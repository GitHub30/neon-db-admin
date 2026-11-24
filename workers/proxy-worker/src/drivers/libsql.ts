import type { ConnectionPayload, QueryColumn, QueryResultPayload } from '../security.js';
import { serializeValue, validateHttpsUrl } from '../security.js';

interface HranaValue {
  type: 'null' | 'integer' | 'float' | 'text' | 'blob';
  value?: string | number;
  base64?: string;
}

function toHranaArg(v: unknown): HranaValue {
  if (v === null || v === undefined) return { type: 'null' };
  if (typeof v === 'number') {
    return Number.isInteger(v) ? { type: 'integer', value: String(v) } : { type: 'float', value: v };
  }
  if (typeof v === 'boolean') return { type: 'integer', value: v ? '1' : '0' };
  return { type: 'text', value: String(v) };
}

function fromHranaValue(v: HranaValue | null | undefined): unknown {
  if (!v || v.type === 'null') return null;
  if (v.type === 'integer') {
    const n = Number(v.value);
    return Number.isSafeInteger(n) ? n : String(v.value ?? '');
  }
  if (v.type === 'float') return Number(v.value);
  if (v.type === 'blob') return v.base64 ? `base64:${v.base64}` : null;
  return v.value ?? '';
}

export async function executeLibsql(
  conn: ConnectionPayload,
  statements: Array<{ sql: string; params?: unknown[] }>,
  maxRows: number,
  timeoutMs: number
): Promise<QueryResultPayload[]> {
  const rawUrl = (conn.url || '').replace(/^libsql:\/\//i, 'https://');
  const parsed = validateHttpsUrl(rawUrl);
  const endpoint = `${parsed.origin}/v2/pipeline`;

  const requests = [
    ...statements.map((stmt) => ({
      type: 'execute',
      stmt: {
        sql: stmt.sql,
        args: (stmt.params || []).map(toHranaArg),
      },
    })),
    { type: 'close' },
  ];

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = conn.authToken || conn.apiToken || conn.password;
  if (token) headers.Authorization = `Bearer ${token}`;

  const started = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let resp: Response;
  let data: {
    results?: Array<{
      type: 'ok' | 'error';
      error?: { message?: string };
      response?: {
        result?: {
          cols?: Array<{ name?: string; decltype?: string }>;
          rows?: Array<HranaValue[]>;
          affected_row_count?: number;
          last_insert_rowid?: string | null;
        };
      };
    }>;
  };
  try {
    resp = await fetch(endpoint, {
      method: 'POST',
      redirect: 'error',
      signal: controller.signal,
      headers,
      body: JSON.stringify({ requests }),
    });
    const contentType = resp.headers.get('content-type') || '';
    if (!resp.ok) {
      throw new Error(`LibSQL upstream returned HTTP ${resp.status}.`);
    }
    if (!contentType.includes('json')) {
      throw new Error('LibSQL upstream did not return a JSON response.');
    }
    data = (await resp.json()) as typeof data;
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(`LibSQL request timed out after ${timeoutMs}ms.`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
  const totalDuration = Math.round((performance.now() - started) * 100) / 100;

  const out: QueryResultPayload[] = [];
  for (let i = 0; i < statements.length; i++) {
    const item = data.results?.[i];
    if (!item) throw new Error('Missing statement result from LibSQL pipeline.');
    if (item.type === 'error') {
      throw new Error(item.error?.message || 'LibSQL query error.');
    }
    const res = item.response?.result;
    const cols: QueryColumn[] = (res?.cols || []).map((c) => ({
      name: c.name || '',
      type: c.decltype || 'ANY',
    }));
    const rawRows = res?.rows || [];
    const truncated = rawRows.length > maxRows;
    const sliced = truncated ? rawRows.slice(0, maxRows) : rawRows;
    const rows = sliced.map((r) => r.map((cell) => serializeValue(fromHranaValue(cell))));
    out.push({
      ok: true,
      columns: cols,
      rows,
      rowCount: rows.length,
      affectedRows: res?.affected_row_count ?? 0,
      insertId: res?.last_insert_rowid ?? null,
      truncated,
      durationMs: Math.round((totalDuration / statements.length) * 100) / 100,
    });
  }
  return out;
}
