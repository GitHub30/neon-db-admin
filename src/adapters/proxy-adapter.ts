import type {
  ColumnSchema,
  ConnectionConfig,
  DatabaseSchema,
  DbDialect,
  ForeignKeySchema,
  IndexSchema,
  QueryResult,
  TableSchema,
  TriggerSchema,
  ViewSchema,
} from '../types/db.js';
import type { DatabaseAdapter } from './base.js';
import { isMysqlLike, isPostgres, isSqliteLike, quoteIdent } from '../core/dialect.js';
import {
  inferDialectCandidates,
  isDefinitiveDialectError,
  isSystemDatabase,
  parseConnectionUrlMeta,
  refineDetectedDialect,
  sortDatabasesUserFirst,
} from '../core/dialect-detect.js';
import { DEFAULT_WORKER_PROXY_URL } from '../i18n/translations.js';

interface ProxyResponse {
  ok: boolean;
  error?: string;
  columns?: Array<{ name: string; type: string }>;
  rows?: unknown[][];
  rowCount?: number;
  affectedRows?: number;
  insertId?: string | number | null;
  truncated?: boolean;
  durationMs?: number;
  results?: ProxyResponse[];
}

const CLIENT_TIMEOUT_MS = 25000;

function rewriteConnectionUrlDatabase(rawUrl: string | undefined, dbName: string | undefined): string | undefined {
  if (!rawUrl) return rawUrl;
  if (!dbName) return rawUrl;
  try {
    const u = new URL(rawUrl);
    u.pathname = `/${encodeURIComponent(dbName)}`;
    return u.toString();
  } catch {
    return rawUrl;
  }
}

export class ProxyDatabaseAdapter implements DatabaseAdapter {
  readonly config: ConnectionConfig;
  dialect: DbDialect;
  private activeDatabase: string | undefined;
  private resolvedPort: number | undefined;

  constructor(config: ConnectionConfig) {
    this.config = config;
    this.dialect = config.dialect;
    this.resolvedPort = config.port;
    const urlDb = parseConnectionUrlMeta(config.url).database;
    this.activeDatabase = (config.database || urlDb || '').trim() || undefined;
  }

  setActiveDatabase(databaseName: string): void {
    const clean = databaseName.trim();
    this.activeDatabase = clean || undefined;
  }

  getActiveDatabase(): string | undefined {
    return this.activeDatabase;
  }

  private getEndpoint(): string {
    const raw = (this.config.proxyUrl || DEFAULT_WORKER_PROXY_URL).trim();
    if (!raw) throw new Error('Proxy URL is required.');
    return raw;
  }

  private buildConnectionPayload(overrides?: { port?: number; database?: string }) {
    const effectiveDb = overrides?.database !== undefined ? overrides.database : this.activeDatabase;
    const effectivePort = overrides?.port ?? this.resolvedPort ?? this.config.port;
    const effectiveUrl =
      this.config.url && effectiveDb && effectiveDb !== parseConnectionUrlMeta(this.config.url).database
        ? rewriteConnectionUrlDatabase(this.config.url, effectiveDb)
        : this.config.url;

    return {
      host: this.config.host,
      port: effectivePort,
      user: this.config.user,
      password: this.config.password,
      database: effectiveDb,
      ssl: this.config.ssl,
      sslRejectUnauthorized: this.config.sslRejectUnauthorized !== false,
      url: effectiveUrl,
      filePath: this.config.filePath,
      accountId: this.config.accountId,
      databaseId: this.config.databaseId,
      apiToken: this.config.apiToken,
      authToken: this.config.authToken,
    };
  }

  private async request(body: Record<string, unknown>, dialectOverride?: DbDialect): Promise<ProxyResponse> {
    const endpoint = this.getEndpoint();
    const useDialect = dialectOverride ?? this.dialect;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-DB-Dialect': useDialect,
    };
    if (this.config.proxyToken) {
      headers['X-Proxy-Token'] = this.config.proxyToken;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CLIENT_TIMEOUT_MS);
    let resp: Response;
    let text: string;
    try {
      resp = await fetch(endpoint, {
        method: 'POST',
        mode: 'cors',
        signal: controller.signal,
        headers,
        body: JSON.stringify(body),
      });
      text = await resp.text();
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new Error(`プロキシ要求がタイムアウトしました (${CLIENT_TIMEOUT_MS / 1000}秒)`);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }

    let parsed: ProxyResponse;
    try {
      parsed = JSON.parse(text) as ProxyResponse;
    } catch {
      throw new Error(`Proxy returned HTTP ${resp.status}: ${text.slice(0, 200)}`);
    }
    if (!resp.ok || !parsed.ok) {
      throw new Error(parsed.error || `Proxy request failed (HTTP ${resp.status})`);
    }
    return parsed;
  }

  async connect(): Promise<void> {
    const test = await this.testConnection();
    if (!test.ok) {
      throw new Error(test.error || 'Unable to connect via proxy.');
    }
  }

  async disconnect(): Promise<void> {
    // Stateless HTTP proxy
  }

  async testConnection(): Promise<{ ok: boolean; version: string; durationMs: number; dialect?: DbDialect; error?: string }> {
    const candidates = this.config.autoDetectDialect
      ? inferDialectCandidates(this.config)
      : [{ dialect: this.dialect, port: this.resolvedPort ?? this.config.port }];

    let lastError = '';
    for (const cand of candidates) {
      try {
        const res = await this.request(
          {
            action: 'test',
            dialect: cand.dialect,
            connection: this.buildConnectionPayload({ port: cand.port }),
          },
          cand.dialect
        );
        const version = String(res.rows?.[0]?.[0] ?? cand.dialect);
        const refined = refineDetectedDialect(cand.dialect, version);
        this.dialect = refined;
        this.config.dialect = refined;
        if (cand.port && !this.config.port) {
          this.resolvedPort = cand.port;
        }
        return {
          ok: true,
          version,
          durationMs: res.durationMs ?? 0,
          dialect: refined,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        lastError = msg;
        if (isDefinitiveDialectError(cand.dialect, msg)) {
          this.dialect = cand.dialect;
          this.config.dialect = cand.dialect;
          return { ok: false, version: '', durationMs: 0, dialect: cand.dialect, error: msg };
        }
      }
    }

    return {
      ok: false,
      version: '',
      durationMs: 0,
      error: lastError || 'Unable to connect via proxy.',
    };
  }

  async query(sql: string, params?: unknown[], maxRows = 2000): Promise<QueryResult> {
    const res = await this.request({
      action: 'query',
      dialect: this.dialect,
      connection: this.buildConnectionPayload(),
      sql,
      params,
      maxRows,
    });
    return {
      columns: res.columns || [],
      rows: res.rows || [],
      rowCount: res.rowCount ?? (res.rows?.length || 0),
      affectedRows: res.affectedRows ?? 0,
      insertId: res.insertId ?? null,
      truncated: Boolean(res.truncated),
      durationMs: res.durationMs ?? 0,
      sql,
    };
  }

  async executeBatch(statements: Array<{ sql: string; params?: unknown[] }>, maxRows = 2000): Promise<QueryResult[]> {
    const res = await this.request({
      action: 'batch',
      dialect: this.dialect,
      connection: this.buildConnectionPayload(),
      statements,
      maxRows,
    });
    return (res.results || []).map((r, i) => ({
      columns: r.columns || [],
      rows: r.rows || [],
      rowCount: r.rowCount ?? (r.rows?.length || 0),
      affectedRows: r.affectedRows ?? 0,
      insertId: r.insertId ?? null,
      truncated: Boolean(r.truncated),
      durationMs: r.durationMs ?? 0,
      sql: statements[i]?.sql,
    }));
  }

  async listDatabases(): Promise<string[]> {
    if (isMysqlLike(this.dialect)) {
      try {
        const res = await this.query('SHOW DATABASES', undefined, 500);
        return sortDatabasesUserFirst(
          res.rows.map((r) => String(r[0] ?? '')).filter(Boolean),
          this.dialect
        );
      } catch {
        return this.activeDatabase ? [this.activeDatabase] : [];
      }
    }
    if (isPostgres(this.dialect)) {
      try {
        const res = await this.query(
          'SELECT datname FROM pg_database WHERE datistemplate = false ORDER BY datname',
          undefined,
          500
        );
        return sortDatabasesUserFirst(
          res.rows.map((r) => String(r[0] ?? '')).filter(Boolean),
          this.dialect
        );
      } catch {
        return this.activeDatabase ? [this.activeDatabase] : ['postgres'];
      }
    }
    const single = this.activeDatabase || this.config.databaseId || this.config.filePath || this.config.name;
    return single ? [single] : [];
  }

  async introspectSchema(targetDatabase?: string): Promise<DatabaseSchema> {
    if (targetDatabase !== undefined) {
      this.setActiveDatabase(targetDatabase);
    }
    if (isMysqlLike(this.dialect)) return this.introspectMysql();
    if (isPostgres(this.dialect)) return this.introspectPostgres();
    return this.introspectSqliteLike();
  }

  private async introspectMysql(): Promise<DatabaseSchema> {
    // 1. Fetch version, currently selected database, and full SHOW DATABASES list
    let serverVersion = 'MySQL';
    let currentDb = this.activeDatabase || '';
    let availableDatabases: string[] = [];

    try {
      const [verRes, dbsRes] = await this.executeBatch(
        [{ sql: 'SELECT VERSION(), DATABASE()' }, { sql: 'SHOW DATABASES' }],
        1000
      );
      serverVersion = String(verRes.rows[0]?.[0] ?? 'MySQL');
      const dbFromServer = verRes.rows[0]?.[1];
      if (!currentDb && dbFromServer != null && String(dbFromServer).trim() !== '') {
        currentDb = String(dbFromServer).trim();
      }
      availableDatabases = sortDatabasesUserFirst(
        dbsRes.rows.map((r) => String(r[0] ?? '')).filter(Boolean),
        this.dialect
      );
    } catch {
      // Fallback when user lacks SHOW DATABASES privilege
      const verRes = await this.query('SELECT VERSION(), DATABASE()', undefined, 10);
      serverVersion = String(verRes.rows[0]?.[0] ?? 'MySQL');
      const dbFromServer = verRes.rows[0]?.[1];
      if (!currentDb && dbFromServer != null && String(dbFromServer).trim() !== '') {
        currentDb = String(dbFromServer).trim();
      }
      if (currentDb) availableDatabases = [currentDb];
    }

    // Refine mysql -> mariadb if server reports MariaDB
    const refined = refineDetectedDialect(this.dialect, serverVersion);
    this.dialect = refined;
    this.config.dialect = refined;

    // When Database was unspecified, auto-pick the first user database so tables appear immediately
    if (!currentDb && availableDatabases.length > 0) {
      const firstUserDb = availableDatabases.find((d) => !isSystemDatabase(d, this.dialect));
      currentDb = firstUserDb || availableDatabases[0];
    }
    if (currentDb) {
      this.activeDatabase = currentDb;
      if (!availableDatabases.includes(currentDb)) {
        availableDatabases = sortDatabasesUserFirst([currentDb, ...availableDatabases], this.dialect);
      }
    }

    if (!currentDb) {
      return {
        databaseName: '',
        availableDatabases,
        dialect: this.dialect,
        serverVersion,
        tables: [],
        views: [],
        triggers: [],
      };
    }

    const [tblRes, colRes, fkRes, idxRes, viewRes, trgRes] = await this.executeBatch(
      [
        {
          sql: `SELECT TABLE_NAME, TABLE_ROWS, TABLE_COMMENT FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME`,
          params: [currentDb],
        },
        {
          sql: `SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, COLUMN_KEY, EXTRA, COLUMN_COMMENT FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME, ORDINAL_POSITION`,
          params: [currentDb],
        },
        {
          sql: `SELECT kcu.TABLE_NAME, kcu.CONSTRAINT_NAME, kcu.COLUMN_NAME, kcu.REFERENCED_TABLE_NAME, kcu.REFERENCED_COLUMN_NAME, rc.DELETE_RULE, rc.UPDATE_RULE
                FROM information_schema.KEY_COLUMN_USAGE kcu
                LEFT JOIN information_schema.REFERENTIAL_CONSTRAINTS rc
                  ON rc.CONSTRAINT_SCHEMA = kcu.TABLE_SCHEMA AND rc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
                WHERE kcu.TABLE_SCHEMA = ? AND kcu.REFERENCED_TABLE_NAME IS NOT NULL`,
          params: [currentDb],
        },
        {
          sql: `SELECT TABLE_NAME, INDEX_NAME, NON_UNIQUE, COLUMN_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX`,
          params: [currentDb],
        },
        {
          sql: `SELECT TABLE_NAME, VIEW_DEFINITION FROM information_schema.VIEWS WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME`,
          params: [currentDb],
        },
        {
          sql: `SELECT TRIGGER_NAME, EVENT_OBJECT_TABLE, ACTION_TIMING, EVENT_MANIPULATION, ACTION_STATEMENT FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = ?`,
          params: [currentDb],
        },
      ],
      10000
    );

    const tableMap = new Map<string, TableSchema>();

    for (const r of tblRes.rows) {
      const name = String(r[0]);
      tableMap.set(name, {
        name,
        type: 'table',
        rowCount: r[1] != null ? Number(r[1]) : undefined,
        comment: r[2] ? String(r[2]) : undefined,
        columns: [],
        foreignKeys: [],
        indexes: [],
      });
    }

    for (const r of colRes.rows) {
      const tbl = tableMap.get(String(r[0]));
      if (!tbl) continue;
      const key = String(r[5] ?? '');
      const extra = String(r[6] ?? '');
      tbl.columns.push({
        name: String(r[1]),
        type: String(r[2]),
        nullable: String(r[3]) === 'YES',
        defaultValue: r[4] != null ? String(r[4]) : null,
        isPrimaryKey: key === 'PRI',
        isUnique: key === 'UNI',
        isAutoIncrement: extra.toLowerCase().includes('auto_increment'),
        comment: r[7] ? String(r[7]) : undefined,
      });
    }

    for (const r of fkRes.rows) {
      const tbl = tableMap.get(String(r[0]));
      if (!tbl) continue;
      tbl.foreignKeys.push({
        name: String(r[1]),
        column: String(r[2]),
        refTable: String(r[3]),
        refColumn: String(r[4]),
        onDelete: String(r[5] || 'NO ACTION'),
        onUpdate: String(r[6] || 'NO ACTION'),
      });
    }

    const idxAcc = new Map<string, IndexSchema>();
    for (const r of idxRes.rows) {
      const tName = String(r[0]);
      const iName = String(r[1]);
      const key = `${tName}::${iName}`;
      let entry = idxAcc.get(key);
      if (!entry) {
        entry = { name: iName, columns: [], unique: Number(r[2]) === 0, primary: iName === 'PRIMARY' };
        idxAcc.set(key, entry);
        tableMap.get(tName)?.indexes.push(entry);
      }
      entry.columns.push(String(r[3]));
    }

    return {
      databaseName: currentDb,
      availableDatabases,
      dialect: this.dialect,
      serverVersion,
      tables: Array.from(tableMap.values()),
      views: viewRes.rows.map((r) => ({ name: String(r[0]), sql: String(r[1] ?? '') })),
      triggers: trgRes.rows.map((r) => ({
        name: String(r[0]),
        table: String(r[1]),
        timing: String(r[2]),
        event: String(r[3]),
        sql: String(r[4] ?? ''),
      })),
    };
  }

  private async introspectPostgres(): Promise<DatabaseSchema> {
    const [verRes, tblRes, colRes, pkRes, fkRes, idxRes, viewRes, trgRes] = await this.executeBatch(
      [
        { sql: 'SELECT version(), current_database()' },
        {
          sql: `SELECT c.relname AS table_name, GREATEST(c.reltuples::bigint, 0) AS est_rows, obj_description(c.oid) AS comment, n.nspname AS schema_name
                FROM pg_class c
                JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE n.nspname = ANY(current_schemas(false)) AND c.relkind IN ('r', 'p')
                ORDER BY c.relname`,
        },
        {
          sql: `SELECT table_name, column_name, udt_name, data_type, is_nullable, column_default, is_identity
                FROM information_schema.columns
                WHERE table_schema = ANY(current_schemas(false))
                ORDER BY table_name, ordinal_position`,
        },
        {
          sql: `SELECT c.relname AS table_name, a.attname AS column_name
                FROM pg_constraint con
                JOIN pg_class c ON c.oid = con.conrelid
                JOIN pg_namespace n ON n.oid = c.relnamespace
                JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = ANY(con.conkey)
                WHERE n.nspname = ANY(current_schemas(false)) AND con.contype = 'p'`,
        },
        {
          // Use pg_constraint with unnest + ordinality to avoid composite FK Cartesian products (H10)
          sql: `SELECT c.relname AS table_name, con.conname AS constraint_name,
                       sa.attname AS col_name, fc.relname AS ref_table, fa.attname AS ref_col,
                       CASE con.confdeltype WHEN 'c' THEN 'CASCADE' WHEN 'n' THEN 'SET NULL' WHEN 'r' THEN 'RESTRICT' ELSE 'NO ACTION' END AS delete_rule,
                       CASE con.confupdtype WHEN 'c' THEN 'CASCADE' WHEN 'n' THEN 'SET NULL' WHEN 'r' THEN 'RESTRICT' ELSE 'NO ACTION' END AS update_rule
                FROM pg_constraint con
                JOIN pg_class c ON c.oid = con.conrelid
                JOIN pg_namespace n ON n.oid = c.relnamespace
                JOIN pg_class fc ON fc.oid = con.confrelid
                JOIN LATERAL unnest(con.conkey, con.confkey) WITH ORDINALITY AS u(attnum, refnum, ord) ON true
                JOIN pg_attribute sa ON sa.attrelid = c.oid AND sa.attnum = u.attnum
                JOIN pg_attribute fa ON fa.attrelid = fc.oid AND fa.attnum = u.refnum
                WHERE n.nspname = ANY(current_schemas(false)) AND con.contype = 'f'`,
        },
        {
          sql: `SELECT t.relname AS tablename, i.relname AS indexname, ix.indisunique, ix.indisprimary,
                       array_to_string(ARRAY(SELECT a.attname FROM unnest(ix.indkey) WITH ORDINALITY AS k(attnum, ord) JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum ORDER BY k.ord), ',') AS cols
                FROM pg_index ix
                JOIN pg_class t ON t.oid = ix.indrelid
                JOIN pg_class i ON i.oid = ix.indexrelid
                JOIN pg_namespace n ON n.oid = t.relnamespace
                WHERE n.nspname = ANY(current_schemas(false))
                ORDER BY t.relname, i.relname`,
        },
        {
          sql: `SELECT table_name, view_definition FROM information_schema.views WHERE table_schema = ANY(current_schemas(false)) ORDER BY table_name`,
        },
        {
          sql: `SELECT trigger_name, event_object_table, action_timing, event_manipulation, action_statement FROM information_schema.triggers WHERE trigger_schema = ANY(current_schemas(false))`,
        },
      ],
      10000
    );

    const serverVersion = String(verRes.rows[0]?.[0] ?? 'PostgreSQL').split(',')[0];
    const databaseName = String(verRes.rows[0]?.[1] ?? this.activeDatabase ?? this.config.database ?? 'postgres');
    this.activeDatabase = databaseName;

    // Fetch list of accessible databases on the PostgreSQL server (graceful if restricted)
    let availableDatabases = await this.listDatabases();
    if (!availableDatabases.includes(databaseName)) {
      availableDatabases = sortDatabasesUserFirst([databaseName, ...availableDatabases], this.dialect);
    }

    const pkSet = new Set(pkRes.rows.map((r) => `${r[0]}.${r[1]}`));
    const tableMap = new Map<string, TableSchema>();

    for (const r of tblRes.rows) {
      const name = String(r[0]);
      tableMap.set(name, {
        name,
        schema: String(r[3] || 'public'),
        type: 'table',
        rowCount: r[1] != null ? Number(r[1]) : undefined,
        comment: r[2] ? String(r[2]) : undefined,
        columns: [],
        foreignKeys: [],
        indexes: [],
      });
    }

    for (const r of colRes.rows) {
      const tName = String(r[0]);
      const cName = String(r[1]);
      const tbl = tableMap.get(tName);
      if (!tbl) continue;
      const def = r[5] != null ? String(r[5]) : null;
      const isIdentity = String(r[6] ?? '') === 'YES';
      tbl.columns.push({
        name: cName,
        type: String(r[3] === 'USER-DEFINED' ? r[2] : r[3]),
        nullable: String(r[4]) === 'YES',
        defaultValue: def,
        isPrimaryKey: pkSet.has(`${tName}.${cName}`),
        isAutoIncrement: isIdentity || Boolean(def && def.includes('nextval(')),
      });
    }

    for (const r of fkRes.rows) {
      const tbl = tableMap.get(String(r[0]));
      if (!tbl) continue;
      tbl.foreignKeys.push({
        name: String(r[1]),
        column: String(r[2]),
        refTable: String(r[3]),
        refColumn: String(r[4]),
        onDelete: String(r[5] || 'NO ACTION'),
        onUpdate: String(r[6] || 'NO ACTION'),
      });
    }

    for (const r of idxRes.rows) {
      const tbl = tableMap.get(String(r[0]));
      if (!tbl) continue;
      const cols = String(r[4] ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const unique = Boolean(r[2]);
      const primary = Boolean(r[3]);
      tbl.indexes.push({ name: String(r[1]), columns: cols, unique, primary });
      if (unique && !primary && cols.length === 1) {
        const target = tbl.columns.find((c) => c.name === cols[0]);
        if (target) target.isUnique = true;
      }
    }

    return {
      databaseName,
      availableDatabases,
      dialect: this.dialect,
      serverVersion,
      tables: Array.from(tableMap.values()),
      views: viewRes.rows.map((r) => ({ name: String(r[0]), sql: String(r[1] ?? '') })),
      triggers: trgRes.rows.map((r) => ({
        name: String(r[0]),
        table: String(r[1]),
        timing: String(r[2]),
        event: String(r[3]),
        sql: String(r[4] ?? ''),
      })),
    };
  }

  private async introspectSqliteLike(): Promise<DatabaseSchema> {
    const [verRes, masterRes] = await this.executeBatch(
      [
        { sql: 'SELECT sqlite_version() AS version' },
        { sql: `SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY type, name` },
      ],
      10000
    );

    const serverVersion = `${this.dialect.toUpperCase()} (SQLite ${verRes.rows[0]?.[0] ?? '3.x'})`;
    const rawTables: Array<{ name: string; sql: string }> = [];
    const views: ViewSchema[] = [];
    const triggers: TriggerSchema[] = [];

    for (const r of masterRes.rows) {
      const type = String(r[0] ?? '');
      const name = String(r[1] ?? '');
      if (type === 'table') rawTables.push({ name, sql: String(r[3] ?? '') });
      else if (type === 'view') views.push({ name, sql: String(r[3] ?? '') });
      else if (type === 'trigger') triggers.push({ name, table: String(r[2] ?? ''), sql: String(r[3] ?? '') });
    }

    const tables: TableSchema[] = [];
    for (let start = 0; start < rawTables.length; start += 12) {
      const slice = rawTables.slice(start, start + 12);
      const batchStmts: Array<{ sql: string }> = [];
      for (const t of slice) {
        const q = quoteIdent(t.name, this.dialect);
        batchStmts.push(
          { sql: `PRAGMA table_info(${q})` },
          { sql: `PRAGMA foreign_key_list(${q})` },
          { sql: `PRAGMA index_list(${q})` }
        );
      }
      const batchRes = await this.executeBatch(batchStmts, 10000);

      const idxQueries: Array<{ tblIdx: number; idxName: string; unique: boolean; primary: boolean }> = [];
      const partialTables: TableSchema[] = [];

      slice.forEach((t, localIdx) => {
        const colRes = batchRes[localIdx * 3];
        const fkRes = batchRes[localIdx * 3 + 1];
        const idxRes = batchRes[localIdx * 3 + 2];

        const columns: ColumnSchema[] = colRes.rows.map((r) => {
          const isPk = Number(r[5] ?? 0) > 0;
          return {
            name: String(r[1] ?? ''),
            type: String(r[2] || 'TEXT'),
            nullable: Number(r[3] ?? 0) === 0 && !isPk,
            defaultValue: r[4] != null ? String(r[4]) : null,
            isPrimaryKey: isPk,
            isAutoIncrement: isPk && t.sql.toUpperCase().includes('AUTOINCREMENT'),
          };
        });
        const foreignKeys: ForeignKeySchema[] = fkRes.rows.map((r, i) => ({
          name: `fk_${t.name}_${r[3]}_${i}`,
          column: String(r[3] ?? ''),
          refTable: String(r[2] ?? ''),
          refColumn: String(r[4] || 'id'),
          onUpdate: String(r[5] || 'NO ACTION'),
          onDelete: String(r[6] || 'NO ACTION'),
        }));

        for (const r of idxRes.rows) {
          idxQueries.push({
            tblIdx: localIdx,
            idxName: String(r[1] ?? ''),
            unique: Number(r[2] ?? 0) === 1,
            primary: String(r[3] ?? '') === 'pk',
          });
        }

        partialTables.push({
          name: t.name,
          type: 'table',
          columns,
          foreignKeys,
          indexes: [],
          ddl: t.sql,
        });
      });

      for (let i = 0; i < idxQueries.length; i += 40) {
        const chunk = idxQueries.slice(i, i + 40);
        const infoResults = await this.executeBatch(
          chunk.map((item) => ({ sql: `PRAGMA index_info(${quoteIdent(item.idxName, this.dialect)})` })),
          500
        );
        chunk.forEach((item, ci) => {
          const cols = infoResults[ci]?.rows.map((ir) => String(ir[2] ?? '')).filter(Boolean) || [];
          const tbl = partialTables[item.tblIdx];
          tbl.indexes.push({ name: item.idxName, columns: cols, unique: item.unique, primary: item.primary });
          if (item.unique && cols.length === 1) {
            const c = tbl.columns.find((col) => col.name === cols[0]);
            if (c && !c.isPrimaryKey) c.isUnique = true;
          }
        });
      }

      tables.push(...partialTables);
    }

    const dbName = this.activeDatabase || this.config.databaseId || this.config.filePath || this.config.name;
    return {
      databaseName: dbName,
      availableDatabases: dbName ? [dbName] : [],
      dialect: this.dialect,
      serverVersion,
      tables,
      views,
      triggers,
    };
  }

  async getServerInfo(): Promise<Array<{ key: string; value: string }>> {
    try {
      if (isMysqlLike(this.dialect)) {
        const res = await this.query(
          `SHOW VARIABLES WHERE Variable_name IN ('version','version_comment','character_set_database','collation_database','max_connections','innodb_buffer_pool_size','time_zone','sql_mode')`
        );
        return res.rows.map((r) => ({ key: String(r[0]), value: String(r[1]) }));
      }
      if (isPostgres(this.dialect)) {
        const res = await this.query(
          `SELECT name, setting FROM pg_settings WHERE name IN ('server_version','server_encoding','TimeZone','max_connections','shared_buffers','work_mem','ssl') ORDER BY name`
        );
        return res.rows.map((r) => ({ key: String(r[0]), value: String(r[1]) }));
      }
      if (isSqliteLike(this.dialect)) {
        const res = await this.query('SELECT sqlite_version() AS version');
        return [{ key: 'sqlite_version', value: String(res.rows[0]?.[0] ?? '') }];
      }
    } catch {
      // fallback
    }
    return [{ key: 'dialect', value: this.dialect }];
  }
}
