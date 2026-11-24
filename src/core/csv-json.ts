import type { DbDialect } from '../types/db.js';
import { quoteIdent, quoteLiteral } from './dialect.js';

const FORMULA_PREFIX = /^[=+\-@\t\r]/;

/**
 * Escapes a single CSV cell per RFC-4180, with optional spreadsheet formula-injection protection.
 */
export function escapeCsvCell(val: unknown, protectFormulas = true): string {
  if (val === null || val === undefined) return '';
  let str = typeof val === 'object' ? JSON.stringify(val) : String(val);
  if (protectFormulas && FORMULA_PREFIX.test(str)) {
    str = "'" + str;
  }
  if (/[",\r\n]/.test(str)) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

export function toCsv(columns: string[], rows: unknown[][], protectFormulas = true): string {
  const header = columns.map((c) => escapeCsvCell(c, protectFormulas)).join(',');
  const body = rows.map((row) => columns.map((_, idx) => escapeCsvCell(row[idx], protectFormulas)).join(','));
  return [header, ...body].join('\r\n');
}

export function toTsv(columns: string[], rows: unknown[][]): string {
  const clean = (v: unknown) =>
    v === null || v === undefined ? '' : String(v).replace(/\t/g, ' ').replace(/\r?\n/g, ' ');
  return [columns.map(clean).join('\t'), ...rows.map((r) => columns.map((_, i) => clean(r[i])).join('\t'))].join('\n');
}

export function toJson(columns: string[], rows: unknown[][], pretty = true): string {
  const objs = rows.map((row) => {
    const obj: Record<string, unknown> = {};
    columns.forEach((col, i) => {
      obj[col] = row[i] ?? null;
    });
    return obj;
  });
  return JSON.stringify(objs, null, pretty ? 2 : 0);
}

export function toNdjson(columns: string[], rows: unknown[][]): string {
  return rows
    .map((row) => {
      const obj: Record<string, unknown> = {};
      columns.forEach((col, i) => {
        obj[col] = row[i] ?? null;
      });
      return JSON.stringify(obj);
    })
    .join('\n');
}

export function toMarkdownTable(columns: string[], rows: unknown[][]): string {
  const esc = (v: unknown) =>
    v === null || v === undefined
      ? '*NULL*'
      : String(v).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
  const header = `| ${columns.map(esc).join(' | ')} |`;
  const sep = `| ${columns.map(() => '---').join(' | ')} |`;
  const body = rows.map((row) => `| ${columns.map((_, i) => esc(row[i])).join(' | ')} |`);
  return [header, sep, ...body].join('\n');
}

export function toSqlInserts(tableName: string, columns: string[], rows: unknown[][], dialect: DbDialect): string {
  if (rows.length === 0) return `-- No rows to export for ${tableName}\n`;
  const qTable = quoteIdent(tableName, dialect);
  const qCols = columns.map((c) => quoteIdent(c, dialect)).join(', ');
  return rows
    .map((row) => {
      const vals = columns.map((_, i) => quoteLiteral(row[i], dialect)).join(', ');
      return `INSERT INTO ${qTable} (${qCols}) VALUES (${vals});`;
    })
    .join('\n');
}

/**
 * RFC-4180 compliant CSV parser supporting multiline quoted fields and custom delimiters.
 */
export function parseCsv(text: string, delimiter = ','): { headers: string[]; rows: string[][] } {
  const clean = text.replace(/^\uFEFF/, '');
  const records: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;

  while (i < clean.length) {
    const ch = clean[i];
    if (inQuotes) {
      if (ch === '"' && clean[i + 1] === '"') {
        field += '"';
        i += 2;
        continue;
      }
      if (ch === '"') {
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === delimiter) {
      row.push(field);
      field = '';
      i++;
      continue;
    }
    if (ch === '\r' && clean[i + 1] === '\n') {
      row.push(field);
      records.push(row);
      row = [];
      field = '';
      i += 2;
      continue;
    }
    if (ch === '\n' || ch === '\r') {
      row.push(field);
      records.push(row);
      row = [];
      field = '';
      i++;
      continue;
    }
    field += ch;
    i++;
  }

  if (field !== '' || row.length > 0) {
    row.push(field);
    records.push(row);
  }

  const nonEmpty = records.filter((r) => !(r.length === 1 && r[0].trim() === ''));
  if (nonEmpty.length === 0) return { headers: [], rows: [] };
  const headers = nonEmpty[0].map((h, idx) => h.trim() || `column_${idx + 1}`);
  const rows = nonEmpty.slice(1).map((r) => headers.map((_, idx) => r[idx] ?? ''));
  return { headers, rows };
}

export function inferColumnTypes(headers: string[], rows: unknown[][]): Array<{ name: string; type: string }> {
  const sample = rows.slice(0, 100);
  return headers.map((name, idx) => {
    let allInt = true;
    let allNum = true;
    let allBool = true;
    let hasValue = false;

    for (const r of sample) {
      const v = r[idx];
      if (v === null || v === undefined || v === '') continue;
      hasValue = true;
      const s = String(v).trim();
      if (!/^-?\d+$/.test(s)) allInt = false;
      if (!/^-?\d+(?:\.\d+)?$/.test(s)) allNum = false;
      if (!/^(true|false|0|1)$/i.test(s)) allBool = false;
    }

    if (!hasValue) return { name, type: 'TEXT' };
    if (allInt) return { name, type: 'INTEGER' };
    if (allNum) return { name, type: 'REAL' };
    if (allBool) return { name, type: 'BOOLEAN' };
    return { name, type: 'TEXT' };
  });
}

export function downloadBlob(content: BlobPart, filename: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
