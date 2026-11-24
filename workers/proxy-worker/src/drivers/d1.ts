import type { ConnectionPayload, Env, QueryColumn, QueryResultPayload } from '../security.js';
import { serializeValue, validateHexId, validateUuid, withTimeout } from '../security.js';

interface CloudflareD1ApiResult {
  results?: Array<Record<string, unknown>>;
  success?: boolean;
  meta?: {
    changes?: number;
    last_row_id?: number;
    duration?: number;
  };
}

interface CloudflareD1ApiResponse {
  success: boolean;
  errors?: Array<{ code: number; message: string }>;
  result?: CloudflareD1ApiResult[];
}

function normalizeObjectRows(
  rowsObj: Array<Record<string, unknown>>,
  maxRows: number
): { columns: QueryColumn[]; rows: unknown[][]; truncated: boolean } {
  const truncated = rowsObj.length > maxRows;
  const sliced = truncated ? rowsObj.slice(0, maxRows) : rowsObj;
  const keySet = new Set<string>();
  for (const row of sliced) {
    for (const k of Object.keys(row)) keySet.add(k);
  }
  const keys = Array.from(keySet);
  const columns: QueryColumn[] = keys.map((name) => ({ name, type: 'ANY' }));
  const rows = sliced.map((r) => keys.map((k) => serializeValue(r[k])));
  return { columns, rows, truncated };
}

export async function executeD1Rest(
  conn: ConnectionPayload,
  statements: Array<{ sql: string; params?: unknown[] }>,
  maxRows: number,
  timeoutMs: number
): Promise<QueryResultPayload[]> {
  const accountId = validateHexId(conn.accountId, 'Account ID');
  const databaseId = validateUuid(conn.databaseId, 'D1 Database ID');
  const apiToken = conn.apiToken?.trim();
  if (!apiToken) {
    throw new Error('Cloudflare API Token is required for D1 REST connections.');
  }

  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`;
  const deadline = performance.now() + timeoutMs;
  const results: QueryResultPayload[] = [];

  for (const stmt of statements) {
    const rem = Math.max(250, deadline - performance.now());
    if (rem <= 250) throw new Error(`Batch timed out after ${timeoutMs}ms.`);

    const started = performance.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), rem);
    let resp: Response;
    let payload: CloudflareD1ApiResponse;
    try {
      resp = await fetch(endpoint, {
        method: 'POST',
        redirect: 'error',
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${apiToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sql: stmt.sql,
          params: stmt.params ?? [],
        }),
      });
      const text = await resp.text();
      try {
        payload = JSON.parse(text) as CloudflareD1ApiResponse;
      } catch {
        throw new Error(`Cloudflare D1 API returned non-JSON response (HTTP ${resp.status}).`);
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new Error(`Cloudflare D1 API timed out after ${Math.round(rem)}ms.`);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }

    const durationMs = Math.round((performance.now() - started) * 100) / 100;
    if (!resp.ok || !payload.success) {
      const errMsg = payload.errors?.map((e) => `${e.code}: ${e.message}`).join('; ') || `D1 HTTP ${resp.status}`;
      throw new Error(errMsg);
    }

    const first = payload.result?.[0];
    const normalized = normalizeObjectRows(first?.results ?? [], maxRows);
    results.push({
      ok: true,
      columns: normalized.columns,
      rows: normalized.rows,
      rowCount: normalized.rows.length,
      affectedRows: first?.meta?.changes ?? 0,
      insertId: first?.meta?.last_row_id ?? null,
      truncated: normalized.truncated,
      durationMs,
    });
  }

  return results;
}

export async function executeD1Binding(
  env: Env,
  statements: Array<{ sql: string; params?: unknown[] }>,
  maxRows: number,
  timeoutMs: number
): Promise<QueryResultPayload[]> {
  if (!env.DB) {
    throw new Error('No D1 database binding (DB) is configured on this Worker.');
  }
  const deadline = performance.now() + timeoutMs;
  const results: QueryResultPayload[] = [];
  for (const stmt of statements) {
    const rem = Math.max(250, deadline - performance.now());
    const started = performance.now();
    const prepared = stmt.params && stmt.params.length > 0
      ? env.DB.prepare(stmt.sql).bind(...stmt.params)
      : env.DB.prepare(stmt.sql);
    const res = await withTimeout(prepared.all(), rem, 'Cloudflare D1 binding');
    const durationMs = Math.round((performance.now() - started) * 100) / 100;
    const normalized = normalizeObjectRows((res.results || []) as Array<Record<string, unknown>>, maxRows);
    results.push({
      ok: true,
      columns: normalized.columns,
      rows: normalized.rows,
      rowCount: normalized.rows.length,
      affectedRows: res.meta?.changes ?? 0,
      insertId: res.meta?.last_row_id ?? null,
      truncated: normalized.truncated,
      durationMs,
    });
  }
  return results;
}
