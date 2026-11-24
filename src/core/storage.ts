import type { ConnectionConfig, ERModel, Locale, QueryHistoryEntry, SqlSnippet, ThemeMode } from '../types/db.js';
import { DEFAULT_WORKER_PROXY_URL } from '../i18n/translations.js';

const KEYS = {
  connections: 'neondb_connections_v1',
  sessionSecrets: 'neondb_session_secrets_v1',
  history: 'neondb_history_v1',
  snippets: 'neondb_snippets_v1',
  erModels: 'neondb_er_models_v1',
  theme: 'neondb_theme_v1',
  locale: 'neondb_locale_v1',
};

interface SecretBundle {
  password?: string;
  apiToken?: string;
  authToken?: string;
  proxyToken?: string;
  url?: string;
}

const SENSITIVE_QUERY_PARAM = /[?&](?:password|passwd|pwd|token|auth_?token|api_?key|secret)=/i;

export function urlContainsSecret(rawUrl: string | undefined): boolean {
  if (!rawUrl) return false;
  return /:[^/@]+@/.test(rawUrl) || SENSITIVE_QUERY_PARAM.test(rawUrl);
}

function safeGet(storage: 'local' | 'session', key: string): string | null {
  try {
    const s = storage === 'local' ? window.localStorage : window.sessionStorage;
    return s.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(storage: 'local' | 'session', key: string, value: string): void {
  try {
    const s = storage === 'local' ? window.localStorage : window.sessionStorage;
    s.setItem(key, value);
  } catch {
    // storage quota or sandboxed iframe ignored
  }
}

function safeRemove(storage: 'local' | 'session', key: string): void {
  try {
    const s = storage === 'local' ? window.localStorage : window.sessionStorage;
    s.removeItem(key);
  } catch {
    // ignore
  }
}

function readJson<T>(storage: 'local' | 'session', key: string, fallback: T): T {
  try {
    const raw = safeGet(storage, key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function getDefaultConnections(): ConnectionConfig[] {
  return [
    {
      id: 'demo-ecommerce',
      name: 'EC Store Demo (SQLite WASM)',
      dialect: 'sqlite',
      transport: 'wasm',
      sampleId: 'ecommerce',
      color: '#0f766e',
      createdAt: 1,
    },
    {
      id: 'demo-saas',
      name: 'SaaS Workspace (SQLite WASM)',
      dialect: 'sqlite',
      transport: 'wasm',
      sampleId: 'saas',
      color: '#0284c7',
      createdAt: 2,
    },
    {
      id: 'demo-blog',
      name: 'Blog CMS (SQLite WASM)',
      dialect: 'sqlite',
      transport: 'wasm',
      sampleId: 'blog',
      color: '#b45309',
      createdAt: 3,
    },
  ];
}

export function loadConnections(): ConnectionConfig[] {
  const saved = readJson<ConnectionConfig[]>('local', KEYS.connections, []);
  const sessionSecrets = readJson<Record<string, SecretBundle>>('session', KEYS.sessionSecrets, {});
  const list = saved.length > 0 ? saved : getDefaultConnections();

  return list.map((conn) => {
    const sec = sessionSecrets[conn.id];
    if (!sec) return conn;
    return {
      ...conn,
      password: conn.password || sec.password,
      apiToken: conn.apiToken || sec.apiToken,
      authToken: conn.authToken || sec.authToken,
      proxyToken: conn.proxyToken || sec.proxyToken,
      url: conn.url || sec.url,
    };
  });
}

export function saveConnections(connections: ConnectionConfig[]): void {
  const sessionSecrets: Record<string, SecretBundle> = {};
  // Exclude ephemeral uploaded local .sqlite files that have no backing storage
  const persistable = connections.filter((c) => !(c.transport === 'wasm' && !c.sampleId));
  const persisted = persistable.map((c) => {
    if (c.rememberSecrets) {
      return c;
    }
    const secretUrl = urlContainsSecret(c.url);
    sessionSecrets[c.id] = {
      password: c.password,
      apiToken: c.apiToken,
      authToken: c.authToken,
      proxyToken: c.proxyToken,
      url: secretUrl ? c.url : undefined,
    };
    return {
      ...c,
      password: '',
      apiToken: '',
      authToken: '',
      proxyToken: '',
      url: secretUrl ? '' : c.url,
    };
  });
  safeSet('local', KEYS.connections, JSON.stringify(persisted));
  safeSet('session', KEYS.sessionSecrets, JSON.stringify(sessionSecrets));
}

export function scrubSecretsFromConnection(c: ConnectionConfig): ConnectionConfig {
  return {
    ...c,
    rememberSecrets: false,
    password: '',
    apiToken: '',
    authToken: '',
    proxyToken: '',
    url: urlContainsSecret(c.url) ? '' : c.url,
  };
}

export function clearAllStoredSecrets(currentConnections?: ConnectionConfig[]): ConnectionConfig[] {
  safeRemove('session', KEYS.sessionSecrets);
  const scrubbed = (currentConnections ?? loadConnections()).map(scrubSecretsFromConnection);
  saveConnections(scrubbed);
  return scrubbed;
}

export function loadHistory(): QueryHistoryEntry[] {
  return readJson<QueryHistoryEntry[]>('local', KEYS.history, []);
}

export function saveHistory(entries: QueryHistoryEntry[]): void {
  safeSet('local', KEYS.history, JSON.stringify(entries.slice(0, 100)));
}

export function loadSnippets(): SqlSnippet[] {
  const saved = readJson<SqlSnippet[]>('local', KEYS.snippets, []);
  if (saved.length > 0) return saved;
  return [
    {
      id: 'snip-1',
      title: 'Top Customers by Order Revenue',
      dialect: 'all',
      sql: `SELECT
  c.full_name,
  c.tier,
  COUNT(o.id) AS orders_count,
  COALESCE(SUM(o.total_jpy), 0) AS lifetime_jpy
FROM customers c
LEFT JOIN orders o ON o.customer_id = c.id
GROUP BY c.id
ORDER BY lifetime_jpy DESC;`,
      createdAt: 1,
    },
    {
      id: 'snip-2',
      title: 'Monthly Sales Breakdown (Chart Ready)',
      dialect: 'all',
      sql: `SELECT
  substr(ordered_at, 1, 7) AS month,
  COUNT(*) AS orders,
  SUM(total_jpy) AS revenue_jpy
FROM orders
GROUP BY substr(ordered_at, 1, 7)
ORDER BY month ASC;`,
      createdAt: 2,
    },
    {
      id: 'snip-3',
      title: 'Products & Category Inventory',
      dialect: 'all',
      sql: `SELECT
  p.sku,
  p.name,
  c.name AS category,
  p.price_jpy,
  p.stock
FROM products p
JOIN categories c ON c.id = p.category_id
ORDER BY p.price_jpy DESC;`,
      createdAt: 3,
    },
  ];
}

export function saveSnippets(snippets: SqlSnippet[]): void {
  safeSet('local', KEYS.snippets, JSON.stringify(snippets));
}

export function loadERModels(): ERModel[] {
  return readJson<ERModel[]>('local', KEYS.erModels, []);
}

export function saveERModels(models: ERModel[]): void {
  safeSet('local', KEYS.erModels, JSON.stringify(models.slice(0, 20)));
}

export function loadTheme(): ThemeMode {
  const val = safeGet('local', KEYS.theme);
  if (val === 'light' || val === 'dark' || val === 'system') return val;
  return 'system';
}

export function saveTheme(mode: ThemeMode): void {
  safeSet('local', KEYS.theme, mode);
}

export function loadLocale(): Locale {
  const val = safeGet('local', KEYS.locale);
  if (val === 'ja' || val === 'en') return val;
  return 'ja';
}

export function saveLocale(loc: Locale): void {
  safeSet('local', KEYS.locale, loc);
}

export function createEmptyConnectionTemplate(): ConnectionConfig {
  return {
    id: `conn-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    name: 'New Database Connection',
    dialect: 'postgresql',
    transport: 'cloudflare-worker',
    proxyUrl: DEFAULT_WORKER_PROXY_URL,
    host: '',
    port: 5432,
    user: 'postgres',
    password: '',
    database: 'postgres',
    ssl: true,
    sslRejectUnauthorized: true,
    rememberSecrets: false,
    createdAt: Date.now(),
  };
}
