import { store } from '../core/state.js';
import { createEmptyConnectionTemplate } from '../core/storage.js';
import { deriveDefaultConnectionName } from '../core/dialect-detect.js';
import { DEFAULT_WORKER_PROXY_URL, t } from '../i18n/translations.js';
import { ProxyDatabaseAdapter } from '../adapters/proxy-adapter.js';
import type { ConnectionConfig, DbDialect } from '../types/db.js';
import { el, labeledField, openModal, toast } from './dom.js';
import { icon } from './icons.js';
import { handleSqliteFileUpload } from './import-export.js';
import { renderProxyGuidePanel } from './proxy-guide-modal.js';

const SPECIALIZED_DIALECTS = new Set<DbDialect>(['d1', 'd1-binding', 'libsql', 'sqlite']);

function detectUrlSslOverride(rawUrl: string): boolean | undefined {
  try {
    const u = new URL(rawUrl);
    const sslMode = (u.searchParams.get('sslmode') || u.searchParams.get('ssl-mode') || '').toLowerCase();
    if (
      sslMode === 'require' ||
      sslMode === 'required' ||
      sslMode === 'verify-ca' ||
      sslMode === 'verify-full' ||
      sslMode === 'verify_ca' ||
      sslMode === 'verify_identity'
    ) {
      return true;
    }
    if (sslMode === 'disable' || sslMode === 'disabled') {
      return false;
    }
    const sslFlag = (u.searchParams.get('ssl') || '').toLowerCase();
    if (sslFlag === 'true' || sslFlag === '1') return true;
    if (sslFlag === 'false' || sslFlag === '0') return false;
  } catch {
    // Ignore incomplete URLs while typing
  }
  return undefined;
}

export function openConnectionModal(editing?: ConnectionConfig, initialTab: 'connect' | 'proxy' = 'connect'): void {
  const draft: ConnectionConfig = editing ? { ...editing } : createEmptyConnectionTemplate();
  if (draft.ssl === undefined) draft.ssl = false;
  if (draft.sslRejectUnauthorized === undefined) draft.sslRejectUnauthorized = true;
  if (!draft.proxyUrl) draft.proxyUrl = DEFAULT_WORKER_PROXY_URL;
  let activeTab: 'connect' | 'proxy' = initialTab;
  let specializedMode = Boolean(editing && SPECIALIZED_DIALECTS.has(editing.dialect));
  let advancedOpen = Boolean(
    editing &&
      ((editing.proxyUrl && editing.proxyUrl !== DEFAULT_WORKER_PROXY_URL) ||
        Boolean(editing.proxyToken) ||
        (!specializedMode && Boolean(editing.url)))
  );

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

        const previewDefaultName = () => {
          const derived = deriveDefaultConnectionName({ ...draft, name: '' });
          return draft.host || draft.user || draft.url ? derived : t('connNameAutoHint');
        };

        const nameInp = el('input', {
          type: 'text',
          className: 'input',
          autocomplete: 'off',
          value: draft.name,
          placeholder: previewDefaultName(),
          onInput: (e: Event) => {
            draft.name = (e.target as HTMLInputElement).value;
          },
        });

        const refreshNamePlaceholder = () => {
          nameInp.placeholder = previewDefaultName();
        };

        const proxyUrlInp = el('input', {
          type: 'url',
          className: 'input mono',
          autocomplete: 'off',
          value: draft.proxyUrl || DEFAULT_WORKER_PROXY_URL,
          placeholder: DEFAULT_WORKER_PROXY_URL,
          onInput: (e: Event) => {
            draft.proxyUrl = (e.target as HTMLInputElement).value.trim();
          },
        });

        const proxyTokenInp = el('input', {
          type: 'password',
          className: 'input mono',
          autocomplete: 'new-password',
          value: draft.proxyToken || '',
          placeholder: t('proxyTokenPlaceholder'),
          onInput: (e: Event) => {
            draft.proxyToken = (e.target as HTMLInputElement).value;
          },
        });

        const currentDialectVal = draft.autoDetectDialect ? 'auto' : draft.dialect;
        const dialectOverrideSel = el(
          'select',
          {
            className: 'select',
            onChange: (e: Event) => {
              const val = (e.target as HTMLSelectElement).value;
              if (val === 'auto') {
                draft.autoDetectDialect = true;
                draft.dialect = 'mysql';
                specializedMode = false;
              } else {
                draft.autoDetectDialect = false;
                draft.dialect = val as DbDialect;
                specializedMode = SPECIALIZED_DIALECTS.has(draft.dialect);
              }
              renderModalContent();
            },
          },
          el('option', { value: 'auto', selected: currentDialectVal === 'auto' }, t('dialectAutoOption')),
          el('option', { value: 'mysql', selected: currentDialectVal === 'mysql' }, 'MySQL'),
          el('option', { value: 'mariadb', selected: currentDialectVal === 'mariadb' }, 'MariaDB'),
          el('option', { value: 'postgresql', selected: currentDialectVal === 'postgresql' }, 'PostgreSQL'),
          el('option', { value: 'd1', selected: currentDialectVal === 'd1' }, 'Cloudflare D1 (REST API)'),
          el('option', { value: 'd1-binding', selected: currentDialectVal === 'd1-binding' }, 'Cloudflare D1 (Worker Binding)'),
          el('option', { value: 'libsql', selected: currentDialectVal === 'libsql' }, 'Turso / LibSQL (HTTP)'),
          el('option', { value: 'sqlite', selected: currentDialectVal === 'sqlite' }, 'SQLite (Server via proxy.php / proxy-node.mjs)')
        );

        const specificFields = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px' } });
        let sslChk: HTMLInputElement | null = null;

        if (specializedMode) {
          const specialSel = el(
            'select',
            {
              className: 'select',
              onChange: (e: Event) => {
                draft.dialect = (e.target as HTMLSelectElement).value as DbDialect;
                draft.autoDetectDialect = false;
                renderModalContent();
              },
            },
            el('option', { value: 'd1', selected: draft.dialect === 'd1' }, 'Cloudflare D1 Database (REST API)'),
            el('option', { value: 'd1-binding', selected: draft.dialect === 'd1-binding' }, 'Cloudflare D1 (Worker Binding)'),
            el('option', { value: 'libsql', selected: draft.dialect === 'libsql' }, 'Turso / LibSQL (HTTP)'),
            el('option', { value: 'sqlite', selected: draft.dialect === 'sqlite' }, 'SQLite (Server via proxy.php / proxy-node.mjs)')
          );
          specificFields.append(labeledField(t('dialectLabel'), specialSel));

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
                    autocomplete: 'off',
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
                    autocomplete: 'off',
                    value: draft.databaseId || '',
                    placeholder: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx',
                    onInput: (e: Event) => {
                      draft.databaseId = (e.target as HTMLInputElement).value.trim();
                      refreshNamePlaceholder();
                    },
                  })
                )
              ),
              labeledField(
                'Cloudflare API Token (D1 Edit)',
                el('input', {
                  type: 'password',
                  className: 'input mono',
                  autocomplete: 'new-password',
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
                  autocomplete: 'off',
                  value: draft.url || '',
                  placeholder: 'https://your-db-org.turso.io',
                  onInput: (e: Event) => {
                    draft.url = (e.target as HTMLInputElement).value.trim();
                    refreshNamePlaceholder();
                  },
                })
              ),
              labeledField(
                'Auth Token',
                el('input', {
                  type: 'password',
                  className: 'input mono',
                  autocomplete: 'new-password',
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
                  autocomplete: 'off',
                  value: draft.filePath || '',
                  placeholder: 'app.sqlite',
                  onInput: (e: Event) => {
                    draft.filePath = (e.target as HTMLInputElement).value.trim();
                    refreshNamePlaceholder();
                  },
                })
              )
            );
          }
        } else {
          // Streamlined default SQL connection form (auto-detects MySQL / MariaDB / PostgreSQL / URL)
          sslChk = el('input', {
            type: 'checkbox',
            checked: Boolean(draft.ssl),
            onChange: (e: Event) => {
              draft.ssl = (e.target as HTMLInputElement).checked;
            },
          });

          specificFields.append(
            el(
              'div',
              { className: 'field-row' },
              labeledField(
                'Host',
                el('input', {
                  type: 'text',
                  className: 'input mono',
                  autocomplete: 'off',
                  value: draft.host || '',
                  placeholder: 'db.example.com',
                  onInput: (e: Event) => {
                    draft.host = (e.target as HTMLInputElement).value.trim();
                    refreshNamePlaceholder();
                  },
                })
              ),
              labeledField(
                'Port',
                el('input', {
                  type: 'number',
                  className: 'input mono',
                  autocomplete: 'off',
                  value: draft.port ? String(draft.port) : '',
                  placeholder: t('portOptionalPlaceholder'),
                  onInput: (e: Event) => {
                    const v = (e.target as HTMLInputElement).value.trim();
                    draft.port = v ? Number(v) || undefined : undefined;
                  },
                })
              ),
              labeledField(
                t('databaseOptionalLabel'),
                el('input', {
                  type: 'text',
                  className: 'input mono',
                  autocomplete: 'off',
                  value: draft.database || '',
                  placeholder: t('databaseOptionalPlaceholder'),
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
                  autocomplete: 'off',
                  value: draft.user || '',
                  placeholder: 'root / postgres',
                  onInput: (e: Event) => {
                    draft.user = (e.target as HTMLInputElement).value;
                    refreshNamePlaceholder();
                  },
                })
              ),
              labeledField(
                'Password',
                el('input', {
                  type: 'password',
                  className: 'input mono',
                  autocomplete: 'new-password',
                  value: draft.password || '',
                  onInput: (e: Event) => {
                    draft.password = (e.target as HTMLInputElement).value;
                  },
                })
              )
            ),
            el(
              'div',
              { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' } },
              el(
                'label',
                { style: { display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '0.82rem' } },
                sslChk,
                t('sslEnableLabel')
              )
            )
          );
        }

        const connUrlInp = el('input', {
          type: 'password',
          className: 'input mono',
          autocomplete: 'new-password',
          spellcheck: 'false',
          value: draft.url || '',
          placeholder: 'mysql://user:pass@host:3306/db  |  postgresql://user:pass@host:5432/db',
          onInput: (e: Event) => {
            const v = (e.target as HTMLInputElement).value.trim();
            draft.url = v;
            const urlSsl = detectUrlSslOverride(v);
            if (urlSsl !== undefined) {
              draft.ssl = urlSsl;
              if (sslChk) sslChk.checked = urlSsl;
            }
            refreshNamePlaceholder();
          },
        });

        // Collapsible advanced settings (hidden by default: Connection URL, Connection Name, Proxy URL, Proxy Token, Dialect Override, Self-Signed TLS)
        const advancedDetails = el(
          'details',
          {
            className: 'conn-advanced',
            ...(advancedOpen ? { open: true } : {}),
            onToggle: (e: Event) => {
              advancedOpen = (e.target as HTMLDetailsElement).open;
            },
          },
          el('summary', {}, t('advancedSettingsSummary')),
          el(
            'div',
            { className: 'conn-advanced-body' },
            !specializedMode && labeledField(t('connUrlLabel'), connUrlInp),
            el('div', { className: 'field-row' }, labeledField(t('connNameLabel'), nameInp), labeledField(t('dialectLabel'), dialectOverrideSel)),
            el('div', { className: 'field-row' }, labeledField(t('proxyUrlLabel'), proxyUrlInp), labeledField(t('proxyTokenLabel'), proxyTokenInp)),
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

        const testStatus = el('div', { style: { fontSize: '0.82rem' } });
        const rememberChk = el('input', {
          type: 'checkbox',
          checked: Boolean(draft.rememberSecrets),
          onChange: (e: Event) => {
            draft.rememberSecrets = (e.target as HTMLInputElement).checked;
          },
        });

        const switchSpecialBtn = el(
          'button',
          {
            type: 'button',
            className: 'btn btn-ghost btn-sm',
            onClick: () => {
              specializedMode = !specializedMode;
              if (specializedMode) {
                draft.autoDetectDialect = false;
                if (!SPECIALIZED_DIALECTS.has(draft.dialect)) draft.dialect = 'd1';
              } else {
                draft.autoDetectDialect = true;
                draft.dialect = 'mysql';
              }
              renderModalContent();
            },
          },
          specializedMode ? t('standardDbToggleBtn') : t('specialDbToggleBtn')
        );

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
                'div',
                { className: 'toolbar-group' },
                switchSpecialBtn,
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
              )
            ),
            specificFields,
            advancedDetails,
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
                    const probeDraft: ConnectionConfig = {
                      ...draft,
                      proxyUrl: draft.proxyUrl || DEFAULT_WORKER_PROXY_URL,
                    };
                    const adapter = new ProxyDatabaseAdapter(probeDraft);
                    const res = await adapter.testConnection();
                    if (res.ok) {
                      if (res.dialect) {
                        draft.dialect = res.dialect;
                        draft.autoDetectDialect = false;
                      }
                      const dialectTag = res.dialect ? ` [${res.dialect.toUpperCase()}]` : '';
                      testStatus.textContent = `${t('connTestSuccess')}${dialectTag}: ${res.version} (${res.durationMs}ms)`;
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
                    const finalConn: ConnectionConfig = {
                      ...draft,
                      proxyUrl: draft.proxyUrl || DEFAULT_WORKER_PROXY_URL,
                      name: deriveDefaultConnectionName(draft),
                    };
                    store.upsertConnection(finalConn);
                    try {
                      await store.connectTo(finalConn);
                      close();
                      toast(`${finalConn.name} ${t('connectedSuffix')}`, 'success');
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
