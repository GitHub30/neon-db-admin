import { DEFAULT_WORKER_PROXY_URL } from '../i18n/translations.js';
import { copyToClipboard, el } from './dom.js';
import { icon } from './icons.js';

export function renderProxyGuidePanel(container: HTMLElement): void {
  const liveStatus = el('span', { className: 'badge' }, 'ステータス確認中...');

  fetch(`${DEFAULT_WORKER_PROXY_URL}/health`, { mode: 'cors' })
    .then(async (res) => {
      const data = (await res.json()) as { ok?: boolean; supportedDialects?: string[]; cors?: string };
      if (res.ok && data.ok) {
        liveStatus.className = 'badge badge-libsql';
        liveStatus.textContent = `稼働中 · CORS: ${data.cors || '*'} · ${(data.supportedDialects || []).join(', ')}`;
      } else {
        liveStatus.className = 'badge badge-d1';
        liveStatus.textContent = `HTTP ${res.status}`;
      }
    })
    .catch(() => {
      liveStatus.className = 'badge badge-d1';
      liveStatus.textContent = 'オフライン / 到達不可';
    });

  const workerSnippet = `# セルフホスト版 Cloudflare Workers プロキシのデプロイ
git clone https://github.com/GitHub30/neon-db-admin.git
cd neon-db-admin/workers/proxy-worker
npm install
npx wrangler deploy
# (任意) トークン認証を有効にする場合:
# npx wrangler secret put PROXY_AUTH_TOKEN`;

  const phpSnippet = `# PHP 8.1+ (PDO) が動くサーバーに proxy.php を配置するだけで動作（トークン不要）
php -S 127.0.0.1:8080 proxy.php

# (任意) 公開サーバー等でトークン認証を有効にする場合:
# export NEON_DB_PROXY_TOKEN="$(openssl rand -hex 32)"`;

  const nodeSnippet = `# Node.js 22+ でそのまま起動可能（トークン不要）
npm i mysql2 pg
PORT=8787 node proxy-node.mjs

# (任意) トークン認証を有効にする場合:
# NEON_DB_PROXY_TOKEN="$(openssl rand -hex 32)" PORT=8787 node proxy-node.mjs`;

  container.replaceChildren(
    el(
      'div',
      { className: 'card' },
      el('div', { className: 'card-title' }, el('span', {}, '1. Cloudflare Workers プロキシ（全リモートDB対応）'), liveStatus),
      el(
        'p',
        { style: { margin: '0 0 8px', fontSize: '0.82rem', color: 'var(--ink-secondary)' } },
        'Cloudflare Workers の TCP Socket と Fetch API により、MySQL / MariaDB / PostgreSQL / Cloudflare D1 / LibSQL へ CORS (Access-Control-Allow-Origin: *) 対応で接続できます。'
      ),
      el(
        'div',
        { className: 'toolbar-group', style: { marginBottom: '8px' } },
        el('code', { className: 'code-block', style: { padding: '6px 10px', flex: '1' } }, DEFAULT_WORKER_PROXY_URL),
        el('button', { type: 'button', className: 'btn btn-sm', onClick: () => copyToClipboard(DEFAULT_WORKER_PROXY_URL) }, icon('copy', 12), 'URLをコピー')
      ),
      el('pre', { className: 'code-block' }, workerSnippet)
    ),
    el(
      'div',
      { className: 'card' },
      el(
        'div',
        { className: 'card-title' },
        el('span', {}, '2. シングルファイル PHP プロキシ (proxy.php)'),
        el('a', { href: './proxies/proxy.php', download: 'proxy.php', className: 'btn btn-sm btn-primary', style: { textDecoration: 'none' } }, icon('download', 12), 'proxy.php をダウンロード')
      ),
      el(
        'p',
        { style: { margin: '0 0 8px', fontSize: '0.82rem', color: 'var(--ink-secondary)' } },
        '依存関係ゼロの PHP PDO プロキシ。MySQL / MariaDB / PostgreSQL / SQLite に対応。NEON_DB_PROXY_TOKEN は任意（未設定のまま配置しても動作します）。Access-Control-Allow-Origin: * 標準対応。'
      ),
      el('pre', { className: 'code-block' }, phpSnippet)
    ),
    el(
      'div',
      { className: 'card' },
      el(
        'div',
        { className: 'card-title' },
        el('span', {}, '3. スタンドアロン Node.js プロキシ (proxy-node.mjs)'),
        el('a', { href: './proxies/proxy-node.mjs', download: 'proxy-node.mjs', className: 'btn btn-sm', style: { textDecoration: 'none' } }, icon('download', 12), 'proxy-node.mjs をダウンロード')
      ),
      el(
        'p',
        { style: { margin: '0 0 8px', fontSize: '0.82rem', color: 'var(--ink-secondary)' } },
        'ローカル環境や社内ネットワークのDB向け軽量 Node.js 22+ プロキシ。NEON_DB_PROXY_TOKEN は任意（未設定でも動作します）。'
      ),
      el('pre', { className: 'code-block' }, nodeSnippet)
    )
  );
}
