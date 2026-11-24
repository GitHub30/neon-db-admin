import type {
  ColumnSchema,
  ConnectionConfig,
  DatabaseSchema,
  ForeignKeySchema,
  IndexSchema,
  QueryResult,
  TableSchema,
  TriggerSchema,
  ViewSchema,
} from '../types/db.js';
import type { DatabaseAdapter } from './base.js';
import { quoteIdent } from '../core/dialect.js';
import { SAMPLE_DATABASES } from '../core/sample-dbs.js';

interface PendingCall {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
}

export class SqliteWasmAdapter implements DatabaseAdapter {
  readonly config: ConnectionConfig;
  readonly dialect = 'sqlite' as const;
  private worker: Worker | null = null;
  private nextId = 1;
  private pending = new Map<number, PendingCall>();
  private dbName: string;
  private initialBytes?: Uint8Array;

  constructor(config: ConnectionConfig, initialBytes?: Uint8Array) {
    this.config = config;
    this.initialBytes = initialBytes;
    const sampleId = config.sampleId;
    this.dbName = config.filePath || (sampleId ? SAMPLE_DATABASES[sampleId]?.name : undefined) || 'local.sqlite';
  }

  private rejectAllPending(reason: string): void {
    for (const call of this.pending.values()) {
      call.reject(new Error(reason));
    }
    this.pending.clear();
  }

  private ensureWorker(): Worker {
    if (!this.worker) {
      this.worker = new Worker(new URL('./sqlite-worker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = (e: MessageEvent<{ id: number; ok: boolean; result?: unknown; results?: unknown; bytes?: Uint8Array; error?: string }>) => {
        const msg = e.data;
        const call = this.pending.get(msg.id);
        if (!call) return;
        this.pending.delete(msg.id);
        if (msg.ok) {
          call.resolve(msg);
        } else {
          call.reject(new Error(msg.error || 'SQLite worker error'));
        }
      };
      this.worker.onerror = (err) => {
        this.rejectAllPending(err.message || 'SQLite worker crashed');
        this.worker?.terminate();
        this.worker = null;
      };
    }
    return this.worker;
  }

  private callWorker<T>(payload: Record<string, unknown>, transfer?: Transferable[]): Promise<T> {
    const worker = this.ensureWorker();
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      if (transfer?.length) {
        worker.postMessage({ id, ...payload }, transfer);
      } else {
        worker.postMessage({ id, ...payload });
      }
    });
  }

  async connect(): Promise<void> {
    const baseHref = document.baseURI.endsWith('/') ? document.baseURI : `${document.baseURI.replace(/\/[^/]*$/, '/')}`;
    const wasmUrl = new URL('wasm/sql-wasm.wasm', baseHref).href;

    if (this.initialBytes) {
      const copy = new Uint8Array(this.initialBytes);
      await this.callWorker({ type: 'init', wasmUrl, bytes: copy }, [copy.buffer]);
      return;
    }

    if (!this.config.sampleId) {
      throw new Error('ローカルSQLiteファイルのデータは再読み込み後に保持されません。ファイルを再度アップロードしてください。');
    }

    await this.callWorker({ type: 'init', wasmUrl });
    const sample = SAMPLE_DATABASES[this.config.sampleId];
    if (sample?.sql) {
      await this.callWorker({ type: 'execScript', sql: sample.sql });
    }
  }

  async disconnect(): Promise<void> {
    if (this.worker) {
      try {
        await this.callWorker({ type: 'close' });
      } catch {
        // ignore
      }
      this.rejectAllPending('SQLite connection closed.');
      this.worker.terminate();
      this.worker = null;
    }
  }

  async loadSqliteBinary(bytes: Uint8Array, name: string): Promise<void> {
    this.dbName = name;
    const copy = new Uint8Array(bytes);
    await this.callWorker({ type: 'loadBinary', bytes: copy }, [copy.buffer]);
  }

  async exportSqliteBinary(): Promise<Uint8Array> {
    const res = await this.callWorker<{ bytes: Uint8Array }>({ type: 'export' });
    return res.bytes;
  }

  async testConnection(): Promise<{ ok: boolean; version: string; durationMs: number; error?: string }> {
    try {
      const res = await this.query('SELECT sqlite_version() AS version');
      return {
        ok: true,
        version: `SQLite ${res.rows[0]?.[0] ?? 'WASM'} (Browser WebAssembly)`,
        durationMs: res.durationMs,
      };
    } catch (err) {
      return { ok: false, version: '', durationMs: 0, error: err instanceof Error ? err.message : String(err) };
    }
  }

  async query(sql: string, params?: unknown[], maxRows = 2000): Promise<QueryResult> {
    const res = await this.callWorker<{ result: QueryResult }>({
      type: 'query',
      sql,
      params,
      maxRows,
    });
    return { ...res.result, sql };
  }

  async executeBatch(statements: Array<{ sql: string; params?: unknown[] }>, maxRows = 2000): Promise<QueryResult[]> {
    const res = await this.callWorker<{ results: QueryResult[] }>({
      type: 'batch',
      statements,
      maxRows,
    });
    return res.results.map((r, i) => ({ ...r, sql: statements[i]?.sql }));
  }

  async introspectSchema(): Promise<DatabaseSchema> {
    const [verRes, masterRes] = await this.executeBatch([
      { sql: 'SELECT sqlite_version() AS ver' },
      {
        sql: `SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name`,
      },
    ], 10000);

    const serverVersion = `SQLite ${verRes.rows[0]?.[0] ?? '3.x'} (WASM)`;
    const tableRows: Array<{ name: string; sql: string }> = [];
    const views: ViewSchema[] = [];
    const triggers: TriggerSchema[] = [];

    for (const row of masterRes.rows) {
      const type = String(row[0] ?? '');
      const name = String(row[1] ?? '');
      const tblName = String(row[2] ?? '');
      const ddl = String(row[3] ?? '');
      if (type === 'table') tableRows.push({ name, sql: ddl });
      else if (type === 'view') views.push({ name, sql: ddl });
      else if (type === 'trigger') triggers.push({ name, table: tblName, sql: ddl });
    }

    const tables: TableSchema[] = [];
    for (const t of tableRows) {
      const qName = quoteIdent(t.name, 'sqlite');
      const [colsRes, fkRes, idxListRes, cntRes] = await this.executeBatch([
        { sql: `PRAGMA table_info(${qName})` },
        { sql: `PRAGMA foreign_key_list(${qName})` },
        { sql: `PRAGMA index_list(${qName})` },
        { sql: `SELECT COUNT(*) FROM ${qName}` },
      ], 10000);

      const ddlUpper = t.sql.toUpperCase();
      const columns: ColumnSchema[] = colsRes.rows.map((r) => {
        const colName = String(r[1] ?? '');
        const isPk = Number(r[5] ?? 0) > 0;
        const isAuto = isPk && ddlUpper.includes('AUTOINCREMENT');
        return {
          name: colName,
          type: String(r[2] || 'TEXT'),
          nullable: Number(r[3] ?? 0) === 0 && !isPk,
          defaultValue: r[4] !== null && r[4] !== undefined ? String(r[4]) : null,
          isPrimaryKey: isPk,
          isAutoIncrement: isAuto,
        };
      });

      const foreignKeys: ForeignKeySchema[] = fkRes.rows.map((r, idx) => ({
        name: `fk_${t.name}_${r[3]}_${idx}`,
        column: String(r[3] ?? ''),
        refTable: String(r[2] ?? ''),
        refColumn: String(r[4] || 'id'),
        onUpdate: String(r[5] || 'NO ACTION'),
        onDelete: String(r[6] || 'NO ACTION'),
      }));

      const indexes: IndexSchema[] = [];
      for (const idxRow of idxListRes.rows) {
        const idxName = String(idxRow[1] ?? '');
        const unique = Number(idxRow[2] ?? 0) === 1;
        const origin = String(idxRow[3] ?? '');
        const infoRes = await this.query(`PRAGMA index_info(${quoteIdent(idxName, 'sqlite')})`);
        const idxCols = infoRes.rows.map((ir) => String(ir[2] ?? '')).filter(Boolean);
        indexes.push({ name: idxName, columns: idxCols, unique, primary: origin === 'pk' });
        if (unique && idxCols.length === 1) {
          const targetCol = columns.find((c) => c.name === idxCols[0]);
          if (targetCol && !targetCol.isPrimaryKey) targetCol.isUnique = true;
        }
      }

      tables.push({
        name: t.name,
        type: 'table',
        rowCount: Number(cntRes.rows[0]?.[0] ?? 0),
        columns,
        foreignKeys,
        indexes,
        ddl: t.sql,
      });
    }

    return {
      databaseName: this.dbName,
      dialect: 'sqlite',
      serverVersion,
      tables,
      views,
      triggers,
    };
  }

  async getServerInfo(): Promise<Array<{ key: string; value: string }>> {
    const pragmas = [
      'sqlite_version()',
      'PRAGMA page_size',
      'PRAGMA page_count',
      'PRAGMA journal_mode',
      'PRAGMA foreign_keys',
      'PRAGMA encoding',
      'PRAGMA synchronous',
      'PRAGMA integrity_check',
    ];
    const items: Array<{ key: string; value: string }> = [];
    for (const p of pragmas) {
      try {
        const sql = p.startsWith('PRAGMA') ? p : `SELECT ${p}`;
        const res = await this.query(sql);
        items.push({ key: p.replace(/^PRAGMA\s+/i, ''), value: String(res.rows[0]?.[0] ?? '') });
      } catch {
        // ignore unsupported pragma
      }
    }
    return items;
  }
}
