import { Client } from 'pg';
import type { ConnectionPayload, QueryColumn, QueryResultPayload } from '../security.js';
import { serializeValue, validateHost, validatePort, withTimeout } from '../security.js';

const PG_OID_MAP: Record<number, string> = {
  16: 'BOOL',
  17: 'BYTEA',
  20: 'BIGINT',
  21: 'SMALLINT',
  23: 'INTEGER',
  25: 'TEXT',
  114: 'JSON',
  700: 'REAL',
  701: 'DOUBLE PRECISION',
  1042: 'CHAR',
  1043: 'VARCHAR',
  1082: 'DATE',
  1083: 'TIME',
  1114: 'TIMESTAMP',
  1184: 'TIMESTAMPTZ',
  1700: 'NUMERIC',
  2950: 'UUID',
  3802: 'JSONB',
};

function parsePgConfig(conn: ConnectionPayload) {
  const rejectUnauthorized = conn.sslRejectUnauthorized !== false;
  if (conn.url) {
    const parsed = new URL(conn.url);
    if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
      throw new Error('Invalid PostgreSQL connection URL protocol.');
    }
    const host = validateHost(parsed.hostname);
    const port = validatePort(parsed.port || undefined, 5432);
    const user = parsed.username ? decodeURIComponent(parsed.username) : (conn.user || '');
    const password = parsed.password ? decodeURIComponent(parsed.password) : (conn.password || '');
    const rawDb = parsed.pathname.replace(/^\//, '');
    const database = rawDb ? decodeURIComponent(rawDb) : (conn.database || 'postgres');
    const sslMode = parsed.searchParams.get('sslmode');
    const useSsl = conn.ssl ?? (sslMode !== 'disable');
    return {
      host,
      port,
      user,
      password,
      database,
      ssl: useSsl ? { rejectUnauthorized } : undefined,
    };
  }
  const host = validateHost(conn.host);
  const port = validatePort(conn.port, 5432);
  return {
    host,
    port,
    user: conn.user || 'postgres',
    password: conn.password || '',
    database: conn.database || 'postgres',
    ssl: conn.ssl !== false ? { rejectUnauthorized } : undefined,
  };
}

export async function executePostgres(
  conn: ConnectionPayload,
  statements: Array<{ sql: string; params?: unknown[] }>,
  maxRows: number,
  timeoutMs: number
): Promise<QueryResultPayload[]> {
  const cfg = parsePgConfig(conn);
  const deadline = performance.now() + timeoutMs;
  const remaining = () => Math.max(250, deadline - performance.now());

  const client = new Client({
    ...cfg,
    connectionTimeoutMillis: Math.min(timeoutMs, 10000),
    query_timeout: timeoutMs,
  });

  await withTimeout(client.connect(), Math.min(timeoutMs, 10000), 'PostgreSQL connection');
  const results: QueryResultPayload[] = [];
  try {
    for (const stmt of statements) {
      const rem = remaining();
      if (rem <= 250) {
        throw new Error(`Batch timed out after ${timeoutMs}ms.`);
      }
      const started = performance.now();
      const rawRes = await withTimeout(
        client.query({
          text: stmt.sql,
          values: stmt.params && stmt.params.length > 0 ? stmt.params : undefined,
          rowMode: 'array',
        }),
        rem,
        'PostgreSQL query'
      );
      const res = Array.isArray(rawRes) ? rawRes[rawRes.length - 1] : rawRes;
      const durationMs = Math.round((performance.now() - started) * 100) / 100;
      const allRows = Array.isArray(res?.rows) ? res.rows : [];
      const truncated = allRows.length > maxRows;
      const sliced = truncated ? allRows.slice(0, maxRows) : allRows;
      const columns: QueryColumn[] = (res?.fields || []).map((f: { name: string; dataTypeID: number }) => ({
        name: f.name,
        type: PG_OID_MAP[f.dataTypeID] || `OID(${f.dataTypeID})`,
      }));
      const serializedRows = sliced.map((r: unknown) =>
        Array.isArray(r) ? r.map(serializeValue) : [serializeValue(r)]
      );

      results.push({
        ok: true,
        columns,
        rows: serializedRows,
        rowCount: serializedRows.length,
        affectedRows: typeof res?.rowCount === 'number' ? res.rowCount : 0,
        insertId: null,
        truncated,
        durationMs,
      });
    }
  } finally {
    try {
      await client.end();
    } catch {
      // ignore close errors
    }
  }
  return results;
}
