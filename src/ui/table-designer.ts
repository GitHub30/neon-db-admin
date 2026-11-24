import { store } from '../core/state.js';
import {
  generateCreateTableDdl,
  getDataTypesForDialect,
  isSqliteLike,
  makeColumn,
  quoteIdent,
} from '../core/dialect.js';
import { t } from '../i18n/translations.js';
import type { ColumnSchema, DbDialect, TableSchema } from '../types/db.js';
import { confirmSqlModal, copyToClipboard, el, labeledField, openModal, toast } from './dom.js';
import { icon } from './icons.js';

export function openCreateTableModal(): void {
  const schema = store.schema;
  const adapter = store.adapter;
  if (!schema || !adapter) {
    toast('先にデータベースへ接続してください', 'error');
    return;
  }

  const dialect = schema.dialect;
  const types = getDataTypesForDialect(dialect);
  let tableName = 'new_table';
  const columns: ColumnSchema[] = [
    makeColumn({ name: 'id', type: types[0], isPrimaryKey: true, isAutoIncrement: true, nullable: false }),
    makeColumn({ name: 'name', type: dialect === 'sqlite' ? 'TEXT' : 'VARCHAR(255)', nullable: false }),
    makeColumn({ name: 'created_at', type: dialect === 'postgresql' ? 'TIMESTAMPTZ' : 'DATETIME', nullable: false, defaultValue: 'CURRENT_TIMESTAMP' }),
  ];

  openModal({
    title: `${t('createTable')} (${dialect.toUpperCase()})`,
    large: true,
    renderBody: (body, close) => {
      const render = () => {
        body.replaceChildren();
        const ddlPreview = generateCreateTableDdl({ name: tableName || 'untitled', columns, foreignKeys: [] }, dialect);

        const nameInp = el('input', {
          type: 'text',
          className: 'input mono',
          value: tableName,
          onInput: (e: Event) => {
            tableName = (e.target as HTMLInputElement).value.trim();
            pre.textContent = generateCreateTableDdl({ name: tableName || 'untitled', columns, foreignKeys: [] }, dialect);
          },
        });

        const pre = el('pre', { className: 'code-block' }, ddlPreview);
        const rowsWrap = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } });

        columns.forEach((col, i) => {
          const cName = el('input', {
            type: 'text',
            className: 'input input-sm mono',
            value: col.name,
            placeholder: 'column_name',
            onInput: (e: Event) => {
              col.name = (e.target as HTMLInputElement).value;
              pre.textContent = generateCreateTableDdl({ name: tableName || 'untitled', columns, foreignKeys: [] }, dialect);
            },
          });
          const cType = el(
            'select',
            {
              className: 'select select-sm mono',
              onChange: (e: Event) => {
                col.type = (e.target as HTMLSelectElement).value;
                pre.textContent = generateCreateTableDdl({ name: tableName || 'untitled', columns, foreignKeys: [] }, dialect);
              },
            },
            ...Array.from(new Set([col.type, ...types])).map((tp) => el('option', { value: tp, selected: tp === col.type }, tp))
          );
          const cDef = el('input', {
            type: 'text',
            className: 'input input-sm mono',
            value: col.defaultValue || '',
            placeholder: 'DEFAULT',
            onInput: (e: Event) => {
              const v = (e.target as HTMLInputElement).value;
              col.defaultValue = v === '' ? null : v;
              pre.textContent = generateCreateTableDdl({ name: tableName || 'untitled', columns, foreignKeys: [] }, dialect);
            },
          });

          rowsWrap.append(
            el(
              'div',
              {
                style: {
                  display: 'grid',
                  gridTemplateColumns: '1.3fr 1.2fr 1fr auto auto auto auto',
                  gap: '6px',
                  alignItems: 'center',
                },
              },
              cName,
              cType,
              cDef,
              el(
                'label',
                { style: { fontSize: '0.72rem', display: 'inline-flex', gap: '3px', alignItems: 'center' } },
                el('input', {
                  type: 'checkbox',
                  checked: col.isPrimaryKey,
                  onChange: (e: Event) => {
                    col.isPrimaryKey = (e.target as HTMLInputElement).checked;
                    if (col.isPrimaryKey) col.nullable = false;
                    render();
                  },
                }),
                'PK'
              ),
              el(
                'label',
                { style: { fontSize: '0.72rem', display: 'inline-flex', gap: '3px', alignItems: 'center' } },
                el('input', {
                  type: 'checkbox',
                  checked: !col.nullable,
                  onChange: (e: Event) => {
                    col.nullable = !(e.target as HTMLInputElement).checked;
                    render();
                  },
                }),
                'NN'
              ),
              el(
                'label',
                { style: { fontSize: '0.72rem', display: 'inline-flex', gap: '3px', alignItems: 'center' } },
                el('input', {
                  type: 'checkbox',
                  checked: col.isAutoIncrement,
                  onChange: (e: Event) => {
                    col.isAutoIncrement = (e.target as HTMLInputElement).checked;
                    render();
                  },
                }),
                'AI'
              ),
              el(
                'button',
                {
                  type: 'button',
                  className: 'btn btn-ghost btn-sm',
                  style: { color: 'var(--danger)' },
                  'aria-label': 'カラム削除',
                  onClick: () => {
                    if (columns.length <= 1) return;
                    columns.splice(i, 1);
                    render();
                  },
                },
                icon('trash', 13)
              )
            )
          );
        });

        body.append(
          el('div', { className: 'field' }, el('label', { className: 'label' }, 'テーブル名'), nameInp),
          el(
            'div',
            { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
            el('strong', { style: { fontSize: '0.84rem' } }, 'カラム定義'),
            el(
              'button',
              {
                type: 'button',
                className: 'btn btn-sm',
                onClick: () => {
                  columns.push(makeColumn({ name: `col_${columns.length + 1}`, type: types[1] || 'TEXT' }));
                  render();
                },
              },
              icon('plus', 13),
              'カラム追加'
            )
          ),
          rowsWrap,
          el('div', { className: 'field' }, el('label', { className: 'label' }, '生成DDLプレビュー'), pre),
          el(
            'div',
            { style: { display: 'flex', justifyContent: 'flex-end', gap: '8px' } },
            el('button', { type: 'button', className: 'btn', onClick: close }, t('cancel')),
            el(
              'button',
              {
                type: 'button',
                className: 'btn btn-primary',
                onClick: async () => {
                  if (!tableName.trim()) {
                    toast('テーブル名を入力してください', 'error');
                    return;
                  }
                  const sql = generateCreateTableDdl({ name: tableName.trim(), columns, foreignKeys: [] }, dialect);
                  try {
                    await adapter.query(sql);
                    await store.refreshSchema();
                    store.selectTable(tableName.trim(), 'structure');
                    close();
                    toast(`テーブル "${tableName}" を作成しました`, 'success');
                  } catch (err) {
                    toast(err instanceof Error ? err.message : String(err), 'error', 5000);
                  }
                },
              },
              icon('check', 13),
              t('createTable')
            )
          )
        );
      };
      render();
    },
  });
}

export function renderStructureView(container: HTMLElement): void {
  const schema = store.schema;
  const adapter = store.adapter;
  const tableName = store.selectedTable;
  const table: TableSchema | undefined = schema?.tables.find((x) => x.name === tableName);

  if (!schema || !adapter) {
    container.replaceChildren(el('div', { className: 'empty-state' }, t('disconnected')));
    return;
  }

  if (!table) {
    container.replaceChildren(
      el(
        'div',
        { className: 'empty-state' },
        icon('wrench', 32),
        el('p', {}, 'テーブルを選択するとカラム・インデックス・外部キー・DDLを確認・変更できます。'),
        el('button', { type: 'button', className: 'btn btn-primary', onClick: openCreateTableModal }, icon('plus', 14), t('createTable'))
      )
    );
    return;
  }

  const dialect = schema.dialect;
  let convertTarget: DbDialect = dialect;

  const panel = el('div', { className: 'panel-scroll' });

  // Action bar
  panel.append(
    el(
      'div',
      { style: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '8px' } },
      el(
        'div',
        { className: 'toolbar-group' },
        el('h2', { style: { margin: '0', fontSize: '1.05rem' } }, table.name),
        el('span', { className: 'badge' }, `${table.columns.length} columns`),
        table.rowCount !== undefined ? el('span', { className: 'badge' }, `${table.rowCount.toLocaleString()} rows`) : null
      ),
      el(
        'div',
        { className: 'toolbar-group' },
        el('button', { type: 'button', className: 'btn btn-sm btn-primary', onClick: openCreateTableModal }, icon('plus', 13), t('createTable')),
        el(
          'button',
          {
            type: 'button',
            className: 'btn btn-sm',
            onClick: () => {
              const nameInp = el('input', { type: 'text', className: 'input mono', placeholder: 'new_column' });
              const typeSel = el(
                'select',
                { className: 'select mono' },
                ...getDataTypesForDialect(dialect).map((tp) => el('option', { value: tp }, tp))
              );
              const defInp = el('input', { type: 'text', className: 'input mono', placeholder: "例: '' または 0" });
              openModal({
                title: `${table.name} にカラムを追加 (ALTER TABLE)`,
                renderBody: (b) => {
                  b.append(
                    labeledField('カラム名', nameInp),
                    labeledField('データ型', typeSel),
                    labeledField('DEFAULT (任意)', defInp)
                  );
                },
                renderFooter: (f, close) => {
                  f.append(
                    el('button', { type: 'button', className: 'btn', onClick: close }, t('cancel')),
                    el(
                      'button',
                      {
                        type: 'button',
                        className: 'btn btn-primary',
                        onClick: async () => {
                          if (!nameInp.value.trim()) {
                            toast('カラム名を入力してください', 'error');
                            return;
                          }
                          const defPart = defInp.value.trim() ? ` DEFAULT ${defInp.value.trim()}` : '';
                          const sql = `ALTER TABLE ${quoteIdent(table.name, dialect)} ADD COLUMN ${quoteIdent(nameInp.value.trim(), dialect)} ${typeSel.value}${defPart};`;
                          try {
                            await adapter.query(sql);
                            await store.refreshSchema();
                            close();
                            toast('カラムを追加しました', 'success');
                          } catch (err) {
                            toast(err instanceof Error ? err.message : String(err), 'error', 5000);
                          }
                        },
                      },
                      'カラム追加'
                    )
                  );
                },
              });
            },
          },
          icon('plus', 13),
          'カラム追加'
        ),
        el(
          'button',
          {
            type: 'button',
            className: 'btn btn-sm',
            onClick: () => {
              const idxName = el('input', { type: 'text', className: 'input mono', value: `idx_${table.name}_${table.columns[0]?.name || 'col'}` });
              const colSel = el('select', { className: 'select mono' }, ...table.columns.map((c) => el('option', { value: c.name }, c.name)));
              const uniqChk = el('input', { type: 'checkbox' });
              openModal({
                title: `${table.name} にインデックスを作成`,
                renderBody: (b) => {
                  b.append(
                    labeledField('インデックス名', idxName),
                    labeledField('対象カラム', colSel),
                    el('label', { style: { display: 'inline-flex', gap: '6px', alignItems: 'center' } }, uniqChk, 'UNIQUE インデックス')
                  );
                },
                renderFooter: (f, close) => {
                  f.append(
                    el('button', { type: 'button', className: 'btn', onClick: close }, t('cancel')),
                    el(
                      'button',
                      {
                        type: 'button',
                        className: 'btn btn-primary',
                        onClick: async () => {
                          const cleanIdx = idxName.value.trim();
                          if (!cleanIdx) {
                            toast('インデックス名を入力してください', 'error');
                            return;
                          }
                          const sql = `CREATE ${uniqChk.checked ? 'UNIQUE ' : ''}INDEX ${quoteIdent(cleanIdx, dialect)} ON ${quoteIdent(table.name, dialect)} (${quoteIdent(colSel.value, dialect)});`;
                          try {
                            await adapter.query(sql);
                            await store.refreshSchema();
                            close();
                            toast('インデックスを作成しました', 'success');
                          } catch (err) {
                            toast(err instanceof Error ? err.message : String(err), 'error', 5000);
                          }
                        },
                      },
                      '作成'
                    )
                  );
                },
              });
            },
          },
          icon('key', 13),
          'インデックス作成'
        ),
        el(
          'button',
          {
            type: 'button',
            className: 'btn btn-sm btn-danger',
            onClick: async () => {
              const sql = isSqliteLike(dialect) ? `DELETE FROM ${quoteIdent(table.name, dialect)};` : `TRUNCATE TABLE ${quoteIdent(table.name, dialect)};`;
              const ok = await confirmSqlModal({ title: `テーブル "${table.name}" を空にする (Truncate)`, sql, danger: true });
              if (!ok) return;
              try {
                await adapter.query(sql);
                await store.refreshSchema();
                toast('テーブルのデータをすべて削除しました', 'success');
              } catch (err) {
                toast(err instanceof Error ? err.message : String(err), 'error');
              }
            },
          },
          '全行削除 (Truncate)'
        )
      )
    )
  );

  // Columns Table
  const colRows = table.columns.map((c) =>
    el(
      'tr',
      {},
      el(
        'td',
        {},
        el('strong', {}, c.name),
        c.isPrimaryKey ? el('span', { className: 'badge badge-pk', style: { marginLeft: '6px' } }, 'PK') : null,
        c.isAutoIncrement ? el('span', { className: 'badge', style: { marginLeft: '4px' } }, 'AI') : null,
        c.isUnique ? el('span', { className: 'badge', style: { marginLeft: '4px' } }, 'UNIQUE') : null
      ),
      el('td', {}, c.type),
      el('td', {}, c.nullable ? 'YES' : 'NO'),
      el('td', {}, c.defaultValue ?? 'NULL'),
      el('td', {}, c.comment || '—')
    )
  );

  panel.append(
    el(
      'div',
      { className: 'card' },
      el('h3', { className: 'card-title' }, 'カラム構造'),
      el(
        'div',
        { className: 'table-scroll' },
        el(
          'table',
          { className: 'data-table' },
          el('thead', {}, el('tr', {}, el('th', {}, 'Name'), el('th', {}, 'Type'), el('th', {}, 'Nullable'), el('th', {}, 'Default'), el('th', {}, 'Comment'))),
          el('tbody', {}, ...colRows)
        )
      )
    )
  );

  // Foreign Keys & Indexes
  const fkCard = el(
    'div',
    { className: 'card' },
    el('h3', { className: 'card-title' }, `${t('foreignKeys')} (${table.foreignKeys.length})`),
    table.foreignKeys.length === 0
      ? el('p', { style: { margin: '0', color: 'var(--ink-muted)', fontSize: '0.82rem' } }, '外部キー制約はありません。')
      : el(
          'div',
          { className: 'table-scroll' },
          el(
            'table',
            { className: 'data-table' },
            el('thead', {}, el('tr', {}, el('th', {}, 'Name'), el('th', {}, 'Column'), el('th', {}, 'References'), el('th', {}, 'ON DELETE'), el('th', {}, 'ON UPDATE'))),
            el(
              'tbody',
              {},
              ...table.foreignKeys.map((fk) =>
                el(
                  'tr',
                  {},
                  el('td', {}, fk.name),
                  el('td', {}, fk.column),
                  el('td', {}, `${fk.refTable}.${fk.refColumn}`),
                  el('td', {}, fk.onDelete),
                  el('td', {}, fk.onUpdate)
                )
              )
            )
          )
        )
  );

  const idxCard = el(
    'div',
    { className: 'card' },
    el('h3', { className: 'card-title' }, `${t('indexes')} (${table.indexes.length})`),
    table.indexes.length === 0
      ? el('p', { style: { margin: '0', color: 'var(--ink-muted)', fontSize: '0.82rem' } }, 'インデックスはありません。')
      : el(
          'div',
          { className: 'table-scroll' },
          el(
            'table',
            { className: 'data-table' },
            el('thead', {}, el('tr', {}, el('th', {}, 'Index Name'), el('th', {}, 'Columns'), el('th', {}, 'Unique'), el('th', {}, 'Action'))),
            el(
              'tbody',
              {},
              ...table.indexes.map((idx) =>
                el(
                  'tr',
                  {},
                  el('td', {}, idx.name),
                  el('td', {}, idx.columns.join(', ') || '—'),
                  el('td', {}, idx.unique ? 'UNIQUE' : 'NORMAL'),
                  el(
                    'td',
                    {},
                    !idx.primary
                      ? el(
                          'button',
                          {
                            type: 'button',
                            className: 'btn btn-ghost btn-sm',
                            style: { color: 'var(--danger)' },
                            onClick: async () => {
                              const sql =
                                dialect === 'mysql' || dialect === 'mariadb'
                                  ? `DROP INDEX ${quoteIdent(idx.name, dialect)} ON ${quoteIdent(table.name, dialect)};`
                                  : `DROP INDEX ${quoteIdent(idx.name, dialect)};`;
                              const ok = await confirmSqlModal({ title: `インデックス "${idx.name}" を削除`, sql, danger: true });
                              if (!ok) return;
                              try {
                                await adapter.query(sql);
                                await store.refreshSchema();
                                toast('インデックスを削除しました', 'success');
                              } catch (err) {
                                toast(err instanceof Error ? err.message : String(err), 'error');
                              }
                            },
                          },
                          icon('trash', 12),
                          'Drop'
                        )
                      : 'PK'
                  )
                )
              )
            )
          )
        )
  );

  // DDL Viewer & Cross-Dialect Converter
  const ddlPre = el('pre', { className: 'code-block' }, table.ddl || generateCreateTableDdl(table, dialect));
  const convertSel = el(
    'select',
    {
      className: 'select select-sm',
      style: { width: 'auto' },
      'aria-label': t('ddlConverter'),
      onChange: (e: Event) => {
        convertTarget = (e.target as HTMLSelectElement).value as DbDialect;
        ddlPre.textContent = convertTarget === dialect && table.ddl ? table.ddl : generateCreateTableDdl(table, convertTarget);
      },
    },
    ...(['sqlite', 'mysql', 'mariadb', 'postgresql', 'd1'] as DbDialect[]).map((d) =>
      el('option', { value: d, selected: d === dialect }, `${d.toUpperCase()}${d === dialect ? ' (Original)' : ' へ変換'}`)
    )
  );

  const ddlCard = el(
    'div',
    { className: 'card' },
    el(
      'div',
      { className: 'card-title' },
      el('span', {}, `CREATE TABLE DDL (${t('ddlConverter')})`),
      el(
        'div',
        { className: 'toolbar-group' },
        convertSel,
        el('button', { type: 'button', className: 'btn btn-sm', onClick: () => copyToClipboard(ddlPre.textContent || '') }, icon('copy', 12), 'Copy DDL')
      )
    ),
    ddlPre
  );

  panel.append(fkCard, idxCard, ddlCard);
  container.replaceChildren(panel);
}
