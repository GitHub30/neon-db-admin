export type IconName =
  | 'database'
  | 'table'
  | 'eye'
  | 'zap'
  | 'play'
  | 'code'
  | 'diagram'
  | 'upload'
  | 'download'
  | 'wrench'
  | 'plus'
  | 'trash'
  | 'refresh'
  | 'search'
  | 'sun'
  | 'moon'
  | 'monitor'
  | 'menu'
  | 'close'
  | 'copy'
  | 'check'
  | 'filter'
  | 'key'
  | 'link'
  | 'edit'
  | 'chart'
  | 'server'
  | 'shield'
  | 'command'
  | 'sparkles'
  | 'diff'
  | 'bookmark'
  | 'clock'
  | 'layout'
  | 'zoomIn'
  | 'zoomOut'
  | 'maximize'
  | 'globe'
  | 'chevronDown'
  | 'chevronRight';

const PATHS: Record<IconName, string> = {
  database: 'M12 3C7.58 3 4 4.34 4 6v12c0 1.66 3.58 3 8 3s8-1.34 8-3V6c0-1.66-3.58-3-8-3zm0 2c3.87 0 6 .96 6 1s-2.13 1-6 1-6-.96-6-1 2.13-1 6-1zm0 14c-3.87 0-6-.96-6-1v-3.1c1.47.69 3.63 1.1 6 1.1s4.53-.41 6-1.1V18c0 .04-2.13 1-6 1zm0-5c-3.87 0-6-.96-6-1V9.9c1.47.69 3.63 1.1 6 1.1s4.53-.41 6-1.1V13c0 .04-2.13 1-6 1z',
  table: 'M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5zm2 4v3h5V9H5zm7 0v3h7V9h-7zm-7 5v5h5v-5H5zm7 0v5h7v-5h-7zM5 5v2h14V5H5z',
  eye: 'M12 5C6.5 5 2 12 2 12s4.5 7 10 7 10-7 10-7-4.5-7-10-7zm0 11a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm0-6a2 2 0 1 0 0 4 2 2 0 0 0 0-4z',
  zap: 'M13 2L3 14h7l-1 8 10-12h-7l1-8z',
  play: 'M6 4l14 8-14 8V4z',
  code: 'M8.7 16.3L4.4 12l4.3-4.3L7.3 6.3 1.6 12l5.7 5.7 1.4-1.4zm6.6 0l4.3-4.3-4.3-4.3 1.4-1.4 5.7 5.7-5.7 5.7-1.4-1.4zM13.8 4l-3.6 16h2l3.6-16h-2z',
  diagram: 'M3 3h7v6H3V3zm11 0h7v6h-7V3zM8 15h8v6H8v-6zM6.5 9v3h11V9m-5.5 3v3',
  upload: 'M12 3l-5 5h3v7h4V8h3l-5-5zm-7 14v2h14v-2H5z',
  download: 'M12 16l5-5h-3V4h-4v7H7l5 5zm-7 2v2h14v-2H5z',
  wrench: 'M21 6.5a5.5 5.5 0 0 1-7.5 5.1L7.4 17.7a2.1 2.1 0 1 1-3-3l6.1-6.1A5.5 5.5 0 0 1 17.6 3l-3.1 3.1 2.4 2.4L20 5.4c.6.3 1 .7 1 1.1z',
  plus: 'M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6V5z',
  trash: 'M6 7h12v13a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V7zm3-4h6l1 2h4v2H4V5h4l1-2z',
  refresh: 'M17.65 6.35A7.95 7.95 0 0 0 12 4a8 8 0 1 0 7.75 10h-2.1A6 6 0 1 1 12 6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z',
  search: 'M10 3a7 7 0 1 0 4.3 12.5l4.6 4.6 1.4-1.4-4.6-4.6A7 7 0 0 0 10 3zm0 2a5 5 0 1 1 0 10 5 5 0 0 1 0-10z',
  sun: 'M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10zm0-5h2v3h-2V2zm0 17h2v3h-2v-3zM2 11h3v2H2v-2zm17 0h3v2h-3v-2zM4.9 4.9l2.1 2.1-1.4 1.4-2.1-2.1 1.4-1.4zm12.7 12.7l2.1 2.1-1.4 1.4-2.1-2.1 1.4-1.4zM19.1 4.9l1.4 1.4-2.1 2.1-1.4-1.4 2.1-2.1zM6.3 17.6l1.4 1.4-2.1 2.1-1.4-1.4 2.1-2.1z',
  moon: 'M20.35 15.22A8.5 8.5 0 0 1 8.78 3.65a8.5 8.5 0 1 0 11.57 11.57z',
  monitor: 'M3 4h18a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1h-7v2h3v2H7v-2h3v-2H3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zm1 2v9h16V6H4z',
  menu: 'M3 6h18v2H3V6zm0 5h18v2H3v-2zm0 5h18v2H3v-2z',
  close: 'M18.3 5.7L12 12l6.3 6.3-1.4 1.4L10.6 13.4 4.3 19.7 2.9 18.3 9.2 12 2.9 5.7 4.3 4.3l6.3 6.3 6.3-6.3 1.4 1.4z',
  copy: 'M8 7h11v13H8V7zm2 2v9h7V9h-7zM5 4h10v2H7v10H5V4z',
  check: 'M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z',
  filter: 'M3 5h18l-7 8v6l-4-2v-4L3 5z',
  key: 'M14 3a7 7 0 0 0-6.7 9.1L2 17.4V21h3.6l1.4-1.4V18h2v-2h2l1.1-1.1A7 7 0 1 0 14 3zm2 7a2 2 0 1 1 0-4 2 2 0 0 1 0 4z',
  link: 'M10.6 13.4a1 1 0 0 1 0-1.4l3-3a3 3 0 0 1 4.2 4.2l-2 2a3 3 0 0 1-4.2 0l1.4-1.4a1 1 0 0 0 1.4 0l2-2a1 1 0 1 0-1.4-1.4l-3 3a1 1 0 0 1-1.4 0zm2.8-2.8a1 1 0 0 1 0 1.4l-3 3a3 3 0 0 1-4.2-4.2l2-2a3 3 0 0 1 4.2 0L11 10.2a1 1 0 0 0-1.4 0l-2 2a1 1 0 1 0 1.4 1.4l3-3a1 1 0 0 1 1.4 0z',
  edit: 'M3 17.25V21h3.75L17.8 9.94l-3.75-3.75L3 17.25zM20.7 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z',
  chart: 'M4 19h16v2H4v-2zm2-7h3v5H6v-5zm5-5h3v10h-3V7zm5 3h3v7h-3v-7z',
  server: 'M4 4h16v6H4V4zm2 2v2h2V6H6zm-2 8h16v6H4v-6zm2 2v2h2v-2H6z',
  shield: 'M12 2l8 4v6c0 5-3.4 9.5-8 10-4.6-.5-8-5-8-10V6l8-4zm0 2.2L6 7.2V12c0 3.9 2.5 7.4 6 7.9 3.5-.5 6-4 6-7.9V7.2l-6-3z',
  command: 'M7 3a4 4 0 0 0 0 8h2v2H7a4 4 0 1 0 4 4v-2h2v2a4 4 0 1 0 4-4h-2v-2h2a4 4 0 1 0-4-4v2h-2V7a4 4 0 0 0-4-4zm0 2a2 2 0 0 1 2 2v2H7a2 2 0 1 1 0-4zm10 0a2 2 0 1 1 0 4h-2V7a2 2 0 0 1 2-2zm-6 6h2v2h-2v-2zm-4 4h2v2a2 2 0 1 1-2-2zm8 0h2a2 2 0 1 1-2 2v-2z',
  sparkles: 'M12 2l2.1 6.1L20 10l-5.9 2.1L12 18l-2.1-5.9L4 10l5.9-1.9L12 2zm7 13l1 3 3 1-3 1-1 3-1-3-3-1 3-1 1-3z',
  diff: 'M5 4h6v16H5V4zm8 0h6v16h-6V4zM7 8v2h2V8H7zm8 0v2h2V8h-2zm0 4v2h2v-2h-2z',
  bookmark: 'M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1z',
  clock: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm1 5v5.4l3.7 2.2-1 1.7L11 13.5V7h2z',
  layout: 'M3 3h8v8H3V3zm10 0h8v5h-8V3zm0 7h8v11h-8V10zM3 13h8v8H3v-8z',
  zoomIn: 'M10 3a7 7 0 1 0 4.3 12.5l4.6 4.6 1.4-1.4-4.6-4.6A7 7 0 0 0 10 3zm-1 4h2v2h2v2h-2v2H9v-2H7V9h2V7z',
  zoomOut: 'M10 3a7 7 0 1 0 4.3 12.5l4.6 4.6 1.4-1.4-4.6-4.6A7 7 0 0 0 10 3zM7 9h6v2H7V9z',
  maximize: 'M4 4h6v2H6v4H4V4zm10 0h6v6h-2V6h-4V4zM4 14h2v4h4v2H4v-6zm14 4v-4h2v6h-6v-2h4z',
  globe: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm7.9 9h-3.1a15 15 0 0 0-1.3-5A8 8 0 0 1 19.9 11zM12 4.1c1 1.3 1.9 3.7 2.2 6.9H9.8c.3-3.2 1.2-5.6 2.2-6.9zM4.1 13h3.1c.2 1.8.6 3.5 1.3 5A8 8 0 0 1 4.1 13zm3.1-2H4.1a8 8 0 0 1 4.4-5 15 15 0 0 0-1.3 5zm4.8 8.9c-1-1.3-1.9-3.7-2.2-6.9h4.4c-.3 3.2-1.2 5.6-2.2 6.9zm3.5-1.9c.7-1.5 1.1-3.2 1.3-5h3.1a8 8 0 0 1-4.4 5z',
  chevronDown: 'M7 10l5 5 5-5H7z',
  chevronRight: 'M10 7l5 5-5 5V7z',
};

const SVG_NS = 'http://www.w3.org/2000/svg';

function svgNode<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number>
): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    el.setAttribute(k, String(v));
  }
  return el;
}

function starPoints(cx: number, cy: number, outerR: number, innerR: number): string {
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? outerR : innerR;
    const angle = (Math.PI / 5) * i - Math.PI / 2;
    pts.push(`${(cx + r * Math.cos(angle)).toFixed(2)},${(cy + r * Math.sin(angle)).toFixed(2)}`);
  }
  return pts.join(' ');
}

export function icon(name: IconName, size = 15): SVGSVGElement {
  const svg = svgNode('svg', {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'currentColor',
    'aria-hidden': 'true',
  });
  svg.style.flexShrink = '0';

  const path = svgNode('path', { d: PATHS[name] || PATHS.database });
  if (name === 'diagram') {
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', 'currentColor');
    path.setAttribute('stroke-width', '2');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
  }
  svg.appendChild(path);
  return svg;
}

/**
 * Crisp inline SVG country flags (renders consistently on Windows, macOS, Linux, iOS, and Android).
 */
export function flagIcon(locale: 'ja' | 'en' | 'zh' | 'ko' | 'vi', width = 20, height = 14): SVGSVGElement {
  const svg = svgNode('svg', {
    width,
    height,
    viewBox: '0 0 24 16',
    class: 'flag-icon',
    'aria-hidden': 'true',
  });

  if (locale === 'ja') {
    svg.append(
      svgNode('rect', { width: 24, height: 16, fill: '#ffffff' }),
      svgNode('circle', { cx: 12, cy: 8, r: 4.5, fill: '#bc002d' })
    );
  } else if (locale === 'en') {
    svg.append(svgNode('rect', { width: 24, height: 16, fill: '#ffffff' }));
    for (let i = 0; i < 7; i++) {
      svg.append(svgNode('rect', { x: 0, y: (i * 16) / 13 * 2, width: 24, height: 16 / 13 + 0.05, fill: '#b22234' }));
    }
    svg.append(svgNode('rect', { x: 0, y: 0, width: 10.6, height: 8.65, fill: '#3c3b6e' }));
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 4; col++) {
        svg.append(
          svgNode('circle', {
            cx: 1.55 + col * 2.5,
            cy: 1.65 + row * 2.65,
            r: 0.55,
            fill: '#ffffff',
          })
        );
      }
    }
  } else if (locale === 'zh') {
    svg.append(
      svgNode('rect', { width: 24, height: 16, fill: '#de2910' }),
      svgNode('polygon', { points: starPoints(4.8, 4.8, 2.35, 0.92), fill: '#ffde00' }),
      svgNode('polygon', { points: starPoints(9.2, 2.1, 0.85, 0.34), fill: '#ffde00' }),
      svgNode('polygon', { points: starPoints(10.8, 3.8, 0.85, 0.34), fill: '#ffde00' }),
      svgNode('polygon', { points: starPoints(10.8, 6.1, 0.85, 0.34), fill: '#ffde00' }),
      svgNode('polygon', { points: starPoints(9.2, 7.8, 0.85, 0.34), fill: '#ffde00' })
    );
  } else if (locale === 'ko') {
    svg.append(
      svgNode('rect', { width: 24, height: 16, fill: '#ffffff' }),
      // Taegeuk (red upper swirl + blue lower swirl)
      svgNode('circle', { cx: 12, cy: 8, r: 3.7, fill: '#0047a0' }),
      svgNode('path', { d: 'M8.3 8 A3.7 3.7 0 0 1 15.7 8 A1.85 1.85 0 0 0 12 8 A1.85 1.85 0 0 1 8.3 8 Z', fill: '#cd2e3a' }),
      // Four trigrams (simplified crisp strokes)
      svgNode('path', {
        d: 'M4.2 4.6 L6.8 2.4 M5.1 5.6 L7.7 3.4 M6.0 6.6 L8.6 4.4',
        stroke: '#111827',
        'stroke-width': 0.85,
        fill: 'none',
      }),
      svgNode('path', {
        d: 'M17.2 2.4 L19.8 4.6 M16.3 3.4 L18.9 5.6 M15.4 4.4 L18.0 6.6',
        stroke: '#111827',
        'stroke-width': 0.85,
        fill: 'none',
      }),
      svgNode('path', {
        d: 'M4.2 11.4 L6.8 13.6 M5.1 10.4 L7.7 12.6 M6.0 9.4 L8.6 11.6',
        stroke: '#111827',
        'stroke-width': 0.85,
        fill: 'none',
      }),
      svgNode('path', {
        d: 'M17.2 13.6 L19.8 11.4 M16.3 12.6 L18.9 10.4 M15.4 11.6 L18.0 9.4',
        stroke: '#111827',
        'stroke-width': 0.85,
        fill: 'none',
      })
    );
  } else {
    // Vietnam
    svg.append(
      svgNode('rect', { width: 24, height: 16, fill: '#da251d' }),
      svgNode('polygon', { points: starPoints(12, 8.2, 4.4, 1.72), fill: '#ffcd00' })
    );
  }

  return svg;
}
