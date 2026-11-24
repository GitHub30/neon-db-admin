export type SqlTokenType = 'keyword' | 'function' | 'string' | 'number' | 'comment' | 'operator' | 'identifier' | 'plain';

export interface SqlToken {
  type: SqlTokenType;
  text: string;
}

const KEYWORDS = new Set([
  'SELECT', 'FROM', 'WHERE', 'JOIN', 'LEFT', 'RIGHT', 'INNER', 'OUTER', 'FULL', 'CROSS', 'ON', 'AS',
  'ORDER', 'BY', 'GROUP', 'HAVING', 'LIMIT', 'OFFSET', 'DISTINCT', 'UNION', 'ALL', 'INSERT', 'INTO',
  'VALUES', 'UPDATE', 'SET', 'DELETE', 'CREATE', 'ALTER', 'DROP', 'TABLE', 'INDEX', 'VIEW', 'TRIGGER',
  'DATABASE', 'SCHEMA', 'ADD', 'COLUMN', 'PRIMARY', 'FOREIGN', 'KEY', 'REFERENCES', 'NOT', 'NULL',
  'DEFAULT', 'UNIQUE', 'CHECK', 'CONSTRAINT', 'CASCADE', 'RESTRICT', 'AND', 'OR', 'IN', 'IS', 'BETWEEN',
  'LIKE', 'ILIKE', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'WITH', 'RECURSIVE', 'OVER', 'PARTITION',
  'EXPLAIN', 'QUERY', 'PLAN', 'BEGIN', 'COMMIT', 'ROLLBACK', 'PRAGMA', 'VACUUM', 'ANALYZE', 'TRUNCATE',
  'RETURNING', 'EXISTS', 'IF', 'ASC', 'DESC', 'TRUE', 'FALSE', 'AUTOINCREMENT', 'AUTO_INCREMENT',
  'INTEGER', 'INT', 'BIGINT', 'SMALLINT', 'TEXT', 'VARCHAR', 'CHAR', 'REAL', 'DOUBLE', 'PRECISION',
  'NUMERIC', 'DECIMAL', 'BOOLEAN', 'BOOL', 'DATE', 'TIME', 'DATETIME', 'TIMESTAMP', 'TIMESTAMPTZ',
  'JSON', 'JSONB', 'UUID', 'BLOB', 'BYTEA', 'SERIAL', 'BIGSERIAL', 'ENGINE', 'CHARSET', 'COMMENT',
]);

const FUNCTIONS = new Set([
  'COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'COALESCE', 'NULLIF', 'CAST', 'LOWER', 'UPPER', 'TRIM', 'LENGTH',
  'SUBSTR', 'SUBSTRING', 'CONCAT', 'REPLACE', 'ROUND', 'ABS', 'NOW', 'CURRENT_TIMESTAMP', 'CURRENT_DATE',
  'DATE', 'STRFTIME', 'DATETIME', 'ROW_NUMBER', 'RANK', 'DENSE_RANK', 'LAG', 'LEAD', 'JSON_EXTRACT',
  'GROUP_CONCAT', 'STRING_AGG', 'VERSION', 'SQLITE_VERSION',
]);

/**
 * Pure tokenizer for SQL syntax highlighting.
 * Rendered solely through textContent / DOM spans to prevent any XSS.
 */
export function tokenizeSql(sql: string): SqlToken[] {
  const tokens: SqlToken[] = [];
  let i = 0;
  const len = sql.length;

  while (i < len) {
    const ch = sql[i];
    const next = sql[i + 1] ?? '';

    // Line comment
    if (ch === '-' && next === '-') {
      let j = i + 2;
      while (j < len && sql[j] !== '\n') j++;
      tokens.push({ type: 'comment', text: sql.slice(i, j) });
      i = j;
      continue;
    }

    // Block comment
    if (ch === '/' && next === '*') {
      const end = sql.indexOf('*/', i + 2);
      const stop = end === -1 ? len : end + 2;
      tokens.push({ type: 'comment', text: sql.slice(i, stop) });
      i = stop;
      continue;
    }

    // Single-quoted string
    if (ch === "'") {
      let j = i + 1;
      while (j < len) {
        if (sql[j] === "'" && sql[j + 1] === "'") {
          j += 2;
          continue;
        }
        if (sql[j] === '\\') {
          j += 2;
          continue;
        }
        if (sql[j] === "'") {
          j++;
          break;
        }
        j++;
      }
      tokens.push({ type: 'string', text: sql.slice(i, j) });
      i = j;
      continue;
    }

    // Quoted identifier
    if (ch === '"' || ch === '`') {
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
      tokens.push({ type: 'identifier', text: sql.slice(i, j) });
      i = j;
      continue;
    }

    // Numbers
    if (/[0-9]/.test(ch)) {
      let j = i;
      while (j < len && /[0-9._]/.test(sql[j])) j++;
      tokens.push({ type: 'number', text: sql.slice(i, j) });
      i = j;
      continue;
    }

    // Words (keywords / functions / identifiers)
    if (/[A-Za-z_]/.test(ch)) {
      let j = i;
      while (j < len && /[A-Za-z0-9_$]/.test(sql[j])) j++;
      const word = sql.slice(i, j);
      const upper = word.toUpperCase();
      if (FUNCTIONS.has(upper)) {
        tokens.push({ type: 'function', text: word });
      } else if (KEYWORDS.has(upper)) {
        tokens.push({ type: 'keyword', text: word });
      } else {
        tokens.push({ type: 'plain', text: word });
      }
      i = j;
      continue;
    }

    // Operators / punctuation
    if (/[=<>!+\-*/%,.;:()]/.test(ch)) {
      tokens.push({ type: 'operator', text: ch });
      i++;
      continue;
    }

    // Whitespace / other
    let j = i;
    while (j < len && /[\s]/.test(sql[j])) j++;
    if (j === i) j = i + 1;
    tokens.push({ type: 'plain', text: sql.slice(i, j) });
    i = j;
  }

  return tokens;
}

export function renderHighlightedSql(container: HTMLElement, sql: string): void {
  const frag = document.createDocumentFragment();
  const tokens = tokenizeSql(sql);
  for (const tok of tokens) {
    if (tok.type === 'plain') {
      frag.appendChild(document.createTextNode(tok.text));
    } else {
      const span = document.createElement('span');
      span.className = `sql-tok-${tok.type}`;
      span.textContent = tok.text;
      frag.appendChild(span);
    }
  }
  // Ensure trailing newline keeps mirror height synced with textarea
  if (sql.endsWith('\n')) {
    frag.appendChild(document.createTextNode(' '));
  }
  container.replaceChildren(frag);
}
