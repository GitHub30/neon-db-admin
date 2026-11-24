import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js';

interface WorkerRequest {
  id: number;
  type: 'init' | 'loadBinary' | 'execScript' | 'query' | 'batch' | 'export' | 'close';
  wasmUrl?: string;
  bytes?: Uint8Array;
  sql?: string;
  params?: unknown[];
  statements?: Array<{ sql: string; params?: unknown[] }>;
  maxRows?: number;
}

let SQL: SqlJsStatic | null = null;
let db: Database | null = null;
// Serialize all async worker operations so initSqlJs never races with subsequent queries (H6)
let queue: Promise<void> = Promise.resolve();

function normalizeBindParam(v: unknown): string | number | Uint8Array | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'number' || typeof v === 'string' || v instanceof Uint8Array) return v;
  return JSON.stringify(v);
}

function serializeCell(val: unknown): unknown {
  if (val === null || val === undefined) return null;
  if (val instanceof Uint8Array) {
    let hex = '0x';
    const limit = Math.min(val.length, 4096);
    for (let i = 0; i < limit; i++) {
      hex += val[i].toString(16).padStart(2, '0');
    }
    return val.length > limit ? `${hex}…(${val.length} bytes)` : hex;
  }
  return val;
}

function stripLeadingComments(sql: string): string {
  return sql.replace(/^(?:\s|--[^\n]*\n|\/\*[\s\S]*?\*\/)*/g, '');
}

function runSingleQuery(sql: string, params: unknown[] | undefined, maxRows: number) {
  if (!db) throw new Error('SQLite database is not initialized.');
  const started = performance.now();
  const stmt = db.prepare(sql);
  try {
    if (params && params.length > 0) {
      stmt.bind(params.map(normalizeBindParam));
    }
    const colNames = stmt.getColumnNames();
    const rows: unknown[][] = [];
    let truncated = false;

    if (colNames.length > 0) {
      while (stmt.step()) {
        if (rows.length >= maxRows) {
          truncated = true;
          break;
        }
        const row = stmt.get();
        rows.push(row.map(serializeCell));
      }
      const durationMs = Math.round((performance.now() - started) * 100) / 100;
      return {
        columns: colNames.map((name) => ({ name, type: 'ANY' })),
        rows,
        rowCount: rows.length,
        affectedRows: 0,
        insertId: null,
        truncated,
        durationMs,
      };
    } else {
      stmt.step();
      const affectedRows = db.getRowsModified();
      let insertId: number | null = null;
      if (/^INSERT\b/i.test(stripLeadingComments(sql))) {
        const idRes = db.exec('SELECT last_insert_rowid()');
        if (idRes[0]?.values?.[0]?.[0] !== undefined) {
          insertId = Number(idRes[0].values[0][0]);
        }
      }
      const durationMs = Math.round((performance.now() - started) * 100) / 100;
      return {
        columns: [],
        rows: [],
        rowCount: 0,
        affectedRows,
        insertId,
        truncated: false,
        durationMs,
      };
    }
  } finally {
    stmt.free();
  }
}

async function handleRequest(req: WorkerRequest): Promise<void> {
  try {
    if (req.type === 'init') {
      if (!SQL) {
        const wasmUrl = req.wasmUrl || './wasm/sql-wasm.wasm';
        SQL = await initSqlJs({ locateFile: () => wasmUrl });
      }
      if (db) db.close();
      db = req.bytes ? new SQL.Database(req.bytes) : new SQL.Database();
      db.run('PRAGMA foreign_keys = ON;');
      self.postMessage({ id: req.id, ok: true });
      return;
    }

    if (req.type === 'loadBinary') {
      if (!SQL) throw new Error('SQL.js WASM not loaded.');
      if (db) db.close();
      db = new SQL.Database(req.bytes);
      db.run('PRAGMA foreign_keys = ON;');
      self.postMessage({ id: req.id, ok: true });
      return;
    }

    if (req.type === 'execScript') {
      if (!db) throw new Error('SQLite database is not initialized.');
      const started = performance.now();
      db.exec(req.sql || '');
      const durationMs = Math.round((performance.now() - started) * 100) / 100;
      self.postMessage({ id: req.id, ok: true, result: { durationMs } });
      return;
    }

    if (req.type === 'query') {
      const result = runSingleQuery(req.sql || '', req.params, req.maxRows || 5000);
      self.postMessage({ id: req.id, ok: true, result });
      return;
    }

    if (req.type === 'batch') {
      const results = (req.statements || []).map((s) => runSingleQuery(s.sql, s.params, req.maxRows || 5000));
      self.postMessage({ id: req.id, ok: true, results });
      return;
    }

    if (req.type === 'export') {
      if (!db) throw new Error('SQLite database is not initialized.');
      const data = db.export();
      self.postMessage({ id: req.id, ok: true, bytes: data }, [data.buffer]);
      return;
    }

    if (req.type === 'close') {
      if (db) {
        db.close();
        db = null;
      }
      self.postMessage({ id: req.id, ok: true });
      return;
    }
  } catch (err) {
    self.postMessage({
      id: req.id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  queue = queue.then(() => handleRequest(event.data));
};
