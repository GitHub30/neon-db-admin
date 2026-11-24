import { describe, expect, it } from 'vitest';
import { formatSql, splitSqlStatements } from '../src/core/sql-formatter.js';

describe('sql-formatter & statement splitter', () => {
  it('splits statements ignoring semicolons inside quotes and comments', () => {
    const script = `
      -- comment; with semicolon
      INSERT INTO notes VALUES ('hello; world');
      /* block; comment */
      SELECT "col;1" FROM t;
    `;
    const stmts = splitSqlStatements(script);
    expect(stmts).toHaveLength(2);
    expect(stmts[0]).toContain("'hello; world'");
    expect(stmts[1]).toContain('"col;1"');
  });

  it('keeps CREATE TRIGGER BEGIN...END blocks intact even with nested CASE...END (M3)', () => {
    const script = `
      CREATE TRIGGER trg_test AFTER INSERT ON items
      BEGIN
        UPDATE orders SET label = CASE WHEN NEW.qty > 1 THEN 'bulk' ELSE 'single' END WHERE id = NEW.order_id;
        INSERT INTO logs(msg) VALUES ('ok');
      END;
      SELECT 1;
    `;
    const stmts = splitSqlStatements(script);
    expect(stmts).toHaveLength(2);
    expect(stmts[0]).toContain("INSERT INTO logs(msg) VALUES ('ok')");
    expect(stmts[1]).toBe('SELECT 1');
  });

  it('handles trailing backslashes in standard SQL strings and dollar-quoted Postgres functions (M3)', () => {
    const s1 = splitSqlStatements("SELECT 'C:\\'; SELECT 2;", false);
    expect(s1).toEqual(["SELECT 'C:\\'", 'SELECT 2']);

    const script = `CREATE FUNCTION f() RETURNS int AS $$ BEGIN RETURN 1; END; $$ LANGUAGE plpgsql; SELECT f();`;
    const stmts = splitSqlStatements(script);
    expect(stmts).toHaveLength(2);
    expect(stmts[0]).toContain('$$ BEGIN RETURN 1; END; $$');
  });

  it('formats SELECT statements cleanly without being corrupted by comment apostrophes (M3)', () => {
    const out = formatSql("-- don't break on apostrophe\nselect id, name from users where status = 'select from where' and active = 1 order by id desc;");
    expect(out).toContain("-- don't break on apostrophe");
    expect(out).toContain('SELECT id, name\nFROM users');
    expect(out).toContain("'select from where'");
    expect(out).toContain('\nORDER BY id DESC;');
  });
});
