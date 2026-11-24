/**
 * Splits a SQL script into individual executable statements while properly ignoring
 * semicolons inside single-quoted strings, double-quoted identifiers, backticks,
 * line comments (--), block comments (/* ... *\/), PostgreSQL dollar-quoted blocks ($$...$$),
 * and CREATE TRIGGER ... BEGIN ... END blocks (properly distinguishing nested CASE ... END).
 */
export function splitSqlStatements(sql: string, backslashEscape = false): string[] {
  const statements: string[] = [];
  let current = '';
  let i = 0;
  const len = sql.length;

  let inSingle = false;
  let inDouble = false;
  let inBacktick = false;
  let inLineComment = false;
  let inBlockComment = false;
  let dollarTag: string | null = null;
  let triggerDepth = 0;
  let caseDepth = 0;

  while (i < len) {
    const ch = sql[i];
    const next = sql[i + 1] ?? '';

    if (inLineComment) {
      current += ch;
      if (ch === '\n') inLineComment = false;
      i++;
      continue;
    }

    if (inBlockComment) {
      current += ch;
      if (ch === '*' && next === '/') {
        current += next;
        inBlockComment = false;
        i += 2;
        continue;
      }
      i++;
      continue;
    }

    if (dollarTag !== null) {
      if (sql.startsWith(dollarTag, i)) {
        current += dollarTag;
        i += dollarTag.length;
        dollarTag = null;
        continue;
      }
      current += ch;
      i++;
      continue;
    }

    if (inSingle) {
      current += ch;
      if (ch === "'" && next === "'") {
        current += next;
        i += 2;
        continue;
      }
      if (backslashEscape && ch === '\\' && next) {
        current += next;
        i += 2;
        continue;
      }
      if (ch === "'") inSingle = false;
      i++;
      continue;
    }

    if (inDouble) {
      current += ch;
      if (ch === '"' && next === '"') {
        current += next;
        i += 2;
        continue;
      }
      if (ch === '"') inDouble = false;
      i++;
      continue;
    }

    if (inBacktick) {
      current += ch;
      if (ch === '`' && next === '`') {
        current += next;
        i += 2;
        continue;
      }
      if (ch === '`') inBacktick = false;
      i++;
      continue;
    }

    if (ch === '-' && next === '-') {
      inLineComment = true;
      current += '--';
      i += 2;
      continue;
    }
    if (ch === '/' && next === '*') {
      inBlockComment = true;
      current += '/*';
      i += 2;
      continue;
    }

    if (ch === "'") {
      inSingle = true;
      current += ch;
      i++;
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      current += ch;
      i++;
      continue;
    }
    if (ch === '`') {
      inBacktick = true;
      current += ch;
      i++;
      continue;
    }

    if (ch === '$') {
      const match = sql.slice(i).match(/^\$[A-Za-z_0-9]*\$/);
      if (match) {
        dollarTag = match[0];
        current += dollarTag;
        i += dollarTag.length;
        continue;
      }
    }

    // Track CREATE TRIGGER ... BEGIN ... (nested CASE ... END) ... END;
    if (/[A-Za-z]/.test(ch) && (i === 0 || !/[A-Za-z0-9_]/.test(sql[i - 1]))) {
      const rest = sql.slice(i);
      if (/^BEGIN\b/i.test(rest) && /\bCREATE\s+(?:TEMP\s+|TEMPORARY\s+)?TRIGGER\b/i.test(current)) {
        triggerDepth++;
      } else if (/^CASE\b/i.test(rest) && triggerDepth > 0) {
        caseDepth++;
      } else if (/^END\b/i.test(rest)) {
        if (caseDepth > 0) caseDepth--;
        else if (triggerDepth > 0) triggerDepth--;
      }
    }

    if (ch === ';' && triggerDepth === 0) {
      const trimmed = current.trim();
      if (trimmed) statements.push(trimmed);
      current = '';
      i++;
      continue;
    }

    current += ch;
    i++;
  }

  const tail = current.trim();
  if (tail) statements.push(tail);
  return statements;
}

const MAJOR_CLAUSES = [
  'SELECT', 'FROM', 'WHERE', 'LEFT OUTER JOIN', 'RIGHT OUTER JOIN', 'FULL OUTER JOIN',
  'LEFT JOIN', 'RIGHT JOIN', 'INNER JOIN', 'CROSS JOIN', 'JOIN', 'ORDER BY', 'GROUP BY',
  'HAVING', 'LIMIT', 'OFFSET', 'UNION ALL', 'UNION', 'INSERT INTO', 'VALUES', 'UPDATE',
  'SET', 'DELETE FROM', 'RETURNING',
];

const UPPER_KEYWORDS = new Set([
  'SELECT', 'FROM', 'WHERE', 'AND', 'OR', 'NOT', 'IN', 'IS', 'NULL', 'AS', 'ON', 'JOIN', 'LEFT', 'RIGHT',
  'INNER', 'OUTER', 'FULL', 'CROSS', 'ORDER', 'BY', 'GROUP', 'HAVING', 'LIMIT', 'OFFSET', 'ASC', 'DESC',
  'DISTINCT', 'UNION', 'ALL', 'INSERT', 'INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE', 'CREATE', 'TABLE',
  'ALTER', 'DROP', 'INDEX', 'VIEW', 'TRIGGER', 'PRIMARY', 'KEY', 'FOREIGN', 'REFERENCES', 'UNIQUE',
  'DEFAULT', 'CHECK', 'CONSTRAINT', 'AUTOINCREMENT', 'AUTO_INCREMENT', 'IF', 'EXISTS', 'CASE', 'WHEN',
  'THEN', 'ELSE', 'END', 'BETWEEN', 'LIKE', 'ILIKE', 'CAST', 'COALESCE', 'COUNT', 'SUM', 'AVG', 'MIN',
  'MAX', 'WITH', 'RECURSIVE', 'OVER', 'PARTITION', 'EXPLAIN', 'PRAGMA', 'BEGIN', 'COMMIT', 'ROLLBACK',
  'CASCADE', 'RESTRICT', 'RETURNING', 'TRUE', 'FALSE',
]);

export function formatSql(input: string): string {
  const stmts = splitSqlStatements(input);
  if (stmts.length === 0) return input.trim();
  const formatted = stmts.map((stmt) => formatSingleStatement(stmt));
  return formatted.join(';\n\n') + (input.trim().endsWith(';') ? ';' : '');
}

function formatSingleStatement(sql: string): string {
  const tokens: Array<{ type: 'code' | 'literal' | 'comment'; text: string }> = [];
  let i = 0;
  const len = sql.length;

  while (i < len) {
    const ch = sql[i];
    const next = sql[i + 1] ?? '';

    if (ch === '-' && next === '-') {
      let end = sql.indexOf('\n', i);
      if (end === -1) end = len;
      tokens.push({ type: 'comment', text: sql.slice(i, end) });
      i = end + 1;
      continue;
    }
    if (ch === '/' && next === '*') {
      const end = sql.indexOf('*/', i + 2);
      const stop = end === -1 ? len : end + 2;
      tokens.push({ type: 'comment', text: sql.slice(i, stop) });
      i = stop;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      const q = ch;
      let j = i + 1;
      while (j < len) {
        if (sql[j] === q && sql[j + 1] === q) {
          j += 2;
          continue;
        }
        if (sql[j] === q) {
          j++;
          break;
        }
        j++;
      }
      tokens.push({ type: 'literal', text: sql.slice(i, j) });
      i = j;
      continue;
    }

    let j = i;
    while (
      j < len &&
      sql[j] !== "'" &&
      sql[j] !== '"' &&
      sql[j] !== '`' &&
      !(sql[j] === '-' && sql[j + 1] === '-') &&
      !(sql[j] === '/' && sql[j + 1] === '*')
    ) {
      j++;
    }
    const chunk = sql.slice(i, j);
    if (chunk) tokens.push({ type: 'code', text: chunk });
    i = j;
  }

  let out = '';
  for (const tok of tokens) {
    if (tok.type === 'comment') {
      out += `\n${tok.text}\n`;
      continue;
    }
    if (tok.type === 'literal') {
      out += tok.text;
      continue;
    }
    let normalized = tok.text.replace(/\s+/g, ' ');
    normalized = normalized.replace(/\b([A-Za-z_][A-Za-z0-9_]*)\b/g, (word) => {
      const upper = word.toUpperCase();
      return UPPER_KEYWORDS.has(upper) ? upper : word;
    });
    out += normalized;
  }

  out = out.trim();
  if (/^CREATE\s+TABLE\b/i.test(out)) return out;

  for (const clause of MAJOR_CLAUSES) {
    const re = new RegExp(`(?<!^)\\s+(${clause.replace(/ /g, '\\s+')})\\b`, 'g');
    out = replaceOutsideProtected(out, re, '\n$1');
  }
  out = replaceOutsideProtected(out, /\s+\b(AND|OR)\b/g, '\n  $1');

  return out
    .split('\n')
    .map((line) => line.replace(/\s+$/g, ''))
    .filter((line, idx, arr) => !(line === '' && arr[idx - 1] === ''))
    .join('\n');
}

function replaceOutsideProtected(sql: string, regex: RegExp, replacement: string): string {
  const segments: Array<{ protected: boolean; text: string }> = [];
  let buf = '';
  let i = 0;
  let depth = 0;
  let quote: string | null = null;

  const flush = (isProtected: boolean) => {
    if (buf) {
      segments.push({ protected: isProtected, text: buf });
      buf = '';
    }
  };

  while (i < sql.length) {
    const ch = sql[i];
    const next = sql[i + 1] ?? '';

    if (quote) {
      buf += ch;
      if (ch === quote && next === quote) {
        buf += next;
        i += 2;
        continue;
      }
      if (ch === quote) {
        quote = null;
        if (depth === 0) flush(true);
      }
      i++;
      continue;
    }

    // Protect line and block comments so apostrophes inside comments don't corrupt formatting
    if (ch === '-' && next === '-') {
      if (depth === 0) flush(false);
      let end = sql.indexOf('\n', i + 2);
      if (end === -1) end = sql.length;
      segments.push({ protected: true, text: sql.slice(i, end) });
      i = end;
      continue;
    }
    if (ch === '/' && next === '*') {
      if (depth === 0) flush(false);
      const end = sql.indexOf('*/', i + 2);
      const stop = end === -1 ? sql.length : end + 2;
      segments.push({ protected: true, text: sql.slice(i, stop) });
      i = stop;
      continue;
    }

    if (ch === "'" || ch === '"' || ch === '`') {
      if (depth === 0) flush(false);
      quote = ch;
      buf += ch;
      i++;
      continue;
    }
    if (ch === '(') {
      if (depth === 0) flush(false);
      depth++;
      buf += ch;
      i++;
      continue;
    }
    if (ch === ')' && depth > 0) {
      depth--;
      buf += ch;
      if (depth === 0) flush(true);
      i++;
      continue;
    }
    buf += ch;
    i++;
  }
  flush(depth > 0 || quote !== null);

  return segments
    .map((seg) => (seg.protected ? seg.text : seg.text.replace(regex, replacement)))
    .join('');
}
