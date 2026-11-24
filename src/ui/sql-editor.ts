import { store } from '../core/state.js';
import { generateExplainSql, isDestructiveSql, isMysqlLike, SQL_KEYWORDS } from '../core/dialect.js';
import { formatSql, splitSqlStatements } from '../core/sql-formatter.js';
import { renderHighlightedSql } from '../core/sql-highlighter.js';
import { downloadBlob, toCsv, toJson, toMarkdownTable, toNdjson, toSqlInserts } from '../core/csv-json.js';
import { t } from '../i18n/translations.js';
import type { QueryResult } from '../types/db.js';
import { confirmSqlModal, copyToClipboard, el, labeledField, openModal, toast } from './dom.js';
import { icon } from './icons.js';

interface SqlTab {
  id: string;
  title: string;
  sql: string;
  results: QueryResult[];
  activeResultIdx: number;
  resultMode: 'table' | 'chart';
  running: boolean;
  error: string | null;
}

const tabs: SqlTab[] = [
  {
    id: 'sql-1',
    title: 'Query 1',
    sql: `-- Ctrl+Enter で実行 / Ctrl+Space で補完候補を表示
SELECT
  c.full_name,
  c.tier,
  COUNT(o.id) AS orders_count,
  COALESCE(SUM(o.total_jpy), 0) AS total_spent_jpy
FROM customers c
LEFT JOIN orders o ON o.customer_id = c.id
GROUP BY c.id
ORDER BY total_spent_jpy DESC;`,
    results: [],
    activeResultIdx: 0,
    resultMode: 'table',
    running: false,
    error: null,
  },
];

let activeTabId = 'sql-1';
let sideTab: 'history' | 'snippets' = 'snippets';

function getActiveTab(): SqlTab {
  return tabs.find((x) => x.id === activeTabId) || tabs[0];
}

function getAutocompleteCandidates(prefix: string): Array<{ label: string; kind: string }> {
  const lower = prefix.toLowerCase();
  const candidates: Array<{ label: string; kind: string }> = [];
  const seen = new Set<string>();

  if (store.schema) {
    for (const tbl of store.schema.tables) {
      if (tbl.name.toLowerCase().startsWith(lower) && !seen.has(tbl.name)) {
        seen.add(tbl.name);
        candidates.push({ label: tbl.name, kind: 'TABLE' });
      }
      for (const col of tbl.columns) {
        if (col.name.toLowerCase().startsWith(lower) && !seen.has(`${tbl.name}.${col.name}`)) {
          seen.add(`${tbl.name}.${col.name}`);
          candidates.push({ label: col.name, kind: tbl.name });
        }
      }
    }
    for (const v of store.schema.views) {
      if (v.name.toLowerCase().startsWith(lower) && !seen.has(v.name)) {
        seen.add(v.name);
        candidates.push({ label: v.name, kind: 'VIEW' });
      }
    }
  }

  for (const kw of SQL_KEYWORDS) {
    if (kw.toLowerCase().startsWith(lower) && !seen.has(kw)) {
      seen.add(kw);
      candidates.push({ label: kw, kind: 'SQL' });
    }
  }

  return candidates.slice(0, 14);
}

async function executeStatements(tab: SqlTab, rawSql: string, container: HTMLElement, explain = false): Promise<void> {
  const adapter = store.adapter;
  const conn = store.activeConnection;
  if (!adapter || !conn) {
    toast('データベースに接続してください', 'error');
    return;
  }

  const stmts = splitSqlStatements(rawSql, isMysqlLike(conn.dialect));
  if (stmts.length === 0) {
    toast('実行するSQLを入力してください', 'info');
    return;
  }

  const finalStmts = explain ? [generateExplainSql(stmts[0], conn.dialect)] : stmts;

  if (!explain && finalStmts.some(isDestructiveSql)) {
    const confirmed = await confirmSqlModal({
      title: t('destructiveTitle'),
      sql: finalStmts.join(';\n'),
      danger: true,
    });
    if (!confirmed) return;
  }

  tab.running = true;
  tab.error = null;
  if (store.activeView === 'sql') renderSqlEditorView(container);

  const started = performance.now();
  try {
    let results: QueryResult[];
    // Execute multi-statement scripts as a single batch so transactions (BEGIN/COMMIT) stay on one connection (M3)
    if (finalStmts.length > 1 && finalStmts.length <= 50) {
      results = await adapter.executeBatch(finalStmts.map((sql) => ({ sql })));
    } else {
      results = [];
      for (const stmt of finalStmts) {
        results.push(await adapter.query(stmt));
      }
    }

    const schemaDirty = finalStmts.some((stmt) => /^\s*(CREATE|ALTER|DROP|RENAME)\b/i.test(stmt));
    tab.results = results;
    tab.activeResultIdx = Math.max(0, results.length - 1);
    const totalMs = Math.round((performance.now() - started) * 100) / 100;
    const last = results[results.length - 1];
    store.addHistory({
      sql: rawSql.trim(),
      dialect: conn.dialect,
      connectionName: conn.name,
      durationMs: totalMs,
      rowCount: last?.rowCount ?? 0,
      status: 'ok',
    });

    if (schemaDirty) {
      await store.refreshSchema();
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    tab.error = msg;
    tab.results = [];
    store.addHistory({
      sql: rawSql.trim(),
      dialect: conn.dialect,
      connectionName: conn.name,
      durationMs: Math.round((performance.now() - started) * 100) / 100,
      rowCount: 0,
      status: 'error',
      error: msg,
    });
  } finally {
    tab.running = false;
    // Guard against overwriting another view if user switched tabs mid-query (H6)
    if (store.activeView === 'sql') renderSqlEditorView(container);
  }
}

export function renderSqlEditorView(container: HTMLElement): void {
  if (store.pendingSqlToLoad !== null) {
    const cur = getActiveTab();
    cur.sql = store.pendingSqlToLoad;
    store.pendingSqlToLoad = null;
  }

  const tab = getActiveTab();
  let acPopup: HTMLElement | null = null;
  let acCandidates: Array<{ label: string; kind: string }> = [];
  let acIndex = 0;

  // Sub-tabs bar — sibling buttons inside wrapper div (eliminates nested-interactive axe violation H11)
  const subtabsBar = el('div', { className: 'sql-editor-tabs' });
  for (const item of tabs) {
    subtabsBar.append(
      el(
        'div',
        { className: `sql-subtab ${item.id === tab.id ? 'active' : ''}` },
        el(
          'button',
          {
            type: 'button',
            className: 'sql-subtab-btn',
            onClick: () => {
              activeTabId = item.id;
              renderSqlEditorView(container);
            },
          },
          icon('code', 12),
          item.title
        ),
        tabs.length > 1
          ? el(
              'button',
              {
                type: 'button',
                className: 'sql-subtab-close',
                'aria-label': `${item.title} を閉じる`,
                onClick: () => {
                  const idx = tabs.findIndex((x) => x.id === item.id);
                  tabs.splice(idx, 1);
                  if (activeTabId === item.id) activeTabId = tabs[Math.max(0, idx - 1)].id;
                  renderSqlEditorView(container);
                },
              },
              '×'
            )
          : null
      )
    );
  }
  subtabsBar.append(
    el(
      'button',
      {
        type: 'button',
        className: 'btn btn-ghost btn-sm',
        style: { marginBottom: '4px' },
        'aria-label': '新しいクエリタブを追加',
        onClick: () => {
          const nextNum = tabs.length + 1;
          const nt: SqlTab = {
            id: `sql-${Date.now()}`,
            title: `Query ${nextNum}`,
            sql: '',
            results: [],
            activeResultIdx: 0,
            resultMode: 'table',
            running: false,
            error: null,
          };
          tabs.push(nt);
          activeTabId = nt.id;
          renderSqlEditorView(container);
        },
      },
      icon('plus', 13)
    )
  );

  // Code Editor with synchronized syntax highlight & line numbers
  const gutter = el('div', { className: 'sql-gutter', 'aria-hidden': 'true' });
  const highlight = el('pre', { className: 'sql-highlight', 'aria-hidden': 'true' });
  const textarea = el('textarea', {
    className: 'sql-textarea',
    value: tab.sql,
    spellcheck: 'false',
    autocomplete: 'off',
    autocapitalize: 'off',
    'aria-label': 'SQL クエリエディタ',
  });

  const syncVisuals = () => {
    const val = textarea.value;
    tab.sql = val;
    renderHighlightedSql(highlight, val);
    const lineCount = Math.max(1, val.split('\n').length);
    const nums: string[] = [];
    for (let i = 1; i <= lineCount; i++) nums.push(String(i));
    gutter.textContent = nums.join('\n');
    highlight.scrollTop = textarea.scrollTop;
    highlight.scrollLeft = textarea.scrollLeft;
    gutter.scrollTop = textarea.scrollTop;
  };

  const hideAc = () => {
    acPopup?.remove();
    acPopup = null;
    acCandidates = [];
  };

  const applyAc = (label: string) => {
    const pos = textarea.selectionStart;
    const before = textarea.value.slice(0, pos);
    const after = textarea.value.slice(pos);
    const match = before.match(/[A-Za-z_][A-Za-z0-9_]*$/);
    const start = match ? pos - match[0].length : pos;
    textarea.value = textarea.value.slice(0, start) + label + after;
    const newPos = start + label.length;
    textarea.setSelectionRange(newPos, newPos);
    syncVisuals();
    hideAc();
    textarea.focus();
  };

  const showAc = (force = false) => {
    const pos = textarea.selectionStart;
    const before = textarea.value.slice(0, pos);
    const match = before.match(/[A-Za-z_][A-Za-z0-9_]*$/);
    const prefix = match ? match[0] : '';
    if (!force && prefix.length < 2) {
      hideAc();
      return;
    }
    acCandidates = getAutocompleteCandidates(prefix);
    if (acCandidates.length === 0) {
      hideAc();
      return;
    }
    acIndex = 0;
    renderAcPopup();
  };

  const renderAcPopup = () => {
    if (!acPopup) {
      acPopup = el('div', { className: 'autocomplete-popup', role: 'listbox', 'aria-label': 'SQL補完候補' });
      editorBox.append(acPopup);
    }
    acPopup.replaceChildren(
      ...acCandidates.map((cand, idx) =>
        el(
          'button',
          {
            type: 'button',
            role: 'option',
            'aria-selected': String(idx === acIndex),
            className: `ac-item ${idx === acIndex ? 'active' : ''}`,
            onMouseDown: (e: Event) => {
              e.preventDefault();
              applyAc(cand.label);
            },
          },
          el('span', {}, cand.label),
          el('span', { className: 'badge' }, cand.kind)
        )
      )
    );
  };

  textarea.addEventListener('input', () => {
    syncVisuals();
    showAc(false);
  });

  textarea.addEventListener('scroll', () => {
    highlight.scrollTop = textarea.scrollTop;
    highlight.scrollLeft = textarea.scrollLeft;
    gutter.scrollTop = textarea.scrollTop;
  });

  textarea.addEventListener('keydown', (e: KeyboardEvent) => {
    if (acPopup && acCandidates.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        acIndex = (acIndex + 1) % acCandidates.length;
        renderAcPopup();
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        acIndex = (acIndex - 1 + acCandidates.length) % acCandidates.length;
        renderAcPopup();
        return;
      }
      if (e.key === 'Tab' || e.key === 'Enter') {
        e.preventDefault();
        applyAc(acCandidates[acIndex].label);
        return;
      }
      if (e.key === 'Escape') {
        hideAc();
        return;
      }
    }

    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      const selected = textarea.value.slice(textarea.selectionStart, textarea.selectionEnd).trim();
      executeStatements(tab, selected || textarea.value, container, false);
      return;
    }

    if (e.ctrlKey && e.code === 'Space') {
      e.preventDefault();
      showAc(true);
      return;
    }

    if (e.key === 'Tab') {
      e.preventDefault();
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      textarea.value = textarea.value.slice(0, start) + '  ' + textarea.value.slice(end);
      textarea.setSelectionRange(start + 2, start + 2);
      syncVisuals();
    }
  });

  textarea.addEventListener('blur', () => setTimeout(hideAc, 120));

  const editorBox = el(
    'div',
    { className: 'sql-editor-box' },
    gutter,
    el('div', { className: 'sql-code-layer' }, highlight, textarea)
  );
  syncVisuals();

  // Toolbar
  const toolbar = el(
    'div',
    { className: 'pane-toolbar' },
    el(
      'div',
      { className: 'toolbar-group' },
      el(
        'button',
        {
          type: 'button',
          className: 'btn btn-sm btn-primary',
          disabled: tab.running,
          onClick: () => executeStatements(tab, textarea.value, container, false),
        },
        icon('play', 13),
        tab.running ? t('loading') : t('runQuery')
      ),
      el(
        'button',
        {
          type: 'button',
          className: 'btn btn-sm',
          disabled: tab.running,
          onClick: () => {
            const sel = textarea.value.slice(textarea.selectionStart, textarea.selectionEnd).trim();
            executeStatements(tab, sel || textarea.value, container, false);
          },
        },
        t('runSelected')
      ),
      el(
        'button',
        {
          type: 'button',
          className: 'btn btn-sm',
          disabled: tab.running,
          onClick: () => {
            const sel = textarea.value.slice(textarea.selectionStart, textarea.selectionEnd).trim();
            executeStatements(tab, sel || textarea.value, container, true);
          },
        },
        icon('zap', 13),
        t('explainQuery')
      )
    ),
    el(
      'div',
      { className: 'toolbar-group' },
      el(
        'button',
        {
          type: 'button',
          className: 'btn btn-sm',
          onClick: () => {
            textarea.value = formatSql(textarea.value);
            syncVisuals();
          },
        },
        icon('sparkles', 13),
        t('formatSql')
      ),
      el(
        'button',
        {
          type: 'button',
          className: 'btn btn-sm',
          onClick: () => {
            if (!textarea.value.trim()) return;
            const titleInp = el('input', { type: 'text', className: 'input', placeholder: 'スニペット名 (例: 月次売上集計)' });
            openModal({
              title: t('saveSnippet'),
              renderBody: (b) => b.append(labeledField('タイトル', titleInp)),
              renderFooter: (f, close) => {
                f.append(
                  el('button', { type: 'button', className: 'btn', onClick: close }, t('cancel')),
                  el(
                    'button',
                    {
                      type: 'button',
                      className: 'btn btn-primary',
                      onClick: () => {
                        const title = titleInp.value.trim() || `Snippet ${store.snippets.length + 1}`;
                        store.addSnippet(title, textarea.value.trim());
                        close();
                        toast(t('saved'), 'success');
                        renderSqlEditorView(container);
                      },
                    },
                    t('saveSnippet')
                  )
                );
              },
            });
          },
        },
        icon('bookmark', 13),
        t('saveSnippet')
      ),
      el(
        'button',
        {
          type: 'button',
          className: 'btn btn-sm',
          onClick: () => {
            textarea.value = '';
            syncVisuals();
          },
        },
        t('clear')
      )
    )
  );

  // Results Area
  const resultsPane = el('div', { className: 'sql-results' });
  if (tab.error) {
    resultsPane.append(
      el(
        'div',
        { style: { padding: '16px' } },
        el('div', { style: { color: 'var(--danger)', fontWeight: '700', marginBottom: '6px' } }, 'SQL Execution Error'),
        el('pre', { className: 'code-block', style: { color: 'var(--danger)' } }, tab.error)
      )
    );
  } else if (tab.results.length > 0) {
    const activeRes = tab.results[tab.activeResultIdx] || tab.results[0];
    const colNames = activeRes.columns.map((c) => c.name);

    const resToolbar = el(
      'div',
      { className: 'pane-toolbar' },
      el(
        'div',
        { className: 'toolbar-group' },
        ...(tab.results.length > 1
          ? tab.results.map((_, i) =>
              el(
                'button',
                {
                  type: 'button',
                  className: `btn btn-sm ${i === tab.activeResultIdx ? 'btn-primary' : ''}`,
                  onClick: () => {
                    tab.activeResultIdx = i;
                    renderSqlEditorView(container);
                  },
                },
                `Result #${i + 1}`
              )
            )
          : []),
        el(
          'span',
          { className: 'badge badge-sqlite' },
          activeRes.columns.length > 0
            ? `${activeRes.rowCount.toLocaleString()} ${t('rows')}${activeRes.truncated ? ' (capped)' : ''}`
            : `${activeRes.affectedRows} ${t('affected')}`
        ),
        el('span', { className: 'mono', style: { fontSize: '0.75rem', color: 'var(--ink-muted)' } }, `${activeRes.durationMs} ${t('ms')}`)
      ),
      el(
        'div',
        { className: 'toolbar-group' },
        activeRes.columns.length >= 2 && activeRes.rows.length > 0
          ? el(
              'button',
              {
                type: 'button',
                className: `btn btn-sm ${tab.resultMode === 'chart' ? 'btn-primary' : ''}`,
                onClick: () => {
                  tab.resultMode = tab.resultMode === 'table' ? 'chart' : 'table';
                  renderSqlEditorView(container);
                },
              },
              icon('chart', 13),
              tab.resultMode === 'chart' ? t('tableView') : t('chartView')
            )
          : null,
        activeRes.columns.length > 0
          ? el('button', { type: 'button', className: 'btn btn-sm', onClick: () => downloadBlob(toCsv(colNames, activeRes.rows), 'query_result.csv', 'text/csv;charset=utf-8') }, 'CSV')
          : null,
        activeRes.columns.length > 0
          ? el('button', { type: 'button', className: 'btn btn-sm', onClick: () => downloadBlob(toJson(colNames, activeRes.rows), 'query_result.json', 'application/json;charset=utf-8') }, 'JSON')
          : null,
        activeRes.columns.length > 0
          ? el('button', { type: 'button', className: 'btn btn-sm hide-sm', onClick: () => downloadBlob(toNdjson(colNames, activeRes.rows), 'query_result.ndjson', 'application/x-ndjson') }, 'NDJSON')
          : null,
        activeRes.columns.length > 0
          ? el('button', { type: 'button', className: 'btn btn-sm hide-sm', onClick: () => copyToClipboard(toMarkdownTable(colNames, activeRes.rows)) }, 'MD')
          : null,
        activeRes.columns.length > 0
          ? el(
              'button',
              {
                type: 'button',
                className: 'btn btn-sm hide-sm',
                onClick: () => copyToClipboard(toSqlInserts('exported_table', colNames, activeRes.rows, store.activeConnection?.dialect || 'sqlite')),
              },
              'SQL'
            )
          : null
      )
    );
    resultsPane.append(resToolbar);

    if (activeRes.columns.length === 0) {
      resultsPane.append(
        el(
          'div',
          { className: 'empty-state' },
          icon('check', 28),
          el('strong', {}, `クエリが正常に完了しました (${activeRes.affectedRows} ${t('affected')}, ${activeRes.durationMs}ms)`),
          activeRes.insertId != null ? el('span', { className: 'mono' }, `Last Insert ID: ${activeRes.insertId}`) : null
        )
      );
    } else if (tab.resultMode === 'chart') {
      const chartHost = el('div', { style: { flex: '1', minHeight: '0', overflow: 'auto' } });
      resultsPane.append(chartHost);
      import('./charts.js').then(({ renderResultChart }) => renderResultChart(chartHost, activeRes));
    } else {
      const tblScroll = el('div', { className: 'table-scroll' });
      const headRow = el('tr', {}, ...activeRes.columns.map((c) => el('th', {}, c.name)));
      const bodyRows = activeRes.rows.map((r) =>
        el(
          'tr',
          {},
          ...r.map((val) => {
            const td = el('td', { className: typeof val === 'number' ? 'cell-num' : '' });
            if (val === null || val === undefined) td.append(el('span', { className: 'cell-null' }, 'NULL'));
            else td.textContent = String(val);
            return td;
          })
        )
      );
      tblScroll.append(el('table', { className: 'data-table' }, el('thead', {}, headRow), el('tbody', {}, ...bodyRows)));
      resultsPane.append(tblScroll);
    }
  } else {
    resultsPane.append(
      el('div', { className: 'empty-state' }, icon('play', 28), el('p', { style: { margin: '0' } }, 'Ctrl+Enter で SQL クエリを実行します。Ctrl+Space でテーブル・カラム名の自動補完が使えます。'))
    );
  }

  // Right Side Panel: Snippets & Query History (accessible sibling buttons — no clickable div H11)
  const sideList = el('div', { className: 'sql-side-list' });
  if (sideTab === 'snippets') {
    for (const s of store.snippets) {
      sideList.append(
        el(
          'div',
          { className: 'history-card', style: { display: 'flex', flexDirection: 'column', gap: '4px' } },
          el(
            'div',
            { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '4px' } },
            el(
              'button',
              {
                type: 'button',
                className: 'btn btn-ghost btn-sm',
                style: { flex: '1', justifyContent: 'flex-start', padding: '2px 4px', fontWeight: '700' },
                onClick: () => {
                  textarea.value = s.sql;
                  syncVisuals();
                },
              },
              s.title
            ),
            el(
              'button',
              {
                type: 'button',
                className: 'btn btn-ghost btn-sm',
                style: { padding: '2px 6px', minHeight: '28px', minWidth: '28px' },
                'aria-label': `スニペット ${s.title} を削除`,
                onClick: () => {
                  store.deleteSnippet(s.id);
                  renderSqlEditorView(container);
                },
              },
              icon('trash', 12)
            )
          ),
          el('div', { className: 'history-sql' }, s.sql)
        )
      );
    }
  } else {
    if (store.history.length === 0) {
      sideList.append(el('div', { style: { padding: '12px', color: 'var(--ink-muted)', fontSize: '0.78rem' } }, 'クエリ実行履歴はまだありません。'));
    }
    for (const h of store.history) {
      sideList.append(
        el(
          'button',
          {
            type: 'button',
            className: 'history-card',
            onClick: () => {
              textarea.value = h.sql;
              syncVisuals();
            },
          },
          el(
            'div',
            { style: { display: 'flex', justifyContent: 'space-between', marginBottom: '4px', fontSize: '0.7rem' } },
            el('span', { style: { color: h.status === 'ok' ? 'var(--success)' : 'var(--danger)', fontWeight: '600' } }, h.status === 'ok' ? `${h.rowCount} rows · ${h.durationMs}ms` : 'ERROR'),
            el('span', { style: { color: 'var(--ink-muted)' } }, new Date(h.timestamp).toLocaleTimeString())
          ),
          el('div', { className: 'history-sql' }, h.sql)
        )
      );
    }
  }

  const sidePanel = el(
    'aside',
    { className: 'sql-side', 'aria-label': 'スニペットと履歴' },
    el(
      'div',
      { className: 'pane-toolbar', style: { padding: '6px 8px' } },
      el(
        'div',
        { className: 'toolbar-group' },
        el(
          'button',
          {
            type: 'button',
            className: `btn btn-sm ${sideTab === 'snippets' ? 'btn-primary' : 'btn-ghost'}`,
            onClick: () => {
              sideTab = 'snippets';
              renderSqlEditorView(container);
            },
          },
          icon('bookmark', 12),
          t('snippets')
        ),
        el(
          'button',
          {
            type: 'button',
            className: `btn btn-sm ${sideTab === 'history' ? 'btn-primary' : 'btn-ghost'}`,
            onClick: () => {
              sideTab = 'history';
              renderSqlEditorView(container);
            },
          },
          icon('clock', 12),
          t('history')
        )
      ),
      sideTab === 'history' && store.history.length > 0
        ? el(
            'button',
            {
              type: 'button',
              className: 'btn btn-ghost btn-sm',
              onClick: () => {
                store.clearHistory();
                renderSqlEditorView(container);
              },
            },
            t('clear')
          )
        : null
    ),
    sideList
  );

  const mainCol = el('div', { className: 'sql-main' }, subtabsBar, toolbar, editorBox, resultsPane);
  container.replaceChildren(el('div', { className: 'sql-layout' }, mainCol, sidePanel));
}
