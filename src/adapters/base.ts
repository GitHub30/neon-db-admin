import type { ConnectionConfig, DatabaseSchema, DbDialect, QueryResult } from '../types/db.js';

export interface DatabaseAdapter {
  readonly config: ConnectionConfig;
  readonly dialect: DbDialect;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  testConnection(): Promise<{ ok: boolean; version: string; durationMs: number; error?: string }>;
  query(sql: string, params?: unknown[], maxRows?: number): Promise<QueryResult>;
  executeBatch(statements: Array<{ sql: string; params?: unknown[] }>, maxRows?: number): Promise<QueryResult[]>;
  introspectSchema(): Promise<DatabaseSchema>;
  getServerInfo(): Promise<Array<{ key: string; value: string }>>;
  exportSqliteBinary?(): Promise<Uint8Array>;
  loadSqliteBinary?(bytes: Uint8Array, name: string): Promise<void>;
}
