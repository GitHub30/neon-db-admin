#!/usr/bin/env node
/**
 * Neon DB Admin — Standalone Node.js Database Proxy (v1.2.0)
 *
 * Supported Databases: MySQL, MariaDB (mysql2), PostgreSQL (pg), SQLite (node:sqlite in Node 22+)
 * CORS: Access-Control-Allow-Origin: *
 *
 * Usage:
 *   # Quick start (NEON_DB_PROXY_TOKEN is optional):
 *   PORT=8787 node proxy-node.mjs
 *
 *   # Optional token authentication (recommended for shared/public networks):
 *   NEON_DB_PROXY_TOKEN="$(openssl rand -hex 32)" PORT=8787 node proxy-node.mjs
 *   (Install optional drivers as needed: `npm i mysql2 pg`)
 */

import http from 'node:http';
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '127.0.0.1';
const PROXY_TOKEN = process.env.NEON_DB_PROXY_TOKEN || '';
const ALLOWED_ORIGIN = process.env.NEON_DB_ALLOWED_ORIGIN || '*';
const SQLITE_ALLOWED_DIR = path.resolve(process.env.NEON_DB_SQLITE_DIR || process.cwd());
const MAX_ROWS = Math.min(Math.max(Number(process.env.NEON_DB_MAX_ROWS) || 5000, 1), 10000);
const QUERY_TIMEOUT_MS = Math.min(Math.max(Number(process.env.NEON_DB_TIMEOUT_MS) || 15000, 1000), 60000);
const MAX_BODY_BYTES = 2 * 1024 * 1024;

const PG_OID_MAP = {
  16: 'BOOL', 17: 'BYTEA', 20: 'BIGINT', 21: 'SMALLINT', 23: 'INTEGER', 25: 'TEXT',
  114: 'JSON', 700: 'REAL', 701: 'DOUBLE PRECISION', 1042: 'CHAR', 1043: 'VARCHAR',
  1082: 'DATE', 1083: 'TIME', 1114: 'TIMESTAMP', 1184: 'TIMESTAMPTZ', 1700: 'NUMERIC',
  2950: 'UUID', 3802: 'JSONB',
};

const MYSQL_TYPE_MAP = {
  0: 'DECIMAL', 1: 'TINYINT', 2: 'SMALLINT', 3: 'INT', 4: 'FLOAT', 5: 'DOUBLE',
  7: 'TIMESTAMP', 8: 'BIGINT', 10: 'DATE', 11: 'TIME', 12: 'DATETIME',
  15: 'VARCHAR', 245: 'JSON', 246: 'DECIMAL', 252: 'BLOB', 253: 'VARCHAR', 254: 'CHAR',
};

function corsHeaders(extra = {}) {
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Proxy-Token, X-Requested-With, X-DB-Dialect',
    'Access-Control-Expose-Headers': 'X-Query-Time-Ms, X-Proxy-Version',
    'Access-Control-Max-Age': '86400',
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-store',
    'X-Proxy-Version': '1.2.0',
    ...extra,
  };
}

function sendJson(res, status, data, extra = {}) {
  if (res.writableEnded) return;
  res.writeHead(status, corsHeaders(extra));
  res.end(JSON.stringify(data));
}

function safeEqual(a, b) {
  const hashA = crypto.createHash('sha256').update(String(a)).digest();
  const hashB = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(hashA, hashB);
}

function withTimeout(promise, ms, label = 'Query') {
  let timer;
  const tp = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms.`)), ms);
  });
  return Promise.race([promise, tp]).finally(() => clearTimeout(timer));
}

function serializeVal(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'bigint') return v.toString();
  if (v instanceof Date) return v.toISOString();
  if (v instanceof Uint8Array || Buffer.isBuffer(v)) {
    return '0x' + Buffer.from(v).subarray(0, 4096).toString('hex');
  }
  if (typeof v === 'object') return JSON.stringify(v);
  return v;
}

function stripSqlLiteralsAndComments(sql) {
  let out = '';
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i];
    const next = sql[i + 1] || '';
    if (ch === '-' && next === '-') {
      const nl = sql.indexOf('\n', i + 2);
      i = nl === -1 ? sql.length : nl + 1;
      out += ' ';
      continue;
    }
    if (ch === '/' && next === '*') {
      const end = sql.indexOf('*/', i + 2);
      i = end === -1 ? sql.length : end + 2;
      out += ' ';
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      const q = ch;
      i++;
      while (i < sql.length) {
        if (sql[i] === q && sql[i + 1] === q) { i += 2; continue; }
        if (sql[i] === q) { i++; break; }
        i++;
      }
      out += ' ';
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

function resolveSafeSqlitePath(rawPath) {
  if (rawPath === ':memory:') return ':memory:';
  if (typeof rawPath !== 'string' || !rawPath.trim() || rawPath.includes('\0')) {
    throw new Error('Invalid SQLite file path.');
  }
  const ext = path.extname(rawPath).toLowerCase();
  if (!['.sqlite', '.sqlite3', '.db', '.db3'].includes(ext)) {
    throw new Error('SQLite file must end with .sqlite, .sqlite3, .db, or .db3.');
  }
  if (!fs.existsSync(SQLITE_ALLOWED_DIR)) {
    throw new Error('NEON_DB_SQLITE_DIR does not exist.');
  }
  const realAllowed = fs.realpathSync(SQLITE_ALLOWED_DIR);
  const candidate = path.resolve(realAllowed, rawPath);
  if (!candidate.startsWith(realAllowed + path.sep)) {
    throw new Error('Access denied: SQLite file must reside inside NEON_DB_SQLITE_DIR.');
  }
  if (fs.existsSync(candidate)) {
    const lst = fs.lstatSync(candidate);
    if (lst.isSymbolicLink() || lst.isDirectory()) {
      throw new Error('Access denied: symlinks and directories are not allowed.');
    }
    const realTarget = fs.realpathSync(candidate);
    if (!realTarget.startsWith(realAllowed + path.sep)) {
      throw new Error('Access denied: SQLite symlink escape blocked.');
    }
    return realTarget;
  }
  const parentReal = fs.realpathSync(path.dirname(candidate));
  if (!parentReal.startsWith(realAllowed + path.sep) && parentReal !== realAllowed) {
    throw new Error('Access denied: parent directory escapes NEON_DB_SQLITE_DIR.');
  }
  return path.join(parentReal, path.basename(candidate));
}

async function runSqlite(conn, statements, maxRows) {
  const { DatabaseSync } = await import('node:sqlite');
  const dbPath = resolveSafeSqlitePath(conn.filePath || conn.database || ':memory:');
  const db = new DatabaseSync(dbPath, { allowExtension: false });
  db.exec('PRAGMA foreign_keys = ON;');
  const results = [];
  try {
    for (const s of statements) {
      const stripped = stripSqlLiteralsAndComments(s.sql);
      if (/\b(ATTACH|DETACH|LOAD_EXTENSION)\b/i.test(stripped)) {
        throw new Error('Security policy: ATTACH, DETACH, and load_extension are disabled.');
      }
      const started = performance.now();
      const stmt = db.prepare(s.sql);
      const hasColumnsFn = typeof stmt.columns === 'function';
      const colsMeta = hasColumnsFn ? stmt.columns() : null;
      const isReadQuery = hasColumnsFn
        ? colsMeta.length > 0
        : /^\s*(SELECT|PRAGMA|EXPLAIN|WITH|VALUES)\b/i.test(stripped) || /\bRETURNING\b/i.test(stripped);

      if (isReadQuery) {
        const all = stmt.all(...(s.params || []));
        const truncated = all.length > maxRows;
        const sliced = truncated ? all.slice(0, maxRows) : all;
        const colNames = colsMeta && colsMeta.length > 0
          ? colsMeta.map((c) => c.name)
          : (sliced[0] ? Object.keys(sliced[0]) : []);
        results.push({
          ok: true,
          columns: colsMeta && colsMeta.length > 0
            ? colsMeta.map((c) => ({ name: c.name, type: c.type || 'ANY' }))
            : colNames.map((n) => ({ name: n, type: 'ANY' })),
          rows: sliced.map((r) => colNames.map((k) => serializeVal(r[k]))),
          rowCount: sliced.length,
          affectedRows: 0,
          insertId: null,
          truncated,
          durationMs: Math.round((performance.now() - started) * 100) / 100,
        });
      } else {
        const info = stmt.run(...(s.params || []));
        results.push({
          ok: true,
          columns: [],
          rows: [],
          rowCount: 0,
          affectedRows: Number(info.changes ?? 0),
          insertId: info.lastInsertRowid != null ? Number(info.lastInsertRowid) : null,
          truncated: false,
          durationMs: Math.round((performance.now() - started) * 100) / 100,
        });
      }
    }
  } finally {
    try { db.close(); } catch {}
  }
  return results;
}

function parseExplicitUrl(rawUrl, allowedProtocols, defaultPort) {
  const u = new URL(rawUrl);
  if (!allowedProtocols.includes(u.protocol)) {
    throw new Error('Unsupported database URL protocol.');
  }
  return {
    host: u.hostname,
    port: u.port ? Number(u.port) : defaultPort,
    user: u.username ? decodeURIComponent(u.username) : undefined,
    password: u.password ? decodeURIComponent(u.password) : undefined,
    database: u.pathname.replace(/^\//, '') ? decodeURIComponent(u.pathname.replace(/^\//, '')) : undefined,
  };
}

async function runMysql(conn, statements, maxRows) {
  const mysql = (await import('mysql2/promise')).default;
  const rejectUnauthorized = conn.sslRejectUnauthorized !== false;
  const parsed = conn.url ? parseExplicitUrl(conn.url, ['mysql:', 'mysql2:', 'mariadb:'], 3306) : {};
  const client = await withTimeout(
    mysql.createConnection({
      host: parsed.host || conn.host || '127.0.0.1',
      port: Number(parsed.port || conn.port || 3306),
      user: parsed.user ?? conn.user ?? 'root',
      password: parsed.password ?? conn.password ?? '',
      database: parsed.database || conn.database || undefined,
      ssl: conn.ssl ? { rejectUnauthorized } : undefined,
      rowsAsArray: true,
      dateStrings: true,
      connectTimeout: Math.min(QUERY_TIMEOUT_MS, 10000),
    }),
    Math.min(QUERY_TIMEOUT_MS, 10000),
    'MySQL connection'
  );
  const results = [];
  let timedOut = false;
  try {
    for (const s of statements) {
      const started = performance.now();
      const [rows, fields] = await withTimeout(
        s.params?.length ? client.execute(s.sql, s.params) : client.query(s.sql),
        QUERY_TIMEOUT_MS,
        'MySQL query'
      ).catch((e) => {
        if (String(e).includes('timed out')) timedOut = true;
        throw e;
      });
      const durationMs = Math.round((performance.now() - started) * 100) / 100;
      if (Array.isArray(rows)) {
        const truncated = rows.length > maxRows;
        const sliced = truncated ? rows.slice(0, maxRows) : rows;
        results.push({
          ok: true,
          columns: (fields || []).map((f) => ({ name: f.name, type: MYSQL_TYPE_MAP[f.type] || `TYPE(${f.type ?? 0})` })),
          rows: sliced.map((r) => r.map(serializeVal)),
          rowCount: sliced.length,
          affectedRows: 0,
          insertId: null,
          truncated,
          durationMs,
        });
      } else {
        results.push({
          ok: true,
          columns: [],
          rows: [],
          rowCount: 0,
          affectedRows: rows.affectedRows ?? 0,
          insertId: rows.insertId ?? null,
          truncated: false,
          durationMs,
        });
      }
    }
  } finally {
    try {
      if (timedOut) client.destroy();
      else await client.end();
    } catch {}
  }
  return results;
}

async function runPostgres(conn, statements, maxRows) {
  const { Client } = await import('pg');
  const rejectUnauthorized = conn.sslRejectUnauthorized !== false;
  const parsed = conn.url ? parseExplicitUrl(conn.url, ['postgres:', 'postgresql:'], 5432) : {};
  const client = new Client({
    host: parsed.host || conn.host || '127.0.0.1',
    port: Number(parsed.port || conn.port || 5432),
    user: parsed.user || conn.user || 'postgres',
    password: parsed.password ?? conn.password ?? '',
    database: parsed.database || conn.database || 'postgres',
    ssl: conn.ssl ? { rejectUnauthorized } : undefined,
    connectionTimeoutMillis: Math.min(QUERY_TIMEOUT_MS, 10000),
    query_timeout: QUERY_TIMEOUT_MS,
  });
  await withTimeout(client.connect(), Math.min(QUERY_TIMEOUT_MS, 10000), 'PostgreSQL connection');
  const results = [];
  try {
    for (const s of statements) {
      const started = performance.now();
      const rawRes = await withTimeout(
        client.query({ text: s.sql, values: s.params?.length ? s.params : undefined, rowMode: 'array' }),
        QUERY_TIMEOUT_MS,
        'PostgreSQL query'
      );
      const res = Array.isArray(rawRes) ? rawRes[rawRes.length - 1] : rawRes;
      const allRows = Array.isArray(res?.rows) ? res.rows : [];
      const truncated = allRows.length > maxRows;
      const sliced = truncated ? allRows.slice(0, maxRows) : allRows;
      results.push({
        ok: true,
        columns: (res?.fields || []).map((f) => ({ name: f.name, type: PG_OID_MAP[f.dataTypeID] || `OID(${f.dataTypeID})` })),
        rows: sliced.map((r) => r.map(serializeVal)),
        rowCount: sliced.length,
        affectedRows: typeof res?.rowCount === 'number' ? res.rowCount : 0,
        insertId: null,
        truncated,
        durationMs: Math.round((performance.now() - started) * 100) / 100,
      });
    }
  } finally {
    try { await client.end(); } catch {}
  }
  return results;
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, corsHeaders());
      res.end();
      return;
    }

    if (req.method === 'GET') {
      sendJson(res, 200, {
        ok: true,
        service: 'neon-db-admin-proxy',
        runtime: 'nodejs',
        nodeVersion: process.version,
        version: '1.2.0',
        cors: ALLOWED_ORIGIN,
        supportedDialects: ['mysql', 'mariadb', 'postgresql', 'sqlite'],
        authRequired: Boolean(PROXY_TOKEN),
        configured: true,
      });
      return;
    }

    if (req.method !== 'POST') {
      sendJson(res, 405, { ok: false, error: 'Method not allowed.' });
      return;
    }

    // Optional authentication — enforced only when NEON_DB_PROXY_TOKEN is set
    if (PROXY_TOKEN !== '') {
      const auth = req.headers['x-proxy-token'] || (req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : '');
      if (!auth || !safeEqual(String(auth), PROXY_TOKEN)) {
        sendJson(res, 401, { ok: false, error: 'Unauthorized: invalid or missing proxy token.' });
        return;
      }
    }

    const chunks = [];
    let bytes = 0;
    for await (const chunk of req) {
      bytes += chunk.length;
      if (bytes > MAX_BODY_BYTES) {
        sendJson(res, 413, { ok: false, error: 'Payload too large (max 2 MB).' });
        req.destroy();
        return;
      }
      chunks.push(chunk);
    }

    let body;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      sendJson(res, 400, { ok: false, error: 'Invalid JSON.' });
      return;
    }

    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      sendJson(res, 400, { ok: false, error: 'JSON request body must be an object.' });
      return;
    }

    const { action = 'query', dialect, connection = {}, sql, params, statements: batchStmts, maxRows } = body;
    const connObj = connection && typeof connection === 'object' ? connection : {};
    const cap = Math.min(Math.max(Number(maxRows) || MAX_ROWS, 1), MAX_ROWS);
    let stmts;

    if (action === 'test') {
      const testSql = dialect === 'postgresql' ? 'SELECT version() AS version, 1 AS ok' : dialect === 'sqlite' ? 'SELECT sqlite_version() AS version, 1 AS ok' : 'SELECT VERSION() AS version, 1 AS ok';
      stmts = [{ sql: testSql }];
    } else if (action === 'batch') {
      if (!Array.isArray(batchStmts) || !batchStmts.length || batchStmts.length > 50) {
        sendJson(res, 400, { ok: false, error: 'Batch requires 1 to 50 statements.' });
        return;
      }
      stmts = batchStmts.map((item) => {
        if (!item || typeof item !== 'object' || typeof item.sql !== 'string' || !item.sql.trim()) {
          throw new Error('Each batch statement must contain a non-empty SQL string.');
        }
        return { sql: item.sql, params: Array.isArray(item.params) ? item.params : [] };
      });
    } else if (action === 'query') {
      if (typeof sql !== 'string' || !sql.trim()) {
        sendJson(res, 400, { ok: false, error: 'SQL query string is required.' });
        return;
      }
      stmts = [{ sql, params: Array.isArray(params) ? params : [] }];
    } else {
      sendJson(res, 400, { ok: false, error: 'Invalid action.' });
      return;
    }

    const started = performance.now();
    let results;
    if (dialect === 'sqlite') results = await runSqlite(connObj, stmts, cap);
    else if (dialect === 'mysql' || dialect === 'mariadb') results = await runMysql(connObj, stmts, cap);
    else if (dialect === 'postgresql') results = await runPostgres(connObj, stmts, cap);
    else throw new Error('Unsupported dialect.');

    const totalMs = Math.round((performance.now() - started) * 100) / 100;
    sendJson(res, 200, action === 'batch' ? { ok: true, results, durationMs: totalMs } : results[0], {
      'X-Query-Time-Ms': String(totalMs),
    });
  } catch (err) {
    let msg = err instanceof Error ? err.message : String(err);
    msg = msg.replace(/([a-z][a-z0-9+.-]*:\/\/)([^/\s]*)@([^/@\s]+)/gi, '$1***@$3');
    sendJson(res, 400, { ok: false, error: msg.slice(0, 600) });
  }
});

server.requestTimeout = QUERY_TIMEOUT_MS + 5000;
server.listen(PORT, HOST, () => {
  console.log(`Neon DB Admin Node.js Proxy v1.2.0 listening on http://${HOST}:${PORT} (CORS: ${ALLOWED_ORIGIN}, Auth: ${PROXY_TOKEN ? 'ENABLED' : 'OPTIONAL/OFF'})`);
});
