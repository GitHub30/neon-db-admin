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

async function createAndConnectEmptySqlite(): Promise<void> {
  const c: ConnectionConfig = {
    id: `empty-${Date.now()}`,
    name: 'New SQLite DB',
    dialect: 'sqlite',
    transport: 'wasm',
    sampleId: 'empty',
    createdAt: Date.now(),
  };
  store.upsertConnection(c);
  await store.connectTo(c);
}

function applyHashRoute(): void {
  const hash = window.location.hash.replace(/^#/, '').toLowerCase();
  const validViews: ActiveView[] = ['data', 'sql', 'structure', 'er', 'import-export', 'tools'];
  if (validViews.includes(hash as ActiveView)) {
    store.setActiveView(hash as ActiveView);
  }
}

function renderEmptyWorkbench(container: HTMLElement): void {
  const isEn = store.locale === 'en';
  container.replaceChildren(
    el(
      'div',
      { className: 'empty-state' },
      icon('database', 36),
      el(
        'h1',
        { style: { margin: '0', fontSize: '1.15rem', fontWeight: '700', color: 'var(--ink-primary)' } },
        isEn ? 'Connect to a Database' : 'データベースに接続して開始'
      ),
      el(
        'p',
        { style: { margin: '0', maxWidth: '520px', fontSize: '0.84rem', color: 'var(--ink-secondary)' } },
        isEn
          ? 'Open a local SQLite file (.sqlite / .db) or connect to MySQL, MariaDB, PostgreSQL, or Cloudflare D1 via Connection Manager.'
          : 'ローカルの SQLite ファイルを開くか、「接続管理」から MySQL・MariaDB・PostgreSQL・Cloudflare D1 へ接続してください。'
      ),
      el(
        'div',
        { className: 'toolbar-group', style: { justifyContent: 'center', marginTop: '4px' } },
        el(
          'button',
          {
            type: 'button',
            id: 'btn-open-conn-hero',
            className: 'btn btn-primary',
            onClick: async () => {
              const { openConnectionModal } = await import('./ui/connection-modal.js');
              openConnectionModal();
            },
          },
          icon('server', 14),
          isEn ? 'Open Connection Manager' : '接続管理（リモートDB・プロキシ）'
        ),
        el(
          'button',
          {
            type: 'button',
            id: 'btn-upload-sqlite-hero',
            className: 'btn',
            onClick: () => getHiddenSqliteInput().click(),
          },
          icon('upload', 14),
          t('uploadSqlite')
        ),
        el(
          'button',
          {
            type: 'button',
            id: 'btn-new-sqlite-hero',
            className: 'btn',
            onClick: async () => {
              try {
                await createAndConnectEmptySqlite();
                toast('新規 SQLite データベースを作成しました', 'success');
              } catch (err) {
                toast(err instanceof Error ? err.message : String(err), 'error', 5000);
              }
            },
          },
          icon('plus', 14),
          t('emptySqlite')
        )
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

  const openConnections = async (editing?: ConnectionConfig, initialTab: 'connect' | 'proxy' = 'connect') => {
    const { openConnectionModal } = await import('./ui/connection-modal.js');
    openConnectionModal(editing, initialTab);
  };

  const openPalette = async () => {
    const { openCommandPalette } = await import('./ui/command-palette.js');
    openCommandPalette();
  };

  const openCreateTable = async () => {
    if (!store.adapter) {
      toast('先にデータベースへ接続するか、新規SQLiteを作成してください', 'info');
      openConnections();
      return;
    }
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

    const renderTopbarOnly = () => {
      renderTopbar(topbarEl, {
        onOpenConnections: () => openConnections(),
        onUploadSqlite: () => getHiddenSqliteInput().click(),
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
    };

    const renderTabsOnly = () => {
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
              onClick: () => {
                store.setActiveView(td.id);
              },
            },
            icon(td.icon, 14),
            t(td.labelKey)
          );
        })
      );
    };

    const renderChrome = () => {
      renderTopbarOnly();
      renderTabsOnly();
    };

    const renderPanels = async () => {
      if (token !== viewRenderToken) return;
      renderSidebar(sidebarEl, {
        onOpenConnections: (editing) => openConnections(editing),
        onCreateTable: openCreateTable,
      });

      const schema = store.schema;
      statusEl.replaceChildren(
        el(
          'div',
          { className: 'statusbar-group' },
          el('span', {}, store.loadingStatus || (schema ? `${schema.serverVersion} · ${schema.databaseName}` : 'Ready')),
          schema ? el('span', { className: 'hide-sm' }, `${schema.tables.length} tables · ${schema.views.length} views · ${schema.triggers.length} triggers`) : null
        ),
        el(
          'div',
          { className: 'statusbar-group' },
          el('span', { className: 'hide-sm' }, 'CORS: *'),
          el('span', {}, t('offlineReady'))
        )
      );

      // ER Designer and Import/Export work even before connecting to a DB
      if (!store.adapter && store.activeView !== 'import-export' && store.activeView !== 'er') {
        renderEmptyWorkbench(contentEl);
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
      // Attach handlers to pre-rendered empty-state buttons in-place (zero reflow / zero CLS)
      const bindStaticHero = () => {
        if (store.activeView === 'er' || store.activeView === 'import-export') {
          void renderPanels();
          return;
        }
        const btnConn = document.getElementById('btn-open-conn-hero');
        const btnUpload = document.getElementById('btn-upload-sqlite-hero');
        const btnNew = document.getElementById('btn-new-sqlite-hero');
        if (store.locale === 'ja' && btnConn && btnUpload && btnNew) {
          btnConn.addEventListener('click', () => {
            void openConnections();
          });
          btnUpload.addEventListener('click', () => {
            getHiddenSqliteInput().click();
          });
          btnNew.addEventListener('click', async () => {
            try {
              await createAndConnectEmptySqlite();
              toast('新規 SQLite データベースを作成しました', 'success');
            } catch (err) {
              toast(err instanceof Error ? err.message : String(err), 'error', 5000);
            }
          });
        } else {
          renderEmptyWorkbench(contentEl);
        }
      };

      bindStaticHero();
      setTimeout(() => {
        if (token !== viewRenderToken) return;
        renderTopbarOnly();
        setTimeout(() => {
          if (token !== viewRenderToken) return;
          renderTabsOnly();
          setTimeout(() => {
            if (token !== viewRenderToken) return;
            renderSidebar(sidebarEl, {
              onOpenConnections: (editing) => openConnections(editing),
              onCreateTable: openCreateTable,
            });
            statusEl.replaceChildren(
              el('div', { className: 'statusbar-group' }, el('span', {}, 'Ready')),
              el('div', { className: 'statusbar-group' }, el('span', { className: 'hide-sm' }, 'CORS: *'), el('span', {}, t('offlineReady')))
            );
          }, 25);
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
      if (!store.adapter) {
        await createAndConnectEmptySqlite();
      }
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
