import type { ColumnSchema, DbDialect, TableSchema } from '../types/db.js';
import { quoteIdent, quoteLiteral } from './dialect.js';

const FIRST_NAMES = ['Haruto', 'Yui', 'Ren', 'Aoi', 'Sora', 'Hana', 'Kenji', 'Mika', 'Liam', 'Emily', 'Noah', 'Maya'];
const LAST_NAMES = ['Sato', 'Suzuki', 'Takahashi', 'Tanaka', 'Watanabe', 'Ito', 'Nakamura', 'Kobayashi', 'Chen', 'Miller', 'Patel', 'Rivera'];
const CITIES = ['Tokyo', 'Osaka', 'Fukuoka', 'Sapporo', 'Nagoya', 'Yokohama', 'San Francisco', 'London', 'Singapore'];
const COUNTRIES = ['JP', 'US', 'GB', 'SG', 'DE', 'CA', 'AU'];
const STATUSES = ['active', 'pending', 'completed', 'archived', 'paid', 'shipped'];
const DOMAINS = ['example.jp', 'example.com', 'devmail.test', 'cloud.example'];

function pick<T>(arr: T[], idx: number): T {
  return arr[Math.abs(idx) % arr.length];
}

function generateColumnValue(col: ColumnSchema, rowIndex: number, seed: number, dialect: DbDialect): unknown {
  const name = col.name.toLowerCase();
  const type = (col.type || 'TEXT').toUpperCase();
  const n = seed + rowIndex;

  if (name.includes('email')) {
    return `${pick(FIRST_NAMES, n).toLowerCase()}.${pick(LAST_NAMES, n * 3).toLowerCase()}.${n}@${pick(DOMAINS, n)}`;
  }
  if (name.includes('uuid') || name.includes('guid')) {
    const hex = (x: number, len: number) => Math.abs(x * 2654435761 % 0xffffffff).toString(16).padStart(len, '0').slice(0, len);
    return `${hex(n, 8)}-${hex(n + 1, 4)}-4${hex(n + 2, 3)}-a${hex(n + 3, 3)}-${hex(n + 4, 12)}`;
  }
  if (name.includes('name') && !name.includes('user')) {
    return `${pick(FIRST_NAMES, n)} ${pick(LAST_NAMES, n * 7)}`;
  }
  if (name.includes('slug') || name.includes('handle')) {
    return `item-${n}-${pick(FIRST_NAMES, n).toLowerCase()}`;
  }
  if (name.includes('sku') || name.includes('code')) {
    return `SKU-${String(1000 + n).slice(-4)}`;
  }
  if (name.includes('city')) return pick(CITIES, n);
  if (name.includes('country')) return pick(COUNTRIES, n);
  if (name.includes('status') || name.includes('state')) return pick(STATUSES, n);
  if (name.includes('tier') || name.includes('plan')) return pick(['free', 'standard', 'pro', 'enterprise'], n);
  if (name.includes('role')) return pick(['member', 'engineer', 'admin', 'viewer'], n);
  if (name.includes('json') || name.includes('meta') || type.includes('JSON')) {
    return JSON.stringify({ generated: true, seq: n });
  }
  if (name.includes('date') || name.endsWith('_at') || type.includes('DATE') || type.includes('TIME')) {
    const d = new Date(Date.UTC(2026, (n % 11), 1 + (n % 27), (n * 3) % 24, (n * 7) % 60, 0));
    return d.toISOString().replace('T', ' ').slice(0, 19);
  }
  if (name.startsWith('is_') || name.startsWith('has_') || type.includes('BOOL')) {
    return dialect === 'postgresql' ? n % 2 === 0 : (n % 2 === 0 ? 1 : 0);
  }
  if (name.includes('price') || name.includes('amount') || name.includes('total')) {
    return (1 + (n % 50)) * 500;
  }
  if (/INT|SERIAL|NUM/.test(type)) {
    return 1 + (n % 100);
  }
  if (/REAL|FLOAT|DOUBLE|DEC/.test(type)) {
    return Math.round(((n % 100) + 0.37 * (n % 10)) * 100) / 100;
  }
  return `Sample ${col.name} #${n}`;
}

export function generateMockInsertStatements(
  table: TableSchema,
  count: number,
  dialect: DbDialect,
  fkSampleValues: Record<string, unknown[]> = {}
): string[] {
  const safeCount = Math.min(Math.max(count, 1), 200);
  const insertCols = table.columns.filter((c) => !(c.isPrimaryKey && c.isAutoIncrement));
  if (insertCols.length === 0) return [];

  const qTable = quoteIdent(table.name, dialect);
  const colList = insertCols.map((c) => quoteIdent(c.name, dialect)).join(', ');
  const fkMap = new Map(table.foreignKeys.map((fk) => [fk.column, fk]));
  const seed = Math.floor(Date.now() / 1000) % 10000;

  const stmts: string[] = [];
  for (let i = 0; i < safeCount; i++) {
    const vals = insertCols.map((col) => {
      const fk = fkMap.get(col.name);
      if (fk && fkSampleValues[col.name]?.length) {
        return pick(fkSampleValues[col.name], i);
      }
      return generateColumnValue(col, i + 1, seed, dialect);
    });
    const litList = vals.map((v) => quoteLiteral(v, dialect)).join(', ');
    stmts.push(`INSERT INTO ${qTable} (${colList}) VALUES (${litList});`);
  }
  return stmts;
}
