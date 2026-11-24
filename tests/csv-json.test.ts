import { describe, expect, it } from 'vitest';
import { escapeCsvCell, inferColumnTypes, parseCsv, toCsv, toMarkdownTable } from '../src/core/csv-json.js';

describe('csv-json import/export', () => {
  it('protects against CSV formula injection by default', () => {
    expect(escapeCsvCell('=CMD("calc")')).toBe('"\'=CMD(""calc"")"');
    expect(escapeCsvCell('+1+1')).toBe("'+1+1");
    expect(escapeCsvCell('-2+3')).toBe("'-2+3");
    expect(escapeCsvCell('@SUM(A1:A2)')).toBe("'@SUM(A1:A2)");
    expect(escapeCsvCell('normal')).toBe('normal');
  });

  it('parses RFC-4180 CSV with quoted commas, escaped quotes, and newlines', () => {
    const raw = 'id,name,note\r\n1,"Sato, Haruto","Line 1\nLine ""2"""\r\n2,Yui,Simple';
    const parsed = parseCsv(raw);
    expect(parsed.headers).toEqual(['id', 'name', 'note']);
    expect(parsed.rows).toEqual([
      ['1', 'Sato, Haruto', 'Line 1\nLine "2"'],
      ['2', 'Yui', 'Simple'],
    ]);
  });

  it('infers column types accurately', () => {
    const inferred = inferColumnTypes(
      ['id', 'price', 'name'],
      [
        ['1', '19.99', 'Keyboard'],
        ['2', '42.50', 'Mouse'],
      ]
    );
    expect(inferred).toEqual([
      { name: 'id', type: 'INTEGER' },
      { name: 'price', type: 'REAL' },
      { name: 'name', type: 'TEXT' },
    ]);
  });

  it('serializes CSV and Markdown tables', () => {
    expect(toCsv(['a', 'b'], [[1, 'x,y']])).toBe('a,b\r\n1,"x,y"');
    expect(toMarkdownTable(['a', 'b'], [[1, null]])).toContain('| 1 | *NULL* |');
  });
});
