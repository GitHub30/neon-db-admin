import { executeD1Binding, executeD1Rest } from './drivers/d1.js';
import { executeLibsql } from './drivers/libsql.js';
import { executeMysql } from './drivers/mysql.js';
import { executePostgres } from './drivers/postgres.js';
import {
  buildCorsHeaders,
  constantTimeEqual,
  DEFAULT_MAX_ROWS,
  DEFAULT_TIMEOUT_MS,
  jsonResponse,
  MAX_BODY_BYTES,
  readBoundedText,
  sanitizeError,
  type Env,
  type ProxyRequest,
  type QueryResultPayload,
} from './security.js';

const ipWindow = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(ip: string, limitPerMin: number): boolean {
  const now = Date.now();
  if (ipWindow.size > 2000) {
    for (const [k, v] of ipWindow) {
      if (v.resetAt <= now) ipWindow.delete(k);
    }
  }
  const entry = ipWindow.get(ip);
  if (!entry || entry.resetAt <= now) {
    ipWindow.set(ip, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  if (entry.count >= limitPerMin) return false;
  entry.count++;
  return true;
}

function getTestQuery(dialect: ProxyRequest['dialect']): string {
  switch (dialect) {
    case 'mysql':
    case 'mariadb':
      return 'SELECT VERSION() AS version, DATABASE() AS current_db, 1 AS ok';
    case 'postgresql':
      return 'SELECT version() AS version, current_database() AS current_db, 1 AS ok';
    case 'd1':
    case 'd1-binding':
    case 'libsql':
      return 'SELECT sqlite_version() AS version, 1 AS ok';
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      // Always handle CORS preflight first
      if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: buildCorsHeaders(env) });
      }

      const url = new URL(request.url);

      // Health / capability discovery endpoint
      if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/health' || url.pathname === '/api/health')) {
        return jsonResponse(
          {
            ok: true,
            service: 'neon-db-admin-proxy',
            runtime: 'cloudflare-workers',
            version: '1.1.0',
            cors: env.ALLOWED_ORIGIN || '*',
            supportedDialects: ['mysql', 'mariadb', 'postgresql', 'd1', 'libsql', ...(env.DB ? ['d1-binding'] : [])],
            authRequired: Boolean(env.PROXY_AUTH_TOKEN),
          },
          200,
          env
        );
      }

      if (request.method !== 'POST') {
        return jsonResponse({ ok: false, error: 'Method not allowed. Use GET /health or POST /api/query.' }, 405, env);
      }

      // Per-IP sliding-window rate guard
      const clientIp = request.headers.get('CF-Connecting-IP') || 'unknown';
      const maxPerMin = Math.max(10, Number(env.MAX_REQ_PER_MIN) || 120);
      if (!checkRateLimit(clientIp, maxPerMin)) {
        return jsonResponse({ ok: false, error: 'Too many requests. Please wait a moment and retry.' }, 429, env);
      }

      // Optional token authentication if PROXY_AUTH_TOKEN secret is configured
      if (env.PROXY_AUTH_TOKEN) {
        const tokenHeader =
          request.headers.get('X-Proxy-Token') ||
          (request.headers.get('Authorization')?.startsWith('Bearer ')
            ? request.headers.get('Authorization')!.slice(7)
            : '');
        if (!tokenHeader || !constantTimeEqual(tokenHeader, env.PROXY_AUTH_TOKEN)) {
          return jsonResponse({ ok: false, error: 'Unauthorized: invalid or missing proxy token.' }, 401, env);
        }
      }

      let bodyText: string;
      try {
        bodyText = await readBoundedText(request, MAX_BODY_BYTES);
      } catch (e) {
        if (e instanceof Error && e.message === 'PAYLOAD_TOO_LARGE') {
          return jsonResponse({ ok: false, error: 'Payload too large (max 2 MB).' }, 413, env);
        }
        return jsonResponse({ ok: false, error: 'Unable to read request body.' }, 400, env);
      }

      let payload: ProxyRequest;
      try {
        const parsed = JSON.parse(bodyText);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          return jsonResponse({ ok: false, error: 'JSON body must be an object.' }, 400, env);
        }
        payload = parsed as ProxyRequest;
      } catch {
        return jsonResponse({ ok: false, error: 'Invalid JSON request body.' }, 400, env);
      }

      const allowedDialects = new Set(['mysql', 'mariadb', 'postgresql', 'd1', 'd1-binding', 'libsql']);
      if (!allowedDialects.has(payload.dialect)) {
        return jsonResponse({ ok: false, error: 'Unsupported or missing database dialect.' }, 400, env);
      }

      const envMaxRows = Math.min(Math.max(Number(env.MAX_ROWS) || DEFAULT_MAX_ROWS, 1), 10000);
      const maxRows = Math.min(Math.max(Number(payload.maxRows) || envMaxRows, 1), envMaxRows);
      const timeoutMs = Math.min(Math.max(Number(env.QUERY_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS, 1000), 25000);

      let statements: Array<{ sql: string; params?: unknown[] }>;
      if (payload.action === 'test') {
        statements = [{ sql: getTestQuery(payload.dialect) }];
      } else if (payload.action === 'batch') {
        if (!Array.isArray(payload.statements) || payload.statements.length === 0 || payload.statements.length > 50) {
          return jsonResponse({ ok: false, error: 'Batch requires 1 to 50 SQL statements.' }, 400, env);
        }
        statements = [];
        for (const item of payload.statements) {
          if (!item || typeof item !== 'object' || typeof item.sql !== 'string' || !item.sql.trim()) {
            return jsonResponse({ ok: false, error: 'Each batch statement must be an object with a non-empty SQL string.' }, 400, env);
          }
          statements.push({
            sql: item.sql,
            params: Array.isArray(item.params) ? item.params : undefined,
          });
        }
      } else if (payload.action === 'query') {
        if (!payload.sql || typeof payload.sql !== 'string') {
          return jsonResponse({ ok: false, error: 'SQL query string is required.' }, 400, env);
        }
        statements = [{ sql: payload.sql, params: Array.isArray(payload.params) ? payload.params : undefined }];
      } else {
        return jsonResponse({ ok: false, error: 'Invalid action. Expected test, query, or batch.' }, 400, env);
      }

      const conn = payload.connection && typeof payload.connection === 'object' ? payload.connection : {};
      const secrets = [conn.password, conn.apiToken, conn.authToken, env.PROXY_AUTH_TOKEN];
      const started = performance.now();

      try {
        let results: QueryResultPayload[];
        switch (payload.dialect) {
          case 'mysql':
          case 'mariadb':
            results = await executeMysql(conn, statements, maxRows, timeoutMs);
            break;
          case 'postgresql':
            results = await executePostgres(conn, statements, maxRows, timeoutMs);
            break;
          case 'd1':
            results = await executeD1Rest(conn, statements, maxRows, timeoutMs);
            break;
          case 'd1-binding':
            results = await executeD1Binding(env, statements, maxRows, timeoutMs);
            break;
          case 'libsql':
            results = await executeLibsql(conn, statements, maxRows, timeoutMs);
            break;
        }

        const totalMs = Math.round((performance.now() - started) * 100) / 100;
        const responseBody =
          payload.action === 'batch'
            ? { ok: true, results, durationMs: totalMs }
            : results[0];

        return jsonResponse(responseBody, 200, env, { 'X-Query-Time-Ms': String(totalMs) });
      } catch (err) {
        const totalMs = Math.round((performance.now() - started) * 100) / 100;
        return jsonResponse(
          { ok: false, error: sanitizeError(err, secrets), durationMs: totalMs },
          400,
          env,
          { 'X-Query-Time-Ms': String(totalMs) }
        );
      }
    } catch (fatal) {
      // Top-level safety net guarantees CORS headers even on unexpected runtime errors
      return jsonResponse({ ok: false, error: sanitizeError(fatal) }, 500, env);
    }
  },
};
