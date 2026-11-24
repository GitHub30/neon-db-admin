import { DEFAULT_WORKER_PROXY_URL } from '../i18n/translations.js';
import { copyToClipboard, el, openModal } from './dom.js';
import { icon } from './icons.js';

export function openProxyGuideModal(): void {
  openModal({
    title: 'プロキシ設定 & ダウンロードセンター (CORS: Access-Control-Allow-Origin: *)',
    large: true,
    renderBody: (body) => {
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
npx wrangler secret put PROXY_AUTH_TOKEN   # 任意の強い認証トークンを設定
npx wrangler deploy`;

      const phpSnippet = `# PHP 8.1+ (PDO) が動くサーバーに proxy.php を配置
export NEON_DB_PROXY_TOKEN="$(openssl rand -hex 32)"
export NEON_DB_SQLITE_DIR="/var/data/sqlite"
php -S 127.0.0.1:8080 proxy.php`;

      const nodeSnippet = `# Node.js 22+ でローカル/社内DB向けプロキシを起動
npm i mysql2 pg
NEON_DB_PROXY_TOKEN="your-secret-token" PORT=8787 node proxy-node.mjs`;

      body.append(
        el(
          'div',
          { className: 'card' },
          el(
            'div',
            { className: 'card-title' },
            el('span', {}, '1. Cloudflare Workers プロキシ（全リモートDB対応）'),
            liveStatus
          ),
          el('p', { style: { margin: '0 0 8px', fontSize: '0.82rem', color: 'var(--ink-secondary)' } }, 'Cloudflare Workers の TCP Socket (cloudflare:sockets) と Fetch API を利用し、MySQL / MariaDB / PostgreSQL / Cloudflare D1 / LibSQL すべてへ CORS 対応 (Access-Control-Allow-Origin: *) で接続できます。SSRF保護（プライベートIP/メタデータ遮断）内蔵。'),
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
          el('p', { style: { margin: '0 0 8px', fontSize: '0.82rem', color: 'var(--ink-secondary)' } }, '依存関係ゼロの PHP PDO プロキシ。共有ホスティング・VPS・ローカル開発環境の MySQL / MariaDB / PostgreSQL / SQLite に安全に接続できます。トークン認証必須・パストラバーサル防御・Access-Control-Allow-Origin: * 標準対応。'),
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
          el('p', { style: { margin: '0 0 8px', fontSize: '0.82rem', color: 'var(--ink-secondary)' } }, 'ローカル環境やプライベートVPC内のDBに接続するための軽量 Node.js 22+ プロキシ。'),
          el('pre', { className: 'code-block' }, nodeSnippet)
        )
      );
    },
  });
}
