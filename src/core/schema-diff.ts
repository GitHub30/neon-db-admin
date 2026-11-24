import type { DbDialect, TableSchema } from '../types/db.js';
import { generateCreateTableDdl, isMysqlLike, mapTypeForDialect, quoteIdent } from './dialect.js';

export interface SchemaDiffItem {
  kind: 'create-table' | 'drop-table' | 'add-column' | 'drop-column' | 'modify-column';
  table: string;
  column?: string;
  description: string;
  sql: string;
}

/**
 * Computes DDL migration statements to transform `source` schema into `target` schema.
 */
export function diffSchemas(
  sourceTables: TableSchema[],
  targetTables: TableSchema[],
  dialect: DbDialect
): SchemaDiffItem[] {
  const diffs: SchemaDiffItem[] = [];
  const srcMap = new Map(sourceTables.map((t) => [t.name.toLowerCase(), t]));
  const tgtMap = new Map(targetTables.map((t) => [t.name.toLowerCase(), t]));
  const q = (id: string) => quoteIdent(id, dialect);

  // Added tables
  for (const [key, tgt] of tgtMap) {
    if (!srcMap.has(key)) {
      diffs.push({
        kind: 'create-table',
        table: tgt.name,
        description: `Create new table "${tgt.name}" (${tgt.columns.length} columns)`,
        sql: generateCreateTableDdl(tgt, dialect),
      });
    }
  }

  // Modified tables
  for (const [key, tgt] of tgtMap) {
    const src = srcMap.get(key);
    if (!src) continue;
    const srcCols = new Map(src.columns.map((c) => [c.name.toLowerCase(), c]));
    const tgtCols = new Map(tgt.columns.map((c) => [c.name.toLowerCase(), c]));

    for (const [colKey, tCol] of tgtCols) {
      const sCol = srcCols.get(colKey);
      if (!sCol) {
        const mappedType = mapTypeForDialect(tCol.type, dialect);
        const notNull = !tCol.nullable ? ' NOT NULL' : '';
        const def = tCol.defaultValue ? ` DEFAULT ${tCol.defaultValue}` : '';
        diffs.push({
          kind: 'add-column',
          table: tgt.name,
          column: tCol.name,
          description: `Add column "${tCol.name}" (${mappedType}) to "${tgt.name}"`,
          sql: `ALTER TABLE ${q(tgt.name)} ADD COLUMN ${q(tCol.name)} ${mappedType}${notNull}${def};`,
        });
      } else {
        const sType = mapTypeForDialect(sCol.type, dialect).toUpperCase();
        const tType = mapTypeForDialect(tCol.type, dialect).toUpperCase();
        if (sType !== tType || sCol.nullable !== tCol.nullable) {
          let alterSql: string;
          if (isMysqlLike(dialect)) {
            alterSql = `ALTER TABLE ${q(tgt.name)} MODIFY COLUMN ${q(tCol.name)} ${tType}${!tCol.nullable ? ' NOT NULL' : ' NULL'};`;
          } else if (dialect === 'postgresql') {
            const parts = [`ALTER TABLE ${q(tgt.name)} ALTER COLUMN ${q(tCol.name)} TYPE ${tType};`];
            if (sCol.nullable !== tCol.nullable) {
              parts.push(
                `ALTER TABLE ${q(tgt.name)} ALTER COLUMN ${q(tCol.name)} ${tCol.nullable ? 'DROP NOT NULL' : 'SET NOT NULL'};`
              );
            }
            alterSql = parts.join('\n');
          } else {
            alterSql = `-- SQLite requires table rebuild to alter column type/nullability for ${q(tgt.name)}.${q(tCol.name)} (${sType} -> ${tType})`;
          }
          diffs.push({
            kind: 'modify-column',
            table: tgt.name,
            column: tCol.name,
            description: `Modify "${tgt.name}"."${tCol.name}": ${sType}${sCol.nullable ? '' : ' NOT NULL'} -> ${tType}${tCol.nullable ? '' : ' NOT NULL'}`,
            sql: alterSql,
          });
        }
      }
    }

    for (const [colKey, sCol] of srcCols) {
      if (!tgtCols.has(colKey)) {
        diffs.push({
          kind: 'drop-column',
          table: tgt.name,
          column: sCol.name,
          description: `Drop column "${sCol.name}" from "${tgt.name}"`,
          sql: `ALTER TABLE ${q(tgt.name)} DROP COLUMN ${q(sCol.name)};`,
        });
      }
    }
  }

  // Dropped tables
  for (const [key, src] of srcMap) {
    if (!tgtMap.has(key)) {
      diffs.push({
        kind: 'drop-table',
        table: src.name,
        description: `Drop table "${src.name}"`,
        sql: `DROP TABLE IF EXISTS ${q(src.name)};`,
      });
    }
  }

  return diffs;
}

export interface HealthIssue {
  severity: 'warn' | 'info';
  table: string;
  message: string;
  suggestionSql?: string;
}

export function auditSchemaHealth(tables: TableSchema[], dialect: DbDialect): HealthIssue[] {
  const issues: HealthIssue[] = [];
  const q = (id: string) => quoteIdent(id, dialect);

  for (const table of tables) {
    if (table.type !== 'table') continue;
    const hasPk = table.columns.some((c) => c.isPrimaryKey);
    if (!hasPk) {
      issues.push({
        severity: 'warn',
        table: table.name,
        message: 'Primary Key が定義されていません（行単位の安全な更新・削除やレプリケーションに影響します）。',
      });
    }

    // Check unindexed foreign keys
    const indexedFirstCols = new Set(
      table.indexes.map((idx) => idx.columns[0]?.toLowerCase()).filter(Boolean)
    );
    for (const fk of table.foreignKeys) {
      if (!indexedFirstCols.has(fk.column.toLowerCase()) && !table.columns.find((c) => c.name === fk.column && c.isPrimaryKey)) {
        issues.push({
          severity: 'info',
          table: table.name,
          message: `外部キー "${fk.column}" にインデックスがありません（JOINや親行削除時のパフォーマンス低下の原因になります）。`,
          suggestionSql: `CREATE INDEX ${q(`idx_${table.name}_${fk.column}`)} ON ${q(table.name)} (${q(fk.column)});`,
        });
      }
    }

    if (table.columns.length > 25) {
      issues.push({
        severity: 'info',
        table: table.name,
        message: `カラム数が多めです (${table.columns.length} カラム)。テーブル分割や正規化を検討してください。`,
      });
    }
  }

  return issues;
}
