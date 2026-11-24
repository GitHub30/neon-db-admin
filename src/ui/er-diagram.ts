import { store } from '../core/state.js';
import {
  buildDbml,
  buildMermaidEr,
  generateCreateTableDdl,
  getDataTypesForDialect,
  makeColumn,
  quoteIdent,
} from '../core/dialect.js';
import { downloadBlob } from '../core/csv-json.js';
import { splitSqlStatements } from '../core/sql-formatter.js';
import { t } from '../i18n/translations.js';
import type {
  ColumnSchema,
  DatabaseSchema,
  DbDialect,
  ERCardinality,
  ERModel,
  ERRelationEdge,
  ERTableNode,
  TableSchema,
} from '../types/db.js';
import { confirmSqlModal, copyToClipboard, el, labeledField, openModal, toast } from './dom.js';
import { icon } from './icons.js';

const NODE_COLORS = ['#0f766e', '#0284c7', '#b45309', '#15803d', '#be123c', '#0e7490', '#475569'];
const HEX_COLOR_RE = /^#[0-9a-fA-F]{3,8}$/;
const NODE_WIDTH = 236;
const NODE_HEADER_H = 36;
const COL_ROW_H = 24;

let zoom = 1;
let panX = 36;
let panY = 36;
let selectedNodeId: string | null = null;
let selectedEdgeId: string | null = null;
let targetDdlDialect: DbDialect | null = null;

function safeColor(c: unknown, fallback = NODE_COLORS[0]): string {
  return typeof c === 'string' && HEX_COLOR_RE.test(c.trim()) ? c.trim() : fallback;
}

function safeCoord(n: unknown, fallback: number): number {
  const num = Number(n);
  return Number.isFinite(num) ? Math.max(0, Math.min(20000, Math.round(num))) : fallback;
}

function nodeHeight(node: ERTableNode): number {
  return NODE_HEADER_H + Math.max(1, node.columns.length) * COL_ROW_H + 10;
}

/**
 * Strictly validates and sanitizes an imported .er.json file (prevents SVG XSS & crashes — H8).
 */
export function sanitizeImportedErModel(raw: unknown): ERModel {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('ERモデルのJSON形式が不正です。');
  }
  const obj = raw as Record<string, unknown>;
  if (!Array.isArray(obj.tables)) {
    throw new Error('ERモデルに tables 配列が含まれていません。');
  }

  const tables: ERTableNode[] = obj.tables.slice(0, 200).map((tRaw, idx) => {
    const tn = (tRaw && typeof tRaw === 'object' ? tRaw : {}) as Record<string, unknown>;
    const rawCols = Array.isArray(tn.columns) ? tn.columns : [];
    const columns: ColumnSchema[] = rawCols.slice(0, 200).map((cRaw, ci) => {
      const c = (cRaw && typeof cRaw === 'object' ? cRaw : {}) as Record<string, unknown>;
      return makeColumn({
        name: String(c.name || `col_${ci + 1}`).slice(0, 128),
        type: String(c.type || 'TEXT').slice(0, 64),
        nullable: c.nullable !== false,
        defaultValue: c.defaultValue != null ? String(c.defaultValue).slice(0, 128) : null,
        isPrimaryKey: Boolean(c.isPrimaryKey),
        isAutoIncrement: Boolean(c.isAutoIncrement),
        isUnique: Boolean(c.isUnique),
      });
    });

    return {
      id: String(tn.id || `tbl-${idx}-${Date.now()}`).slice(0, 128),
      name: String(tn.name || `table_${idx + 1}`).slice(0, 128),
      x: safeCoord(tn.x, 64 + (idx % 3) * 320),
      y: safeCoord(tn.y, 64 + Math.floor(idx / 3) * 260),
      color: safeColor(tn.color, NODE_COLORS[idx % NODE_COLORS.length]),
      columns: columns.length ? columns : [makeColumn({ name: 'id', type: 'INTEGER', isPrimaryKey: true, nullable: false })],
      comment: tn.comment ? String(tn.comment).slice(0, 300) : undefined,
    };
  });

  const validTableIds = new Set(tables.map((tNode) => tNode.id));
  const rawRels = Array.isArray(obj.relations) ? obj.relations : [];
  const relations: ERRelationEdge[] = [];
  rawRels.slice(0, 500).forEach((rRaw, idx) => {
    if (!rRaw || typeof rRaw !== 'object') return;
    const r = rRaw as Record<string, unknown>;
    const srcId = String(r.sourceTableId || '');
    const tgtId = String(r.targetTableId || '');
    if (!validTableIds.has(srcId) || !validTableIds.has(tgtId)) return;
    const card = r.cardinality === '1:1' || r.cardinality === 'N:M' ? r.cardinality : '1:N';
    relations.push({
      id: String(r.id || `rel-${idx}-${Date.now()}`).slice(0, 128),
      name: String(r.name || `fk_${idx}`).slice(0, 128),
      sourceTableId: srcId,
      sourceColumn: String(r.sourceColumn || '').slice(0, 128),
      targetTableId: tgtId,
      targetColumn: String(r.targetColumn || '').slice(0, 128),
      cardinality: card,
      onDelete: String(r.onDelete || 'NO ACTION').slice(0, 32),
      onUpdate: String(r.onUpdate || 'NO ACTION').slice(0, 32),
    });
  });

  const validDialects = new Set<DbDialect>(['sqlite', 'mysql', 'mariadb', 'postgresql', 'd1', 'd1-binding', 'libsql']);
  const dialect = validDialects.has(obj.dialect as DbDialect) ? (obj.dialect as DbDialect) : 'sqlite';

  return {
    id: String(obj.id || `er-${Date.now()}`).slice(0, 128),
    name: String(obj.name || 'Imported ER Model').slice(0, 128),
    dialect,
    tables,
    relations,
    updatedAt: Date.now(),
  };
}

export function reverseEngineerFromSchema(schema: DatabaseSchema): ERModel {
  const tables: ERTableNode[] = schema.tables.map((tbl, idx) => ({
    id: `tbl-${tbl.name}`,
    name: tbl.name,
    x: 60 + (idx % 3) * 320,
    y: 60 + Math.floor(idx / 3) * 280,
    color: NODE_COLORS[idx % NODE_COLORS.length],
    columns: tbl.columns.map((c) => ({ ...c })),
    comment: tbl.comment,
  }));

  const byName = new Map(tables.map((tNode) => [tNode.name.toLowerCase(), tNode]));
  const relations: ERRelationEdge[] = [];

  for (const tbl of schema.tables) {
    const srcNode = byName.get(tbl.name.toLowerCase());
    if (!srcNode) continue;
    tbl.foreignKeys.forEach((fk, fkIdx) => {
      const tgtNode = byName.get(fk.refTable.toLowerCase());
      if (!tgtNode) return;
      const srcCol = tbl.columns.find((c) => c.name === fk.column);
      const isOneToOne = Boolean(
        srcCol?.isUnique || (srcCol?.isPrimaryKey && tbl.columns.filter((c) => c.isPrimaryKey).length === 1)
      );
      relations.push({
        id: `rel-${srcNode.name}-${fk.column}-${tgtNode.name}-${fk.refColumn}-${fkIdx}`,
        name: fk.name || `fk_${srcNode.name}_${fk.column}`,
        sourceTableId: srcNode.id,
        sourceColumn: fk.column,
        targetTableId: tgtNode.id,
        targetColumn: fk.refColumn,
        cardinality: isOneToOne ? '1:1' : '1:N',
        onDelete: fk.onDelete || 'NO ACTION',
        onUpdate: fk.onUpdate || 'NO ACTION',
      });
    });
  }

  const model: ERModel = {
    id: `er-${schema.databaseName}-${Date.now()}`,
    name: `${schema.databaseName} ER Model`,
    dialect: schema.dialect,
    tables,
    relations,
    updatedAt: Date.now(),
  };

  autoLayoutModel(model);
  return model;
}

function autoLayoutModel(model: ERModel): void {
  const inDegree = new Map<string, number>();
  const children = new Map<string, Set<string>>();
  for (const tbl of model.tables) {
    inDegree.set(tbl.id, 0);
    children.set(tbl.id, new Set());
  }
  for (const rel of model.relations) {
    if (rel.sourceTableId === rel.targetTableId) continue;
    const set = children.get(rel.targetTableId);
    if (set && !set.has(rel.sourceTableId)) {
      set.add(rel.sourceTableId);
      inDegree.set(rel.sourceTableId, (inDegree.get(rel.sourceTableId) || 0) + 1);
    }
  }

  const levels = new Map<string, number>();
  const queue: string[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) {
      levels.set(id, 0);
      queue.push(id);
    }
  }

  while (queue.length > 0) {
    const cur = queue.shift()!;
    const curLvl = levels.get(cur) || 0;
    for (const childId of children.get(cur) || []) {
      const nextLvl = Math.max(levels.get(childId) || 0, curLvl + 1);
      levels.set(childId, nextLvl);
      const rem = (inDegree.get(childId) || 1) - 1;
      inDegree.set(childId, rem);
      if (rem === 0) queue.push(childId);
    }
  }

  for (const tbl of model.tables) {
    if (!levels.has(tbl.id)) levels.set(tbl.id, 0);
  }

  const columnsByLevel = new Map<number, ERTableNode[]>();
  for (const tbl of model.tables) {
    const lvl = levels.get(tbl.id) || 0;
    const arr = columnsByLevel.get(lvl) || [];
    arr.push(tbl);
    columnsByLevel.set(lvl, arr);
  }

  const sortedLvls = Array.from(columnsByLevel.keys()).sort((a, b) => a - b);
  let xCursor = 64;
  for (const lvl of sortedLvls) {
    const nodes = columnsByLevel.get(lvl) || [];
    let yCursor = 64;
    for (const node of nodes) {
      node.x = xCursor;
      node.y = yCursor;
      yCursor += nodeHeight(node) + 54;
    }
    xCursor += NODE_WIDTH + 120;
  }
}

export function modelToTableSchemas(model: ERModel): TableSchema[] {
  const byId = new Map(model.tables.map((n) => [n.id, n]));
  return model.tables.map((node) => ({
    name: node.name,
    type: 'table',
    columns: node.columns,
    indexes: [],
    foreignKeys: model.relations
      .filter((r) => r.sourceTableId === node.id)
      .map((r) => ({
        name: r.name,
        column: r.sourceColumn,
        refTable: byId.get(r.targetTableId)?.name || '',
        refColumn: r.targetColumn,
        onDelete: r.onDelete,
        onUpdate: r.onUpdate,
      }))
      .filter((fk) => fk.refTable !== ''),
    comment: node.comment,
  }));
}

function generateModelDdl(model: ERModel, dialect: DbDialect): string {
  const schemas = modelToTableSchemas(model);
  const ordered: TableSchema[] = [];
  const placed = new Set<string>();
  const remaining = [...schemas];

  // Topologically sort acyclic dependencies; defer cyclic FKs to ALTER TABLE (M2)
  for (let pass = 0; pass < schemas.length + 1 && remaining.length > 0; pass++) {
    let progressed = false;
    for (let i = remaining.length - 1; i >= 0; i--) {
      const tbl = remaining[i];
      const depsMet = tbl.foreignKeys.every((fk) => fk.refTable === tbl.name || placed.has(fk.refTable));
      if (depsMet) {
        ordered.push(tbl);
        placed.add(tbl.name);
        remaining.splice(i, 1);
        progressed = true;
      }
    }
    if (!progressed) break;
  }

  const deferredAlters: string[] = [];
  const q = (id: string) => quoteIdent(id, dialect);
  for (const cyclicTbl of remaining) {
    const inlineFks = cyclicTbl.foreignKeys.filter((fk) => fk.refTable === cyclicTbl.name || placed.has(fk.refTable));
    const deferredFks = cyclicTbl.foreignKeys.filter((fk) => fk.refTable !== cyclicTbl.name && !placed.has(fk.refTable));
    ordered.push({ ...cyclicTbl, foreignKeys: inlineFks });
    placed.add(cyclicTbl.name);
    for (const fk of deferredFks) {
      if (dialect === 'sqlite' || dialect === 'd1' || dialect === 'd1-binding' || dialect === 'libsql') {
        deferredAlters.push(`-- Cyclic FK ${cyclicTbl.name}.${fk.column} -> ${fk.refTable}.${fk.refColumn} (enable PRAGMA foreign_keys = OFF during creation in SQLite)`);
      } else {
        const onDel = fk.onDelete && fk.onDelete !== 'NO ACTION' ? ` ON DELETE ${fk.onDelete}` : '';
        deferredAlters.push(
          `ALTER TABLE ${q(cyclicTbl.name)} ADD CONSTRAINT ${q(fk.name)} FOREIGN KEY (${q(fk.column)}) REFERENCES ${q(fk.refTable)}(${q(fk.refColumn)})${onDel};`
        );
      }
    }
  }

  const header = `-- Generated by Neon DB Admin Visual ER Designer\n-- Model: ${model.name}\n-- Target Dialect: ${dialect.toUpperCase()}\n\n`;
  const parts = ordered.map((tbl) => generateCreateTableDdl(tbl, dialect));
  if (deferredAlters.length) parts.push(deferredAlters.join('\n'));
  return header + parts.join('\n\n') + '\n';
}

function computeEdgeGeometry(src: ERTableNode, tgt: ERTableNode, rel: ERRelationEdge) {
  const srcColIdx = Math.max(0, src.columns.findIndex((c) => c.name === rel.sourceColumn));
  const tgtColIdx = Math.max(0, tgt.columns.findIndex((c) => c.name === rel.targetColumn));
  const sxBase = safeCoord(src.x, 60);
  const syBase = safeCoord(src.y, 60);
  const txBase = safeCoord(tgt.x, 60);
  const tyBase = safeCoord(tgt.y, 60);

  const sy = syBase + NODE_HEADER_H + srcColIdx * COL_ROW_H + COL_ROW_H / 2 + 4;
  const ty = tyBase + NODE_HEADER_H + tgtColIdx * COL_ROW_H + COL_ROW_H / 2 + 4;

  if (src.id === tgt.id) {
    const xRight = sxBase + NODE_WIDTH;
    const d = `M ${xRight} ${sy} C ${xRight + 64} ${sy}, ${xRight + 64} ${ty - 36}, ${xRight} ${ty}`;
    return { d, sx: xRight, sy, tx: xRight, ty, sDir: 1, tDir: 1, mx: xRight + 52, my: (sy + ty) / 2 - 14 };
  }

  const srcRight = sxBase + NODE_WIDTH / 2 < txBase + NODE_WIDTH / 2;
  const sx = srcRight ? sxBase + NODE_WIDTH : sxBase;
  const tx = srcRight ? txBase : txBase + NODE_WIDTH;
  const sDir = srcRight ? 1 : -1;
  const tDir = srcRight ? -1 : 1;

  const dx = Math.max(48, Math.abs(tx - sx) * 0.45);
  const d = `M ${sx} ${sy} C ${sx + sDir * dx} ${sy}, ${tx + tDir * dx} ${ty}, ${tx} ${ty}`;
  return { d, sx, sy, tx, ty, sDir, tDir, mx: (sx + tx) / 2, my: (sy + ty) / 2 - 8 };
}

function drawCrowsFootMarker(svg: SVGElement, x: number, y: number, dir: number, isMany: boolean, color: string): void {
  const ns = 'http://www.w3.org/2000/svg';
  const line = (x1: number, y1: number, x2: number, y2: number) => {
    const l = document.createElementNS(ns, 'line');
    l.setAttribute('x1', String(x1));
    l.setAttribute('y1', String(y1));
    l.setAttribute('x2', String(x2));
    l.setAttribute('y2', String(y2));
    l.setAttribute('stroke', color);
    l.setAttribute('stroke-width', '2');
    svg.appendChild(l);
  };

  if (isMany) {
    const tipX = x + dir * 12;
    line(tipX, y, x, y - 7);
    line(tipX, y, x, y);
    line(tipX, y, x, y + 7);
    line(x + dir * 14, y - 6, x + dir * 14, y + 6);
  } else {
    line(x + dir * 6, y - 7, x + dir * 6, y + 7);
    line(x + dir * 12, y - 7, x + dir * 12, y + 7);
  }
}

function buildStandaloneSvg(model: ERModel): string {
  const pad = 48;
  let maxX = 800;
  let maxY = 500;
  let minX = Infinity;
  let minY = Infinity;
  for (const n of model.tables) {
    const nx = safeCoord(n.x, 60);
    const ny = safeCoord(n.y, 60);
    minX = Math.min(minX, nx);
    minY = Math.min(minY, ny);
    maxX = Math.max(maxX, nx + NODE_WIDTH + 64);
    maxY = Math.max(maxY, ny + nodeHeight(n) + 40);
  }
  if (!Number.isFinite(minX)) {
    minX = 0;
    minY = 0;
  }
  const ox = Math.max(0, minX - pad);
  const oy = Math.max(0, minY - pad);
  const w = Math.max(600, maxX - ox + pad);
  const h = Math.max(400, maxY - oy + pad);

  const esc = (s: string) =>
    String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');

  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${ox} ${oy} ${w} ${h}">`,
    `<rect x="${ox}" y="${oy}" width="${w}" height="${h}" fill="#f8fafc"/>`,
    `<style>text{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px} .hdr{font-family:-apple-system,Segoe UI,sans-serif;font-weight:700;font-size:13px}</style>`,
  ];

  const byId = new Map(model.tables.map((n) => [n.id, n]));
  for (const rel of model.relations) {
    const src = byId.get(rel.sourceTableId);
    const tgt = byId.get(rel.targetTableId);
    if (!src || !tgt) continue;
    const g = computeEdgeGeometry(src, tgt, rel);
    parts.push(`<path d="${g.d}" fill="none" stroke="#64748b" stroke-width="2"/>`);
    const isSrcMany = rel.cardinality === '1:N' || rel.cardinality === 'N:M';
    const isTgtMany = rel.cardinality === 'N:M';
    if (isSrcMany) {
      parts.push(`<line x1="${g.sx + g.sDir * 12}" y1="${g.sy}" x2="${g.sx}" y2="${g.sy - 6}" stroke="#64748b" stroke-width="2"/>`);
      parts.push(`<line x1="${g.sx + g.sDir * 12}" y1="${g.sy}" x2="${g.sx}" y2="${g.sy + 6}" stroke="#64748b" stroke-width="2"/>`);
    } else {
      parts.push(`<line x1="${g.sx + g.sDir * 8}" y1="${g.sy - 6}" x2="${g.sx + g.sDir * 8}" y2="${g.sy + 6}" stroke="#64748b" stroke-width="2"/>`);
    }
    if (isTgtMany) {
      parts.push(`<line x1="${g.tx + g.tDir * 12}" y1="${g.ty}" x2="${g.tx}" y2="${g.ty - 6}" stroke="#64748b" stroke-width="2"/>`);
      parts.push(`<line x1="${g.tx + g.tDir * 12}" y1="${g.ty}" x2="${g.tx}" y2="${g.ty + 6}" stroke="#64748b" stroke-width="2"/>`);
    } else {
      parts.push(`<line x1="${g.tx + g.tDir * 8}" y1="${g.ty - 6}" x2="${g.tx + g.tDir * 8}" y2="${g.ty + 6}" stroke="#64748b" stroke-width="2"/>`);
    }
    parts.push(`<text x="${g.mx}" y="${g.my}" text-anchor="middle" fill="#475569" font-size="10">${esc(rel.cardinality)}</text>`);
  }

  for (const node of model.tables) {
    const nx = safeCoord(node.x, 60);
    const ny = safeCoord(node.y, 60);
    const nh = nodeHeight(node);
    const colHex = safeColor(node.color);
    parts.push(`<g transform="translate(${nx},${ny})">`);
    parts.push(`<rect width="${NODE_WIDTH}" height="${nh}" rx="8" fill="#ffffff" stroke="#cbd5e1" stroke-width="1.5"/>`);
    parts.push(`<rect width="${NODE_WIDTH}" height="${NODE_HEADER_H}" rx="8" fill="#f1f5f9"/>`);
    parts.push(`<rect width="${NODE_WIDTH}" height="4" rx="2" fill="${colHex}"/>`);
    parts.push(`<text x="12" y="23" class="hdr" fill="#0f172a">${esc(node.name)}</text>`);
    node.columns.forEach((col, i) => {
      const cy = NODE_HEADER_H + i * COL_ROW_H + 17;
      const prefix = col.isPrimaryKey ? 'PK ' : '';
      parts.push(`<text x="12" y="${cy}" fill="${col.isPrimaryKey ? '#b45309' : '#0f172a'}">${esc(prefix + col.name)}</text>`);
      parts.push(`<text x="${NODE_WIDTH - 10}" y="${cy}" text-anchor="end" fill="#64748b">${esc(col.type)}</text>`);
    });
    parts.push(`</g>`);
  }
  parts.push('</svg>');
  return parts.join('\n');
}

function exportPngFromSvg(svgMarkup: string, filename: string): void {
  const blob = new Blob([svgMarkup], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const img = new Image();
  img.onload = () => {
    const scale = 2;
    const canvas = document.createElement('canvas');
    canvas.width = img.width * scale;
    canvas.height = img.height * scale;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.scale(scale, scale);
      ctx.fillStyle = '#f8fafc';
      ctx.fillRect(0, 0, img.width, img.height);
      ctx.drawImage(img, 0, 0);
      canvas.toBlob((pngBlob) => {
        if (pngBlob) downloadBlob(pngBlob, filename, 'image/png');
        URL.revokeObjectURL(url);
      }, 'image/png');
    } else {
      URL.revokeObjectURL(url);
    }
  };
  img.onerror = () => {
    URL.revokeObjectURL(url);
    toast('PNG出力に失敗しました', 'error');
  };
  img.src = url;
}

function openAddRelationModal(model: ERModel, container: HTMLElement): void {
  if (model.tables.length < 1) {
    toast('リレーションを作成するテーブルを追加してください', 'info');
    return;
  }

  let srcId = selectedNodeId || model.tables[0].id;
  let tgtId = model.tables.find((x) => x.id !== srcId)?.id || model.tables[0].id;
  let cardinality: ERCardinality = '1:N';
  let onDelete = 'CASCADE';
  let onUpdate = 'NO ACTION';

  openModal({
    title: t('erAddRelation'),
    renderBody: (body, close) => {
      const srcTblSel = el('select', { className: 'select' }, ...model.tables.map((n) => el('option', { value: n.id, selected: n.id === srcId }, n.name)));
      const srcColSel = el('select', { className: 'select' });
      const tgtTblSel = el('select', { className: 'select' }, ...model.tables.map((n) => el('option', { value: n.id, selected: n.id === tgtId }, n.name)));
      const tgtColSel = el('select', { className: 'select' });
      const cardSel = el(
        'select',
        { className: 'select' },
        el('option', { value: '1:N', selected: true }, '1 : N (One-to-Many)'),
        el('option', { value: '1:1' }, '1 : 1 (One-to-One)'),
        el('option', { value: 'N:M' }, 'N : M (Many-to-Many)')
      );
      const delSel = el(
        'select',
        { className: 'select' },
        ...['CASCADE', 'SET NULL', 'RESTRICT', 'NO ACTION'].map((o) => el('option', { value: o, selected: o === onDelete }, o))
      );

      const syncCols = () => {
        const sNode = model.tables.find((x) => x.id === srcTblSel.value);
        const tNode = model.tables.find((x) => x.id === tgtTblSel.value);
        srcColSel.replaceChildren(...(sNode?.columns || []).map((c) => el('option', { value: c.name }, `${c.name} (${c.type})`)));
        tgtColSel.replaceChildren(...(tNode?.columns || []).map((c) => el('option', { value: c.name, selected: c.isPrimaryKey }, `${c.name} (${c.type})`)));
      };
      srcTblSel.addEventListener('change', syncCols);
      tgtTblSel.addEventListener('change', syncCols);
      syncCols();

      body.append(
        el('p', { style: { margin: '0', color: 'var(--ink-secondary)', fontSize: '0.82rem' } }, '子テーブルの外部キーカラムから親テーブルの参照先カラムへリレーションを接続します。'),
        el('div', { className: 'field-row' }, labeledField('子テーブル (FK側)', srcTblSel), labeledField('FKカラム', srcColSel)),
        el('div', { className: 'field-row' }, labeledField('親テーブル (参照先)', tgtTblSel), labeledField('参照カラム (PK)', tgtColSel)),
        el('div', { className: 'field-row' }, labeledField('カーディナリティ', cardSel), labeledField('ON DELETE', delSel)),
        el(
          'div',
          { style: { display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '8px' } },
          el('button', { type: 'button', className: 'btn', onClick: close }, t('cancel')),
          el(
            'button',
            {
              type: 'button',
              className: 'btn btn-primary',
              onClick: () => {
                srcId = srcTblSel.value;
                tgtId = tgtTblSel.value;
                cardinality = cardSel.value as ERCardinality;
                onDelete = delSel.value;
                const sNode = model.tables.find((x) => x.id === srcId);
                const tNode = model.tables.find((x) => x.id === tgtId);
                if (!sNode || !tNode || !srcColSel.value || !tgtColSel.value) return;
                model.relations.push({
                  id: `rel-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                  name: `fk_${sNode.name}_${srcColSel.value}`,
                  sourceTableId: srcId,
                  sourceColumn: srcColSel.value,
                  targetTableId: tgtId,
                  targetColumn: tgtColSel.value,
                  cardinality,
                  onDelete,
                  onUpdate,
                });
                model.updatedAt = Date.now();
                store.saveErModel(model);
                close();
                renderErDiagramView(container);
              },
            },
            t('erAddRelation')
          )
        )
      );
    },
  });
}

let fittedModelId: string | null = null;

export function renderErDiagramView(container: HTMLElement): void {
  if (!store.activeErModel) {
    if (store.schema && store.schema.tables.length > 0) {
      store.activeErModel = reverseEngineerFromSchema(store.schema);
    } else if (store.erModels.length > 0) {
      store.activeErModel = structuredClone(store.erModels[0]);
    } else {
      store.activeErModel = {
        id: `er-new-${Date.now()}`,
        name: 'New ER Diagram',
        dialect: store.activeConnection?.dialect || 'postgresql',
        tables: [
          {
            id: 'tbl-users',
            name: 'users',
            x: 80,
            y: 80,
            color: NODE_COLORS[0],
            columns: [
              makeColumn({ name: 'id', type: 'INTEGER', isPrimaryKey: true, isAutoIncrement: true, nullable: false }),
              makeColumn({ name: 'email', type: 'VARCHAR(255)', nullable: false, isUnique: true }),
              makeColumn({ name: 'name', type: 'TEXT', nullable: false }),
            ],
          },
        ],
        relations: [],
        updatedAt: Date.now(),
      };
    }
  }

  const model = store.activeErModel;
  const activeDialect = targetDdlDialect || store.activeConnection?.dialect || model.dialect || 'sqlite';

  const dialectSel = el(
    'select',
    {
      className: 'select select-sm',
      style: { width: 'auto' },
      'aria-label': 'DDLターゲット方言',
      onChange: (e: Event) => {
        targetDdlDialect = (e.target as HTMLSelectElement).value as DbDialect;
      },
    },
    ...(['sqlite', 'mysql', 'mariadb', 'postgresql', 'd1'] as DbDialect[]).map((d) =>
      el('option', { value: d, selected: d === activeDialect }, `DDL: ${d.toUpperCase()}`)
    )
  );

  // Top ER Toolbar
  const toolbar = el(
    'div',
    { className: 'pane-toolbar' },
    el(
      'div',
      { className: 'toolbar-group' },
      el(
        'button',
        {
          type: 'button',
          className: 'btn btn-sm btn-primary',
          onClick: () => {
            if (!store.schema) {
              toast('DBに接続してください', 'error');
              return;
            }
            store.activeErModel = reverseEngineerFromSchema(store.schema);
            selectedNodeId = null;
            selectedEdgeId = null;
            panX = 36;
            panY = 36;
            zoom = 1;
            toast('現在のデータベースからER図をリバース生成しました', 'success');
            renderErDiagramView(container);
          },
        },
        icon('refresh', 13),
        t('erReverse')
      ),
      el(
        'button',
        {
          type: 'button',
          className: 'btn btn-sm',
          onClick: () => {
            const idx = model.tables.length + 1;
            const newNode: ERTableNode = {
              id: `tbl-${Date.now()}`,
              name: `new_table_${idx}`,
              x: Math.max(16, Math.round((120 - panX) / zoom / 16) * 16 + (idx % 4) * 32),
              y: Math.max(16, Math.round((100 - panY) / zoom / 16) * 16 + (idx % 4) * 32),
              color: NODE_COLORS[idx % NODE_COLORS.length],
              columns: [
                makeColumn({ name: 'id', type: 'INTEGER', isPrimaryKey: true, isAutoIncrement: true, nullable: false }),
                makeColumn({ name: 'name', type: 'TEXT', nullable: false }),
                makeColumn({ name: 'created_at', type: 'DATETIME', nullable: false, defaultValue: 'CURRENT_TIMESTAMP' }),
              ],
            };
            model.tables.push(newNode);
            selectedNodeId = newNode.id;
            selectedEdgeId = null;
            store.saveErModel(model);
            renderErDiagramView(container);
          },
        },
        icon('plus', 13),
        t('erAddTable')
      ),
      el('button', { type: 'button', className: 'btn btn-sm', onClick: () => openAddRelationModal(model, container) }, icon('link', 13), t('erAddRelation')),
      el(
        'button',
        {
          type: 'button',
          className: 'btn btn-sm',
          onClick: () => {
            autoLayoutModel(model);
            fitToViewport();
            renderErDiagramView(container);
          },
        },
        icon('layout', 13),
        t('erAutoLayout')
      )
    ),
    el(
      'div',
      { className: 'toolbar-group' },
      dialectSel,
      el(
        'button',
        {
          type: 'button',
          className: 'btn btn-sm btn-primary',
          onClick: async () => {
            const d = (dialectSel.value as DbDialect) || activeDialect;
            const ddl = generateModelDdl(model, d);
            openModal({
              title: `${t('erForward')} (${d.toUpperCase()})`,
              large: true,
              renderBody: (b) => {
                b.append(
                  el('p', { style: { margin: '0', color: 'var(--ink-secondary)' } }, 'ER図からフォワードエンジニアリングで生成されたDDLです。コピー、SQLエディタで開く、または接続中DBへ直接適用できます。'),
                  el('pre', { className: 'code-block' }, ddl)
                );
              },
              renderFooter: (f, close) => {
                f.append(
                  el('button', { type: 'button', className: 'btn', onClick: () => copyToClipboard(ddl) }, icon('copy', 13), 'Copy DDL'),
                  el(
                    'button',
                    {
                      type: 'button',
                      className: 'btn',
                      onClick: () => {
                        close();
                        store.openSqlWithQuery(ddl);
                      },
                    },
                    icon('code', 13),
                    'SQLエディタで開く'
                  ),
                  el(
                    'button',
                    {
                      type: 'button',
                      className: 'btn btn-primary',
                      onClick: async () => {
                        if (!store.adapter) {
                          toast('DBに接続してください', 'error');
                          return;
                        }
                        const ok = await confirmSqlModal({
                          title: 'フォワードエンジニアリングDDLを実行',
                          description: '接続中のデータベースにテーブルを作成します。',
                          sql: ddl,
                          danger: false,
                        });
                        if (!ok) return;
                        try {
                          const stmts = splitSqlStatements(ddl);
                          for (const s of stmts) {
                            await store.adapter.query(s);
                          }
                          await store.refreshSchema();
                          close();
                          toast(`${stmts.length} 件のDDLを実行しました`, 'success');
                        } catch (err) {
                          toast(err instanceof Error ? err.message : String(err), 'error', 5000);
                        }
                      },
                    },
                    icon('play', 13),
                    'DBへ適用'
                  )
                );
              },
            });
          },
        },
        icon('sparkles', 13),
        t('erForward')
      ),
      el('button', { type: 'button', className: 'btn btn-sm', onClick: () => downloadBlob(buildStandaloneSvg(model), `${model.name.replace(/\s+/g, '_')}.svg`, 'image/svg+xml') }, 'SVG'),
      el('button', { type: 'button', className: 'btn btn-sm', onClick: () => exportPngFromSvg(buildStandaloneSvg(model), `${model.name.replace(/\s+/g, '_')}.png`) }, 'PNG'),
      el(
        'button',
        {
          type: 'button',
          className: 'btn btn-sm hide-sm',
          onClick: () => {
            const schemas = modelToTableSchemas(model);
            const byId = new Map(model.tables.map((n) => [n.id, n]));
            const rels = model.relations
              .map((r) => ({
                fromTable: byId.get(r.sourceTableId)?.name || '',
                toTable: byId.get(r.targetTableId)?.name || '',
                label: r.sourceColumn,
                cardinality: r.cardinality,
              }))
              .filter((r) => r.fromTable && r.toTable);
            copyToClipboard(buildMermaidEr(schemas, rels));
          },
        },
        'Mermaid'
      ),
      el('button', { type: 'button', className: 'btn btn-sm hide-sm', onClick: () => copyToClipboard(buildDbml(modelToTableSchemas(model))) }, 'DBML'),
      el(
        'button',
        {
          type: 'button',
          className: 'btn btn-sm hide-sm',
          onClick: () => {
            store.saveErModel({ ...model, updatedAt: Date.now() });
            downloadBlob(JSON.stringify(model, null, 2), `${model.name.replace(/\s+/g, '_')}.er.json`, 'application/json');
            toast('ERモデルを保存＆エクスポートしました', 'success');
          },
        },
        t('erSaveModel')
      )
    )
  );

  // Dynamically size SVG/stage bounds so large schemas never clip (M2)
  let stageW = 3200;
  let stageH = 2200;
  for (const n of model.tables) {
    stageW = Math.max(stageW, safeCoord(n.x, 60) + NODE_WIDTH + 400);
    stageH = Math.max(stageH, safeCoord(n.y, 60) + nodeHeight(n) + 400);
  }

  const viewport = el('div', { className: 'er-viewport', role: 'region', 'aria-label': 'ER図インタラクティブキャンバス' });
  const stage = el('div', { className: 'er-stage', style: { width: `${stageW}px`, height: `${stageH}px` } });
  const ns = 'http://www.w3.org/2000/svg';
  const svgLayer = document.createElementNS(ns, 'svg');
  svgLayer.setAttribute('class', 'er-svg-layer');
  svgLayer.setAttribute('width', String(stageW));
  svgLayer.setAttribute('height', String(stageH));
  svgLayer.style.width = `${stageW}px`;
  svgLayer.style.height = `${stageH}px`;
  stage.append(svgLayer);

  const zoomPct = el('span', { className: 'mono', style: { fontSize: '0.75rem', padding: '0 6px' } }, `${Math.round(zoom * 100)}%`);

  const applyTransform = () => {
    stage.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
    zoomPct.textContent = `${Math.round(zoom * 100)}%`;
  };

  // True bounding-box Fit View (M2)
  const fitToViewport = () => {
    if (model.tables.length === 0) {
      zoom = 1;
      panX = 36;
      panY = 36;
      applyTransform();
      return;
    }
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const n of model.tables) {
      minX = Math.min(minX, n.x);
      minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x + NODE_WIDTH);
      maxY = Math.max(maxY, n.y + nodeHeight(n));
    }
    const vw = viewport.clientWidth || 720;
    const vh = viewport.clientHeight || 480;
    const pad = 40;
    const bw = Math.max(100, maxX - minX);
    const bh = Math.max(100, maxY - minY);
    zoom = Math.min(1.2, Math.max(0.35, Math.min((vw - pad * 2) / bw, (vh - pad * 2) / bh)));
    panX = Math.round((vw - bw * zoom) / 2 - minX * zoom);
    panY = Math.round((vh - bh * zoom) / 2 - minY * zoom);
    applyTransform();
  };

  const renderEdges = () => {
    svgLayer.replaceChildren();
    const byId = new Map(model.tables.map((n) => [n.id, n]));
    for (const rel of model.relations) {
      const src = byId.get(rel.sourceTableId);
      const tgt = byId.get(rel.targetTableId);
      if (!src || !tgt) continue;
      const g = computeEdgeGeometry(src, tgt, rel);
      const isSel = selectedEdgeId === rel.id;
      const strokeColor = isSel ? 'var(--accent)' : 'var(--border-strong)';

      const path = document.createElementNS(ns, 'path');
      path.setAttribute('d', g.d);
      path.setAttribute('class', `er-rel-path ${isSel ? 'selected' : ''}`);
      path.addEventListener('click', (e) => {
        e.stopPropagation();
        selectedEdgeId = rel.id;
        selectedNodeId = null;
        renderErDiagramView(container);
      });
      svgLayer.appendChild(path);

      drawCrowsFootMarker(svgLayer, g.sx, g.sy, g.sDir, rel.cardinality === '1:N' || rel.cardinality === 'N:M', strokeColor);
      drawCrowsFootMarker(svgLayer, g.tx, g.ty, g.tDir, rel.cardinality === 'N:M', strokeColor);

      const label = document.createElementNS(ns, 'text');
      label.setAttribute('x', String(g.mx));
      label.setAttribute('y', String(g.my));
      label.setAttribute('text-anchor', 'middle');
      label.setAttribute('fill', 'var(--ink-muted)');
      label.setAttribute('font-size', '11');
      label.setAttribute('font-family', 'var(--font-mono)');
      label.textContent = `${rel.cardinality} (${rel.sourceColumn})`;
      svgLayer.appendChild(label);
    }
  };

  const fkColsByNode = new Map<string, Set<string>>();
  for (const r of model.relations) {
    const s = fkColsByNode.get(r.sourceTableId) || new Set();
    s.add(r.sourceColumn);
    fkColsByNode.set(r.sourceTableId, s);
  }

  for (const node of model.tables) {
    const nodeFkCols = fkColsByNode.get(node.id) || new Set<string>();
    let justDragged = false;

    const card = el('div', {
      className: `er-node ${selectedNodeId === node.id ? 'selected' : ''}`,
      style: { left: `${node.x}px`, top: `${node.y}px`, '--node-color': safeColor(node.color) } as Record<string, string>,
      onClick: (e: Event) => {
        e.stopPropagation();
        if (justDragged) {
          justDragged = false;
          return;
        }
        selectedNodeId = node.id;
        selectedEdgeId = null;
        renderErDiagramView(container);
      },
    });

    const head = el(
      'div',
      { className: 'er-node-head' },
      el('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, node.name),
      el('span', { className: 'badge' }, `${node.columns.length}`)
    );

    head.addEventListener('pointerdown', (e: PointerEvent) => {
      e.stopPropagation();
      head.setPointerCapture(e.pointerId);
      const startX = e.clientX;
      const startY = e.clientY;
      const origX = node.x;
      const origY = node.y;
      let moved = false;

      const onMove = (me: PointerEvent) => {
        const dx = (me.clientX - startX) / zoom;
        const dy = (me.clientY - startY) / zoom;
        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) moved = true;
        node.x = Math.max(16, Math.round((origX + dx) / 16) * 16);
        node.y = Math.max(16, Math.round((origY + dy) / 16) * 16);
        card.style.left = `${node.x}px`;
        card.style.top = `${node.y}px`;
        renderEdges();
      };
      const cleanup = () => {
        head.removeEventListener('pointermove', onMove);
        head.removeEventListener('pointerup', cleanup);
        head.removeEventListener('pointercancel', cleanup);
        if (moved) {
          justDragged = true;
          store.saveErModel({ ...model, updatedAt: Date.now() });
        }
      };
      head.addEventListener('pointermove', onMove);
      head.addEventListener('pointerup', cleanup);
      head.addEventListener('pointercancel', cleanup);
    });

    const colsList = el('div', { className: 'er-node-cols' });
    for (const col of node.columns) {
      const isFk = nodeFkCols.has(col.name);
      colsList.append(
        el(
          'div',
          { className: 'er-col-row' },
          el(
            'span',
            { className: 'er-col-name' },
            col.isPrimaryKey ? el('span', { className: 'badge badge-pk' }, 'PK') : null,
            isFk ? el('span', { className: 'badge badge-fk' }, 'FK') : null,
            el('span', { style: { fontWeight: col.isPrimaryKey ? '700' : '400' } }, col.name),
            !col.nullable && !col.isPrimaryKey ? el('span', { style: { color: 'var(--danger)' }, title: 'NOT NULL' }, '*') : null
          ),
          el('span', { className: 'er-col-type' }, col.type)
        )
      );
    }

    card.append(head, colsList);
    stage.append(card);
  }

  renderEdges();

  // Panning, empty-canvas deselect, and pointer-centered wheel zoom (M2)
  viewport.addEventListener('pointerdown', (e: PointerEvent) => {
    if ((e.target as HTMLElement).closest('.er-node') || (e.target as HTMLElement).closest('.er-zoom-hud')) return;
    viewport.classList.add('panning');
    const startX = e.clientX;
    const startY = e.clientY;
    const origPanX = panX;
    const origPanY = panY;
    let moved = false;

    const onMove = (me: PointerEvent) => {
      const dx = me.clientX - startX;
      const dy = me.clientY - startY;
      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) moved = true;
      panX = origPanX + dx;
      panY = origPanY + dy;
      applyTransform();
    };
    const cleanup = () => {
      viewport.classList.remove('panning');
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', cleanup);
      window.removeEventListener('pointercancel', cleanup);
      if (!moved && (selectedNodeId || selectedEdgeId)) {
        selectedNodeId = null;
        selectedEdgeId = null;
        renderErDiagramView(container);
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', cleanup);
    window.addEventListener('pointercancel', cleanup);
  });

  viewport.addEventListener(
    'wheel',
    (e: WheelEvent) => {
      e.preventDefault();
      const rect = viewport.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const factor = e.deltaY < 0 ? 1.08 : 0.92;
      const nextZoom = Math.min(2, Math.max(0.35, zoom * factor));
      panX = mx - ((mx - panX) / zoom) * nextZoom;
      panY = my - ((my - panY) / zoom) * nextZoom;
      zoom = nextZoom;
      applyTransform();
    },
    { passive: false }
  );

  const zoomHud = el(
    'div',
    { className: 'er-zoom-hud' },
    el('button', { type: 'button', className: 'btn btn-ghost btn-sm', 'aria-label': '縮小', onClick: () => { zoom = Math.max(0.35, zoom - 0.15); applyTransform(); } }, icon('zoomOut', 14)),
    zoomPct,
    el('button', { type: 'button', className: 'btn btn-ghost btn-sm', 'aria-label': '拡大', onClick: () => { zoom = Math.min(2, zoom + 0.15); applyTransform(); } }, icon('zoomIn', 14)),
    el('button', { type: 'button', className: 'btn btn-ghost btn-sm', title: t('erFitView'), 'aria-label': t('erFitView'), onClick: fitToViewport }, icon('maximize', 14))
  );

  viewport.append(stage, zoomHud);
  applyTransform();

  // Right Inspector Panel
  const inspector = el('aside', { className: 'er-inspector', 'aria-label': 'ERモデルインスペクタ' });
  const selNode = model.tables.find((n) => n.id === selectedNodeId);
  const selEdge = model.relations.find((r) => r.id === selectedEdgeId);

  if (selNode) {
    const nameInp = el('input', {
      type: 'text',
      className: 'input input-sm mono',
      value: selNode.name,
      onChange: (e: Event) => {
        selNode.name = (e.target as HTMLInputElement).value.trim() || selNode.name;
        store.saveErModel(model);
        renderErDiagramView(container);
      },
    });

    const colorPicker = el(
      'div',
      { style: { display: 'flex', flexWrap: 'wrap', gap: '8px' } },
      ...NODE_COLORS.map((c) =>
        el('button', {
          type: 'button',
          'aria-label': `ヘッダー色 ${c}`,
          style: {
            width: '28px',
            height: '28px',
            borderRadius: '50%',
            border: selNode.color === c ? '2px solid var(--ink-primary)' : '1px solid var(--border-default)',
            background: c,
            cursor: 'pointer',
          },
          onClick: () => {
            selNode.color = c;
            store.saveErModel(model);
            renderErDiagramView(container);
          },
        })
      )
    );

    const colEditorList = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } });
    const typeOptions = getDataTypesForDialect(activeDialect);

    selNode.columns.forEach((col, cIdx) => {
      const cName = el('input', {
        type: 'text',
        className: 'input input-sm mono',
        value: col.name,
        'aria-label': 'カラム名',
        onChange: (e: Event) => {
          const oldName = col.name;
          const nextName = (e.target as HTMLInputElement).value.trim() || oldName;
          col.name = nextName;
          // Keep ER relations synced when column is renamed (M2)
          for (const rel of model.relations) {
            if (rel.sourceTableId === selNode.id && rel.sourceColumn === oldName) rel.sourceColumn = nextName;
            if (rel.targetTableId === selNode.id && rel.targetColumn === oldName) rel.targetColumn = nextName;
          }
          store.saveErModel(model);
          renderErDiagramView(container);
        },
      });
      const cType = el(
        'select',
        {
          className: 'select select-sm mono',
          'aria-label': 'データ型',
          onChange: (e: Event) => {
            col.type = (e.target as HTMLSelectElement).value;
            store.saveErModel(model);
            renderErDiagramView(container);
          },
        },
        ...Array.from(new Set([col.type, ...typeOptions])).map((tp) => el('option', { value: tp, selected: tp === col.type }, tp))
      );

      colEditorList.append(
        el(
          'div',
          { className: 'card', style: { padding: '8px', display: 'flex', flexDirection: 'column', gap: '6px' } },
          el('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px' } }, cName, cType),
          el(
            'div',
            { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '0.72rem' } },
            el(
              'label',
              { style: { display: 'inline-flex', gap: '3px', alignItems: 'center' } },
              el('input', {
                type: 'checkbox',
                checked: col.isPrimaryKey,
                onChange: (e: Event) => {
                  col.isPrimaryKey = (e.target as HTMLInputElement).checked;
                  if (col.isPrimaryKey) col.nullable = false;
                  store.saveErModel(model);
                  renderErDiagramView(container);
                },
              }),
              'PK'
            ),
            el(
              'label',
              { style: { display: 'inline-flex', gap: '3px', alignItems: 'center' } },
              el('input', {
                type: 'checkbox',
                checked: !col.nullable,
                onChange: (e: Event) => {
                  col.nullable = !(e.target as HTMLInputElement).checked;
                  store.saveErModel(model);
                  renderErDiagramView(container);
                },
              }),
              'NN'
            ),
            el(
              'label',
              { style: { display: 'inline-flex', gap: '3px', alignItems: 'center' } },
              el('input', {
                type: 'checkbox',
                checked: col.isAutoIncrement,
                onChange: (e: Event) => {
                  col.isAutoIncrement = (e.target as HTMLInputElement).checked;
                  store.saveErModel(model);
                  renderErDiagramView(container);
                },
              }),
              'AI'
            ),
            el(
              'button',
              {
                type: 'button',
                className: 'btn btn-ghost btn-sm',
                style: { color: 'var(--danger)', padding: '2px 6px', minHeight: '28px', minWidth: '28px' },
                'aria-label': `カラム ${col.name} を削除`,
                onClick: () => {
                  const removed = col.name;
                  selNode.columns.splice(cIdx, 1);
                  // Remove orphaned relations referencing deleted column (M2)
                  model.relations = model.relations.filter(
                    (r) =>
                      !(r.sourceTableId === selNode.id && r.sourceColumn === removed) &&
                      !(r.targetTableId === selNode.id && r.targetColumn === removed)
                  );
                  store.saveErModel(model);
                  renderErDiagramView(container);
                },
              },
              icon('trash', 12)
            )
          )
        )
      );
    });

    inspector.append(
      el(
        'div',
        { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
        el('strong', {}, 'テーブル編集'),
        el(
          'button',
          {
            type: 'button',
            className: 'btn btn-sm btn-danger',
            onClick: () => {
              model.tables = model.tables.filter((n) => n.id !== selNode.id);
              model.relations = model.relations.filter((r) => r.sourceTableId !== selNode.id && r.targetTableId !== selNode.id);
              selectedNodeId = null;
              store.saveErModel(model);
              renderErDiagramView(container);
            },
          },
          icon('trash', 12),
          '削除'
        )
      ),
      labeledField('テーブル名', nameInp),
      el('div', { className: 'field' }, el('span', { className: 'label' }, 'ヘッダー色'), colorPicker),
      el(
        'div',
        { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
        el('strong', { style: { fontSize: '0.8rem' } }, `カラム (${selNode.columns.length})`),
        el(
          'button',
          {
            type: 'button',
            className: 'btn btn-sm',
            onClick: () => {
              selNode.columns.push(makeColumn({ name: `col_${selNode.columns.length + 1}`, type: 'TEXT', nullable: true }));
              store.saveErModel(model);
              renderErDiagramView(container);
            },
          },
          icon('plus', 12),
          '追加'
        )
      ),
      colEditorList
    );
  } else if (selEdge) {
    const byId = new Map(model.tables.map((n) => [n.id, n]));
    const srcName = byId.get(selEdge.sourceTableId)?.name || '';
    const tgtName = byId.get(selEdge.targetTableId)?.name || '';
    const cardSel = el(
      'select',
      {
        className: 'select select-sm',
        onChange: (e: Event) => {
          selEdge.cardinality = (e.target as HTMLSelectElement).value as ERCardinality;
          store.saveErModel(model);
          renderErDiagramView(container);
        },
      },
      ...(['1:N', '1:1', 'N:M'] as ERCardinality[]).map((c) => el('option', { value: c, selected: c === selEdge.cardinality }, c))
    );
    const delSel = el(
      'select',
      {
        className: 'select select-sm',
        onChange: (e: Event) => {
          selEdge.onDelete = (e.target as HTMLSelectElement).value;
          store.saveErModel(model);
        },
      },
      ...['CASCADE', 'SET NULL', 'RESTRICT', 'NO ACTION'].map((o) => el('option', { value: o, selected: o === selEdge.onDelete }, o))
    );
    inspector.append(
      el('strong', {}, 'リレーション編集'),
      el('div', { className: 'mono', style: { fontSize: '0.78rem' } }, `${srcName}.${selEdge.sourceColumn} → ${tgtName}.${selEdge.targetColumn}`),
      labeledField('カーディナリティ', cardSel),
      labeledField('ON DELETE', delSel),
      el(
        'button',
        {
          type: 'button',
          className: 'btn btn-sm btn-danger',
          onClick: () => {
            model.relations = model.relations.filter((r) => r.id !== selEdge.id);
            selectedEdgeId = null;
            store.saveErModel(model);
            renderErDiagramView(container);
          },
        },
        icon('trash', 12),
        'リレーションを削除'
      )
    );
  } else {
    const importInp = el('input', {
      type: 'file',
      accept: '.json',
      className: 'input input-sm',
      onChange: async (e: Event) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (!file) return;
        try {
          const loaded = sanitizeImportedErModel(JSON.parse(await file.text()));
          store.saveErModel(loaded);
          toast('ERモデルを読み込みました', 'success');
          renderErDiagramView(container);
        } catch (err) {
          toast(err instanceof Error ? err.message : String(err), 'error');
        }
      },
    });

    const savedModelsSel =
      store.erModels.length > 0
        ? labeledField(
            '保存済みERモデルを開く',
            el(
              'select',
              {
                className: 'select select-sm',
                onChange: (e: Event) => {
                  const found = store.erModels.find((m) => m.id === (e.target as HTMLSelectElement).value);
                  if (found) {
                    store.activeErModel = structuredClone(found);
                    selectedNodeId = null;
                    selectedEdgeId = null;
                    renderErDiagramView(container);
                  }
                },
              },
              el('option', { value: '' }, '選択してください...'),
              ...store.erModels.map((m) => el('option', { value: m.id, selected: m.id === model.id }, `${m.name} (${m.tables.length}T)`))
            )
          )
        : null;

    inspector.append(
      el('strong', {}, 'ER図モデル概要'),
      el('div', { style: { fontSize: '0.8rem', color: 'var(--ink-secondary)' } }, `テーブル数: ${model.tables.length} / リレーション数: ${model.relations.length}`),
      el('p', { style: { fontSize: '0.78rem', color: 'var(--ink-muted)', margin: '0' } }, 'テーブルカードをドラッグして配置を調整、クリックしてカラム編集、リレーション線をクリックしてカーディナリティを編集できます。ホイールでカーソル位置中心の拡大縮小、背景ドラッグでパン可能です。')
    );
    if (savedModelsSel) inspector.append(savedModelsSel);
    inspector.append(labeledField('ERモデルJSONを読み込む', importInp));
  }

  container.replaceChildren(
    el('div', { className: 'er-shell' }, toolbar, el('div', { className: 'er-workspace' }, viewport, inspector))
  );

  if (fittedModelId !== model.id) {
    fittedModelId = model.id;
    requestAnimationFrame(() => fitToViewport());
  }
}
