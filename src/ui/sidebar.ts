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

  const activeConn = store.activeConnection;
  const savedActiveConn = activeConn
    ? store.connections.find((c) => c.id === activeConn.id)
    : undefined;

  // Compact Connection Switcher Dropdown (replaces multi-row connection list)
  const connSelect = el(
    'select',
    {
      id: 'sidebar-connection-select',
      className: 'select select-sm',
      style: { flex: '1', minWidth: '0', minHeight: '32px' },
      'aria-label': t('connections'),
      onChange: async (e: Event) => {
        const id = (e.target as HTMLSelectElement).value;
        if (!id) return;
        const target = store.connections.find((c) => c.id === id);
        if (!target || store.activeConnection?.id === target.id) return;
        try {
          await store.connectTo(target);
          toast(`${target.name} ${t('connectedSuffix')}`, 'success', 2000);
        } catch (err) {
          toast(err instanceof Error ? err.message : String(err), 'error', 4500);
          renderSidebar(container, cb);
        }
      },
    },
    ...(!activeConn
      ? [
          el(
            'option',
            { value: '', selected: true, disabled: store.connections.length > 0 },
            store.connections.length === 0 ? t('noConnectionsOption') : t('selectConnectionOption')
          ),
        ]
      : []),
    ...(activeConn && !savedActiveConn
      ? [
          el(
            'option',
            { value: activeConn.id, selected: true },
            `[${getDialectBadgeInfo(activeConn.dialect).label}] ${activeConn.name}`
          ),
        ]
      : []),
    ...store.connections.map((c) =>
      el(
        'option',
        { value: c.id, selected: activeConn?.id === c.id },
        `[${getDialectBadgeInfo(c.dialect).label}] ${c.name}`
      )
    )
  );

  const connDropdownRow = el(
    'div',
    { style: { display: 'flex', alignItems: 'center', gap: '4px' } },
    connSelect,
    savedActiveConn
      ? el(
          'button',
          {
            type: 'button',
            className: 'btn btn-ghost btn-sm',
            style: { padding: '2px 5px', minHeight: '28px', minWidth: '28px' },
            title: t('editConnection'),
            'aria-label': `${t('editConnection')}: ${savedActiveConn.name}`,
            onClick: () => cb.onOpenConnections(savedActiveConn),
          },
          icon('edit', 13)
        )
      : null,
    savedActiveConn
      ? el(
          'button',
          {
            type: 'button',
            className: 'btn btn-ghost btn-sm',
            style: { padding: '2px 5px', minHeight: '28px', minWidth: '28px', color: 'var(--danger)' },
            title: t('deleteConnection'),
            'aria-label': `${t('deleteConnection')}: ${savedActiveConn.name}`,
            onClick: () => {
              store.deleteConnection(savedActiveConn.id);
              toast(`${savedActiveConn.name}: ${t('deleted')}`, 'info');
            },
          },
          icon('trash', 13)
        )
      : null
  );

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
              toast(t('schemaRefreshed'), 'success', 1800);
            } catch (err) {
              toast(err instanceof Error ? err.message : String(err), 'error');
            }
          },
        },
        icon('refresh', 14)
      )
    ),
    connDropdownRow,
    searchInput
  );

  const bodyEl = el('div', { className: 'sidebar-body' });
  renderBody(bodyEl);
  container.replaceChildren(header, bodyEl);

  function renderBody(host: HTMLElement) {
    host.replaceChildren();
    const q = treeFilter.trim().toLowerCase();

    const schema = store.schema;
    if (!schema) {
      host.append(
        el(
          'div',
          { style: { padding: '12px', color: 'var(--ink-muted)', fontSize: '0.8rem' } },
          store.loadingStatus || t('disconnected')
        )
      );
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

    if (tables.length === 0) {
      tableSection.append(
        el('div', { style: { padding: '6px 8px', color: 'var(--ink-muted)', fontSize: '0.78rem' } }, t('noTables'))
      );
    }

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
              'aria-label': `SELECT * FROM ${tbl.name}`,
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
              'aria-label': `DROP TABLE ${tbl.name}`,
              onClick: async () => {
                const sql = `DROP TABLE ${quoteIdent(tbl.name, schema.dialect)};`;
                const ok = await confirmSqlModal({ title: `${t('dropTableTitle')}: ${tbl.name}`, sql, danger: true });
                if (!ok || !store.adapter) return;
                try {
                  await store.adapter.query(sql);
                  await store.refreshSchema();
                  toast(`${tbl.name}: ${t('deleted')}`, 'success');
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
