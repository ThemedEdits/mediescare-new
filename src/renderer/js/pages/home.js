// Home: greeting, next steps for administrators, this computer, recent activity.
import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { t } from '../strings/index.js';
import { call } from '../api.js';
import { state, can } from '../state.js';
import * as fmt from '../ui/format.js';

export async function render(page, { navigate }) {
  const me = state.me;
  const device = state.app.device;
  page.append(h('div.page-head', h('div',
    h('h1', t('home.greeting', { name: me.user.fullName.split(' ')[0] })),
    h('p.sub', t('home.sub', { branch: me.branch.name, role: me.user.roleName })))));

  const steps = [
    can('branches.create') && { icon: 'building', title: t('home.stepBranches'), text: t('home.stepBranchesText'), go: () => navigate('branches') },
    can('users.create') && { icon: 'users', title: t('home.stepUsers'), text: t('home.stepUsersText'), go: () => navigate('users') },
    can('roles.edit') && { icon: 'shield', title: t('home.stepRoles'), text: t('home.stepRolesText'), go: () => navigate('roles') },
    can('settings.edit') && { icon: 'settings', title: t('home.stepSettings'), text: t('home.stepSettingsText'), go: () => navigate('settings') },
  ].filter(Boolean);

  if (steps.length) {
    page.append(h('div.card', h('div.card-head', h('div', h('h2', t('home.setupTitle')), h('p.small.muted', t('home.setupSub')))),
      h('div.card-body', h('div.grid-2', ...steps.map((s) => h('button.choice', { type: 'button', onclick: s.go },
        h('div.row', icon(s.icon), h('h3', s.title)), h('p.small.muted', s.text)))))));
  }

  const computer = h('div.card', h('div.card-head', h('h2', t('home.thisComputer'))),
    h('div.card-body', h('dl.kv',
      h('dt', t('devices.name')), h('dd', device.name),
      h('dt', t('devices.kind')), h('dd', device.kind === 'primary' ? t('devices.primary') : t('devices.client')),
      h('dt', t('devices.number')), h('dd', String(device.deviceNo)),
      h('dt', t('shell.branch')), h('dd', `${device.branch.name} (${device.branch.code})`),
      h('dt', t('shell.syncTitle')), h('dd', t('shell.syncNotSetUp')))),
    h('div.card-body', { style: { paddingTop: 0 } }, h('div.form-note', icon('info', 'sm'), h('div', t('home.modulesNote')))));

  const recent = h('div.card', h('div.card-head', h('h2', t('home.recent')),
    can('audit.view') ? h('a.small', { href: '#/audit' }, t('home.viewAll')) : null));
  const grid = h('div.grid-2', { style: { marginTop: '16px' } }, computer);
  if (can('audit.view')) {
    grid.append(recent);
    try {
      const res = await call('audit.list', { pageSize: 10 });
      const list = h('div', { style: { padding: '4px 0' } });
      if (!res.rows.length) list.append(h('p.muted', { style: { padding: '16px' } }, t('home.recentEmpty')));
      for (const r of res.rows) {
        list.append(h('a.menu-item', { href: `#/audit?open=${r.id}`, style: { textDecoration: 'none', borderRadius: 0, padding: '8px 16px' } },
          h('div.grow', h('div', r.summary || fmt.humanize(r.action)), h('div.small.faint', `${r.username || ''} - ${fmt.relative(r.at)}`))));
      }
      recent.append(list);
    } catch (err) {
      recent.append(h('p.muted', { style: { padding: '16px' } }, err.message));
    }
  }
  page.append(grid);
}
