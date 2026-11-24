export interface D1PreparedStatementLike {
  bind(...values: unknown[]): D1PreparedStatementLike;
  all(): Promise<{ results?: unknown[]; meta?: { changes?: number; last_row_id?: number } }>;
}

export interface D1DatabaseLike {
  prepare(sql: string): D1PreparedStatementLike;
}

export interface Env {
  ALLOWED_ORIGIN?: string;
  MAX_ROWS?: string;
  QUERY_TIMEOUT_MS?: string;
  PROXY_AUTH_TOKEN?: string;
  MAX_REQ_PER_MIN?: string;
  DB?: D1DatabaseLike;
}

export interface ConnectionPayload {
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  database?: string;
  ssl?: boolean;
  sslRejectUnauthorized?: boolean;
  url?: string;
  accountId?: string;
  databaseId?: string;
  apiToken?: string;
  authToken?: string;
}

export interface ProxyRequest {
  action: 'test' | 'query' | 'batch';
  dialect: 'mysql' | 'mariadb' | 'postgresql' | 'd1' | 'd1-binding' | 'libsql';
  connection?: ConnectionPayload;
  sql?: string;
  params?: unknown[];
  statements?: Array<{ sql: string; params?: unknown[] }>;
  maxRows?: number;
}

export interface QueryColumn {
  name: string;
  type: string;
}

export interface QueryResultPayload {
  ok: true;
  columns: QueryColumn[];
  rows: unknown[][];
  rowCount: number;
  affectedRows: number;
  insertId: string | number | null;
  truncated: boolean;
  durationMs: number;
}

export const MAX_BODY_BYTES = 2 * 1024 * 1024; // 2 MB
export const DEFAULT_MAX_ROWS = 5000;
export const DEFAULT_TIMEOUT_MS = 15000;

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'ip6-localhost',
  'ip6-loopback',
  'metadata.google.internal',
  'metadata',
  'instance-data',
]);

// Complete IANA IPv4 special-purpose / private / reserved ranges (unsigned 32-bit)
const BLOCKED_IPV4_CIDRS: Array<[number, number]> = [
  [0x00000000, 0xff000000], // 0.0.0.0/8 ("this" network)
  [0x0a000000, 0xff000000], // 10.0.0.0/8 (RFC 1918)
  [0x64400000, 0xffc00000], // 100.64.0.0/10 (CGNAT)
  [0x7f000000, 0xff000000], // 127.0.0.0/8 (loopback)
  [0xa9fe0000, 0xffff0000], // 169.254.0.0/16 (link-local & cloud metadata)
  [0xac100000, 0xfff00000], // 172.16.0.0/12 (RFC 1918)
  [0xc0000000, 0xffffff00], // 192.0.0.0/24 (IETF protocol assignments)
  [0xc0000200, 0xffffff00], // 192.0.2.0/24 (TEST-NET-1)
  [0xc0a80000, 0xffff0000], // 192.168.0.0/16 (RFC 1918)
  [0xc6120000, 0xfffe0000], // 198.18.0.0/15 (benchmarking)
  [0xc6336400, 0xffffff00], // 198.51.100.0/24 (TEST-NET-2)
  [0xcb007100, 0xffffff00], // 203.0.113.0/24 (TEST-NET-3)
  [0xe0000000, 0xf0000000], // 224.0.0.0/4 (multicast 224-239)
  [0xf0000000, 0xf0000000], // 240.0.0.0/4 (reserved / broadcast 240-255)
];

function isBlockedIpv4Int(ipInt: number): boolean {
  const u = ipInt >>> 0;
  for (const [net, mask] of BLOCKED_IPV4_CIDRS) {
    if (((u & mask) >>> 0) === (net >>> 0)) return true;
  }
  return false;
}

function parseStrictIpv4(host: string): number | null {
  const parts = host.split('.');
  if (parts.length !== 4) return null;
  let val = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    if (p.length > 1 && p.startsWith('0')) {
      throw new Error('Octal IP addresses are not allowed.');
    }
    const n = Number(p);
    if (n < 0 || n > 255) throw new Error('Invalid IPv4 address.');
    val = ((val << 8) | n) >>> 0;
  }
  return val;
}

/**
 * Strict RFC 4291 IPv6 parser expanding to 8 x 16-bit hextets (rejects zone IDs & malformed syntax).
 */
function parseStrictIpv6(raw: string): number[] | null {
  if (!raw.includes(':') || raw.includes('%')) return null;
  // Reject non-IPv6 chars immediately (prevents "localhost:3306" colon bypass)
  if (!/^[0-9a-f:.]+$/i.test(raw)) return null;

  let addr = raw.toLowerCase();
  // Handle trailing dotted IPv4 embedded in IPv6 (e.g. ::ffff:127.0.0.1)
  const lastColon = addr.lastIndexOf(':');
  const tail = addr.slice(lastColon + 1);
  let ipv4Hextets: number[] | null = null;
  if (tail.includes('.')) {
    const v4 = parseStrictIpv4(tail);
    if (v4 === null) return null;
    ipv4Hextets = [(v4 >>> 16) & 0xffff, v4 & 0xffff];
    addr = addr.slice(0, lastColon);
    if (addr.endsWith(':')) {
      // keep '::' intact by appending placeholder that gets replaced
      addr += '0:0';
    } else {
      addr += ':0:0';
    }
  }

  const dblParts = addr.split('::');
  if (dblParts.length > 2) return null;

  const parseGroups = (part: string): number[] => {
    if (part === '') return [];
    const groups = part.split(':');
    const out: number[] = [];
    for (const g of groups) {
      if (!/^[0-9a-f]{1,4}$/.test(g)) throw new Error('Invalid IPv6 hextet.');
      out.push(parseInt(g, 16));
    }
    return out;
  };

  let hextets: number[];
  try {
    if (dblParts.length === 2) {
      const left = parseGroups(dblParts[0]);
      const right = parseGroups(dblParts[1]);
      const missing = 8 - (left.length + right.length);
      if (missing < 1) return null;
      hextets = [...left, ...new Array(missing).fill(0), ...right];
    } else {
      hextets = parseGroups(addr);
      if (hextets.length !== 8) return null;
    }
  } catch {
    return null;
  }

  if (ipv4Hextets) {
    hextets[6] = ipv4Hextets[0];
    hextets[7] = ipv4Hextets[1];
  }
  return hextets;
}

function isBlockedIpv6(h: number[]): boolean {
  const allZeroPrefix = (count: number) => h.slice(0, count).every((x) => x === 0);

  // ::/128 (unspecified) and ::1/128 (loopback)
  if (allZeroPrefix(7) && (h[7] === 0 || h[7] === 1)) return true;

  // ::/96 (deprecated IPv4-compatible, e.g. ::127.0.0.1)
  if (allZeroPrefix(6)) return true;

  // ::ffff:0:0/96 (IPv4-mapped) & ::ffff:0:0:0/96 (IPv4-translated)
  if ((allZeroPrefix(5) && h[5] === 0xffff) || (allZeroPrefix(4) && h[4] === 0xffff && h[5] === 0)) {
    const embeddedV4 = ((h[6] << 16) | h[7]) >>> 0;
    return isBlockedIpv4Int(embeddedV4) || true; // block all IPv4-mapped IPv6 literals to prevent bypasses
  }

  // 64:ff9b::/96 and 64:ff9b:1::/48 (NAT64)
  if (h[0] === 0x0064 && h[1] === 0xff9b && ((h[2] === 0 && h[3] === 0 && h[4] === 0 && h[5] === 0) || h[2] === 1)) {
    return true;
  }

  // 100::/64 (discard-only)
  if (h[0] === 0x0100 && h[1] === 0 && h[2] === 0 && h[3] === 0) return true;

  // 2001::/32 (Teredo) and 2001:db8::/32 (documentation)
  if (h[0] === 0x2001 && (h[1] === 0x0000 || h[1] === 0x0db8)) return true;

  // 2002::/16 (6to4 — embeds IPv4 in h[1], h[2])
  if (h[0] === 0x2002) return true;

  // fc00::/7 (Unique Local Address fc00..fdff)
  if ((h[0] & 0xfe00) === 0xfc00) return true;

  // fe80::/10 (link-local fe80..febf) & fec0::/10 (site-local)
  if ((h[0] & 0xffc0) === 0xfe80 || (h[0] & 0xffc0) === 0xfec0) return true;

  // ff00::/8 (multicast)
  if ((h[0] & 0xff00) === 0xff00) return true;

  return false;
}

/**
 * Validates that a target hostname/IP is safe for outbound connections (comprehensive SSRF defense).
 */
export function validateHost(rawHost: string | undefined): string {
  if (!rawHost || typeof rawHost !== 'string') {
    throw new Error('Database host is required.');
  }
  const stripped = rawHost.trim().toLowerCase().replace(/^\[|\]$/g, '');
  const host = stripped.replace(/\.+$/, ''); // normalize trailing DNS root dot
  if (!host || host.length > 253) {
    throw new Error('Invalid database hostname.');
  }

  // Reject whitespace, control characters, path/query/auth delimiters
  if (/[\s/\\@?#%\u0000-\u001f]/.test(host)) {
    throw new Error('Hostname contains invalid characters.');
  }

  if (
    BLOCKED_HOSTNAMES.has(host) ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host.endsWith('.localhost') ||
    host.endsWith('.home.arpa')
  ) {
    throw new Error('Connections to private or internal hostnames are blocked by SSRF policy.');
  }

  // Strict IPv6 path (also rejects non-IPv6 colon strings like "localhost:3306")
  if (host.includes(':')) {
    const hextets = parseStrictIpv6(host);
    if (!hextets) {
      throw new Error('Invalid IPv6 address or unexpected colon in hostname.');
    }
    if (isBlockedIpv6(hextets)) {
      throw new Error('Connections to loopback, link-local, NAT64, or private IPv6 addresses are blocked.');
    }
    return host;
  }

  // Reject single numeric/hex/octal IP literals (e.g. 2130706433, 0x7f000001)
  if (/^(0x[0-9a-f]+|0[0-7]+|\d+)$/i.test(host)) {
    throw new Error('Numeric IP literal formats are not allowed.');
  }

  // Check dotted IPv4 (strict 4 decimal octets)
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    const ipv4 = parseStrictIpv4(host);
    if (ipv4 === null) throw new Error('Invalid IPv4 address.');
    if (isBlockedIpv4Int(ipv4)) {
      throw new Error('Connections to private, loopback, reserved, or metadata IPv4 addresses are blocked.');
    }
    return host;
  }

  // Reject shorthand / hex / octal dotted IPv4 bypasses (e.g. 127.1, 127.0.1, 0x7f.0x0.0x0.0x1)
  const labels = host.split('.');
  if (labels.length < 2) {
    throw new Error('Hostname must be a fully qualified domain name or public IP.');
  }
  const tld = labels[labels.length - 1];
  // RFC 1123/3696: DNS TLD must be alphabetic or punycode (xn--...) — blocks 127.1, 0x7f.1, 0177.0.1
  if (!/^(?:[a-z]{2,63}|xn--[a-z0-9-]{2,59})$/.test(tld)) {
    throw new Error('Invalid DNS top-level domain or shorthand IP address blocked.');
  }
  for (const label of labels) {
    if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) {
      throw new Error('Invalid DNS hostname label.');
    }
  }
  return host;
}

export function validatePort(rawPort: unknown, defaultPort: number): number {
  if (rawPort === undefined || rawPort === null || rawPort === '') return defaultPort;
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('Port must be an integer between 1 and 65535.');
  }
  return port;
}

export function validateHttpsUrl(rawUrl: string | undefined): URL {
  if (!rawUrl || typeof rawUrl !== 'string') {
    throw new Error('Endpoint URL is required.');
  }
  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    throw new Error('Invalid endpoint URL.');
  }
  if (parsed.protocol !== 'https:') {
    throw new Error('Only HTTPS endpoints are permitted through the Cloudflare Workers proxy.');
  }
  if (parsed.username || parsed.password) {
    throw new Error('Embedded credentials in HTTP endpoint URLs are not allowed.');
  }
  if (parsed.port !== '' && parsed.port !== '443') {
    throw new Error('Only standard HTTPS port 443 is permitted.');
  }
  validateHost(parsed.hostname);
  return parsed;
}

export function validateHexId(id: string | undefined, label: string): string {
  if (!id || !/^[a-f0-9]{32}$/i.test(id.trim())) {
    throw new Error(`Invalid Cloudflare ${label} format (expected 32-character hex ID).`);
  }
  return id.trim().toLowerCase();
}

export function validateUuid(id: string | undefined, label: string): string {
  if (!id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id.trim())) {
    throw new Error(`Invalid ${label} format (expected UUID).`);
  }
  return id.trim().toLowerCase();
}

/**
 * Constant-time string comparison for bearer/proxy token verification.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const bufA = enc.encode(a);
  const bufB = enc.encode(b);
  const maxLen = Math.max(bufA.length, bufB.length);
  let diff = bufA.length ^ bufB.length;
  for (let i = 0; i < maxLen; i++) {
    diff |= (bufA[i] ?? 0) ^ (bufB[i] ?? 0);
  }
  return diff === 0;
}

/**
 * Streams request body with strict byte cap to prevent memory DoS when Content-Length is omitted.
 */
export async function readBoundedText(request: Request, maxBytes: number): Promise<string> {
  const cl = Number(request.headers.get('content-length') || 0);
  if (cl > maxBytes) {
    throw new Error('PAYLOAD_TOO_LARGE');
  }
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new Error('PAYLOAD_TOO_LARGE');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    merged.set(c, offset);
    offset += c.byteLength;
  }
  return new TextDecoder('utf-8').decode(merged);
}

export function buildCorsHeaders(env: Env, extra: Record<string, string> = {}): Headers {
  return new Headers({
    'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Proxy-Token, X-Requested-With, X-DB-Dialect',
    'Access-Control-Expose-Headers': 'X-Query-Time-Ms, X-Proxy-Version',
    'Access-Control-Max-Age': '86400',
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-store',
    'X-Proxy-Version': '1.1.0',
    ...extra,
  });
}

export function jsonResponse(data: unknown, status: number, env: Env, extraHeaders?: Record<string, string>): Response {
  const headers = buildCorsHeaders(env, {
    'Content-Type': 'application/json; charset=utf-8',
    ...extraHeaders,
  });
  return new Response(JSON.stringify(data), { status, headers });
}

export function serializeValue(val: unknown): unknown {
  if (val === null || val === undefined) return null;
  if (typeof val === 'bigint') return val.toString();
  if (val instanceof Date) return val.toISOString();
  if (val instanceof Uint8Array || ArrayBuffer.isView(val)) {
    const bytes = new Uint8Array(val.buffer, val.byteOffset, val.byteLength);
    let hex = '0x';
    const limit = Math.min(bytes.length, 4096);
    for (let i = 0; i < limit; i++) {
      hex += bytes[i].toString(16).padStart(2, '0');
    }
    return bytes.length > limit ? `${hex}…(${bytes.length} bytes)` : hex;
  }
  if (typeof val === 'object') {
    try {
      return JSON.stringify(val);
    } catch {
      return String(val);
    }
  }
  return val;
}

export function sanitizeError(err: unknown, secrets: Array<string | undefined> = []): string {
  let msg = err instanceof Error ? err.message : String(err);
  // Scrub URI credentials (including empty username :pass@ and @ inside passwords)
  msg = msg.replace(/([a-z][a-z0-9+.-]*:\/\/)([^/\s]*)@([^/@\s]+)/gi, (_m, proto, _auth, host) => `${proto}***@${host}`);
  for (const s of secrets) {
    if (s && s.length >= 4) {
      msg = msg.split(s).join('***');
    }
  }
  return msg.slice(0, 600);
}

export async function withTimeout<T>(promise: Promise<T>, ms: number, label = 'Query'): Promise<T> {
  const boundedMs = Math.max(100, ms);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${Math.round(boundedMs)}ms.`)), boundedMs);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
