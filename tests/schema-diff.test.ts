import { describe, expect, it } from 'vitest';
import { auditSchemaHealth, diffSchemas } from '../src/core/schema-diff.js';
import { makeColumn } from '../src/core/dialect.js';
import type { TableSchema } from '../src/types/db.js';

describe('schema-diff & health audit', () => {
  it('generates migration SQL for added tables and columns', () => {
    const src: TableSchema[] = [
      {
        name: 'users',
        type: 'table',
        columns: [makeColumn({ name: 'id', type: 'INTEGER', isPrimaryKey: true, nullable: false })],
        foreignKeys: [],
        indexes: [],
      },
    ];
    const tgt: TableSchema[] = [
      {
        name: 'users',
        type: 'table',
        columns: [
          makeColumn({ name: 'id', type: 'INTEGER', isPrimaryKey: true, nullable: false }),
          makeColumn({ name: 'email', type: 'TEXT', nullable: false }),
        ],
        foreignKeys: [],
        indexes: [],
      },
      {
        name: 'audit_logs',
        type: 'table',
        columns: [makeColumn({ name: 'id', type: 'INTEGER', isPrimaryKey: true, nullable: false })],
        foreignKeys: [],
        indexes: [],
      },
    ];

    const diffs = diffSchemas(src, tgt, 'postgresql');
    expect(diffs.some((d) => d.kind === 'create-table' && d.table === 'audit_logs')).toBe(true);
    expect(diffs.some((d) => d.kind === 'add-column' && d.column === 'email')).toBe(true);
  });

  it('flags missing primary keys and unindexed foreign keys', () => {
    const tables: TableSchema[] = [
      {
        name: 'events',
        type: 'table',
        columns: [makeColumn({ name: 'user_id', type: 'INTEGER', nullable: false })],
        foreignKeys: [{ name: 'fk_u', column: 'user_id', refTable: 'users', refColumn: 'id', onDelete: 'CASCADE', onUpdate: 'NO ACTION' }],
        indexes: [],
      },
    ];
    const issues = auditSchemaHealth(tables, 'sqlite');
    expect(issues.some((i) => i.severity === 'warn')).toBe(true);
    expect(issues.some((i) => i.suggestionSql?.includes('CREATE INDEX'))).toBe(true);
  });
});
