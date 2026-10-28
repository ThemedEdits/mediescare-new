'use strict';
// Shared checks that stop a user from giving away more power than they have, or reaching another branch.
const { fail } = require('../core/errors');

function rolePermissions(role) {
  try { return JSON.parse(role.permissions || '[]'); } catch (_) { return []; }
}

// True when every permission of the role is one the actor also has.
function withinActor(ctx, role) {
  if (ctx.isSuper) return true;
  if (role.is_super) return false;
  // Non-super admins (like branch admins) cannot edit Branch Admin or Super Admin
  if (role.name === 'Branch Admin' || role.name === 'Super Admin') return false;
  return rolePermissions(role).every((p) => ctx.can(p));
}

function assertCanGrantRole(ctx, role) {
  if (!withinActor(ctx, role)) fail('FORBIDDEN', 'error.noPermission');
}

function seesAllBranches(ctx) {
  return ctx.can('branches.view_all');
}

function assertBranchAccess(ctx, branchId) {
  if (!seesAllBranches(ctx) && branchId !== ctx.branchId) fail('FORBIDDEN', 'error.wrongBranch');
}

module.exports = { rolePermissions, withinActor, assertCanGrantRole, seesAllBranches, assertBranchAccess };
