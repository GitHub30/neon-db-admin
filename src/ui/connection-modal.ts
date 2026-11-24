import { store } from '../core/state.js';
import { createEmptyConnectionTemplate } from '../core/storage.js';
import { DEFAULT_WORKER_PROXY_URL, t } from '../i18n/translations.js';
import { ProxyDatabaseAdapter } from '../adapters/proxy-adapter.js';
import type { ConnectionConfig, DbDialect, TransportType } from '../types/db.js';
import { el, labeledField, openModal, toast } from './dom.js';
import { icon } from './icons.js';
import { handleSqliteFileUpload } from './import-export.js';
import { renderProxyGuidePanel } from './proxy-guide-modal.js';

const PRESET_PROXY_URLS = new Set([
  '',
  DEFAULT_WORKER_PROXY_URL,
  'https://your-server.example.com/proxy.php',
  'http://127.0.0.1:8787',
]);

export function openConnectionModal(editing?: ConnectionConfig, initialTab: 'connect' | 'proxy' = 'connect'): void {
  const draft: ConnectionConfig = editing ? { ...editing } : createEmptyConnectionTemplate();
  if (draft.sslRejectUnauthorized === undefined) draft.sslRejectUnauthorized = true;
  let activeTab: 'connect' | 'proxy' = initialTab;

  openModal({
    title: editing ? `${t('connect')} — ${t('connEditSuffix')}` : t('connect'),
    large: true,
    renderBody: (body, close) => {
      const renderModalContent = () => {
        body.replaceChildren();

        // Modal tab bar: Connection Settings | Proxy Setup / Download
        const tabBar = el(
          'div',
          {
            role: 'tablist',
            'aria-label': t('connect'),
            style: { display: 'flex', gap: '6px', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '10px' },
          },
          el(
            'button',
            {
              type: 'button',
              role: 'tab',
              'aria-selected': String(activeTab === 'connect'),
              className: `btn btn-sm ${activeTab === 'connect' ? 'btn-primary' : ''}`,
              onClick: () => {
                activeTab = 'connect';
                renderModalContent();
              },
            },
            icon('database', 13),
            t('connTabSettings')
          ),
          el(
            'button',
            {
              type: 'button',
              role: 'tab',
              'aria-selected': String(activeTab === 'proxy'),
              className: `btn btn-sm ${activeTab === 'proxy' ? 'btn-primary' : ''}`,
              onClick: () => {
                activeTab = 'proxy';
                renderModalContent();
              },
            },
            icon('server', 13),
            t('proxySetup')
          )
        );

        body.append(tabBar);

        if (activeTab === 'proxy') {
          const proxyHost = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px' } });
          renderProxyGuidePanel(proxyHost);
          body.append(proxyHost);
          return;
        }

        const fileInp = el('input', {
          type: 'file',
          accept: '.sqlite,.sqlite3,.db,.db3',
          style: { display: 'none' },
          onChange: async (e: Event) => {
            const file = (e.target as HTMLInputElement).files?.[0];
            if (!file) return;
            try {
              await handleSqliteFileUpload(file);
              close();
            } catch (err) {
              toast(err instanceof Error ? err.message : String(err), 'error');
            }
          },
        });

        const quickBox = el(
          'div',
          { className: 'card', style: { background: 'var(--bg-subtle)' } },
          el('div', { style: { fontWeight: '700', fontSize: '0.84rem', marginBottom: '8px' } }, t('localSqliteTitle')),
          el(
            'div',
            { className: 'toolbar-group' },
            fileInp,
            el('button', { type: 'button', className: 'btn btn-sm btn-primary', onClick: () => fileInp.click() }, icon('upload', 13), t('openSqliteFileBtn')),
            el(
              'button',
              {
                type: 'button',
                className: 'btn btn-sm',
                onClick: async () => {
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
                  close();
                  toast(t('newSqliteCreated'), 'success');
                },
              },
              icon('plus', 13),
              t('emptySqlite')
            )
          )
        );

        const defaultPortFor = (d: DbDialect) => (d === 'mysql' || d === 'mariadb' ? 3306 : 5432);

        const dialectSel = el(
          'select',
          {
            className: 'select',
            onChange: (e: Event) => {
              draft.dialect = (e.target as HTMLSelectElement).value as DbDialect;
              if (draft.dialect === 'mysql' || draft.dialect === 'mariadb') {
                draft.port = 3306;
                if (!draft.user || draft.user === 'postgres') draft.user = 'root';
              } else if (draft.dialect === 'postgresql') {
                draft.port = 5432;
                if (!draft.user || draft.user === 'root') draft.user = 'postgres';
              } else if (draft.dialect === 'sqlite' && draft.transport === 'cloudflare-worker') {
                draft.transport = 'php-proxy';
                if (PRESET_PROXY_URLS.has(draft.proxyUrl || '')) {
                  draft.proxyUrl = 'https://your-server.example.com/proxy.php';
                }
              }
              renderModalContent();
            },
          },
          el('option', { value: 'postgresql', selected: draft.dialect === 'postgresql' }, 'PostgreSQL (Neon / Supabase / RDS / Self-hosted)'),
          el('option', { value: 'mysql', selected: draft.dialect === 'mysql' }, 'MySQL (PlanetScale / RDS / Self-hosted)'),
          el('option', { value: 'mariadb', selected: draft.dialect === 'mariadb' }, 'MariaDB'),
          el('option', { value: 'd1', selected: draft.dialect === 'd1' }, 'Cloudflare D1 Database (REST API)'),
          el('option', { value: 'd1-binding', selected: draft.dialect === 'd1-binding' }, 'Cloudflare D1 (Worker Binding)'),
          el('option', { value: 'libsql', selected: draft.dialect === 'libsql' }, 'Turso / LibSQL (HTTP)'),
          el('option', { value: 'sqlite', selected: draft.dialect === 'sqlite' }, 'SQLite (Server-side via proxy.php / proxy-node.mjs)')
        );

        const transportSel = el(
          'select',
          {
            className: 'select',
            onChange: (e: Event) => {
              draft.transport = (e.target as HTMLSelectElement).value as TransportType;
              if (PRESET_PROXY_URLS.has(draft.proxyUrl || '')) {
                if (draft.transport === 'cloudflare-worker') draft.proxyUrl = DEFAULT_WORKER_PROXY_URL;
                else if (draft.transport === 'php-proxy') draft.proxyUrl = 'https://your-server.example.com/proxy.php';
                else if (draft.transport === 'node-proxy') draft.proxyUrl = 'http://127.0.0.1:8787';
              }
              renderModalContent();
            },
          },
          el('option', { value: 'cloudflare-worker', selected: draft.transport === 'cloudflare-worker' }, t('proxyOptWorker')),
          el('option', { value: 'php-proxy', selected: draft.transport === 'php-proxy' }, t('proxyOptPhp')),
          el('option', { value: 'node-proxy', selected: draft.transport === 'node-proxy' }, t('proxyOptNode'))
        );

        const nameInp = el('input', {
          type: 'text',
          className: 'input',
          value: draft.name,
          placeholder: 'Production PostgreSQL',
          onInput: (e: Event) => {
            draft.name = (e.target as HTMLInputElement).value;
          },
        });

        const proxyUrlInp = el('input', {
          type: 'url',
          className: 'input mono',
          value: draft.proxyUrl || DEFAULT_WORKER_PROXY_URL,
          placeholder: DEFAULT_WORKER_PROXY_URL,
          onInput: (e: Event) => {
            draft.proxyUrl = (e.target as HTMLInputElement).value.trim();
          },
        });

        const proxyTokenInp = el('input', {
          type: 'password',
          className: 'input mono',
          value: draft.proxyToken || '',
          placeholder: t('proxyTokenPlaceholder'),
          onInput: (e: Event) => {
            draft.proxyToken = (e.target as HTMLInputElement).value;
          },
        });

        const specificFields = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px' } });

        if (draft.dialect === 'd1') {
          specificFields.append(
            el(
              'div',
              { className: 'field-row' },
              labeledField(
                'Cloudflare Account ID (32-hex)',
                el('input', {
                  type: 'text',
                  className: 'input mono',
                  value: draft.accountId || '',
                  placeholder: '0123456789abcdef0123456789abcdef',
                  onInput: (e: Event) => {
                    draft.accountId = (e.target as HTMLInputElement).value.trim();
                  },
                })
              ),
              labeledField(
                'D1 Database ID (UUID)',
                el('input', {
                  type: 'text',
                  className: 'input mono',
                  value: draft.databaseId || '',
                  placeholder: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx',
                  onInput: (e: Event) => {
                    draft.databaseId = (e.target as HTMLInputElement).value.trim();
                  },
                })
              )
            ),
            labeledField(
              'Cloudflare API Token (D1 Edit)',
              el('input', {
                type: 'password',
                className: 'input mono',
                value: draft.apiToken || '',
                onInput: (e: Event) => {
                  draft.apiToken = (e.target as HTMLInputElement).value.trim();
                },
              })
            )
          );
        } else if (draft.dialect === 'd1-binding') {
          specificFields.append(
            el('p', { style: { margin: '0', fontSize: '0.82rem', color: 'var(--ink-secondary)' } }, t('d1BindingNote'))
          );
        } else if (draft.dialect === 'libsql') {
          specificFields.append(
            labeledField(
              'LibSQL / Turso Endpoint URL',
              el('input', {
                type: 'url',
                className: 'input mono',
                value: draft.url || '',
                placeholder: 'https://your-db-org.turso.io',
                onInput: (e: Event) => {
                  draft.url = (e.target as HTMLInputElement).value.trim();
                },
              })
            ),
            labeledField(
              'Auth Token',
              el('input', {
                type: 'password',
                className: 'input mono',
                value: draft.authToken || '',
                onInput: (e: Event) => {
                  draft.authToken = (e.target as HTMLInputElement).value.trim();
                },
              })
            )
          );
        } else if (draft.dialect === 'sqlite') {
          specificFields.append(
            labeledField(
              t('sqlitePathLabel'),
              el('input', {
                type: 'text',
                className: 'input mono',
                value: draft.filePath || '',
                placeholder: 'app.sqlite',
                onInput: (e: Event) => {
                  draft.filePath = (e.target as HTMLInputElement).value.trim();
                },
              })
            )
          );
        } else {
          specificFields.append(
            labeledField(
              t('connUrlLabel'),
              el('input', {
                type: 'password',
                className: 'input mono',
                value: draft.url || '',
                placeholder: draft.dialect === 'postgresql' ? 'postgresql://user:pass@host:5432/dbname?sslmode=require' : 'mysql://user:pass@host:3306/dbname',
                onInput: (e: Event) => {
                  draft.url = (e.target as HTMLInputElement).value.trim();
                },
              })
            ),
            el(
              'div',
              { className: 'field-row' },
              labeledField(
                'Host',
                el('input', {
                  type: 'text',
                  className: 'input mono',
                  value: draft.host || '',
                  placeholder: 'db.example.com',
                  onInput: (e: Event) => {
                    draft.host = (e.target as HTMLInputElement).value.trim();
                  },
                })
              ),
              labeledField(
                'Port',
                el('input', {
                  type: 'number',
                  className: 'input mono',
                  value: String(draft.port || defaultPortFor(draft.dialect)),
                  onInput: (e: Event) => {
                    draft.port = Number((e.target as HTMLInputElement).value) || defaultPortFor(draft.dialect);
                  },
                })
              ),
              labeledField(
                'Database',
                el('input', {
                  type: 'text',
                  className: 'input mono',
                  value: draft.database || '',
                  placeholder: draft.dialect === 'postgresql' ? 'postgres' : 'mydb',
                  onInput: (e: Event) => {
                    draft.database = (e.target as HTMLInputElement).value.trim();
                  },
                })
              )
            ),
            el(
              'div',
              { className: 'field-row' },
              labeledField(
                'Username',
                el('input', {
                  type: 'text',
                  className: 'input mono',
                  value: draft.user || '',
                  onInput: (e: Event) => {
                    draft.user = (e.target as HTMLInputElement).value;
                  },
                })
              ),
              labeledField(
                'Password',
                el('input', {
                  type: 'password',
                  className: 'input mono',
                  value: draft.password || '',
                  onInput: (e: Event) => {
                    draft.password = (e.target as HTMLInputElement).value;
                  },
                })
              )
            ),
            el(
              'div',
              { className: 'toolbar-group', style: { gap: '14px' } },
              el(
                'label',
                { style: { display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '0.82rem' } },
                el('input', {
                  type: 'checkbox',
                  checked: draft.ssl !== false,
                  onChange: (e: Event) => {
                    draft.ssl = (e.target as HTMLInputElement).checked;
                  },
                }),
                t('sslEnableLabel')
              ),
              el(
                'label',
                { style: { display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem', color: 'var(--ink-secondary)' } },
                el('input', {
                  type: 'checkbox',
                  checked: draft.sslRejectUnauthorized === false,
                  onChange: (e: Event) => {
                    draft.sslRejectUnauthorized = !(e.target as HTMLInputElement).checked;
                  },
                }),
                t('sslSelfSignedLabel')
              )
            )
          );
        }

        const testStatus = el('div', { style: { fontSize: '0.82rem' } });
        const rememberChk = el('input', {
          type: 'checkbox',
          checked: Boolean(draft.rememberSecrets),
          onChange: (e: Event) => {
            draft.rememberSecrets = (e.target as HTMLInputElement).checked;
          },
        });

        body.append(
          quickBox,
          el(
            'div',
            { className: 'card', style: { display: 'flex', flexDirection: 'column', gap: '10px' } },
            el(
              'div',
              { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '6px' } },
              el('span', { style: { fontWeight: '700', fontSize: '0.86rem' } }, t('remoteDbTitle')),
              el(
                'button',
                {
                  type: 'button',
                  className: 'btn btn-ghost btn-sm',
                  onClick: () => {
                    activeTab = 'proxy';
                    renderModalContent();
                  },
                },
                icon('download', 12),
                t('getProxyFilesBtn')
              )
            ),
            el('div', { className: 'field-row' }, labeledField(t('connNameLabel'), nameInp), labeledField(t('dialectLabel'), dialectSel)),
            el('div', { className: 'field-row' }, labeledField(t('proxyMethodLabel'), transportSel), labeledField(t('proxyUrlLabel'), proxyUrlInp)),
            labeledField(t('proxyTokenLabel'), proxyTokenInp),
            specificFields,
            el(
              'div',
              { style: { display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: '8px', paddingTop: '6px', borderTop: '1px solid var(--border-subtle)' } },
              el('label', { style: { display: 'inline-flex', gap: '6px', alignItems: 'center', fontSize: '0.78rem', color: 'var(--ink-secondary)' } }, rememberChk, t('rememberSecretsLabel')),
              el(
                'button',
                {
                  type: 'button',
                  className: 'btn btn-ghost btn-sm',
                  style: { color: 'var(--danger)' },
                  onClick: () => {
                    store.purgeAllSecrets();
                    toast(t('secretsPurgedToast'), 'info');
                  },
                },
                icon('shield', 12),
                t('purgeSecretsBtn')
              )
            ),
            testStatus,
            el(
              'div',
              { style: { display: 'flex', justifyContent: 'flex-end', gap: '8px' } },
              el(
                'button',
                {
                  type: 'button',
                  className: 'btn',
                  onClick: async () => {
                    testStatus.textContent = t('testingConnStatus');
                    testStatus.style.color = 'var(--ink-muted)';
                    const adapter = new ProxyDatabaseAdapter(draft);
                    const res = await adapter.testConnection();
                    if (res.ok) {
                      testStatus.textContent = `${t('connTestSuccess')}: ${res.version} (${res.durationMs}ms)`;
                      testStatus.style.color = 'var(--success)';
                    } else {
                      testStatus.textContent = `${t('connTestError')}: ${res.error}`;
                      testStatus.style.color = 'var(--danger)';
                    }
                  },
                },
                t('testConnectionBtn')
              ),
              el(
                'button',
                {
                  type: 'button',
                  className: 'btn btn-primary',
                  onClick: async () => {
                    if (!draft.name.trim()) draft.name = `${draft.dialect.toUpperCase()} (${draft.host || draft.databaseId || 'remote'})`;
                    store.upsertConnection({ ...draft });
                    try {
                      await store.connectTo({ ...draft });
                      close();
                      toast(`${draft.name} ${t('connectedSuffix')}`, 'success');
                    } catch (err) {
                      toast(err instanceof Error ? err.message : String(err), 'error', 5000);
                    }
                  },
                },
                t('saveAndConnectBtn')
              )
            )
          )
        );
      };
      renderModalContent();
    },
  });
}
