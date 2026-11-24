import { DEFAULT_WORKER_PROXY_URL, t } from '../i18n/translations.js';
import { copyToClipboard, el } from './dom.js';
import { icon } from './icons.js';

export function renderProxyGuidePanel(container: HTMLElement): void {
  const liveStatus = el('span', { className: 'badge' }, t('proxyStatusChecking'));

  fetch(`${DEFAULT_WORKER_PROXY_URL}/health`, { mode: 'cors' })
    .then(async (res) => {
      const data = (await res.json()) as { ok?: boolean; supportedDialects?: string[]; cors?: string };
      if (res.ok && data.ok) {
        liveStatus.className = 'badge badge-libsql';
        liveStatus.textContent = `${t('proxyStatusLive')} · CORS: ${data.cors || '*'} · ${(data.supportedDialects || []).join(', ')}`;
      } else {
        liveStatus.className = 'badge badge-d1';
        liveStatus.textContent = `HTTP ${res.status}`;
      }
    })
    .catch(() => {
      liveStatus.className = 'badge badge-d1';
      liveStatus.textContent = t('proxyStatusOffline');
    });

  const workerSnippet = `# Self-hosted Cloudflare Workers Proxy
git clone https://github.com/GitHub30/neon-db-admin.git
cd neon-db-admin/workers/proxy-worker
npm install
npx wrangler deploy
# (Optional) Enable token auth:
# npx wrangler secret put PROXY_AUTH_TOKEN`;

  const phpSnippet = `# PHP 8.1+ (PDO) — works out-of-the-box without a token
php -S 127.0.0.1:8080 proxy.php

# (Optional) Enable token auth for public servers:
# export NEON_DB_PROXY_TOKEN="$(openssl rand -hex 32)"`;

  const nodeSnippet = `# Node.js 22+ — works out-of-the-box without a token
npm i mysql2 pg
PORT=8787 node proxy-node.mjs

# (Optional) Enable token auth:
# NEON_DB_PROXY_TOKEN="$(openssl rand -hex 32)" PORT=8787 node proxy-node.mjs`;

  container.replaceChildren(
    el(
      'div',
      { className: 'card' },
      el('div', { className: 'card-title' }, el('span', {}, t('proxyCardWorkerTitle')), liveStatus),
      el(
        'p',
        { style: { margin: '0 0 8px', fontSize: '0.82rem', color: 'var(--ink-secondary)' } },
        t('proxyCardWorkerDesc')
      ),
      el(
        'div',
        { className: 'toolbar-group', style: { marginBottom: '8px' } },
        el('code', { className: 'code-block', style: { padding: '6px 10px', flex: '1' } }, DEFAULT_WORKER_PROXY_URL),
        el('button', { type: 'button', className: 'btn btn-sm', onClick: () => copyToClipboard(DEFAULT_WORKER_PROXY_URL) }, icon('copy', 12), t('copyUrlBtn'))
      ),
      el('pre', { className: 'code-block' }, workerSnippet)
    ),
    el(
      'div',
      { className: 'card' },
      el(
        'div',
        { className: 'card-title' },
        el('span', {}, t('proxyCardPhpTitle')),
        el('a', { href: './proxies/proxy.php', download: 'proxy.php', className: 'btn btn-sm btn-primary', style: { textDecoration: 'none' } }, icon('download', 12), t('downloadPhpBtn'))
      ),
      el(
        'p',
        { style: { margin: '0 0 8px', fontSize: '0.82rem', color: 'var(--ink-secondary)' } },
        t('proxyCardPhpDesc')
      ),
      el('pre', { className: 'code-block' }, phpSnippet)
    ),
    el(
      'div',
      { className: 'card' },
      el(
        'div',
        { className: 'card-title' },
        el('span', {}, t('proxyCardNodeTitle')),
        el('a', { href: './proxies/proxy-node.mjs', download: 'proxy-node.mjs', className: 'btn btn-sm', style: { textDecoration: 'none' } }, icon('download', 12), t('downloadNodeBtn'))
      ),
      el(
        'p',
        { style: { margin: '0 0 8px', fontSize: '0.82rem', color: 'var(--ink-secondary)' } },
        t('proxyCardNodeDesc')
      ),
      el('pre', { className: 'code-block' }, nodeSnippet)
    )
  );
}
