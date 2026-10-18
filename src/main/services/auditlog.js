'use strict';
// Audit log viewer: filters, one entry, export.
const { fail } = require('../core/errors');
const v = require('../core/validate');
const { seesAllBranches } = require('./guards');
const exporter = require('../core/exporter');

function buildWhere(ctx, params) {
  const where = [];
  const args = {};
  if (!seesAllBranches(ctx)) { where.push('a.branch_id = @branch'); args.branch = ctx.branchId; }
  else if (params.branchId) { where.push('a.branch_id = @branch'); args.branch = params.branchId; }
  if (params.from) { where.push('a.at >= @from'); args.from = String(params.from); }
  if (params.to) { where.push('a.at < @to'); args.to = String(params.to); }
  if (params.userId) { where.push('a.user_id = @user'); args.user = params.userId; }
  if (params.module) { where.push('a.module = @module'); args.module = params.module; }
  if (params.action) { where.push('a.action = @action'); args.action = params.action; }
  if (params.recordType) { where.push('a.record_type = @rtype'); args.rtype = params.recordType; }
  if (params.recordId) { where.push('a.record_id = @rid'); args.rid = params.recordId; }
  if (params.search) {
    where.push("(a.summary LIKE @q ESCAPE '\\' OR a.username LIKE @q ESCAPE '\\' OR a.reason LIKE @q ESCAPE '\\' OR a.record_id LIKE @q ESCAPE '\\')");
    args.q = `%${String(params.search).replace(/[\\%_]/g, (m) => '\\' + m)}%`;
  }
  return { sql: where.length ? 'WHERE ' + where.join(' AND ') : '', args };
}

const COLUMNS = `a.id, a.at, a.user_id, a.username, a.branch_id, b.name AS branch_name, a.device_id, a.module, a.action,
  a.record_type, a.record_id, a.summary, a.reason`;

function shape(r) {
  return {
    id: r.id, at: r.at, userId: r.user_id, username: r.username, branchId: r.branch_id, branchName: r.branch_name, deviceId: r.device_id,
    module: r.module, action: r.action, recordType: r.record_type, recordId: r.record_id, summary: r.summary, reason: r.reason,
    oldValue: r.old_value ? JSON.parse(r.old_value) : null, newValue: r.new_value ? JSON.parse(r.new_value) : null,
  };
}

const SORTABLE = { at: 'a.at', username: 'a.username', module: 'a.module', action: 'a.action', branchName: 'branch_name' };

function list(ctx, params) {
  const { sql, args } = buildWhere(ctx, params);
  const pageSize = Math.min(Math.max(Number(params.pageSize) || 50, 10), 500);
  const page = Math.max(Number(params.page) || 1, 1);
  const sortCol = SORTABLE[params.sort] || 'a.at';
  const dir = params.dir === 'asc' ? 'ASC' : 'DESC';
  const total = ctx.db.prepare(`SELECT COUNT(*) AS n FROM audit_log a ${sql}`).get(args).n;
  const rows = ctx.db.prepare(`SELECT ${COLUMNS} FROM audit_log a LEFT JOIN branches b ON b.id = a.branch_id ${sql}
    ORDER BY ${sortCol} ${dir}, a.id ${dir} LIMIT @limit OFFSET @offset`).all({ ...args, limit: pageSize, offset: (page - 1) * pageSize });
  return { rows: rows.map(shape), total, page, pageSize };
}

function register(define) {
  define('audit.list', { perm: 'audit.view' }, list);

  define('audit.get', { perm: 'audit.view' }, (ctx, params) => {
    const row = ctx.db.prepare(`SELECT a.*, b.name AS branch_name FROM audit_log a LEFT JOIN branches b ON b.id = a.branch_id WHERE a.id = ?`).get(v.id(params, 'id'));
    if (!row) fail('NOT_FOUND', 'error.notFound', { thing: 'audit entry' });
    if (!seesAllBranches(ctx) && row.branch_id !== ctx.branchId) fail('FORBIDDEN', 'error.wrongBranch');
    return shape(row);
  });

  define('audit.filters', { perm: 'audit.view' }, (ctx) => {
    const scope = seesAllBranches(ctx) ? '' : 'WHERE branch_id = @b';
    const args = { b: ctx.branchId };
    return {
      modules: ctx.db.prepare(`SELECT DISTINCT module FROM audit_log ${scope} ORDER BY module`).all(args).map((r) => r.module),
      actions: ctx.db.prepare(`SELECT DISTINCT action FROM audit_log ${scope} ORDER BY action`).all(args).map((r) => r.action),
      users: ctx.db.prepare(`SELECT DISTINCT user_id AS id, username FROM audit_log ${scope ? scope + ' AND' : 'WHERE'} user_id IS NOT NULL ORDER BY username`).all(args),
    };
  });

  define('audit.export', { perm: 'audit.export' }, async (ctx, params) => {
    const { sql, args } = buildWhere(ctx, params);
    const rows = ctx.db.prepare(`SELECT ${COLUMNS} FROM audit_log a LEFT JOIN branches b ON b.id = a.branch_id ${sql} ORDER BY a.at DESC LIMIT 100000`).all(args);
    const columns = [
      { key: 'at', label: 'Date and time' }, { key: 'username', label: 'User' }, { key: 'branch_name', label: 'Branch' },
      { key: 'module', label: 'Module' }, { key: 'action', label: 'Action' }, { key: 'summary', label: 'What happened' },
      { key: 'reason', label: 'Reason' }, { key: 'record_type', label: 'Record type' }, { key: 'record_id', label: 'Record' },
    ];
    return exporter.exportRows(ctx, { title: 'Audit log', format: params.format || 'csv', columns, rows, filters: params, module: 'audit' });
  });
}

module.exports = { register };
