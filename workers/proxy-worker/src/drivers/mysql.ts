import mysql from 'mysql2/promise';
import type { ConnectionPayload, QueryColumn, QueryResultPayload } from '../security.js';
import { serializeValue, validateHost, validatePort, withTimeout } from '../security.js';

const MYSQL_TYPE_NAMES: Record<number, string> = {
  0: 'DECIMAL',
  1: 'TINYINT',
  2: 'SMALLINT',
  3: 'INT',
  4: 'FLOAT',
  5: 'DOUBLE',
  7: 'TIMESTAMP',
  8: 'BIGINT',
  9: 'MEDIUMINT',
  10: 'DATE',
  11: 'TIME',
  12: 'DATETIME',
  13: 'YEAR',
  15: 'VARCHAR',
  16: 'BIT',
  245: 'JSON',
  246: 'DECIMAL',
  249: 'TINYBLOB',
  250: 'MEDIUMBLOB',
  251: 'LONGBLOB',
  252: 'BLOB',
  253: 'VARCHAR',
  254: 'CHAR',
};

function parseMysqlConfig(conn: ConnectionPayload) {
  const rejectUnauthorized = conn.sslRejectUnauthorized !== false;
  if (conn.url) {
    const parsed = new URL(conn.url);
    if (parsed.protocol !== 'mysql:' && parsed.protocol !== 'mysql2:' && parsed.protocol !== 'mariadb:') {
      throw new Error('Invalid MySQL/MariaDB connection URL protocol.');
    }
    const host = validateHost(parsed.hostname);
    const port = validatePort(parsed.port || undefined, 3306);
    const user = parsed.username ? decodeURIComponent(parsed.username) : (conn.user || '');
    const password = parsed.password ? decodeURIComponent(parsed.password) : (conn.password || '');
    const rawDb = parsed.pathname.replace(/^\//, '');
    const database = rawDb ? decodeURIComponent(rawDb) : (conn.database || '');
    const sslParam = parsed.searchParams.get('ssl-mode') || parsed.searchParams.get('ssl');
    const useSsl = conn.ssl ?? (sslParam !== null && sslParam !== 'false' && sslParam !== 'DISABLED');
    return {
      host,
      port,
      user,
      password,
      database: database || undefined,
      ssl: useSsl ? { rejectUnauthorized } : undefined,
    };
  }
  const host = validateHost(conn.host);
  const port = validatePort(conn.port, 3306);
  return {
    host,
    port,
    user: conn.user || 'root',
    password: conn.password || '',
    database: conn.database || undefined,
    ssl: conn.ssl ? { rejectUnauthorized } : undefined,
  };
}

export async function executeMysql(
  conn: ConnectionPayload,
  statements: Array<{ sql: string; params?: unknown[] }>,
  maxRows: number,
  timeoutMs: number
): Promise<QueryResultPayload[]> {
  const cfg = parseMysqlConfig(conn);
  const deadline = performance.now() + timeoutMs;
  const remaining = () => Math.max(250, deadline - performance.now());

  const client = await withTimeout(
    mysql.createConnection({
      ...cfg,
      rowsAsArray: true,
      dateStrings: true,
      supportBigNumbers: true,
      bigNumberStrings: true,
      connectTimeout: Math.min(timeoutMs, 10000),
      disableEval: true,
    }),
    Math.min(timeoutMs, 10000),
    'MySQL connection'
  );

  let timedOut = false;
  const results: QueryResultPayload[] = [];
  try {
    for (const stmt of statements) {
      const rem = remaining();
      if (rem <= 250) {
        timedOut = true;
        throw new Error(`Batch timed out after ${timeoutMs}ms.`);
      }
      const started = performance.now();
      const [rows, fields] = await withTimeout(
        stmt.params && stmt.params.length > 0
          ? client.execute(stmt.sql, stmt.params as (string | number | boolean | null)[])
          : client.query(stmt.sql),
        rem,
        'MySQL query'
      ).catch((e) => {
        if (String(e).includes('timed out')) timedOut = true;
        throw e;
      });
      const durationMs = Math.round((performance.now() - started) * 100) / 100;

      if (Array.isArray(rows)) {
        const truncated = rows.length > maxRows;
        const sliced = truncated ? rows.slice(0, maxRows) : rows;
        const cols: QueryColumn[] = Array.isArray(fields)
          ? fields.map((f: { name?: string; type?: number }) => ({
              name: f.name || '',
              type: (f.type !== undefined && MYSQL_TYPE_NAMES[f.type]) || `TYPE(${f.type ?? 0})`,
            }))
          : [];
        const serializedRows = sliced.map((r) =>
          Array.isArray(r) ? r.map(serializeValue) : [serializeValue(r)]
        );
        results.push({
          ok: true,
          columns: cols,
          rows: serializedRows,
          rowCount: serializedRows.length,
          affectedRows: 0,
          insertId: null,
          truncated,
          durationMs,
        });
      } else {
        const header = rows as mysql.ResultSetHeader;
        results.push({
          ok: true,
          columns: [],
          rows: [],
          rowCount: 0,
          affectedRows: header.affectedRows ?? 0,
          insertId: header.insertId ?? null,
          truncated: false,
          durationMs,
        });
      }
    }
  } finally {
    try {
      if (timedOut) {
        client.destroy();
      } else {
        await client.end();
      }
    } catch {
      try {
        client.destroy();
      } catch {
        // ignore
      }
    }
  }
  return results;
}
