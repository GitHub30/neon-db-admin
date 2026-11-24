import type { ColumnSchema, DbDialect, ForeignKeySchema, TableSchema } from '../types/db.js';

export function isMysqlLike(dialect: DbDialect): boolean {
  return dialect === 'mysql' || dialect === 'mariadb';
}

export function isSqliteLike(dialect: DbDialect): boolean {
  return dialect === 'sqlite' || dialect === 'd1' || dialect === 'd1-binding' || dialect === 'libsql';
}

export function isPostgres(dialect: DbDialect): boolean {
  return dialect === 'postgresql';
}

/**
 * Safely quotes a SQL identifier according to the active database dialect.
 * Strips NUL bytes and escapes embedded quote characters.
 */
export function quoteIdent(name: string, dialect: DbDialect): string {
  const clean = String(name).replace(/\u0000/g, '');
  if (isMysqlLike(dialect)) {
    return '`' + clean.replace(/`/g, '``') + '`';
  }
  return '"' + clean.replace(/"/g, '""') + '"';
}

/**
 * Safely formats a JS value into a SQL literal for DDL/preview/export statements.
 */
export function quoteLiteral(value: unknown, dialect: DbDialect): string {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'boolean') {
    if (isSqliteLike(dialect)) return value ? '1' : '0';
    return value ? 'TRUE' : 'FALSE';
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return 'NULL';
    return String(value);
  }
  const str = String(value);
  if (isMysqlLike(dialect)) {
    return "'" + str.replace(/\\/g, '\\\\').replace(/'/g, "''").replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\u0000/g, '') + "'";
  }
  return "'" + str.replace(/'/g, "''").replace(/\u0000/g, '') + "'";
}

export function getPlaceholder(dialect: DbDialect, index1Based: number): string {
  return isPostgres(dialect) ? `$${index1Based}` : '?';
}

export function mapTypeForDialect(rawType: string, target: DbDialect): string {
  const upper = (rawType || 'TEXT').trim().toUpperCase();
  if (isSqliteLike(target)) {
    if (/INT|SERIAL/.test(upper)) return 'INTEGER';
    if (/FLOAT|DOUBLE|REAL|DEC|NUM/.test(upper)) return 'REAL';
    if (/BLOB|BYTEA|BINARY/.test(upper)) return 'BLOB';
    if (/BOOL/.test(upper)) return 'INTEGER';
    return 'TEXT';
  }
  if (isMysqlLike(target)) {
    if (upper === 'SERIAL' || upper === 'BIGSERIAL') return 'BIGINT';
    if (upper === 'INTEGER' || upper === 'INT') return 'INT';
    if (upper === 'REAL' || upper === 'DOUBLE PRECISION') return 'DOUBLE';
    if (upper === 'BOOLEAN' || upper === 'BOOL') return 'TINYINT(1)';
    if (upper === 'BYTEA' || upper === 'BLOB') return 'LONGBLOB';
    if (upper === 'JSONB') return 'JSON';
    if (upper === 'UUID') return 'CHAR(36)';
    if (upper === 'TIMESTAMPTZ') return 'DATETIME';
    if (upper === 'TEXT') return 'TEXT';
    return upper;
  }
  // PostgreSQL
  if (upper === 'TINYINT(1)' || upper === 'BOOL') return 'BOOLEAN';
  if (upper === 'DATETIME') return 'TIMESTAMP';
  if (upper === 'LONGBLOB' || upper === 'BLOB') return 'BYTEA';
  if (upper === 'DOUBLE') return 'DOUBLE PRECISION';
  if (upper === 'INT' || upper === 'INTEGER') return 'INTEGER';
  if (upper === 'NVARCHAR' || upper.startsWith('VARCHAR')) return upper.replace(/^NVARCHAR/, 'VARCHAR');
  return upper;
}

export function generateCreateTableDdl(
  table: Pick<TableSchema, 'name' | 'columns' | 'foreignKeys'>,
  dialect: DbDialect
): string {
  const q = (id: string) => quoteIdent(id, dialect);
  const pks = table.columns.filter((c) => c.isPrimaryKey);
  const singlePk = pks.length === 1;
  const lines: string[] = [];

  for (const col of table.columns) {
    let typeSql = mapTypeForDialect(col.type, dialect);
    const parts: string[] = [`  ${q(col.name)}`];

    if (col.isPrimaryKey && col.isAutoIncrement && singlePk) {
      if (isPostgres(dialect)) {
        typeSql = /BIGINT/i.test(typeSql) ? 'BIGSERIAL' : 'SERIAL';
        parts.push(typeSql, 'PRIMARY KEY');
      } else if (isMysqlLike(dialect)) {
        parts.push(typeSql === 'TEXT' ? 'INT' : typeSql, 'NOT NULL AUTO_INCREMENT PRIMARY KEY');
      } else {
        parts.push('INTEGER PRIMARY KEY AUTOINCREMENT');
      }
    } else {
      parts.push(typeSql);
      if (col.isPrimaryKey && singlePk) parts.push('PRIMARY KEY');
      if (!col.nullable && !col.isPrimaryKey) parts.push('NOT NULL');
      if (col.isUnique && !col.isPrimaryKey) parts.push('UNIQUE');
      if (col.defaultValue !== null && col.defaultValue !== undefined && col.defaultValue !== '') {
        parts.push(`DEFAULT ${col.defaultValue}`);
      }
    }

    if (col.comment && isMysqlLike(dialect)) {
      parts.push(`COMMENT ${quoteLiteral(col.comment, dialect)}`);
    }
    lines.push(parts.join(' '));
  }

  if (pks.length > 1) {
    lines.push(`  PRIMARY KEY (${pks.map((c) => q(c.name)).join(', ')})`);
  }

  for (const fk of table.foreignKeys || []) {
    const fkName = fk.name ? `CONSTRAINT ${q(fk.name)} ` : '';
    const onDel = fk.onDelete && fk.onDelete !== 'NO ACTION' ? ` ON DELETE ${fk.onDelete}` : '';
    const onUpd = fk.onUpdate && fk.onUpdate !== 'NO ACTION' ? ` ON UPDATE ${fk.onUpdate}` : '';
    lines.push(
      `  ${fkName}FOREIGN KEY (${q(fk.column)}) REFERENCES ${q(fk.refTable)}(${q(fk.refColumn)})${onDel}${onUpd}`
    );
  }

  const suffix = isMysqlLike(dialect) ? ' ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;' : ';';
  return `CREATE TABLE ${q(table.name)} (\n${lines.join(',\n')}\n)${suffix}`;
}

export function generateSelectSql(
  table: string,
  dialect: DbDialect,
  opts: {
    limit?: number;
    offset?: number;
    orderBy?: string;
    orderDir?: 'ASC' | 'DESC';
    whereClause?: string;
  } = {}
): string {
  const q = (id: string) => quoteIdent(id, dialect);
  let sql = `SELECT * FROM ${q(table)}`;
  if (opts.whereClause) sql += ` WHERE ${opts.whereClause}`;
  if (opts.orderBy) sql += ` ORDER BY ${q(opts.orderBy)} ${opts.orderDir === 'DESC' ? 'DESC' : 'ASC'}`;
  if (opts.limit !== undefined) sql += ` LIMIT ${Math.max(1, Math.min(opts.limit, 10000))}`;
  if (opts.offset !== undefined && opts.offset > 0) sql += ` OFFSET ${Math.max(0, opts.offset)}`;
  return sql;
}

export function generateInsertSql(
  table: string,
  columns: string[],
  values: unknown[],
  dialect: DbDialect,
  parameterized = false
): { sql: string; params: unknown[] } {
  const q = (id: string) => quoteIdent(id, dialect);
  const colList = columns.map(q).join(', ');
  if (parameterized) {
    const placeholders = values.map((_, idx) => getPlaceholder(dialect, idx + 1)).join(', ');
    return {
      sql: `INSERT INTO ${q(table)} (${colList}) VALUES (${placeholders})`,
      params: values,
    };
  }
  const litList = values.map((v) => quoteLiteral(v, dialect)).join(', ');
  return {
    sql: `INSERT INTO ${q(table)} (${colList}) VALUES (${litList});`,
    params: [],
  };
}

export function generateExplainSql(sql: string, dialect: DbDialect): string {
  const trimmed = sql.trim().replace(/;+$/, '');
  if (isSqliteLike(dialect)) return `EXPLAIN QUERY PLAN ${trimmed}`;
  if (isPostgres(dialect)) return `EXPLAIN (ANALYZE false, VERBOSE true, FORMAT TEXT) ${trimmed}`;
  return `EXPLAIN ${trimmed}`;
}

export function getDialectBadgeInfo(dialect: DbDialect): { label: string; colorClass: string } {
  switch (dialect) {
    case 'sqlite':
      return { label: 'SQLite', colorClass: 'badge-sqlite' };
    case 'mysql':
      return { label: 'MySQL', colorClass: 'badge-mysql' };
    case 'mariadb':
      return { label: 'MariaDB', colorClass: 'badge-mariadb' };
    case 'postgresql':
      return { label: 'PostgreSQL', colorClass: 'badge-pg' };
    case 'd1':
    case 'd1-binding':
      return { label: 'Cloudflare D1', colorClass: 'badge-d1' };
    case 'libsql':
      return { label: 'LibSQL / Turso', colorClass: 'badge-libsql' };
  }
}

export const COMMON_DATA_TYPES: Record<'sqlite' | 'mysql' | 'postgresql', string[]> = {
  sqlite: ['INTEGER', 'TEXT', 'REAL', 'BLOB', 'NUMERIC', 'DATETIME', 'BOOLEAN', 'JSON'],
  mysql: [
    'INT', 'BIGINT', 'VARCHAR(255)', 'TEXT', 'DECIMAL(10,2)', 'DOUBLE', 'TINYINT(1)',
    'DATE', 'DATETIME', 'TIMESTAMP', 'JSON', 'CHAR(36)', 'LONGBLOB',
  ],
  postgresql: [
    'INTEGER', 'BIGINT', 'SERIAL', 'BIGSERIAL', 'VARCHAR(255)', 'TEXT', 'NUMERIC(10,2)',
    'DOUBLE PRECISION', 'BOOLEAN', 'DATE', 'TIMESTAMP', 'TIMESTAMPTZ', 'JSONB', 'UUID', 'BYTEA',
  ],
};

export function getDataTypesForDialect(dialect: DbDialect): string[] {
  if (isMysqlLike(dialect)) return COMMON_DATA_TYPES.mysql;
  if (isPostgres(dialect)) return COMMON_DATA_TYPES.postgresql;
  return COMMON_DATA_TYPES.sqlite;
}

export const SQL_KEYWORDS = [
  'SELECT', 'FROM', 'WHERE', 'JOIN', 'LEFT JOIN', 'RIGHT JOIN', 'INNER JOIN', 'OUTER JOIN', 'CROSS JOIN',
  'ON', 'AS', 'ORDER BY', 'GROUP BY', 'HAVING', 'LIMIT', 'OFFSET', 'DISTINCT', 'UNION', 'UNION ALL',
  'INSERT INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE FROM', 'CREATE TABLE', 'ALTER TABLE', 'DROP TABLE',
  'CREATE INDEX', 'DROP INDEX', 'CREATE VIEW', 'DROP VIEW', 'ADD COLUMN', 'PRIMARY KEY', 'FOREIGN KEY',
  'REFERENCES', 'NOT NULL', 'DEFAULT', 'UNIQUE', 'CHECK', 'CONSTRAINT', 'ON DELETE CASCADE',
  'ON UPDATE CASCADE', 'AND', 'OR', 'NOT', 'IN', 'IS NULL', 'IS NOT NULL', 'BETWEEN', 'LIKE', 'ILIKE',
  'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'CAST', 'COALESCE', 'NULLIF', 'COUNT', 'SUM', 'AVG', 'MIN', 'MAX',
  'WITH', 'RECURSIVE', 'OVER', 'PARTITION BY', 'ROW_NUMBER', 'RANK', 'EXPLAIN', 'BEGIN', 'COMMIT', 'ROLLBACK',
  'PRAGMA', 'VACUUM', 'ANALYZE', 'TRUNCATE TABLE', 'RETURNING', 'EXISTS', 'IF NOT EXISTS', 'IF EXISTS',
];

export function isDestructiveSql(sql: string): boolean {
  const stripped = sql
    .replace(/--[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .trim();
  if (/^\s*(DROP\s+(TABLE|DATABASE|SCHEMA|VIEW|INDEX|TRIGGER)|TRUNCATE\s+TABLE|ALTER\s+TABLE\s+[\s\S]*\bDROP\b)/i.test(stripped)) {
    return true;
  }
  // DELETE or UPDATE without WHERE (including CTE-prefixed WITH ... DELETE/UPDATE)
  if (/(?:^\s*|\bWITH\b[\s\S]*?)\b(DELETE\s+FROM|UPDATE\s+\S+\s+SET)\b/i.test(stripped) && !/\bWHERE\b/i.test(stripped)) {
    return true;
  }
  return false;
}

export function buildMermaidEr(
  tables: TableSchema[],
  relations: Array<{ fromTable: string; toTable: string; label: string; cardinality?: string }>
): string {
  const lines = ['erDiagram'];
  const sanitize = (s: string) => s.replace(/[^a-zA-Z0-9_]/g, '_') || 'entity';
  const escLabel = (s: string) => s.replace(/"/g, "'").replace(/[\r\n]/g, ' ');
  for (const tbl of tables) {
    lines.push(`  ${sanitize(tbl.name)} {`);
    for (const col of tbl.columns) {
      const safeType = (col.type || 'TEXT').replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_]/g, '') || 'TEXT';
      const keyFlags: string[] = [];
      if (col.isPrimaryKey) keyFlags.push('PK');
      if (tbl.foreignKeys.some((fk) => fk.column === col.name)) keyFlags.push('FK');
      if (col.isUnique) keyFlags.push('UK');
      const flagStr = keyFlags.length ? ` ${keyFlags.join(',')}` : '';
      lines.push(`    ${safeType} ${sanitize(col.name)}${flagStr}`);
    }
    lines.push('  }');
  }
  for (const rel of relations) {
    const sym = rel.cardinality === '1:1' ? '||--||' : rel.cardinality === 'N:M' ? '}o--o{' : '||--o{';
    lines.push(`  ${sanitize(rel.toTable)} ${sym} ${sanitize(rel.fromTable)} : "${escLabel(rel.label)}"`);
  }
  return lines.join('\n');
}

export function buildDbml(tables: TableSchema[]): string {
  const escId = (s: string) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const escDef = (s: string) => s.replace(/`/g, '\\`');
  const out: string[] = [];
  for (const tbl of tables) {
    out.push(`Table "${escId(tbl.name)}" {`);
    for (const col of tbl.columns) {
      const attrs: string[] = [];
      if (col.isPrimaryKey) attrs.push('pk');
      if (col.isAutoIncrement) attrs.push('increment');
      if (!col.nullable && !col.isPrimaryKey) attrs.push('not null');
      if (col.isUnique) attrs.push('unique');
      if (col.defaultValue !== null && col.defaultValue !== '') attrs.push(`default: \`${escDef(col.defaultValue)}\``);
      const attrStr = attrs.length ? ` [${attrs.join(', ')}]` : '';
      const safeType = (col.type || 'text').replace(/\s+/g, '_');
      out.push(`  "${escId(col.name)}" ${safeType}${attrStr}`);
    }
    out.push('}\n');
  }
  for (const tbl of tables) {
    for (const fk of tbl.foreignKeys) {
      const actions: string[] = [];
      if (fk.onDelete && fk.onDelete !== 'NO ACTION') actions.push(`delete: ${fk.onDelete.toLowerCase()}`);
      if (fk.onUpdate && fk.onUpdate !== 'NO ACTION') actions.push(`update: ${fk.onUpdate.toLowerCase()}`);
      const opt = actions.length ? ` [${actions.join(', ')}]` : '';
      out.push(`Ref: "${escId(tbl.name)}"."${escId(fk.column)}" > "${escId(fk.refTable)}"."${escId(fk.refColumn)}"${opt}`);
    }
  }
  return out.join('\n').trim() + '\n';
}

export function buildRowWhereClause(
  table: TableSchema,
  row: unknown[],
  colNames: string[],
  dialect: DbDialect,
  paramStartIndex = 1
): { clause: string; previewClause: string; params: unknown[]; hasPrimaryKey: boolean } {
  const pkCols = table.columns.filter((c) => c.isPrimaryKey).map((c) => c.name);
  const hasPrimaryKey = pkCols.length > 0;
  const keyCols = hasPrimaryKey ? pkCols : colNames;
  const parts: string[] = [];
  const previewParts: string[] = [];
  const params: unknown[] = [];

  for (const col of keyCols) {
    const idx = colNames.indexOf(col);
    if (idx === -1) continue;
    const val = row[idx];
    const qCol = quoteIdent(col, dialect);
    if (val === null || val === undefined) {
      parts.push(`${qCol} IS NULL`);
      previewParts.push(`${qCol} IS NULL`);
    } else {
      params.push(val);
      parts.push(`${qCol} = ${getPlaceholder(dialect, paramStartIndex + params.length - 1)}`);
      previewParts.push(`${qCol} = ${quoteLiteral(val, dialect)}`);
    }
  }
  return {
    clause: parts.join(' AND '),
    previewClause: previewParts.join(' AND '),
    params,
    hasPrimaryKey,
  };
}

export function makeColumn(partial: Partial<ColumnSchema> & { name: string }): ColumnSchema {
  return {
    type: 'TEXT',
    nullable: true,
    defaultValue: null,
    isPrimaryKey: false,
    isAutoIncrement: false,
    ...partial,
  };
}

export function makeForeignKey(partial: Partial<ForeignKeySchema> & Pick<ForeignKeySchema, 'column' | 'refTable' | 'refColumn'>): ForeignKeySchema {
  return {
    name: `fk_${partial.column}_${partial.refTable}`,
    onDelete: 'NO ACTION',
    onUpdate: 'NO ACTION',
    ...partial,
  };
}
