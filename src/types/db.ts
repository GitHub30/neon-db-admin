export type DbDialect = 'sqlite' | 'mysql' | 'mariadb' | 'postgresql' | 'd1' | 'd1-binding' | 'libsql';

export type TransportType = 'wasm' | 'cloudflare-worker' | 'php-proxy' | 'node-proxy';

export interface ConnectionConfig {
  id: string;
  name: string;
  dialect: DbDialect;
  transport: TransportType;
  proxyUrl?: string;
  proxyToken?: string;
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  database?: string;
  ssl?: boolean;
  sslRejectUnauthorized?: boolean;
  url?: string;
  filePath?: string;
  accountId?: string;
  databaseId?: string;
  apiToken?: string;
  authToken?: string;
  rememberSecrets?: boolean;
  sampleId?: 'ecommerce' | 'saas' | 'blog' | 'empty';
  color?: string;
  createdAt: number;
}

export interface QueryColumn {
  name: string;
  type: string;
}

export interface QueryResult {
  columns: QueryColumn[];
  rows: unknown[][];
  rowCount: number;
  affectedRows: number;
  insertId: string | number | null;
  truncated: boolean;
  durationMs: number;
  sql?: string;
  error?: string;
}

export interface ColumnSchema {
  name: string;
  type: string;
  nullable: boolean;
  defaultValue: string | null;
  isPrimaryKey: boolean;
  isAutoIncrement: boolean;
  isUnique?: boolean;
  comment?: string;
}

export interface ForeignKeySchema {
  name: string;
  column: string;
  refTable: string;
  refColumn: string;
  onDelete: string;
  onUpdate: string;
}

export interface IndexSchema {
  name: string;
  columns: string[];
  unique: boolean;
  primary?: boolean;
}

export interface TriggerSchema {
  name: string;
  table: string;
  timing?: string;
  event?: string;
  sql: string;
}

export interface ViewSchema {
  name: string;
  sql: string;
}

export interface TableSchema {
  name: string;
  schema?: string;
  type: 'table' | 'view';
  rowCount?: number;
  columns: ColumnSchema[];
  foreignKeys: ForeignKeySchema[];
  indexes: IndexSchema[];
  ddl?: string;
  comment?: string;
}

export interface DatabaseSchema {
  databaseName: string;
  dialect: DbDialect;
  serverVersion: string;
  tables: TableSchema[];
  views: ViewSchema[];
  triggers: TriggerSchema[];
}

export interface QueryHistoryEntry {
  id: string;
  sql: string;
  dialect: DbDialect;
  connectionName: string;
  durationMs: number;
  rowCount: number;
  status: 'ok' | 'error';
  error?: string;
  timestamp: number;
}

export interface SqlSnippet {
  id: string;
  title: string;
  sql: string;
  dialect: DbDialect | 'all';
  createdAt: number;
}

export type ERCardinality = '1:1' | '1:N' | 'N:M';

export interface ERTableNode {
  id: string;
  name: string;
  x: number;
  y: number;
  color: string;
  columns: ColumnSchema[];
  comment?: string;
}

export interface ERRelationEdge {
  id: string;
  name: string;
  sourceTableId: string;
  sourceColumn: string;
  targetTableId: string;
  targetColumn: string;
  cardinality: ERCardinality;
  onDelete: string;
  onUpdate: string;
}

export interface ERModel {
  id: string;
  name: string;
  dialect: DbDialect;
  tables: ERTableNode[];
  relations: ERRelationEdge[];
  updatedAt: number;
}

export type ActiveView = 'data' | 'sql' | 'structure' | 'er' | 'import-export' | 'tools';
export type ThemeMode = 'light' | 'dark' | 'system';
export type Locale = 'ja' | 'en';

export interface FilterRule {
  id: string;
  column: string;
  operator: '=' | '!=' | '>' | '>=' | '<' | '<=' | 'LIKE' | 'NOT LIKE' | 'IS NULL' | 'IS NOT NULL' | 'IN';
  value: string;
}
