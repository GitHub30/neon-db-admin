import type { QueryResult } from '../types/db.js';
import { el } from './dom.js';

type ChartKind = 'bar' | 'line' | 'pie';

const PALETTE = ['#0f766e', '#0284c7', '#d97706', '#15803d', '#dc2626', '#0d9488', '#0369a1', '#b45309'];

function svgEl(tag: string, attrs: Record<string, string | number> = {}, text?: string): SVGElement {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) {
    node.setAttribute(k, String(v));
  }
  if (text !== undefined) node.textContent = text;
  return node;
}

export function renderResultChart(container: HTMLElement, result: QueryResult): void {
  container.replaceChildren();
  if (result.columns.length < 2 || result.rows.length === 0) {
    container.append(
      el('div', { className: 'empty-state' }, 'チャートを描画するには2列以上（ラベル列と数値列）の結果が必要です。')
    );
    return;
  }

  const numericCols = result.columns
    .map((c, idx) => ({ name: c.name, idx }))
    .filter(({ idx }) =>
      result.rows.slice(0, 50).some((r) => r[idx] !== null && r[idx] !== '' && Number.isFinite(Number(r[idx])))
    );

  if (numericCols.length === 0) {
    container.append(el('div', { className: 'empty-state' }, '数値カラムが見つかりませんでした。'));
    return;
  }

  let kind: ChartKind = 'bar';
  let labelColIdx = 0;
  let valueColIdx = numericCols.find((c) => c.idx !== 0)?.idx ?? numericCols[0].idx;

  const chartHost = el('div', { className: 'chart-wrap' });
  const kindSel = el(
    'select',
    { className: 'select select-sm', style: { width: 'auto' }, 'aria-label': 'チャート種類' },
    el('option', { value: 'bar' }, '棒グラフ (Bar)'),
    el('option', { value: 'line' }, '折れ線グラフ (Line)'),
    el('option', { value: 'pie' }, '円グラフ (Pie)')
  );
  const labelSel = el(
    'select',
    { className: 'select select-sm', style: { width: 'auto' }, 'aria-label': 'ラベル列' },
    ...result.columns.map((c, i) => el('option', { value: String(i), selected: i === labelColIdx }, `X: ${c.name}`))
  );
  const valSel = el(
    'select',
    { className: 'select select-sm', style: { width: 'auto' }, 'aria-label': '数値列' },
    ...numericCols.map((c) => el('option', { value: String(c.idx), selected: c.idx === valueColIdx }, `Y: ${c.name}`))
  );

  const svgContainer = el('div');

  const draw = () => {
    svgContainer.replaceChildren();
    const items = result.rows.slice(0, 30).map((r) => ({
      label: String(r[labelColIdx] ?? 'NULL').slice(0, 22),
      value: Number(r[valueColIdx]) || 0,
    }));

    const W = 760;
    const H = 300;
    const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart-svg', role: 'img', 'aria-label': 'Query result chart' });

    if (kind === 'pie') {
      const total = items.reduce((sum, d) => sum + Math.max(0, d.value), 0) || 1;
      const cx = 190;
      const cy = 150;
      const r = 115;
      let startAngle = -Math.PI / 2;

      items.slice(0, 10).forEach((item, i) => {
        const val = Math.max(0, item.value);
        const angle = (val / total) * Math.PI * 2;
        const color = PALETTE[i % PALETTE.length];
        if (angle >= Math.PI * 2 - 1e-6) {
          const circ = svgEl('circle', { cx, cy, r, fill: color, stroke: 'var(--bg-surface)', 'stroke-width': 2 });
          circ.appendChild(svgEl('title', {}, `${item.label}: ${item.value.toLocaleString()}`));
          svg.appendChild(circ);
        } else if (angle > 0) {
          const endAngle = startAngle + angle;
          const x1 = cx + r * Math.cos(startAngle);
          const y1 = cy + r * Math.sin(startAngle);
          const x2 = cx + r * Math.cos(endAngle);
          const y2 = cy + r * Math.sin(endAngle);
          const largeArc = angle > Math.PI ? 1 : 0;
          const d = `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2} Z`;
          const slice = svgEl('path', { d, fill: color, stroke: 'var(--bg-surface)', 'stroke-width': 2 });
          slice.appendChild(svgEl('title', {}, `${item.label}: ${item.value.toLocaleString()}`));
          svg.appendChild(slice);
          startAngle = endAngle;
        }

        // Legend
        const ly = 36 + i * 24;
        svg.appendChild(svgEl('rect', { x: 350, y: ly - 10, width: 12, height: 12, rx: 3, fill: color }));
        svg.appendChild(
          svgEl(
            'text',
            { x: 370, y: ly, fill: 'var(--ink-primary)', 'font-size': 12 },
            `${item.label} (${item.value.toLocaleString()} / ${Math.round((val / total) * 100)}%)`
          )
        );
      });
    } else {
      const padL = 68;
      const padR = 20;
      const padT = 20;
      const padB = 56;
      const plotW = W - padL - padR;
      const plotH = H - padT - padB;
      const rawMax = Math.max(...items.map((d) => d.value), 0);
      const minVal = Math.min(...items.map((d) => d.value), 0);
      const maxVal = rawMax === minVal ? minVal + 1 : rawMax;
      const range = maxVal - minVal || 1;
      const formatTick = (v: number) => (Math.abs(range) < 10 ? v.toFixed(2) : Math.round(v).toLocaleString());

      // Grid lines
      for (let step = 0; step <= 4; step++) {
        const y = padT + (plotH * step) / 4;
        const v = maxVal - (range * step) / 4;
        svg.appendChild(svgEl('line', { x1: padL, y1: y, x2: W - padR, y2: y, stroke: 'var(--border-subtle)', 'stroke-width': 1 }));
        svg.appendChild(
          svgEl(
            'text',
            { x: padL - 8, y: y + 4, 'text-anchor': 'end', fill: 'var(--ink-muted)', 'font-size': 11 },
            formatTick(v)
          )
        );
      }

      const stepW = plotW / Math.max(items.length, 1);

      if (kind === 'bar') {
        const barW = Math.max(8, Math.min(48, stepW * 0.65));
        items.forEach((item, i) => {
          const x = padL + i * stepW + (stepW - barW) / 2;
          const h = ((item.value - minVal) / range) * plotH;
          const y = padT + plotH - h;
          const rect = svgEl('rect', { x, y, width: barW, height: Math.max(2, h), rx: 3, fill: 'var(--accent)' });
          rect.appendChild(svgEl('title', {}, `${item.label}: ${item.value.toLocaleString()}`));
          svg.appendChild(rect);
        });
      } else {
        const pts = items.map((item, i) => {
          const x = padL + i * stepW + stepW / 2;
          const y = padT + plotH - ((item.value - minVal) / range) * plotH;
          return { x, y, item };
        });
        const pathD = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
        svg.appendChild(svgEl('path', { d: pathD, fill: 'none', stroke: 'var(--accent)', 'stroke-width': 2.5 }));
        for (const p of pts) {
          const c = svgEl('circle', { cx: p.x, cy: p.y, r: 4, fill: 'var(--accent)', stroke: 'var(--bg-surface)', 'stroke-width': 2 });
          c.appendChild(svgEl('title', {}, `${p.item.label}: ${p.item.value.toLocaleString()}`));
          svg.appendChild(c);
        }
      }

      // X labels
      const labelStep = Math.max(1, Math.ceil(items.length / 10));
      items.forEach((item, i) => {
        if (i % labelStep !== 0) return;
        const x = padL + i * stepW + stepW / 2;
        svg.appendChild(
          svgEl(
            'text',
            { x, y: H - 24, 'text-anchor': 'middle', fill: 'var(--ink-secondary)', 'font-size': 11 },
            item.label.slice(0, 12)
          )
        );
      });
    }

    svgContainer.append(svg);
  };

  kindSel.addEventListener('change', () => {
    kind = kindSel.value as ChartKind;
    draw();
  });
  labelSel.addEventListener('change', () => {
    labelColIdx = Number(labelSel.value);
    draw();
  });
  valSel.addEventListener('change', () => {
    valueColIdx = Number(valSel.value);
    draw();
  });

  chartHost.append(
    el('div', { className: 'toolbar-group' }, kindSel, labelSel, valSel),
    svgContainer
  );
  container.append(chartHost);
  draw();
}
