import { store } from '../core/state.js';
import { auditSchemaHealth, diffSchemas } from '../core/schema-diff.js';
import { generateMockInsertStatements } from '../core/mock-data.js';
import { isSqliteLike, quoteIdent } from '../core/dialect.js';
import { t } from '../i18n/translations.js';
import type { TableSchema } from '../types/db.js';
import { copyToClipboard, el, toast } from './dom.js';
import { icon } from './icons.js';

export function renderDbToolsView(container: HTMLElement): void {
  const schema = store.schema;
  const adapter = store.adapter;
  if (!schema || !adapter) {
    container.replaceChildren(el('div', { className: 'empty-state' }, t('disconnected')));
    return;
  }

  const panel = el('div', { className: 'panel-scroll' });

  // 1. Schema Health Audit
  const issues = auditSchemaHealth(schema.tables, schema.dialect);
  const healthCard = el(
    'div',
    { className: 'card' },
    el('h2', { className: 'card-title' }, el('span', {}, `${t('healthCheck')} (${issues.length} 件の提案)`)),
    issues.length === 0
      ? el('p', { style: { margin: '0', color: 'var(--success)', fontWeight: '600' } }, 'すべてのテーブルに Primary Key と適切な外部キーインデックスが設定されています。')
      : el(
          'div',
          { style: { display: 'flex', flexDirection: 'column', gap: '8px' } },
          ...issues.map((iss) =>
            el(
              'div',
              {
                style: {
                  display: 'flex',
                  flexWrap: 'wrap',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '8px',
                  padding: '8px 10px',
                  background: 'var(--bg-subtle)',
                  borderRadius: 'var(--radius-sm)',
                },
              },
              el(
                'div',
                {},
                el('span', { className: `badge ${iss.severity === 'warn' ? 'badge-d1' : 'badge-pg'}`, style: { marginRight: '6px' } }, iss.severity.toUpperCase()),
                el('strong', { className: 'mono' }, iss.table),
                ' — ',
                el('span', { style: { fontSize: '0.82rem' } }, iss.message)
              ),
              iss.suggestionSql
                ? el(
                    'button',
                    {
                      type: 'button',
                      className: 'btn btn-sm btn-primary',
                      onClick: async () => {
                        try {
                          await adapter.query(iss.suggestionSql!);
                          await store.refreshSchema();
                          toast('推奨インデックスを作成しました', 'success');
                          if (store.activeView === 'tools') renderDbToolsView(container);
                        } catch (err) {
                          toast(err instanceof Error ? err.message : String(err), 'error');
                        }
                      },
                    },
                    '1クリックで最適化'
                  )
                : null
            )
          )
        )
  );
  panel.append(healthCard);

  // 2. Mock Data Generator
  const tblSel = el(
    'select',
    { className: 'select select-sm', style: { width: 'auto' }, 'aria-label': '対象テーブル' },
    ...schema.tables.map((tbl) => el('option', { value: tbl.name }, tbl.name))
  );
  const countInp = el('input', { type: 'number', className: 'input input-sm', style: { width: '90px' }, value: '10', min: '1', max: '200', 'aria-label': '生成行数' });
  const mockOut = el('pre', { className: 'code-block', style: { maxHeight: '180px', display: 'none' } });

  const mockCard = el(
    'div',
    { className: 'card' },
    el('h2', { className: 'card-title' }, t('mockGenerator')),
    el('p', { style: { margin: '0 0 10px', fontSize: '0.82rem', color: 'var(--ink-secondary)' } }, 'カラム名とデータ型・外部キー参照を自動解析し、リアルなダミーデータを生成・挿入します。'),
    el(
      'div',
      { className: 'toolbar-group', style: { marginBottom: '10px' } },
      tblSel,
      countInp,
      el(
        'button',
        {
          type: 'button',
          className: 'btn btn-sm btn-primary',
          onClick: async () => {
            const target = schema.tables.find((x) => x.name === tblSel.value);
            if (!target) return;
            const fkPools: Record<string, unknown[]> = {};
            for (const fk of target.foreignKeys) {
              try {
                const res = await adapter.query(
                  `SELECT ${quoteIdent(fk.refColumn, schema.dialect)} FROM ${quoteIdent(fk.refTable, schema.dialect)} LIMIT 50`
                );
                fkPools[fk.column] = res.rows.map((r) => r[0]).filter((v) => v !== null);
              } catch {
                // ignore
              }
            }
            const stmts = generateMockInsertStatements(target, Number(countInp.value) || 10, schema.dialect, fkPools);
            mockOut.style.display = 'block';
            mockOut.textContent = stmts.join('\n');
          },
        },
        icon('sparkles', 13),
        'SQLを生成'
      ),
      el(
        'button',
        {
          type: 'button',
          className: 'btn btn-sm',
          onClick: async () => {
            const sql = mockOut.textContent?.trim();
            if (!sql) {
              toast('先に「SQLを生成」を押してください', 'info');
              return;
            }
            const lines = sql.split('\n').filter(Boolean);
            try {
              for (let i = 0; i < lines.length; i += 40) {
                await adapter.executeBatch(lines.slice(i, i + 40).map((s) => ({ sql: s })));
              }
              await store.refreshSchema();
              toast(`${lines.length} 件のテストデータを挿入しました`, 'success');
            } catch (err) {
              toast(err instanceof Error ? err.message : String(err), 'error', 5000);
            }
          },
        },
        icon('play', 13),
        'DBへ挿入実行'
      )
    ),
    mockOut
  );
  panel.append(mockCard);

  // 3. Schema Diff (Active DB vs ER Model — preserves ER foreign keys M2)
  const diffHost = el('div');
  const runDiff = () => {
    diffHost.replaceChildren();
    if (!store.activeErModel) {
      diffHost.append(el('p', { style: { margin: '0', fontSize: '0.82rem', color: 'var(--ink-muted)' } }, 'ER図デザイナーでモデルを編集すると、現在のDBスキーマとの差分およびマイグレーションSQLを自動生成できます。'));
      return;
    }
    const erById = new Map(store.activeErModel.tables.map((n) => [n.id, n]));
    const targetTables: TableSchema[] = store.activeErModel.tables.map((n) => ({
      name: n.name,
      type: 'table',
      columns: n.columns,
      indexes: [],
      foreignKeys: store.activeErModel!.relations
        .filter((r) => r.sourceTableId === n.id)
        .map((r) => ({
          name: r.name,
          column: r.sourceColumn,
          refTable: erById.get(r.targetTableId)?.name || '',
          refColumn: r.targetColumn,
          onDelete: r.onDelete,
          onUpdate: r.onUpdate,
        }))
        .filter((fk) => fk.refTable !== ''),
    }));
    const diffs = diffSchemas(schema.tables, targetTables, schema.dialect);
    if (diffs.length === 0) {
      diffHost.append(el('p', { style: { margin: '0', color: 'var(--success)', fontSize: '0.84rem' } }, '現在のデータベースと ERモデルの構造は一致しています（差分なし）。'));
      return;
    }
    const migrationSql = diffs.map((d) => `-- ${d.description}\n${d.sql}`).join('\n\n');
    diffHost.append(
      el('div', { style: { marginBottom: '8px', fontSize: '0.82rem', fontWeight: '600' } }, `${diffs.length} 件の差分を検出しました`),
      el('pre', { className: 'code-block', style: { maxHeight: '220px' } }, migrationSql),
      el(
        'div',
        { className: 'toolbar-group', style: { marginTop: '8px' } },
        el('button', { type: 'button', className: 'btn btn-sm', onClick: () => copyToClipboard(migrationSql) }, icon('copy', 12), 'マイグレーションSQLをコピー'),
        el('button', { type: 'button', className: 'btn btn-sm btn-primary', onClick: () => store.openSqlWithQuery(migrationSql) }, icon('code', 12), 'SQLエディタで開く')
      )
    );
  };
  runDiff();

  panel.append(
    el(
      'div',
      { className: 'card' },
      el('div', { className: 'card-title' }, el('span', {}, `${t('schemaDiff')} (DB ↔ ERモデル)`), el('button', { type: 'button', className: 'btn btn-sm', onClick: runDiff }, icon('diff', 12), '差分を再計算')),
      diffHost
    )
  );

  // 4. Server Info & Maintenance
  const infoHost = el('div', { style: { fontSize: '0.82rem', color: 'var(--ink-muted)' } }, '読み込み中...');
  adapter.getServerInfo().then((rows) => {
    infoHost.replaceChildren(
      el(
        'table',
        { className: 'data-table' },
        el('thead', {}, el('tr', {}, el('th', {}, 'Parameter'), el('th', {}, 'Value'))),
        el('tbody', {}, ...rows.map((r) => el('tr', {}, el('td', {}, r.key), el('td', {}, r.value))))
      )
    );
  });

  const maintBtns = isSqliteLike(schema.dialect)
    ? el(
        'div',
        { className: 'toolbar-group' },
        el(
          'button',
          {
            type: 'button',
            className: 'btn btn-sm',
            onClick: async () => {
              try {
                await adapter.query('VACUUM');
                toast('VACUUM が完了しました', 'success');
              } catch (err) {
                toast(err instanceof Error ? err.message : String(err), 'error');
              }
            },
          },
          'VACUUM'
        ),
        el(
          'button',
          {
            type: 'button',
            className: 'btn btn-sm',
            onClick: async () => {
              try {
                await adapter.query('ANALYZE');
                toast('ANALYZE が完了しました', 'success');
              } catch (err) {
                toast(err instanceof Error ? err.message : String(err), 'error');
              }
            },
          },
          'ANALYZE'
        )
      )
    : null;

  panel.append(
    el(
      'div',
      { className: 'card' },
      el('div', { className: 'card-title' }, el('span', {}, `${t('serverInfo')} (${schema.serverVersion})`), maintBtns),
      infoHost
    )
  );

  container.replaceChildren(panel);
}
