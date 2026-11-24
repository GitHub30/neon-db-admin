import { store } from '../core/state.js';
import { generateSelectSql, getDialectBadgeInfo, quoteIdent } from '../core/dialect.js';
import { t } from '../i18n/translations.js';
import type { ConnectionConfig } from '../types/db.js';
import { confirmSqlModal, el, toast } from './dom.js';
import { icon } from './icons.js';

let treeFilter = '';

export interface SidebarCallbacks {
  onOpenConnections: (editing?: ConnectionConfig) => void;
  onCreateTable: () => void;
}

export function renderSidebar(container: HTMLElement, cb: SidebarCallbacks): void {
  container.className = `sidebar ${store.sidebarOpen ? 'open' : ''}`;

  const searchInput = el('input', {
    type: 'search',
    className: 'input input-sm',
    placeholder: t('searchObjects'),
    value: treeFilter,
    'aria-label': t('searchObjects'),
    onInput: (e: Event) => {
      treeFilter = (e.target as HTMLInputElement).value;
      renderBody(bodyEl);
    },
  });

  const header = el(
    'div',
    { className: 'sidebar-header' },
    el(
      'div',
      { className: 'sidebar-actions' },
      el(
        'button',
        { type: 'button', className: 'btn btn-primary btn-sm', style: { flex: '1' }, onClick: () => cb.onOpenConnections() },
        icon('plus', 13),
        t('newConnection')
      ),
      el(
        'button',
        {
          type: 'button',
          className: 'btn btn-sm btn-icon',
          title: t('refresh'),
          'aria-label': t('refresh'),
          onClick: async () => {
            try {
              await store.refreshSchema();
              toast('スキーマを更新しました', 'success', 1800);
            } catch (err) {
              toast(err instanceof Error ? err.message : String(err), 'error');
            }
          },
        },
        icon('refresh', 14)
      )
    ),
    searchInput
  );

  const bodyEl = el('div', { className: 'sidebar-body' });
  renderBody(bodyEl);
  container.replaceChildren(header, bodyEl);

  function renderBody(host: HTMLElement) {
    host.replaceChildren();
    const q = treeFilter.trim().toLowerCase();

    // Saved Connections Switcher (with Edit & Delete buttons for custom connections — M6)
    const connSection = el(
      'div',
      { className: 'tree-section' },
      el('div', { className: 'tree-section-head' }, el('span', {}, t('connections')), el('span', {}, String(store.connections.length)))
    );

    for (const c of store.connections) {
      const isActive = store.activeConnection?.id === c.id;
      const badge = getDialectBadgeInfo(c.dialect);
      const isCustom = !c.id.startsWith('demo-');
      connSection.append(
        el(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: '2px' } },
          el(
            'button',
            {
              type: 'button',
              className: `tree-item ${isActive ? 'active' : ''}`,
              style: { flex: '1', minWidth: '0' },
              onClick: async () => {
                if (isActive) return;
                try {
                  await store.connectTo(c);
                  toast(`${c.name} に接続しました`, 'success', 2000);
                } catch (err) {
                  toast(err instanceof Error ? err.message : String(err), 'error', 4500);
                }
              },
            },
            el('span', { className: 'tree-item-main' }, icon('database', 14), el('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis' } }, c.name)),
            el('span', { className: `badge ${badge.colorClass}` }, badge.label)
          ),
          isCustom
            ? el(
                'button',
                {
                  type: 'button',
                  className: 'btn btn-ghost btn-sm',
                  style: { padding: '2px 5px', minHeight: '28px', minWidth: '28px' },
                  'aria-label': `接続 ${c.name} を編集`,
                  onClick: () => cb.onOpenConnections(c),
                },
                icon('edit', 12)
              )
            : null,
          isCustom
            ? el(
                'button',
                {
                  type: 'button',
                  className: 'btn btn-ghost btn-sm',
                  style: { padding: '2px 5px', minHeight: '28px', minWidth: '28px', color: 'var(--danger)' },
                  'aria-label': `接続 ${c.name} を削除`,
                  onClick: () => {
                    store.deleteConnection(c.id);
                    toast(`接続 "${c.name}" を削除しました`, 'info');
                  },
                },
                icon('trash', 12)
              )
            : null
        )
      );
    }
    host.append(connSection);

    const schema = store.schema;
    if (!schema) {
      host.append(el('div', { style: { padding: '12px', color: 'var(--ink-muted)', fontSize: '0.8rem' } }, store.loadingStatus || t('disconnected')));
      return;
    }

    // Tables
    const tables = schema.tables.filter((tbl) => !q || tbl.name.toLowerCase().includes(q));
    const tableSection = el(
      'div',
      { className: 'tree-section' },
      el(
        'div',
        { className: 'tree-section-head' },
        el('span', {}, `${t('tables')} (${tables.length})`),
        el(
          'button',
          {
            type: 'button',
            className: 'btn btn-ghost btn-sm',
            style: { padding: '2px 6px', minHeight: '28px', minWidth: '28px' },
            title: t('createTable'),
            'aria-label': t('createTable'),
            onClick: cb.onCreateTable,
          },
          icon('plus', 13)
        )
      )
    );

    for (const tbl of tables) {
      const isSelected = store.selectedTable === tbl.name;
      tableSection.append(
        el(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: '2px' } },
          el(
            'button',
            {
              type: 'button',
              className: `tree-item ${isSelected ? 'active' : ''}`,
              style: { flex: '1', minWidth: '0' },
              onClick: () => store.selectTable(tbl.name, store.activeView === 'structure' ? 'structure' : 'data'),
            },
            el('span', { className: 'tree-item-main' }, icon('table', 14), el('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis' } }, tbl.name)),
            tbl.rowCount !== undefined ? el('span', { className: 'tree-item-meta' }, tbl.rowCount.toLocaleString()) : null
          ),
          el(
            'button',
            {
              type: 'button',
              className: 'btn btn-ghost btn-sm',
              style: { padding: '2px 5px', minHeight: '28px', minWidth: '28px' },
              title: `SELECT * FROM ${tbl.name}`,
              'aria-label': `${tbl.name} のSELECTクエリを開く`,
              onClick: () => store.openSqlWithQuery(generateSelectSql(tbl.name, schema.dialect, { limit: 100 }) + ';'),
            },
            icon('code', 12)
          ),
          el(
            'button',
            {
              type: 'button',
              className: 'btn btn-ghost btn-sm',
              style: { padding: '2px 5px', minHeight: '28px', minWidth: '28px', color: 'var(--danger)' },
              title: `DROP TABLE ${tbl.name}`,
              'aria-label': `${tbl.name} を削除`,
              onClick: async () => {
                const sql = `DROP TABLE ${quoteIdent(tbl.name, schema.dialect)};`;
                const ok = await confirmSqlModal({ title: `テーブル "${tbl.name}" を削除`, sql, danger: true });
                if (!ok || !store.adapter) return;
                try {
                  await store.adapter.query(sql);
                  await store.refreshSchema();
                  toast(`テーブル "${tbl.name}" を削除しました`, 'success');
                } catch (err) {
                  toast(err instanceof Error ? err.message : String(err), 'error');
                }
              },
            },
            icon('trash', 12)
          )
        )
      );
    }
    host.append(tableSection);

    // Views
    const views = schema.views.filter((v) => !q || v.name.toLowerCase().includes(q));
    if (views.length > 0) {
      const viewSection = el(
        'div',
        { className: 'tree-section' },
        el('div', { className: 'tree-section-head' }, el('span', {}, `${t('views')} (${views.length})`))
      );
      for (const v of views) {
        viewSection.append(
          el(
            'button',
            {
              type: 'button',
              className: `tree-item ${store.selectedTable === v.name ? 'active' : ''}`,
              onClick: () => store.selectTable(v.name, 'data'),
            },
            el('span', { className: 'tree-item-main' }, icon('eye', 14), el('span', {}, v.name))
          )
        );
      }
      host.append(viewSection);
    }

    // Triggers
    const triggers = schema.triggers.filter((tr) => !q || tr.name.toLowerCase().includes(q));
    if (triggers.length > 0) {
      const trgSection = el(
        'div',
        { className: 'tree-section' },
        el('div', { className: 'tree-section-head' }, el('span', {}, `${t('triggers')} (${triggers.length})`))
      );
      for (const tr of triggers) {
        trgSection.append(
          el(
            'button',
            {
              type: 'button',
              className: 'tree-item',
              onClick: () => store.openSqlWithQuery(`-- Trigger: ${tr.name} on ${tr.table}\n${tr.sql};`),
            },
            el('span', { className: 'tree-item-main' }, icon('zap', 14), el('span', {}, tr.name)),
            el('span', { className: 'tree-item-meta' }, tr.table)
          )
        );
      }
      host.append(trgSection);
    }
  }
}
