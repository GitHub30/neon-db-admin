import { store } from '../core/state.js';
import {
  buildRowWhereClause,
  generateInsertSql,
  generateSelectSql,
  getPlaceholder,
  quoteIdent,
  quoteLiteral,
} from '../core/dialect.js';
import { downloadBlob, toCsv, toJson, toMarkdownTable, toSqlInserts } from '../core/csv-json.js';
import { t } from '../i18n/translations.js';
import type { FilterRule, QueryResult, TableSchema } from '../types/db.js';
import { confirmSqlModal, copyToClipboard, el, nextFieldId, openModal, toast } from './dom.js';
import { icon } from './icons.js';

interface GridState {
  tableName: string | null;
  connectionId: string | null;
  schemaRev: number;
  page: number;
  pageSize: number;
  sortCol: string | null;
  sortDir: 'ASC' | 'DESC';
  filters: FilterRule[];
  showFilters: boolean;
  quickSearch: string;
  result: QueryResult | null;
  totalCount: number;
  selectedRows: Set<number>;
  dirtyCells: Map<string, { rowIdx: number; colIdx: number; newValue: unknown }>;
  inspectedCell: { rowIdx: number; colIdx: number } | null;
  loading: boolean;
  error: string | null;
}

const gState: GridState = {
  tableName: null,
  connectionId: null,
  schemaRev: -1,
  page: 0,
  pageSize: 50,
  sortCol: null,
  sortDir: 'ASC',
  filters: [],
  showFilters: false,
  quickSearch: '',
  result: null,
  totalCount: 0,
  selectedRows: new Set(),
  dirtyCells: new Map(),
  inspectedCell: null,
  loading: false,
  error: null,
};

let fetchSeq = 0;

function buildWhereFromFilters(
  filters: FilterRule[],
  dialect: NonNullable<typeof store.schema>['dialect']
): { clause: string; params: unknown[] } {
  const parts: string[] = [];
  const params: unknown[] = [];
  for (const f of filters) {
    if (!f.column) continue;
    const qCol = quoteIdent(f.column, dialect);
    if (f.operator === 'IS NULL' || f.operator === 'IS NOT NULL') {
      parts.push(`${qCol} ${f.operator}`);
    } else if (f.operator === 'IN') {
      const vals = f.value
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s !== '');
      if (vals.length === 0) continue;
      const phs = vals.map((v) => {
        params.push(v);
        return getPlaceholder(dialect, params.length);
      });
      parts.push(`${qCol} IN (${phs.join(', ')})`);
    } else {
      params.push(f.value);
      parts.push(`${qCol} ${f.operator} ${getPlaceholder(dialect, params.length)}`);
    }
  }
  return { clause: parts.join(' AND '), params };
}

async function fetchGridData(container: HTMLElement): Promise<void> {
  const adapter = store.adapter;
  const schema = store.schema;
  const tableName = store.selectedTable;
  if (!adapter || !schema || !tableName) {
    gState.result = null;
    if (store.activeView === 'data') drawGrid(container);
    return;
  }

  const mySeq = ++fetchSeq;
  gState.loading = true;
  gState.error = null;
  if (store.activeView === 'data') drawGrid(container);

  try {
    const { clause, params } = buildWhereFromFilters(gState.filters, schema.dialect);
    const dataSql = generateSelectSql(tableName, schema.dialect, {
      whereClause: clause || undefined,
      orderBy: gState.sortCol || undefined,
      orderDir: gState.sortDir,
      limit: gState.pageSize,
      offset: gState.page * gState.pageSize,
    });
    const countSql = `SELECT COUNT(*) FROM ${quoteIdent(tableName, schema.dialect)}${clause ? ` WHERE ${clause}` : ''}`;

    // Combine SELECT + COUNT(*) into a single round-trip batch (L3)
    const [res, cntRes] = await adapter.executeBatch(
      [
        { sql: dataSql, params },
        { sql: countSql, params },
      ],
      gState.pageSize
    );

    if (mySeq !== fetchSeq) return; // Stale response ignored (H6)

    gState.result = res;
    gState.totalCount = Number(cntRes?.rows?.[0]?.[0] ?? res.rowCount);
    gState.selectedRows.clear();
    gState.dirtyCells.clear();
    gState.inspectedCell = null;
  } catch (err) {
    if (mySeq !== fetchSeq) return;
    gState.error = err instanceof Error ? err.message : String(err);
    gState.result = null;
  } finally {
    if (mySeq === fetchSeq) {
      gState.loading = false;
      if (store.activeView === 'data') drawGrid(container);
    }
  }
}

function getActiveTableSchema(): TableSchema | undefined {
  return store.schema?.tables.find((tbl) => tbl.name === store.selectedTable);
}

function generateUpdateStatements(): {
  previewSql: string;
  statements: Array<{ sql: string; params: unknown[] }>;
  noPrimaryKeyWarning: boolean;
} {
  const schema = store.schema;
  const tableSchema = getActiveTableSchema();
  const res = gState.result;
  if (!schema || !tableSchema || !res) return { previewSql: '', statements: [], noPrimaryKeyWarning: false };

  const dialect = schema.dialect;
  const colNames = res.columns.map((c) => c.name);

  const byRow = new Map<number, Array<{ colIdx: number; newValue: unknown }>>();
  for (const edit of gState.dirtyCells.values()) {
    const arr = byRow.get(edit.rowIdx) || [];
    arr.push({ colIdx: edit.colIdx, newValue: edit.newValue });
    byRow.set(edit.rowIdx, arr);
  }

  const statements: Array<{ sql: string; params: unknown[] }> = [];
  const previews: string[] = [];
  let noPrimaryKeyWarning = false;
  const qTable = quoteIdent(tableSchema.name, dialect);

  for (const [rowIdx, edits] of byRow) {
    const origRow = res.rows[rowIdx];
    if (!origRow) continue;
    const setParts: string[] = [];
    const previewSet: string[] = [];
    const params: unknown[] = [];

    for (const ed of edits) {
      const colName = colNames[ed.colIdx];
      params.push(ed.newValue);
      setParts.push(`${quoteIdent(colName, dialect)} = ${getPlaceholder(dialect, params.length)}`);
      previewSet.push(`${quoteIdent(colName, dialect)} = ${quoteLiteral(ed.newValue, dialect)}`);
    }

    // Build WHERE with exact next placeholder index and safe previewClause (H7)
    const where = buildRowWhereClause(tableSchema, origRow, colNames, dialect, params.length + 1);
    if (!where.clause) continue;
    if (!where.hasPrimaryKey) noPrimaryKeyWarning = true;
    params.push(...where.params);

    statements.push({
      sql: `UPDATE ${qTable} SET ${setParts.join(', ')} WHERE ${where.clause}`,
      params,
    });
    previews.push(`UPDATE ${qTable} SET ${previewSet.join(', ')} WHERE ${where.previewClause};`);
  }

  return { previewSql: previews.join('\n'), statements, noPrimaryKeyWarning };
}

function openInsertRowModal(tableSchema: TableSchema, container: HTMLElement): void {
  const schema = store.schema;
  const adapter = store.adapter;
  if (!schema || !adapter) return;

  const inputs = new Map<string, { input: HTMLInputElement; nullChk: HTMLInputElement }>();

  openModal({
    title: `${tableSchema.name} — ${t('addRow')}`,
    renderBody: (body) => {
      for (const col of tableSchema.columns) {
        const isAuto = col.isPrimaryKey && col.isAutoIncrement;
        const inpId = nextFieldId('ins');
        const inp = el('input', {
          id: inpId,
          type: 'text',
          className: 'input input-sm mono',
          placeholder: isAuto ? '(AUTO_INCREMENT)' : col.defaultValue ? `DEFAULT: ${col.defaultValue}` : col.type,
        });
        const nullChk = el('input', {
          type: 'checkbox',
          checked: isAuto || (col.nullable && !col.defaultValue),
          'aria-label': `${col.name} を NULL/既定値にする`,
        });
        nullChk.addEventListener('change', () => {
          inp.disabled = nullChk.checked;
        });
        inp.disabled = nullChk.checked;
        inputs.set(col.name, { input: inp, nullChk });

        body.append(
          el(
            'div',
            { className: 'field' },
            el(
              'div',
              { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
              el(
                'label',
                { className: 'label', for: inpId, style: { marginBottom: '0' } },
                col.name,
                ' ',
                el('span', { className: 'th-type' }, col.type),
                col.isPrimaryKey ? el('span', { className: 'badge badge-pk', style: { marginLeft: '6px' } }, 'PK') : null
              ),
              el(
                'label',
                { style: { fontSize: '0.72rem', display: 'inline-flex', alignItems: 'center', gap: '4px', color: 'var(--ink-muted)' } },
                nullChk,
                isAuto ? 'Auto' : 'NULL / Default'
              )
            ),
            inp
          )
        );
      }
    },
    renderFooter: (footer, close) => {
      footer.append(
        el('button', { type: 'button', className: 'btn', onClick: close }, t('cancel')),
        el(
          'button',
          {
            type: 'button',
            className: 'btn btn-primary',
            onClick: async () => {
              const cols: string[] = [];
              const vals: unknown[] = [];
              for (const col of tableSchema.columns) {
                const ref = inputs.get(col.name);
                if (!ref) continue;
                if (ref.nullChk.checked) {
                  if (col.isPrimaryKey && col.isAutoIncrement) continue;
                  if (col.defaultValue !== null) continue;
                  cols.push(col.name);
                  vals.push(null);
                } else {
                  cols.push(col.name);
                  vals.push(ref.input.value);
                }
              }
              try {
                const stmt = generateInsertSql(tableSchema.name, cols, vals, schema.dialect, true);
                await adapter.query(stmt.sql, stmt.params);
                close();
                toast('1行を挿入しました', 'success');
                await store.refreshSchema();
                await fetchGridData(container);
              } catch (err) {
                toast(err instanceof Error ? err.message : String(err), 'error', 5000);
              }
            },
          },
          t('addRow')
        )
      );
    },
  });
}

async function runChunkedBatch(statements: Array<{ sql: string; params?: unknown[] }>): Promise<number> {
  if (!store.adapter) return 0;
  let totalAffected = 0;
  for (let i = 0; i < statements.length; i += 40) {
    const results = await store.adapter.executeBatch(statements.slice(i, i + 40));
    for (const r of results) totalAffected += r.affectedRows;
  }
  return totalAffected;
}

function drawGrid(container: HTMLElement): void {
  const schema = store.schema;
  const tableName = store.selectedTable;
  const tableSchema = getActiveTableSchema();
  const isView = !tableSchema && Boolean(schema?.views.some((v) => v.name === tableName));

  if (!schema || !tableName) {
    container.replaceChildren(
      el(
        'div',
        { className: 'empty-state' },
        icon('table', 36),
        el('p', { style: { margin: '0', maxWidth: '420px' } }, t('noTableSelected')),
        el(
          'button',
          { type: 'button', className: 'btn btn-primary', onClick: () => store.setActiveView('sql') },
          icon('code', 15),
          t('tabSql')
        )
      )
    );
    return;
  }

  const fkByCol = new Map((tableSchema?.foreignKeys || []).map((fk) => [fk.column, fk]));
  const pkSet = new Set((tableSchema?.columns || []).filter((c) => c.isPrimaryKey).map((c) => c.name));

  // Decoupled sub-containers so Quick Search & Cell Inspector updates NEVER destroy live table/input nodes (C7)
  const tbodyRef = el('tbody');
  const inspectorSlot = el('div', { style: { display: 'contents' } });
  const actionButtonsSlot = el('div', { className: 'toolbar-group' });

  const renderInspectorOnly = () => {
    inspectorSlot.replaceChildren();
    if (!gState.inspectedCell || !gState.result) return;
    const { rowIdx, colIdx } = gState.inspectedCell;
    const col = gState.result.columns[colIdx];
    const origVal = gState.result.rows[rowIdx]?.[colIdx];
    const dirtyKey = `${rowIdx}:${colIdx}`;
    const currentVal = gState.dirtyCells.has(dirtyKey) ? gState.dirtyCells.get(dirtyKey)!.newValue : origVal;

    let displayStr = currentVal === null || currentVal === undefined ? '' : String(currentVal);
    let isJson = false;
    if (displayStr.trim().startsWith('{') || displayStr.trim().startsWith('[')) {
      try {
        displayStr = JSON.stringify(JSON.parse(displayStr), null, 2);
        isJson = true;
      } catch {
        // not JSON
      }
    }

    const ta = el('textarea', {
      className: 'textarea mono',
      rows: '10',
      value: displayStr,
      readOnly: !tableSchema,
      'aria-label': t('cellInspector'),
    });

    inspectorSlot.append(
      el(
        'aside',
        { className: 'inspector-drawer', 'aria-label': t('cellInspector') },
        el(
          'div',
          { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' } },
          el('strong', { style: { fontSize: '0.85rem' } }, `${col?.name ?? ''} (Row ${rowIdx + 1})`),
          el(
            'button',
            {
              type: 'button',
              className: 'btn btn-ghost btn-icon',
              'aria-label': t('close'),
              onClick: () => {
                gState.inspectedCell = null;
                renderInspectorOnly();
              },
            },
            icon('close', 14)
          )
        ),
        isJson ? el('span', { className: 'badge badge-sqlite' }, 'JSON Formatted') : null,
        ta,
        el(
          'div',
          { className: 'toolbar-group' },
          tableSchema
            ? el(
                'button',
                {
                  type: 'button',
                  className: 'btn btn-sm btn-primary',
                  onClick: () => {
                    const raw = isJson ? tryCompactJson(ta.value) : ta.value;
                    gState.dirtyCells.set(dirtyKey, { rowIdx, colIdx, newValue: raw });
                    renderTbodyOnly();
                    renderActionButtons();
                  },
                },
                t('saveCell')
              )
            : null,
          tableSchema
            ? el(
                'button',
                {
                  type: 'button',
                  className: 'btn btn-sm',
                  onClick: () => {
                    gState.dirtyCells.set(dirtyKey, { rowIdx, colIdx, newValue: null });
                    renderTbodyOnly();
                    renderActionButtons();
                    renderInspectorOnly();
                  },
                },
                t('setNull')
              )
            : null,
          el(
            'button',
            {
              type: 'button',
              className: 'btn btn-sm',
              onClick: () => copyToClipboard(currentVal === null ? 'NULL' : String(currentVal)),
            },
            icon('copy', 12),
            'Copy'
          )
        )
      )
    );
  };

  const renderActionButtons = () => {
    const dirtyCount = gState.dirtyCells.size;
    const selCount = gState.selectedRows.size;
    const btns: Array<Node | null> = [
      tableSchema
        ? el(
            'button',
            { type: 'button', className: 'btn btn-sm btn-primary', onClick: () => openInsertRowModal(tableSchema, container) },
            icon('plus', 13),
            t('addRow')
          )
        : null,
      tableSchema && dirtyCount > 0
        ? el(
            'button',
            {
              type: 'button',
              className: 'btn btn-sm btn-primary',
              onClick: async () => {
                const { previewSql, statements, noPrimaryKeyWarning } = generateUpdateStatements();
                if (!statements.length || !store.adapter) return;
                const desc = noPrimaryKeyWarning
                  ? '注意: このテーブルには主キーがないため、一致する複数行が更新される可能性があります。SQLを確認してください。'
                  : '以下のUPDATE文を実行して変更をデータベースへ反映します。';
                const ok = await confirmSqlModal({
                  title: `${dirtyCount} セルの変更を保存`,
                  description: desc,
                  sql: previewSql,
                  danger: noPrimaryKeyWarning,
                });
                if (!ok) return;
                try {
                  const affected = await runChunkedBatch(statements);
                  toast(`${statements.length} 件のUPDATEを適用しました (影響行: ${affected})`, 'success');
                  await fetchGridData(container);
                } catch (err) {
                  toast(err instanceof Error ? err.message : String(err), 'error', 5000);
                }
              },
            },
            icon('check', 13),
            `${t('commitChanges')} (${dirtyCount})`
          )
        : null,
      dirtyCount > 0
        ? el(
            'button',
            {
              type: 'button',
              className: 'btn btn-sm',
              onClick: () => {
                gState.dirtyCells.clear();
                renderTbodyOnly();
                renderActionButtons();
                renderInspectorOnly();
              },
            },
            t('discardChanges')
          )
        : null,
      tableSchema && selCount > 0
        ? el(
            'button',
            {
              type: 'button',
              className: 'btn btn-sm btn-danger',
              onClick: async () => {
                const res = gState.result;
                if (!res || !store.adapter) return;
                const colNames = res.columns.map((c) => c.name);
                const qTable = quoteIdent(tableSchema.name, schema.dialect);
                const stmts: Array<{ sql: string; params: unknown[] }> = [];
                const previewLines: string[] = [];
                let missingPk = false;

                for (const rIdx of gState.selectedRows) {
                  const row = res.rows[rIdx];
                  if (!row) continue;
                  const where = buildRowWhereClause(tableSchema, row, colNames, schema.dialect, 1);
                  if (!where.clause) continue;
                  if (!where.hasPrimaryKey) missingPk = true;
                  stmts.push({ sql: `DELETE FROM ${qTable} WHERE ${where.clause}`, params: where.params });
                  previewLines.push(`DELETE FROM ${qTable} WHERE ${where.previewClause};`);
                }
                if (!stmts.length) return;
                const ok = await confirmSqlModal({
                  title: `${selCount} 行を削除`,
                  description: missingPk
                    ? '注意: 主キーがないため、全カラム一致する重複行がまとめて削除される可能性があります。'
                    : undefined,
                  sql: previewLines.join('\n'),
                  danger: true,
                });
                if (!ok) return;
                try {
                  const affected = await runChunkedBatch(stmts);
                  toast(`${affected || stmts.length} 行を削除しました`, 'success');
                  await store.refreshSchema();
                  await fetchGridData(container);
                } catch (err) {
                  toast(err instanceof Error ? err.message : String(err), 'error', 5000);
                }
              },
            },
            icon('trash', 13),
            `${t('deleteSelected')} (${selCount})`
          )
        : null,
      el(
        'button',
        {
          type: 'button',
          className: 'btn btn-sm',
          onClick: () => {
            const res = gState.result;
            if (!res) return;
            downloadBlob(toCsv(res.columns.map((c) => c.name), res.rows), `${tableName}.csv`, 'text/csv;charset=utf-8');
          },
        },
        icon('download', 13),
        'CSV'
      ),
      el(
        'button',
        {
          type: 'button',
          className: 'btn btn-sm',
          onClick: () => {
            const res = gState.result;
            if (!res) return;
            downloadBlob(toJson(res.columns.map((c) => c.name), res.rows), `${tableName}.json`, 'application/json;charset=utf-8');
          },
        },
        'JSON'
      ),
      el(
        'button',
        {
          type: 'button',
          className: 'btn btn-sm hide-sm',
          onClick: () => {
            const res = gState.result;
            if (!res) return;
            copyToClipboard(toSqlInserts(tableName, res.columns.map((c) => c.name), res.rows, schema.dialect));
          },
        },
        icon('copy', 12),
        'SQL'
      ),
      el(
        'button',
        {
          type: 'button',
          className: 'btn btn-sm hide-sm',
          onClick: () => {
            const res = gState.result;
            if (!res) return;
            copyToClipboard(toMarkdownTable(res.columns.map((c) => c.name), res.rows));
          },
        },
        'MD'
      ),
    ];
    actionButtonsSlot.replaceChildren(...btns.filter((b): b is Node => b !== null));
  };

  const getVisibleRowIndices = () => {
    const res = gState.result;
    if (!res) return [];
    const searchLower = gState.quickSearch.trim().toLowerCase();
    return res.rows
      .map((r, idx) => ({ r, idx }))
      .filter(({ r }) => !searchLower || r.some((v) => v !== null && String(v).toLowerCase().includes(searchLower)));
  };

  const renderTbodyOnly = () => {
    tbodyRef.replaceChildren();
    const res = gState.result;
    if (!res) return;
    const visibleRowIndices = getVisibleRowIndices();

    for (const { r: row, idx: rowIdx } of visibleRowIndices) {
      const tr = el('tr', { className: gState.selectedRows.has(rowIdx) ? 'selected-row' : '' });
      if (tableSchema) {
        const chk = el('input', {
          type: 'checkbox',
          'aria-label': `行 ${rowIdx + 1} を選択`,
          checked: gState.selectedRows.has(rowIdx),
          onChange: (e: Event) => {
            if ((e.target as HTMLInputElement).checked) gState.selectedRows.add(rowIdx);
            else gState.selectedRows.delete(rowIdx);
            tr.className = gState.selectedRows.has(rowIdx) ? 'selected-row' : '';
            renderActionButtons();
          },
        });
        tr.append(el('td', {}, chk));
      }

      res.columns.forEach((col, colIdx) => {
        const dirtyKey = `${rowIdx}:${colIdx}`;
        const dirty = gState.dirtyCells.get(dirtyKey);
        const val = dirty ? dirty.newValue : row[colIdx];
        const fk = fkByCol.get(col.name);
        const isNum = typeof val === 'number';

        const td = el('td', {
          className: `${dirty ? 'dirty-cell' : ''} ${isNum ? 'cell-num' : ''}`.trim(),
          title: val === null ? 'NULL' : String(val),
          onClick: () => {
            // Only update the inspector panel — keeps live <td> mounted so dblclick fires cleanly (C7)
            gState.inspectedCell = { rowIdx, colIdx };
            renderInspectorOnly();
          },
          onDblclick: () => {
            if (!tableSchema) return;
            startInlineEdit(td, rowIdx, colIdx, val, () => {
              renderTbodyOnly();
              renderActionButtons();
              renderInspectorOnly();
            });
          },
        });

        if (val === null || val === undefined) {
          td.append(el('span', { className: 'cell-null' }, 'NULL'));
        } else if (fk) {
          td.append(
            el(
              'button',
              {
                type: 'button',
                className: 'fk-jump',
                title: `${fk.refTable}.${fk.refColumn} = ${String(val)} へジャンプ`,
                onClick: (e: Event) => {
                  e.stopPropagation();
                  store.jumpToForeignKey(fk.refTable, fk.refColumn, val);
                },
              },
              String(val),
              icon('link', 11)
            )
          );
        } else {
          td.textContent = String(val);
        }
        tr.append(td);
      });
      tbodyRef.append(tr);
    }

    if (visibleRowIndices.length === 0) {
      tbodyRef.append(
        el(
          'tr',
          {},
          el('td', { colSpan: String(res.columns.length + (tableSchema ? 1 : 0)), style: { textAlign: 'center', padding: '24px', color: 'var(--ink-muted)' } }, '該当するレコードがありません。')
        )
      );
    }
  };

  renderActionButtons();

  // Quick Search updates ONLY tbody — preserves focus & cursor on every keystroke (C7)
  const quickInput = el('input', {
    type: 'search',
    className: 'input input-sm',
    style: { width: '170px' },
    placeholder: t('quickSearch'),
    value: gState.quickSearch,
    'aria-label': t('quickSearch'),
    onInput: (e: Event) => {
      gState.quickSearch = (e.target as HTMLInputElement).value;
      renderTbodyOnly();
    },
  });

  const toolbar = el(
    'div',
    { className: 'pane-toolbar' },
    el(
      'div',
      { className: 'toolbar-group' },
      el('strong', { style: { fontSize: '0.88rem' } }, tableName),
      isView ? el('span', { className: 'badge' }, 'VIEW') : el('span', { className: 'badge' }, `${gState.totalCount.toLocaleString()} ${t('rows')}`),
      quickInput,
      el(
        'button',
        {
          type: 'button',
          className: `btn btn-sm ${gState.showFilters || gState.filters.length > 0 ? 'btn-primary' : ''}`,
          onClick: () => {
            gState.showFilters = !gState.showFilters;
            if (gState.showFilters && gState.filters.length === 0 && gState.result?.columns[0]) {
              gState.filters.push({ id: `f-${Date.now()}`, column: gState.result.columns[0].name, operator: '=', value: '' });
            }
            drawGrid(container);
          },
        },
        icon('filter', 13),
        `${t('filter')}${gState.filters.length ? ` (${gState.filters.length})` : ''}`
      ),
      el(
        'button',
        {
          type: 'button',
          className: 'btn btn-sm',
          title: t('refresh'),
          'aria-label': t('refresh'),
          onClick: () => fetchGridData(container),
        },
        icon('refresh', 13)
      )
    ),
    actionButtonsSlot
  );

  // Filter Builder Bar
  let filterBar: HTMLElement | null = null;
  if (gState.showFilters && gState.result) {
    const colOpts = gState.result.columns.map((c) => c.name);
    const ops: FilterRule['operator'][] = ['=', '!=', '>', '>=', '<', '<=', 'LIKE', 'NOT LIKE', 'IN', 'IS NULL', 'IS NOT NULL'];
    filterBar = el('div', { className: 'filter-bar' });

    for (const rule of gState.filters) {
      const colSel = el(
        'select',
        {
          className: 'select select-sm',
          style: { width: '150px' },
          'aria-label': 'フィルタ列',
          onChange: (e: Event) => {
            rule.column = (e.target as HTMLSelectElement).value;
          },
        },
        ...colOpts.map((c) => el('option', { value: c, selected: c === rule.column }, c))
      );
      const opSel = el(
        'select',
        {
          className: 'select select-sm',
          style: { width: '115px' },
          'aria-label': '比較演算子',
          onChange: (e: Event) => {
            rule.operator = (e.target as HTMLSelectElement).value as FilterRule['operator'];
            drawGrid(container);
          },
        },
        ...ops.map((o) => el('option', { value: o, selected: o === rule.operator }, o))
      );
      const valInp = el('input', {
        type: 'text',
        className: 'input input-sm mono',
        style: { width: '200px' },
        'aria-label': 'フィルタ値',
        placeholder: rule.operator === 'LIKE' ? '%keyword%' : rule.operator === 'IN' ? '1, 2, 3' : 'value',
        value: rule.value,
        disabled: rule.operator === 'IS NULL' || rule.operator === 'IS NOT NULL',
        onInput: (e: Event) => {
          rule.value = (e.target as HTMLInputElement).value;
        },
        onKeydown: (e: KeyboardEvent) => {
          if (e.key === 'Enter') {
            gState.page = 0;
            fetchGridData(container);
          }
        },
      });
      filterBar.append(
        el(
          'div',
          { className: 'filter-row' },
          colSel,
          opSel,
          valInp,
          el(
            'button',
            {
              type: 'button',
              className: 'btn btn-ghost btn-sm',
              'aria-label': '条件削除',
              onClick: () => {
                gState.filters = gState.filters.filter((f) => f.id !== rule.id);
                drawGrid(container);
              },
            },
            icon('close', 13)
          )
        )
      );
    }

    filterBar.append(
      el(
        'div',
        { className: 'toolbar-group' },
        el(
          'button',
          {
            type: 'button',
            className: 'btn btn-sm',
            onClick: () => {
              gState.filters.push({ id: `f-${Date.now()}`, column: colOpts[0] || '', operator: '=', value: '' });
              drawGrid(container);
            },
          },
          icon('plus', 12),
          t('addFilter')
        ),
        el(
          'button',
          {
            type: 'button',
            className: 'btn btn-sm btn-primary',
            onClick: () => {
              gState.page = 0;
              fetchGridData(container);
            },
          },
          t('applyFilter')
        ),
        el(
          'button',
          {
            type: 'button',
            className: 'btn btn-sm',
            onClick: () => {
              gState.filters = [];
              gState.page = 0;
              fetchGridData(container);
            },
          },
          t('resetFilter')
        )
      )
    );
  }

  // Table Body + Decoupled Cell Inspector Slot
  const split = el('div', { className: 'grid-body-split' });
  const scrollWrap = el('div', { className: 'table-scroll' });

  if (gState.loading) {
    scrollWrap.append(el('div', { className: 'empty-state' }, t('loading')));
  } else if (gState.error) {
    scrollWrap.append(
      el('div', { className: 'empty-state', style: { color: 'var(--danger)' } }, el('strong', {}, 'Query Error'), el('pre', { className: 'code-block' }, gState.error))
    );
  } else if (gState.result) {
    const res = gState.result;
    const theadRow = el('tr');
    if (tableSchema) {
      const allChk = el('input', {
        type: 'checkbox',
        'aria-label': '全行選択',
        onChange: (e: Event) => {
          const on = (e.target as HTMLInputElement).checked;
          for (const { idx } of getVisibleRowIndices()) {
            if (on) gState.selectedRows.add(idx);
            else gState.selectedRows.delete(idx);
          }
          renderTbodyOnly();
          renderActionButtons();
        },
      });
      theadRow.append(el('th', { style: { width: '36px' } }, allChk));
    }

    for (const col of res.columns) {
      const colSchema = tableSchema?.columns.find((c) => c.name === col.name);
      const isSorted = gState.sortCol === col.name;
      const ariaSort = isSorted ? (gState.sortDir === 'ASC' ? 'ascending' : 'descending') : 'none';
      const sortArrow = isSorted ? (gState.sortDir === 'ASC' ? ' ▲' : ' ▼') : '';
      theadRow.append(
        el(
          'th',
          { 'aria-sort': ariaSort },
          el(
            'button',
            {
              type: 'button',
              className: 'th-sort-btn',
              onClick: () => {
                if (gState.sortCol === col.name) {
                  gState.sortDir = gState.sortDir === 'ASC' ? 'DESC' : 'ASC';
                } else {
                  gState.sortCol = col.name;
                  gState.sortDir = 'ASC';
                }
                gState.page = 0;
                fetchGridData(container);
              },
            },
            el(
              'span',
              { className: 'th-inner' },
              pkSet.has(col.name) ? el('span', { className: 'badge badge-pk' }, 'PK') : null,
              fkByCol.has(col.name) ? el('span', { className: 'badge badge-fk' }, 'FK') : null,
              el('span', {}, `${col.name}${sortArrow}`),
              colSchema ? el('span', { className: 'th-type' }, colSchema.type) : null
            )
          )
        )
      );
    }

    renderTbodyOnly();
    scrollWrap.append(el('table', { className: 'data-table' }, el('thead', {}, theadRow), tbodyRef));
  }

  renderInspectorOnly();
  split.append(scrollWrap, inspectorSlot);

  // Footer Pagination
  const totalPages = Math.max(1, Math.ceil(gState.totalCount / gState.pageSize));
  const pageSizeSel = el(
    'select',
    {
      className: 'select select-sm',
      style: { width: 'auto' },
      'aria-label': t('rowsPerPage'),
      onChange: (e: Event) => {
        gState.pageSize = Number((e.target as HTMLSelectElement).value);
        gState.page = 0;
        fetchGridData(container);
      },
    },
    ...[25, 50, 100, 250, 500].map((sz) => el('option', { value: String(sz), selected: sz === gState.pageSize }, `${sz} / page`))
  );

  const footer = el(
    'div',
    { className: 'grid-footer' },
    el(
      'div',
      { className: 'toolbar-group' },
      el('span', {}, `Page ${gState.page + 1} / ${totalPages}`),
      gState.result ? el('span', { className: 'mono' }, `(${gState.result.durationMs} ${t('ms')})`) : null,
      tableSchema ? el('span', { className: 'hide-sm', style: { color: 'var(--ink-muted)' } }, 'ダブルクリックでインライン編集') : null
    ),
    el(
      'div',
      { className: 'toolbar-group' },
      pageSizeSel,
      el(
        'button',
        {
          type: 'button',
          className: 'btn btn-sm',
          disabled: gState.page <= 0,
          onClick: () => {
            gState.page = Math.max(0, gState.page - 1);
            fetchGridData(container);
          },
        },
        t('prevPage')
      ),
      el(
        'button',
        {
          type: 'button',
          className: 'btn btn-sm',
          disabled: gState.page + 1 >= totalPages,
          onClick: () => {
            gState.page++;
            fetchGridData(container);
          },
        },
        t('nextPage')
      )
    )
  );

  container.replaceChildren(el('div', { className: 'grid-shell' }, toolbar, filterBar, split, footer));
}

function tryCompactJson(val: string): string {
  try {
    return JSON.stringify(JSON.parse(val));
  } catch {
    return val;
  }
}

function startInlineEdit(
  td: HTMLElement,
  rowIdx: number,
  colIdx: number,
  currentVal: unknown,
  onDone: () => void
): void {
  const origStr = currentVal === null || currentVal === undefined ? '' : String(currentVal);
  let edited = false;
  const inp = el('input', {
    type: 'text',
    className: 'cell-editor-input',
    'aria-label': 'セル編集',
    value: origStr,
    onInput: () => {
      edited = true;
    },
  });
  let committed = false;
  const finish = (save: boolean) => {
    if (committed) return;
    committed = true;
    // Prevent blurring an unedited NULL cell from turning NULL into "" (H7)
    if (save && edited && inp.value !== origStr) {
      gState.dirtyCells.set(`${rowIdx}:${colIdx}`, { rowIdx, colIdx, newValue: inp.value });
    }
    onDone();
  };
  inp.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') finish(true);
    if (e.key === 'Escape') finish(false);
  });
  inp.addEventListener('blur', () => finish(true));
  td.replaceChildren(inp);
  inp.focus();
  inp.select();
}

export function renderDataGridView(container: HTMLElement): void {
  const pending = store.pendingDataFilter;
  const curConnId = store.activeConnection?.id ?? null;
  const targetChanged =
    gState.tableName !== store.selectedTable ||
    gState.connectionId !== curConnId ||
    gState.schemaRev !== store.schemaRevision;

  if (pending && pending.table === store.selectedTable) {
    store.pendingDataFilter = null;
    gState.tableName = store.selectedTable;
    gState.connectionId = curConnId;
    gState.schemaRev = store.schemaRevision;
    gState.page = 0;
    gState.sortCol = null;
    gState.showFilters = true;
    gState.filters = [{ id: `fk-${Date.now()}`, column: pending.column, operator: '=', value: pending.value }];
    fetchGridData(container);
    return;
  }

  if (targetChanged) {
    gState.tableName = store.selectedTable;
    gState.connectionId = curConnId;
    gState.schemaRev = store.schemaRevision;
    gState.page = 0;
    gState.sortCol = null;
    gState.filters = [];
    gState.showFilters = false;
    gState.quickSearch = '';
    fetchGridData(container);
    return;
  }

  drawGrid(container);
}
