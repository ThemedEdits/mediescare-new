'use strict';
// Roles are named sets of permissions, edited as a checklist.
const { newId, nowIso } = require('../core/ids');
const { fail, invalid } = require('../core/errors');
const v = require('../core/validate');
const audit = require('../core/audit');
const { catalogue, isKnown } = require('../core/permissions');
const { rolePermissions, withinActor, assertCanGrantRole } = require('./guards');

function shape(ctx, r) {
  return {
    id: r.id, name: r.name, description: r.description, permissions: rolePermissions(r), isSuper: r.is_super === 1,
    isSystem: r.is_system === 1, active: r.active === 1, userCount: r.user_count || 0, updatedAt: r.updated_at,
    // The screen greys out roles this user may not edit or hand out.
    canManage: !r.is_super && withinActor(ctx, r),
  };
}

function load(db, id) {
  const role = db.prepare(`SELECT r.*, (SELECT COUNT(*) FROM users u WHERE u.role_id = r.id AND u.status = 'active') AS user_count
    FROM roles r WHERE r.id = ?`).get(id);
  if (!role) fail('NOT_FOUND', 'error.notFound', { thing: 'role' });
  return role;
}

function readPermissions(ctx, params) {
  const list = Array.isArray(params.permissions) ? params.permissions : [];
  const unique = [...new Set(list.map(String))];
  for (const p of unique) {
    if (!isKnown(p)) invalid('permissions', 'error.invalid', { field: 'Permission list' });
    // Nobody can create a role more powerful than themselves.
    if (!ctx.can(p)) fail('FORBIDDEN', 'error.noPermission');
  }
  return unique.sort();
}

function assertNameFree(db, name, exceptId) {
  const clash = db.prepare('SELECT id FROM roles WHERE name = ? COLLATE NOCASE AND id <> ?').get(name, exceptId || '');
  if (clash) invalid('name', 'roles.nameTaken');
}

function register(define) {
  define('roles.catalog', { perm: ['roles.view', 'users.view'] }, () => catalogue());

  define('roles.list', { perm: ['roles.view', 'users.view'] }, (ctx, params) => {
    const rows = ctx.db.prepare(`SELECT r.*, (SELECT COUNT(*) FROM users u WHERE u.role_id = r.id AND u.status = 'active') AS user_count
      FROM roles r ORDER BY r.is_super DESC, r.name`).all();
    return rows.filter((r) => params.includeInactive || r.active).map((r) => shape(ctx, r));
  });

  define('roles.get', { perm: 'roles.view' }, (ctx, params) => shape(ctx, load(ctx.db, v.id(params, 'id'))));

  define('roles.create', { perm: 'roles.create' }, (ctx, params) => {
    const name = v.text(params, 'name', 'Role name', { required: true, max: 60 });
    const description = v.text(params, 'description', 'Description', { max: 300 });
    const permissions = readPermissions(ctx, params);
    assertNameFree(ctx.db, name);
    const id = newId();
    const now = nowIso();
    ctx.db.transaction(() => {
      ctx.db.prepare(`INSERT INTO roles (id, name, description, permissions, is_super, is_system, active, created_at, updated_at)
        VALUES (?, ?, ?, ?, 0, 0, 1, ?, ?)`).run(id, name, description, JSON.stringify(permissions), now, now);
      audit.write(ctx.db, ctx.actor, { module: 'roles', action: 'create', recordType: 'role', recordId: id, summary: `Role ${name} created with ${permissions.length} permissions`, new: { name, description, permissions } });
    })();
    return shape(ctx, load(ctx.db, id));
  });

  define('roles.update', { perm: 'roles.edit' }, (ctx, params) => {
    const role = load(ctx.db, v.id(params, 'id'));
    if (role.is_super) fail('FORBIDDEN', 'roles.systemLocked');
    assertCanGrantRole(ctx, role);
    const name = v.text(params, 'name', 'Role name', { required: true, max: 60 });
    const description = v.text(params, 'description', 'Description', { max: 300 });
    const permissions = readPermissions(ctx, params);
    assertNameFree(ctx.db, name, role.id);
    const before = { name: role.name, description: role.description, permissions: rolePermissions(role) };
    const after = { name, description, permissions };
    const change = audit.diff(before, after);
    if (!change.changed) return shape(ctx, role);
    const added = permissions.filter((p) => !before.permissions.includes(p));
    const removed = before.permissions.filter((p) => !permissions.includes(p));
    ctx.db.transaction(() => {
      ctx.db.prepare('UPDATE roles SET name = ?, description = ?, permissions = ?, updated_at = ? WHERE id = ?')
        .run(name, description, JSON.stringify(permissions), nowIso(), role.id);
      audit.write(ctx.db, ctx.actor, {
        module: 'roles', action: 'update', recordType: 'role', recordId: role.id,
        summary: `Role ${name} changed` + (added.length ? `, added: ${added.join(', ')}` : '') + (removed.length ? `, removed: ${removed.join(', ')}` : ''),
        old: change.old, new: change.new,
      });
    })();
    return shape(ctx, load(ctx.db, role.id));
  });

  define('roles.setActive', { perm: 'roles.delete' }, (ctx, params) => {
    const role = load(ctx.db, v.id(params, 'id'));
    if (role.is_super) fail('FORBIDDEN', 'roles.systemLocked');
    assertCanGrantRole(ctx, role);
    const active = v.bool(params, 'active');
    if (!active && role.user_count > 0) fail('IN_USE', 'roles.inUse', { count: role.user_count });
    if ((role.active === 1) === active) return shape(ctx, role);
    ctx.db.transaction(() => {
      ctx.db.prepare('UPDATE roles SET active = ?, updated_at = ? WHERE id = ?').run(active ? 1 : 0, nowIso(), role.id);
      audit.write(ctx.db, ctx.actor, { module: 'roles', action: active ? 'activate' : 'deactivate', recordType: 'role', recordId: role.id, summary: `Role ${role.name} ${active ? 're-activated' : 'deactivated'}`, reason: v.text(params, 'reason', 'Reason', { max: 300 }) });
    })();
    return shape(ctx, load(ctx.db, role.id));
  });
}

module.exports = { register };
