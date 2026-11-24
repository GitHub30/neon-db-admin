import './styles/tokens.css';
import './styles/base.css';
import './styles/layout.css';
import './styles/components.css';

import { store } from './core/state.js';
import { t } from './i18n/translations.js';
import type { ActiveView, ConnectionConfig } from './types/db.js';
import { el, toast } from './ui/dom.js';
import { icon, type IconName } from './ui/icons.js';
import { renderTopbar } from './ui/topbar.js';
import { renderSidebar } from './ui/sidebar.js';

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferredPrompt: BeforeInstallPromptEvent | null = null;
let autoBootPromise: Promise<void> | null = null;
let viewRenderToken = 0;

function getHiddenSqliteInput(): HTMLInputElement {
  let inp = document.getElementById('global-sqlite-upload') as HTMLInputElement | null;
  if (!inp) {
    inp = el('input', {
      id: 'global-sqlite-upload',
      type: 'file',
      accept: '.sqlite,.sqlite3,.db,.db3',
      style: { display: 'none' },
      'aria-hidden': 'true',
      tabIndex: '-1',
    });
    inp.addEventListener('change', async () => {
      const file = inp!.files?.[0];
      inp!.value = '';
      if (!file) return;
      try {
        const { handleSqliteFileUpload } = await import('./ui/import-export.js');
        await handleSqliteFileUpload(file);
      } catch (err) {
        toast(err instanceof Error ? err.message : String(err), 'error', 5000);
      }
    });
    document.body.appendChild(inp);
  }
  return inp;
}

async function ensureDefaultDemoConnected(): Promise<void> {
  if (store.adapter) return;
  if (!autoBootPromise) {
    const demo = store.connections.find((c) => c.id === 'demo-ecommerce') || store.connections[0];
    if (!demo) return;
    autoBootPromise = store.connectTo(demo).finally(() => {
      autoBootPromise = null;
    });
  }
  await autoBootPromise;
}

function applyHashRoute(): void {
  const hash = window.location.hash.replace(/^#/, '').toLowerCase();
  const validViews: ActiveView[] = ['data', 'sql', 'structure', 'er', 'import-export', 'tools'];
  if (validViews.includes(hash as ActiveView)) {
    store.setActiveView(hash as ActiveView);
  }
}

function renderQuickStartHero(container: HTMLElement): void {
  const isEn = store.locale === 'en';
  const demoCards = [
    {
      id: 'demo-ecommerce',
      title: isEn ? 'E-Commerce Store (SQLite WASM)' : 'ECストア デモ (SQLite WASM)',
      desc: isEn
        ? '6 tables with foreign keys, views, and triggers. Try inline editing, SQL charts, and ER reverse engineering.'
        : '6テーブル・外部キー・ビュー・トリガー付き。データ編集、SQL集計チャート、ER図リバース生成を即座に体験。',
      badge: 'SQLite WASM',
    },
    {
      id: 'demo-saas',
      title: isEn ? 'SaaS Project Tracker (SQLite WASM)' : 'SaaSプロジェクト管理 (SQLite WASM)',
      desc: isEn
        ? 'Multi-tenant schema: organizations, users, projects, and issues.'
        : 'organizations / users / projects / issues のマルチテナント設計サンプル。',
      badge: 'SQLite WASM',
    },
    {
      id: 'demo-blog',
      title: isEn ? 'Blog CMS (SQLite WASM)' : 'ブログ CMS (SQLite WASM)',
      desc: isEn
        ? 'Many-to-many (N:M) ER relationship sample: posts ↔ post_tags ↔ tags.'
        : 'N:M 多対多リレーション（posts ↔ post_tags ↔ tags）のER図サンプル。',
      badge: 'SQLite WASM',
    },
  ];

  container.replaceChildren(
    el(
      'div',
      { className: 'panel-scroll' },
      el(
        'div',
        { className: 'card', style: { display: 'flex', flexDirection: 'column', gap: '12px' } },
        el(
          'div',
          { style: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '10px' } },
          el(
            'div',
            {},
            el(
              'h1',
              { style: { margin: '0 0 4px', fontSize: '1.15rem', fontWeight: '700' } },
              isEn ? 'Neon DB Admin — Universal Database Workbench' : 'Neon DB Admin ワークベンチへようこそ'
            ),
            el(
              'p',
              { style: { margin: '0', color: 'var(--ink-secondary)', fontSize: '0.84rem' } },
              isEn
                ? 'Edit local SQLite files offline via WebAssembly, connect to MySQL, MariaDB, PostgreSQL, and Cloudflare D1 through CORS-enabled proxies, and design Crow’s Foot ER diagrams.'
                : 'SQLiteファイルの直接編集（ブラウザWASM）から、Cloudflare Workers / proxy.php 経由の MySQL・MariaDB・PostgreSQL・Cloudflare D1 管理、MySQL Workbench 風 ER図作成まで1つで完結します。'
            )
          ),
          el(
            'div',
            { className: 'toolbar-group' },
            el(
              'button',
              {
                type: 'button',
                id: 'btn-launch-demo',
                className: 'btn btn-primary',
                onClick: async () => {
                  try {
                    await ensureDefaultDemoConnected();
                    toast('ECストア サンプルDB (SQLite WASM) を起動しました', 'success');
                  } catch (err) {
                    toast(err instanceof Error ? err.message : String(err), 'error', 5000);
                  }
                },
              },
              icon('play', 14),
              isEn ? 'Launch Sample DB' : 'サンプルDBを今すぐ起動'
            ),
            el(
              'button',
              { type: 'button', className: 'btn', onClick: () => getHiddenSqliteInput().click() },
              icon('upload', 14),
              t('uploadSqlite')
            ),
            el(
              'button',
              {
                type: 'button',
                className: 'btn',
                onClick: async () => {
                  const { openConnectionModal } = await import('./ui/connection-modal.js');
                  openConnectionModal();
                },
              },
              icon('server', 14),
              isEn ? 'Connect Remote DB' : 'リモートDB接続 (MySQL / PG / D1)'
            )
          )
        ),
        el(
          'div',
          { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '10px' } },
          ...demoCards.map((d) =>
            el(
              'button',
              {
                type: 'button',
                className: 'history-card',
                style: { display: 'flex', flexDirection: 'column', gap: '6px', padding: '12px' },
                onClick: async () => {
                  const target = store.connections.find((c) => c.id === d.id);
                  if (!target) return;
                  try {
                    await store.connectTo(target);
                    toast(`${target.name} を起動しました`, 'success');
                  } catch (err) {
                    toast(err instanceof Error ? err.message : String(err), 'error', 5000);
                  }
                },
              },
              el('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' } }, el('strong', { style: { fontSize: '0.84rem' } }, d.title), el('span', { className: 'badge badge-sqlite' }, d.badge)),
              el('span', { style: { fontSize: '0.78rem', color: 'var(--ink-secondary)', lineHeight: '1.5' } }, d.desc)
            )
          )
        )
      ),
      el(
        'div',
        { className: 'card', style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' } },
        el('div', {}, el('strong', { style: { display: 'block', marginBottom: '4px' } }, isEn ? 'Data Grid & Inline Edit' : 'データ閲覧 & インライン編集'), el('span', { style: { fontSize: '0.8rem', color: 'var(--ink-secondary)' } }, isEn ? 'Multi-filter WHERE builder, sorting, FK jump links, JSON inspector, and batch SQL commit.' : '複数条件フィルタ、並び替え、外部キーリンクジャンプ、セルJSONインスペクタ、SQLプレビュー付きバッチ保存。')),
        el('div', {}, el('strong', { style: { display: 'block', marginBottom: '4px' } }, isEn ? 'SQL IDE & Charts' : 'SQL エディタ & チャート'), el('span', { style: { fontSize: '0.8rem', color: 'var(--ink-secondary)' } }, isEn ? 'Syntax highlighting, autocomplete, EXPLAIN plan, formatter, and Bar/Line/Pie charts.' : 'シンタックスハイライト、テーブル/カラム補完、EXPLAIN実行計画、SQL整形、結果の棒/折れ線/円グラフ可視化。')),
        el('div', {}, el('strong', { style: { display: 'block', marginBottom: '4px' } }, isEn ? 'Visual ER Designer' : 'MySQL Workbench 風 ER図'), el('span', { style: { fontSize: '0.8rem', color: 'var(--ink-secondary)' } }, isEn ? 'Reverse engineer schemas, Crow’s Foot notation, forward DDL generation, SVG/PNG/Mermaid/DBML export.' : 'DBから自動リバース生成、Crow’s Foot記法、ドラッグ配置、DDLフォワード生成、SVG/PNG/Mermaid/DBML出力。')),
        el('div', {}, el('strong', { style: { display: 'block', marginBottom: '4px' } }, isEn ? 'Universal Proxy Support' : 'マルチDB プロキシ接続'), el('span', { style: { fontSize: '0.8rem', color: 'var(--ink-secondary)' } }, isEn ? 'Built-in Cloudflare Workers proxy plus downloadable proxy.php and proxy-node.mjs with CORS (*).' : 'Cloudflare Workers プロキシ標準搭載。proxy.php / proxy-node.mjs も1クリックでダウンロード可能。'))
      )
    )
  );
}

function mountApp(): void {
  store.applyTheme();
  applyHashRoute();

  const topbarEl = document.getElementById('app-topbar');
  const sidebarEl = document.getElementById('app-sidebar');
  const tabsEl = document.getElementById('workspace-tabs');
  const contentEl = document.getElementById('workspace-content');
  const statusEl = document.getElementById('app-statusbar');
  if (!topbarEl || !sidebarEl || !tabsEl || !contentEl || !statusEl) return;

  const openConnections = async (editing?: ConnectionConfig) => {
    const { openConnectionModal } = await import('./ui/connection-modal.js');
    openConnectionModal(editing);
  };

  const openProxyGuide = async () => {
    const { openProxyGuideModal } = await import('./ui/proxy-guide-modal.js');
    openProxyGuideModal();
  };

  const openPalette = async () => {
    const { openCommandPalette } = await import('./ui/command-palette.js');
    openCommandPalette();
  };

  const openCreateTable = async () => {
    await ensureDefaultDemoConnected();
    const { openCreateTableModal } = await import('./ui/table-designer.js');
    openCreateTableModal();
  };

  const tabDefs: Array<{ id: ActiveView; icon: IconName; labelKey: Parameters<typeof t>[0] }> = [
    { id: 'data', icon: 'table', labelKey: 'tabData' },
    { id: 'sql', icon: 'code', labelKey: 'tabSql' },
    { id: 'structure', icon: 'wrench', labelKey: 'tabStructure' },
    { id: 'er', icon: 'diagram', labelKey: 'tabEr' },
    { id: 'import-export', icon: 'upload', labelKey: 'tabIo' },
    { id: 'tools', icon: 'sparkles', labelKey: 'tabTools' },
  ];

  const renderAll = async (isInitialBoot = false) => {
    const token = ++viewRenderToken;

    const renderChrome = () => {
      renderTopbar(topbarEl, {
        onOpenConnections: () => openConnections(),
        onUploadSqlite: () => getHiddenSqliteInput().click(),
        onOpenProxyGuide: openProxyGuide,
        onOpenCommandPalette: openPalette,
        canInstallPwa: () => deferredPrompt !== null,
        onInstallPwa: async () => {
          if (!deferredPrompt) return;
          await deferredPrompt.prompt();
          await deferredPrompt.userChoice;
          deferredPrompt = null;
          renderAll();
        },
      });

      // Complete ARIA Tabs pattern: aria-controls, roving tabindex, ArrowLeft/Right, aria-labelledby on tabpanel (H11)
      contentEl.setAttribute('aria-labelledby', `tab-${store.activeView}`);
      tabsEl.replaceChildren(
        ...tabDefs.map((td, idx) => {
          const isSelected = store.activeView === td.id;
          return el(
            'button',
            {
              type: 'button',
              role: 'tab',
              id: `tab-${td.id}`,
              className: 'ws-tab',
              'aria-selected': String(isSelected),
              'aria-controls': 'workspace-content',
              tabIndex: isSelected ? '0' : '-1',
              onKeydown: (e: KeyboardEvent) => {
                if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
                  e.preventDefault();
                  const nextIdx = (idx + (e.key === 'ArrowRight' ? 1 : -1) + tabDefs.length) % tabDefs.length;
                  const nextView = tabDefs[nextIdx].id;
                  store.setActiveView(nextView);
                  document.getElementById(`tab-${nextView}`)?.focus();
                }
              },
              onClick: async () => {
                store.setActiveView(td.id);
                if (!store.adapter && td.id !== 'import-export') {
                  await ensureDefaultDemoConnected();
                }
              },
            },
            icon(td.icon, 14),
            t(td.labelKey)
          );
        })
      );
    };

    const renderPanels = async () => {
      if (token !== viewRenderToken) return;
      renderSidebar(sidebarEl, {
        onOpenConnections: openConnections,
        onCreateTable: openCreateTable,
      });

      const schema = store.schema;
      statusEl.replaceChildren(
        el(
          'div',
          { className: 'statusbar-group' },
          el('span', {}, store.loadingStatus || (schema ? `${schema.serverVersion} · ${schema.databaseName}` : 'Ready (Click any demo DB or upload .sqlite)')),
          schema ? el('span', { className: 'hide-sm' }, `${schema.tables.length} tables · ${schema.views.length} views · ${schema.triggers.length} triggers`) : null
        ),
        el(
          'div',
          { className: 'statusbar-group' },
          el('span', { className: 'hide-sm' }, 'CORS: *'),
          el('span', {}, t('offlineReady'))
        )
      );

      if (!store.adapter && store.activeView !== 'import-export') {
        renderQuickStartHero(contentEl);
        return;
      }

      switch (store.activeView) {
        case 'data': {
          const { renderDataGridView } = await import('./ui/data-grid.js');
          if (token === viewRenderToken) renderDataGridView(contentEl);
          break;
        }
        case 'sql': {
          const { renderSqlEditorView } = await import('./ui/sql-editor.js');
          if (token === viewRenderToken) renderSqlEditorView(contentEl);
          break;
        }
        case 'structure': {
          const { renderStructureView } = await import('./ui/table-designer.js');
          if (token === viewRenderToken) renderStructureView(contentEl);
          break;
        }
        case 'er': {
          const { renderErDiagramView } = await import('./ui/er-diagram.js');
          if (token === viewRenderToken) renderErDiagramView(contentEl);
          break;
        }
        case 'import-export': {
          const { renderImportExportView } = await import('./ui/import-export.js');
          if (token === viewRenderToken) renderImportExportView(contentEl);
          break;
        }
        case 'tools': {
          const { renderDbToolsView } = await import('./ui/db-tools.js');
          if (token === viewRenderToken) renderDbToolsView(contentEl);
          break;
        }
      }
    };

    if (isInitialBoot) {
      renderChrome();
      setTimeout(() => {
        if (token !== viewRenderToken) return;
        renderQuickStartHero(contentEl);
        setTimeout(() => {
          if (token !== viewRenderToken) return;
          renderSidebar(sidebarEl, {
            onOpenConnections: openConnections,
            onCreateTable: openCreateTable,
          });
          statusEl.replaceChildren(
            el('div', { className: 'statusbar-group' }, el('span', {}, 'Ready (Click any demo DB or upload .sqlite)')),
            el('div', { className: 'statusbar-group' }, el('span', { className: 'hide-sm' }, 'CORS: *'), el('span', {}, t('offlineReady')))
          );
        }, 20);
      }, 10);
    } else {
      renderChrome();
      await renderPanels();
    }
  };

  store.subscribe(() => {
    renderAll();
  });

  window.addEventListener('hashchange', applyHashRoute);

  document.addEventListener('keydown', (e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      openPalette();
    }
  });

  const dropOverlay = el(
    'div',
    { className: 'drop-overlay', 'aria-hidden': 'true' },
    el('div', { className: 'drop-overlay-box' }, icon('upload', 36), el('h2', { style: { margin: '10px 0 4px', fontSize: '1.1rem' } }, t('dropSqliteHint')))
  );
  document.body.appendChild(dropOverlay);

  let dragCounter = 0;
  window.addEventListener('dragenter', (e) => {
    if (e.dataTransfer?.types.includes('Files')) {
      dragCounter++;
      dropOverlay.classList.add('active');
    }
  });
  window.addEventListener('dragover', (e) => {
    if (e.dataTransfer?.types.includes('Files')) e.preventDefault();
  });
  window.addEventListener('dragleave', () => {
    dragCounter = Math.max(0, dragCounter - 1);
    if (dragCounter === 0) dropOverlay.classList.remove('active');
  });
  window.addEventListener('drop', async (e) => {
    e.preventDefault();
    dragCounter = 0;
    dropOverlay.classList.remove('active');
    const file = e.dataTransfer?.files?.[0];
    if (!file) return;
    if (/\.(sqlite|sqlite3|db|db3)$/i.test(file.name)) {
      try {
        const { handleSqliteFileUpload } = await import('./ui/import-export.js');
        await handleSqliteFileUpload(file);
      } catch (err) {
        toast(err instanceof Error ? err.message : String(err), 'error', 5000);
      }
    } else if (/\.sql$/i.test(file.name)) {
      const text = await file.text();
      await ensureDefaultDemoConnected();
      store.openSqlWithQuery(text);
      toast(`SQLファイル "${file.name}" をエディタに読み込みました`, 'success');
    }
  });

  window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (store.theme === 'system') store.applyTheme();
  });

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e as BeforeInstallPromptEvent;
    renderAll();
  });

  if ('serviceWorker' in navigator && window.location.protocol !== 'file:') {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch(() => {
        // ignore in unsupported contexts
      });
    });
  }

  renderAll(true);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mountApp);
} else {
  mountApp();
}
