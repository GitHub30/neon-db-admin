import type { ConnectionConfig, DbDialect } from '../types/db.js';

export interface ParsedUrlMeta {
  protocol?: string;
  host?: string;
  port?: number;
  user?: string;
  database?: string;
}

export function parseConnectionUrlMeta(rawUrl?: string): ParsedUrlMeta {
  const trimmed = (rawUrl || '').trim();
  if (!trimmed) return {};
  try {
    const u = new URL(trimmed);
    const dbRaw = u.pathname.replace(/^\/+/, '');
    return {
      protocol: u.protocol.replace(/:$/, '').toLowerCase(),
      host: u.hostname || undefined,
      port: u.port ? Number(u.port) || undefined : undefined,
      user: u.username ? decodeURIComponent(u.username) : undefined,
      database: dbRaw ? decodeURIComponent(dbRaw) : undefined,
    };
  } catch {
    return {};
  }
}

/**
 * Derives default connection name as `$username@$host` when not explicitly entered by the user.
 */
export function deriveDefaultConnectionName(conn: Partial<ConnectionConfig>): string {
  const explicit = (conn.name || '').trim();
  if (explicit) return explicit;

  const urlMeta = parseConnectionUrlMeta(conn.url);
  const user = (conn.user || urlMeta.user || '').trim();
  const host = (conn.host || urlMeta.host || '').trim();

  if (user && host) return `${user}@${host}`;
  if (host) return host;
  if (conn.dialect === 'd1' && conn.databaseId) return `d1@${conn.databaseId.slice(0, 8)}`;
  if (conn.dialect === 'd1-binding') return 'd1-binding';
  if (conn.filePath) return `sqlite@${conn.filePath}`;
  if (user) return `${user}@localhost`;
  return `${(conn.dialect || 'db').toUpperCase()}@remote`;
}

export interface DialectCandidate {
  dialect: DbDialect;
  port?: number;
}

/**
 * Infers ordered database dialect candidates from URL scheme, credentials, port, and host/user hints
 * so users rarely need to manually pick MySQL vs MariaDB vs PostgreSQL.
 */
export function inferDialectCandidates(conn: Partial<ConnectionConfig>): DialectCandidate[] {
  const url = (conn.url || '').trim();
  const urlMeta = parseConnectionUrlMeta(url);

  // 1. Explicit URL scheme is authoritative
  if (urlMeta.protocol) {
    if (urlMeta.protocol === 'postgres' || urlMeta.protocol === 'postgresql') {
      return [{ dialect: 'postgresql', port: urlMeta.port || conn.port || 5432 }];
    }
    if (urlMeta.protocol === 'mysql' || urlMeta.protocol === 'mysql2') {
      return [{ dialect: 'mysql', port: urlMeta.port || conn.port || 3306 }];
    }
    if (urlMeta.protocol === 'mariadb') {
      return [{ dialect: 'mariadb', port: urlMeta.port || conn.port || 3306 }];
    }
    if (urlMeta.protocol === 'libsql' || (urlMeta.host && /\.turso\.io$/i.test(urlMeta.host))) {
      return [{ dialect: 'libsql' }];
    }
    if (urlMeta.protocol === 'file') {
      return [{ dialect: 'sqlite' }];
    }
  }

  // 2. Specialized credential shapes
  if (conn.accountId && conn.databaseId) {
    return [{ dialect: 'd1' }];
  }
  if (conn.authToken && url) {
    return [{ dialect: 'libsql' }];
  }
  if (conn.filePath) {
    return [{ dialect: 'sqlite' }];
  }

  // 3. Port & host/user heuristics with automatic MySQL <-> PostgreSQL fallback
  const port = conn.port ? Number(conn.port) : undefined;
  const host = (conn.host || '').toLowerCase();
  const user = (conn.user || '').toLowerCase();

  const looksPg =
    port === 5432 ||
    user === 'postgres' ||
    /(postgres|pgsql|neon\.tech|supabase|cockroach|timescale|\bpg\.)/i.test(host);
  const looksMysql =
    port === 3306 ||
    user === 'root' ||
    /(mysql|mariadb|planetscale|psdb\.cloud|tidb|xserver|lolipop|sakura)/i.test(host);

  if (port && port > 0) {
    if (looksPg && !looksMysql) {
      return [
        { dialect: 'postgresql', port },
        { dialect: 'mysql', port },
      ];
    }
    return [
      { dialect: 'mysql', port },
      { dialect: 'postgresql', port },
    ];
  }

  // Port omitted: probe the most likely protocol + default port first, then fallback
  if (looksPg && !looksMysql) {
    return [
      { dialect: 'postgresql', port: 5432 },
      { dialect: 'mysql', port: 3306 },
    ];
  }
  return [
    { dialect: 'mysql', port: 3306 },
    { dialect: 'postgresql', port: 5432 },
  ];
}

/**
 * Returns true if the error message proves the remote server spoke the probed database wire protocol
 * (for example, wrong password or unknown database), so auto-detection should NOT fall back to another dialect.
 */
export function isDefinitiveDialectError(dialect: DbDialect, errorMessage: string): boolean {
  const msg = (errorMessage || '').toLowerCase();
  if (!msg) return false;
  if (dialect === 'mysql' || dialect === 'mariadb') {
    return (
      msg.includes('access denied for user') ||
      msg.includes('unknown database') ||
      msg.includes('er_access_denied') ||
      msg.includes('sqlstate[28000]') ||
      msg.includes('sqlstate[hy000] [1045]') ||
      msg.includes('sqlstate[hy000] [1049]') ||
      msg.includes('caching_sha2_password')
    );
  }
  if (dialect === 'postgresql') {
    return (
      msg.includes('password authentication failed') ||
      msg.includes('no pg_hba.conf entry') ||
      (msg.includes('role "') && msg.includes('does not exist')) ||
      (msg.includes('database "') && msg.includes('does not exist')) ||
      msg.includes('sqlstate[08006]') && msg.includes('authentication')
    );
  }
  return false;
}

/**
 * Refines detected `mysql` dialect to `mariadb` when server version identifies MariaDB.
 */
export function refineDetectedDialect(dialect: DbDialect, serverVersion: string): DbDialect {
  if (dialect === 'mysql' && /mariadb/i.test(serverVersion || '')) {
    return 'mariadb';
  }
  return dialect;
}

const MYSQL_SYSTEM_DBS = new Set(['information_schema', 'mysql', 'performance_schema', 'sys']);

export function sortDatabasesUserFirst(databases: string[], dialect: DbDialect): string[] {
  const unique = Array.from(new Set(databases.map((d) => d.trim()).filter(Boolean)));
  if (dialect === 'mysql' || dialect === 'mariadb') {
    const userDbs = unique.filter((d) => !MYSQL_SYSTEM_DBS.has(d.toLowerCase())).sort((a, b) => a.localeCompare(b));
    const sysDbs = unique.filter((d) => MYSQL_SYSTEM_DBS.has(d.toLowerCase())).sort((a, b) => a.localeCompare(b));
    return [...userDbs, ...sysDbs];
  }
  return unique.sort((a, b) => {
    if (a === 'postgres') return 1;
    if (b === 'postgres') return -1;
    return a.localeCompare(b);
  });
}

export function isSystemDatabase(dbName: string, dialect: DbDialect): boolean {
  if (dialect === 'mysql' || dialect === 'mariadb') {
    return MYSQL_SYSTEM_DBS.has(dbName.toLowerCase());
  }
  return false;
}
