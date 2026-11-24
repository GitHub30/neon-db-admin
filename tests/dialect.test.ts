import { describe, expect, it } from 'vitest';
import {
  buildDbml,
  buildMermaidEr,
  buildRowWhereClause,
  generateCreateTableDdl,
  isDestructiveSql,
  makeColumn,
  quoteIdent,
  quoteLiteral,
} from '../src/core/dialect.js';

describe('dialect utilities', () => {
  it('quotes identifiers safely per dialect and strips NUL bytes', () => {
    expect(quoteIdent('users', 'mysql')).toBe('`users`');
    expect(quoteIdent('bad`name\0', 'mysql')).toBe('`bad``name`');
    expect(quoteIdent('users', 'postgresql')).toBe('"users"');
    expect(quoteIdent('bad"name\0', 'postgresql')).toBe('"bad""name"');
    expect(quoteIdent('order_items', 'sqlite')).toBe('"order_items"');
  });

  it('escapes literals safely across dialects', () => {
    expect(quoteLiteral(null, 'postgresql')).toBe('NULL');
    expect(quoteLiteral("O'Reilly", 'sqlite')).toBe("'O''Reilly'");
    expect(quoteLiteral("a\\b'c", 'mysql')).toBe("'a\\\\b''c'");
    expect(quoteLiteral(true, 'sqlite')).toBe('1');
    expect(quoteLiteral(true, 'postgresql')).toBe('TRUE');
    expect(quoteLiteral(Number.NaN, 'sqlite')).toBe('NULL');
  });

  it('generates dialect-appropriate CREATE TABLE DDL', () => {
    const tbl = {
      name: 'users',
      columns: [
        makeColumn({ name: 'id', type: 'INTEGER', isPrimaryKey: true, isAutoIncrement: true, nullable: false }),
        makeColumn({ name: 'email', type: 'VARCHAR(255)', nullable: false, isUnique: true }),
      ],
      foreignKeys: [],
    };
    expect(generateCreateTableDdl(tbl, 'sqlite')).toContain('INTEGER PRIMARY KEY AUTOINCREMENT');
    expect(generateCreateTableDdl(tbl, 'mysql')).toContain('AUTO_INCREMENT PRIMARY KEY');
    expect(generateCreateTableDdl(tbl, 'mysql')).toContain('ENGINE=InnoDB');
    expect(generateCreateTableDdl(tbl, 'postgresql')).toContain('SERIAL PRIMARY KEY');
  });

  it('detects destructive SQL including UPDATE without WHERE and CTE DELETE (M3)', () => {
    expect(isDestructiveSql('DROP TABLE users;')).toBe(true);
    expect(isDestructiveSql('TRUNCATE TABLE orders;')).toBe(true);
    expect(isDestructiveSql('DELETE FROM users;')).toBe(true);
    expect(isDestructiveSql('UPDATE users SET active = 0;')).toBe(true);
    expect(isDestructiveSql('WITH old AS (SELECT id FROM users) DELETE FROM users;')).toBe(true);
    expect(isDestructiveSql('DELETE FROM users WHERE id = 1;')).toBe(false);
    expect(isDestructiveSql('UPDATE users SET active = 0 WHERE id = 1;')).toBe(false);
    expect(isDestructiveSql('SELECT * FROM users;')).toBe(false);
  });

  it('builds row WHERE clause and preview safely even with ? or $1 in column names (H7)', () => {
    const tbl = {
      name: 'items',
      type: 'table' as const,
      columns: [
        makeColumn({ name: 'is_active?', type: 'INTEGER', isPrimaryKey: true, nullable: false }),
        makeColumn({ name: 'price$1', type: 'INTEGER', isPrimaryKey: true, nullable: false }),
      ],
      foreignKeys: [],
      indexes: [],
    };
    const w = buildRowWhereClause(tbl, [1, 500], ['is_active?', 'price$1'], 'postgresql', 2);
    expect(w.clause).toBe('"is_active?" = $2 AND "price$1" = $3');
    expect(w.previewClause).toBe('"is_active?" = 1 AND "price$1" = 500');
    expect(w.params).toEqual([1, 500]);
  });

  it('exports valid Mermaid erDiagram and DBML', () => {
    const tables = [
      {
        name: 'orders',
        type: 'table' as const,
        columns: [
          makeColumn({ name: 'id', type: 'INTEGER', isPrimaryKey: true, nullable: false }),
          makeColumn({ name: 'customer_id', type: 'INTEGER', nullable: false }),
        ],
        foreignKeys: [{ name: 'fk_cust', column: 'customer_id', refTable: 'customers', refColumn: 'id', onDelete: 'CASCADE', onUpdate: 'NO ACTION' }],
        indexes: [],
      },
    ];
    const mmd = buildMermaidEr(tables, [{ fromTable: 'orders', toTable: 'customers', label: 'customer_id', cardinality: '1:N' }]);
    expect(mmd).toContain('erDiagram');
    expect(mmd).toContain('customers ||--o{ orders');

    const dbml = buildDbml(tables);
    expect(dbml).toContain('Table "orders"');
    expect(dbml).toContain('Ref: "orders"."customer_id" > "customers"."id"');
  });
});
