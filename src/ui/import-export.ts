import { store } from '../core/state.js';
import {
  generateCreateTableDdl,
  generateInsertSql,
  isMysqlLike,
  isSqliteLike,
  quoteIdent,
} from '../core/dialect.js';
import {
  downloadBlob,
  inferColumnTypes,
  parseCsv,
  toSqlInserts,
} from '../core/csv-json.js';
import { splitSqlStatements } from '../core/sql-formatter.js';
import { t } from '../i18n/translations.js';
import { el, labeledField, toast } from './dom.js';
import { icon } from './icons.js';
import { runWithButtonBusy, trackProgress } from './progress.js';

export async function handleSqliteFileUpload(file: File): Promise<void> {
  return trackProgress(async () => {
    const bytes = new Uint8Array(await file.arrayBuffer());
    // Enforce exact SQLite 3 magic header for all non-empty files (fixes 1..15 byte bypass — H9)
    if (bytes.length > 0) {
      const header = bytes.length >= 16 ? new TextDecoder().decode(bytes.subarray(0, 16)) : '';
      if (header !== 'SQLite format 3\0') {
        toast('有効な SQLite 3 データベースファイルではありません。(.sqlite / .db)', 'error', 4500);
        return;
      }
    }
    const conn = {
      id: `sqlite-file-${Date.now()}`,
      name: file.name,
      dialect: 'sqlite' as const,
      transport: 'wasm' as const,
      filePath: file.name,
      createdAt: Date.now(),
    };
    await store.connectTo(conn, bytes);
    toast(`SQLite ファイル "${file.name}" (${(bytes.length / 1024).toFixed(1)} KB) を開きました`, 'success');
  });
}

export function renderImportExportView(container: HTMLElement): void {
  const schema = store.schema;
  const adapter = store.adapter;
  const panel = el('div', { className: 'panel-scroll' });

  // Card 1: SQLite File Upload & Binary Export
  const sqliteInput = el('input', {
    type: 'file',
    accept: '.sqlite,.sqlite3,.db,.db3',
    className: 'input',
    onChange: async (e: Event) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      try {
        await handleSqliteFileUpload(file);
      } catch (err) {
        toast(err instanceof Error ? err.message : String(err), 'error', 5000);
      }
    },
  });

  const sqliteCard = el(
    'div',
    { className: 'card' },
    el('h2', { className: 'card-title' }, 'SQLite データベースファイル (.sqlite / .db)'),
    el('p', { style: { margin: '0 0 10px', color: 'var(--ink-secondary)', fontSize: '0.83rem' } }, 'ブラウザ内の WebAssembly (sql.js) でローカルの SQLite ファイルをそのまま読み込み・編集・バイナリ保存できます。データはサーバーに送信されません。'),
    el(
      'div',
      { className: 'field-row', style: { alignItems: 'end' } },
      labeledField('SQLiteファイルをアップロードして開く', sqliteInput),
      adapter?.exportSqliteBinary
        ? el(
            'button',
            {
              type: 'button',
              className: 'btn btn-primary',
              onClick: async (e: Event) => {
                await runWithButtonBusy(e.currentTarget as HTMLButtonElement, async () => {
                  try {
                    const bytes = await adapter.exportSqliteBinary!();
                    const fname = schema?.databaseName?.endsWith('.sqlite') ? schema.databaseName : `${schema?.databaseName || 'database'}.sqlite`;
                    downloadBlob(new Uint8Array(bytes), fname, 'application/vnd.sqlite3');
                    toast(`${fname} を保存しました`, 'success');
                  } catch (err) {
                    toast(err instanceof Error ? err.message : String(err), 'error');
                  }
                });
              },
            },
            icon('download', 14),
            t('exportSqlite')
          )
        : null
    )
  );
  panel.append(sqliteCard);

  if (!schema || !adapter) {
    panel.append(el('div', { className: 'card' }, 'その他のインポート / エクスポート機能を使うにはデータベースに接続してください。'));
    container.replaceChildren(panel);
    return;
  }

  // Card 2: Full SQL Dump Export (with FK-safe pragmas + truncation warning — H9)
  const selectedDumpTables = new Set(schema.tables.map((x) => x.name));
  const includeDdlChk = el('input', { type: 'checkbox', checked: true });
  const includeDataChk = el('input', { type: 'checkbox', checked: true });
  const tblChecksWrap = el(
    'div',
    { style: { display: 'flex', flexWrap: 'wrap', gap: '10px', marginBottom: '10px' } },
    ...schema.tables.map((tbl) =>
      el(
        'label',
        { style: { display: 'inline-flex', alignItems: 'center', gap: '5px', fontSize: '0.8rem' } },
        el('input', {
          type: 'checkbox',
          checked: true,
          onChange: (e: Event) => {
            if ((e.target as HTMLInputElement).checked) selectedDumpTables.add(tbl.name);
            else selectedDumpTables.delete(tbl.name);
          },
        }),
        tbl.name
      )
    )
  );

  const dumpCard = el(
    'div',
    { className: 'card' },
    el('h2', { className: 'card-title' }, 'SQL ダンプ エクスポート (phpMyAdmin / mysqldump 互換)'),
    tblChecksWrap,
    el(
      'div',
      { className: 'toolbar-group', style: { marginBottom: '10px' } },
      el('label', { style: { display: 'inline-flex', gap: '5px', alignItems: 'center', fontSize: '0.82rem' } }, includeDdlChk, 'CREATE TABLE (DDL) を含む'),
      el('label', { style: { display: 'inline-flex', gap: '5px', alignItems: 'center', fontSize: '0.82rem' } }, includeDataChk, 'INSERT INTO (データ) を含む')
    ),
    el(
      'button',
      {
        type: 'button',
        className: 'btn btn-primary',
        onClick: async (e: Event) => {
          await runWithButtonBusy(e.currentTarget as HTMLButtonElement, async () => {
            const chunks: string[] = [
              `-- Neon DB Admin SQL Dump`,
              `-- Database: ${schema.databaseName} (${schema.dialect})`,
              `-- Exported: ${new Date().toISOString()}`,
            ];
            if (isSqliteLike(schema.dialect)) chunks.push('PRAGMA foreign_keys = OFF;');
            else if (isMysqlLike(schema.dialect)) chunks.push('SET FOREIGN_KEY_CHECKS = 0;');
            chunks.push('');

            const truncatedTables: string[] = [];
            try {
              for (const tbl of schema.tables) {
                if (!selectedDumpTables.has(tbl.name)) continue;
                if (includeDdlChk.checked) {
                  chunks.push(tbl.ddl ? `${tbl.ddl.replace(/;+$/, '')};` : generateCreateTableDdl(tbl, schema.dialect));
                }
                if (includeDataChk.checked) {
                  const res = await adapter.query(`SELECT * FROM ${quoteIdent(tbl.name, schema.dialect)}`, [], 5000);
                  if (res.truncated) truncatedTables.push(tbl.name);
                  if (res.rows.length > 0) {
                    chunks.push(toSqlInserts(tbl.name, res.columns.map((c) => c.name), res.rows, schema.dialect));
                  }
                }
                chunks.push('');
              }
              if (isSqliteLike(schema.dialect)) chunks.push('PRAGMA foreign_keys = ON;');
              else if (isMysqlLike(schema.dialect)) chunks.push('SET FOREIGN_KEY_CHECKS = 1;');

              downloadBlob(chunks.join('\n'), `${schema.databaseName.replace(/\.[^.]+$/, '')}_dump.sql`, 'application/sql;charset=utf-8');
              if (truncatedTables.length > 0) {
                toast(`警告: 5,000行上限により一部省略されました (${truncatedTables.join(', ')})`, 'info', 5500);
              } else {
                toast('SQLダンプをダウンロードしました', 'success');
              }
            } catch (err) {
              toast(err instanceof Error ? err.message : String(err), 'error', 5000);
            }
          });
        },
      },
      icon('download', 14),
      'SQL ダンプをエクスポート (.sql)'
    )
  );
  panel.append(dumpCard);

  // Card 3: Execute .sql Script File
  const sqlFileInput = el('input', { type: 'file', accept: '.sql,.txt', className: 'input' });
  const sqlStatus = el('div', { style: { fontSize: '0.8rem', color: 'var(--ink-secondary)' } });
  const sqlScriptCard = el(
    'div',
    { className: 'card' },
    el('h2', { className: 'card-title' }, 'SQL スクリプト インポート (.sql)'),
    el(
      'div',
      { className: 'field-row', style: { alignItems: 'end' } },
      labeledField('.sql ファイルを選択', sqlFileInput),
      el(
        'button',
        {
          type: 'button',
          className: 'btn btn-primary',
          onClick: async (e: Event) => {
            const btn = e.currentTarget as HTMLButtonElement;
            const file = sqlFileInput.files?.[0];
            if (!file) {
              toast('.sql ファイルを選択してください', 'info');
              return;
            }
            await runWithButtonBusy(btn, async () => {
              const text = await file.text();
              const stmts = splitSqlStatements(text, isMysqlLike(schema.dialect));
              if (stmts.length === 0) {
                toast('実行可能なSQL文がありませんでした', 'info');
                return;
              }
              sqlStatus.textContent = `${stmts.length} 文を実行中...`;
              try {
                for (let i = 0; i < stmts.length; i += 40) {
                  await adapter.executeBatch(stmts.slice(i, i + 40).map((sql) => ({ sql })));
                }
                await store.refreshSchema();
                sqlStatus.textContent = `完了: ${stmts.length} 文のSQLを実行しました。`;
                toast(`${stmts.length} 件のSQL文をインポートしました`, 'success');
              } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                sqlStatus.textContent = `エラー: ${msg}`;
                toast(msg, 'error', 5000);
              }
            });
          },
        },
        icon('upload', 14),
        'SQLを実行'
      )
    ),
    sqlStatus
  );
  panel.append(sqlScriptCard);

  // Card 4: CSV / JSON Import (stringify nested objects & warn if capped — H9)
  const MAX_IMPORT_ROWS = 5000;
  const csvFileInp = el('input', { type: 'file', accept: '.csv,.tsv,.json', className: 'input' });
  const targetTblInp = el('input', { type: 'text', className: 'input mono', placeholder: 'imported_data' });
  const autoCreateChk = el('input', { type: 'checkbox', checked: true });
  const previewBox = el('div');
  let parsedData: { headers: string[]; rows: unknown[][] } | null = null;

  csvFileInp.addEventListener('change', async () => {
    const file = csvFileInp.files?.[0];
    if (!file) return;
    if (!targetTblInp.value.trim()) {
      targetTblInp.value = file.name.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_]/g, '_');
    }
    const text = await file.text();
    try {
      if (file.name.toLowerCase().endsWith('.json')) {
        const arr = JSON.parse(text);
        if (!Array.isArray(arr) || arr.length === 0) throw new Error('JSON配列（オブジェクトの配列）を指定してください。');
        const keySet = new Set<string>();
        arr.slice(0, 100).forEach((o: Record<string, unknown>) => Object.keys(o || {}).forEach((k) => keySet.add(k)));
        const headers = Array.from(keySet);
        const rows = arr.map((o: Record<string, unknown>) =>
          headers.map((k) => {
            const v = o?.[k];
            if (v === null || v === undefined) return null;
            // Stringify nested objects/arrays so SQLite bind() never crashes (H9)
            return typeof v === 'object' ? JSON.stringify(v) : v;
          })
        );
        parsedData = { headers, rows };
      } else {
        const delim = file.name.toLowerCase().endsWith('.tsv') ? '\t' : ',';
        parsedData = parseCsv(text, delim);
      }
      const inferred = inferColumnTypes(parsedData.headers, parsedData.rows);
      const capNotice =
        parsedData.rows.length > MAX_IMPORT_ROWS
          ? ` (※先頭 ${MAX_IMPORT_ROWS.toLocaleString()} 行までインポートされます)`
          : '';
      previewBox.replaceChildren(
        el(
          'div',
          { style: { fontSize: '0.8rem', marginBottom: '6px', color: 'var(--ink-secondary)' } },
          `プレビュー: ${parsedData.rows.length.toLocaleString()} 行 × ${parsedData.headers.length} カラム${capNotice} — 自動型推論: ${inferred.map((c) => `${c.name}:${c.type}`).join(', ')}`
        ),
        el(
          'div',
          { className: 'table-scroll', style: { maxHeight: '180px' } },
          el(
            'table',
            { className: 'data-table' },
            el('thead', {}, el('tr', {}, ...parsedData.headers.map((h) => el('th', {}, h)))),
            el(
              'tbody',
              {},
              ...parsedData.rows.slice(0, 5).map((r) => el('tr', {}, ...r.map((v) => el('td', {}, v == null ? 'NULL' : String(v)))))
            )
          )
        )
      );
    } catch (err) {
      parsedData = null;
      toast(err instanceof Error ? err.message : String(err), 'error', 5000);
    }
  });

  const csvCard = el(
    'div',
    { className: 'card' },
    el('h2', { className: 'card-title' }, 'CSV / TSV / JSON データインポート（型自動推論）'),
    el('div', { className: 'field-row', style: { alignItems: 'end' } }, labeledField('ファイル (.csv / .tsv / .json)', csvFileInp), labeledField('インポート先テーブル名', targetTblInp)),
    el(
      'div',
      { className: 'toolbar-group', style: { margin: '10px 0' } },
      el('label', { style: { display: 'inline-flex', gap: '5px', alignItems: 'center', fontSize: '0.82rem' } }, autoCreateChk, 'テーブルが存在しない場合は自動作成する'),
      el(
        'button',
        {
          type: 'button',
          className: 'btn btn-primary',
          onClick: async (e: Event) => {
            const btn = e.currentTarget as HTMLButtonElement;
            if (!parsedData || parsedData.headers.length === 0) {
              toast('先にCSVまたはJSONファイルを選択してください', 'info');
              return;
            }
            const tName = targetTblInp.value.trim();
            if (!tName) {
              toast('テーブル名を入力してください', 'error');
              return;
            }
            await runWithButtonBusy(btn, async () => {
              try {
                const exists = schema.tables.some((x) => x.name.toLowerCase() === tName.toLowerCase());
                if (!exists && autoCreateChk.checked) {
                  const inferred = inferColumnTypes(parsedData!.headers, parsedData!.rows);
                  const ddl = generateCreateTableDdl(
                    {
                      name: tName,
                      columns: inferred.map((c) => ({
                        name: c.name,
                        type: c.type,
                        nullable: true,
                        defaultValue: null,
                        isPrimaryKey: false,
                        isAutoIncrement: false,
                      })),
                      foreignKeys: [],
                    },
                    schema.dialect
                  );
                  await adapter.query(ddl);
                }

                const rowsToImport = parsedData!.rows.slice(0, MAX_IMPORT_ROWS);
                const batch = rowsToImport.map((row) => generateInsertSql(tName, parsedData!.headers, row, schema.dialect, true));
                for (let i = 0; i < batch.length; i += 40) {
                  await adapter.executeBatch(batch.slice(i, i + 40));
                }
                await store.refreshSchema();
                store.selectTable(tName, 'data');
                const suffix = parsedData!.rows.length > MAX_IMPORT_ROWS ? ` (全${parsedData!.rows.length}行中 ${MAX_IMPORT_ROWS}行まで)` : '';
                toast(`${batch.length} 行を "${tName}" にインポートしました${suffix}`, 'success');
              } catch (err) {
                toast(err instanceof Error ? err.message : String(err), 'error', 5000);
              }
            });
          },
        },
        icon('upload', 14),
        'データをインポート'
      )
    ),
    previewBox
  );
  panel.append(csvCard);

  container.replaceChildren(panel);
}
