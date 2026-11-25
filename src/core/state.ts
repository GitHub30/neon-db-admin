import type { DatabaseAdapter } from '../adapters/base.js';
import type {
  ActiveView,
  ConnectionConfig,
  DatabaseSchema,
  ERModel,
  Locale,
  QueryHistoryEntry,
  SqlSnippet,
  ThemeMode,
} from '../types/db.js';
import {
  clearAllStoredSecrets,
  loadConnections,
  loadERModels,
  loadHistory,
  loadLocale,
  loadSnippets,
  loadTheme,
  saveConnections,
  saveERModels,
  saveHistory,
  saveLocale,
  saveSnippets,
  saveTheme,
  scrubSecretsFromConnection,
} from './storage.js';
import { ensureLocaleLoaded, setLocale, t } from '../i18n/translations.js';
import { trackProgress } from '../ui/progress.js';

export type StateListener = () => void;

class AppStore {
  connections: ConnectionConfig[] = loadConnections();
  activeConnection: ConnectionConfig | null = null;
  adapter: DatabaseAdapter | null = null;
  schema: DatabaseSchema | null = null;
  availableDatabases: string[] = [];
  activeDatabase: string | null = null;
  databaseSchemas: Record<string, DatabaseSchema> = {};
  expandedDatabases = new Set<string>();
  loadingDatabase: string | null = null;
  schemaRevision = 0;
  selectedTable: string | null = null;
  activeView: ActiveView = 'data';
  pendingSqlToLoad: string | null = null;
  pendingDataFilter: { table: string; column: string; value: string } | null = null;
  history: QueryHistoryEntry[] = loadHistory();
  snippets: SqlSnippet[] = loadSnippets();
  erModels: ERModel[] = loadERModels();
  activeErModel: ERModel | null = null;
  theme: ThemeMode = loadTheme();
  locale: Locale = loadLocale();
  sidebarOpen = false;
  loadingStatus: string | null = null;

  private connectSeq = 0;
  private dbSwitchSeq = 0;
  private listeners = new Set<StateListener>();

  constructor() {
    setLocale(this.locale);
    if (this.locale !== 'ja') {
      void ensureLocaleLoaded(this.locale).then(() => this.notify());
    }
  }

  subscribe(listener: StateListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  notify(): void {
    for (const fn of this.listeners) {
      fn();
    }
  }

  setTheme(mode: ThemeMode): void {
    this.theme = mode;
    saveTheme(mode);
    this.applyTheme();
    this.notify();
  }

  applyTheme(): void {
    const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches;
    const effective = this.theme === 'system' ? (prefersDark ? 'dark' : 'light') : this.theme;
    document.documentElement.dataset.theme = effective;
    const metaTheme = document.getElementById('meta-theme-color') as HTMLMetaElement | null;
    if (metaTheme) {
      metaTheme.content = effective === 'dark' ? '#0d1117' : '#f8fafc';
    }
  }

  async setAppLocale(locale: Locale): Promise<void> {
    await trackProgress(() => ensureLocaleLoaded(locale), { delayMs: 60 });
    this.locale = locale;
    setLocale(locale);
    saveLocale(locale);
    this.notify();
  }

  setActiveView(view: ActiveView): void {
    this.activeView = view;
    this.notify();
  }

  selectTable(tableName: string | null, switchToView?: ActiveView): void {
    this.selectedTable = tableName;
    if (switchToView) this.activeView = switchToView;
    this.sidebarOpen = false;
    this.notify();
  }

  async selectTableInDatabase(dbName: string, tableName: string, switchToView?: ActiveView): Promise<void> {
    if (this.activeDatabase !== dbName) {
      await this.switchDatabase(dbName, false);
    }
    this.selectTable(tableName, switchToView);
  }

  openSqlWithQuery(sql: string): void {
    this.pendingSqlToLoad = sql;
    this.activeView = 'sql';
    this.notify();
  }

  jumpToForeignKey(refTable: string, refColumn: string, value: unknown): void {
    this.selectedTable = refTable;
    this.pendingDataFilter = {
      table: refTable,
      column: refColumn,
      value: value === null || value === undefined ? '' : String(value),
    };
    this.activeView = 'data';
    this.notify();
  }

  upsertConnection(conn: ConnectionConfig): void {
    const idx = this.connections.findIndex((c) => c.id === conn.id);
    if (idx >= 0) this.connections[idx] = conn;
    else this.connections.unshift(conn);
    saveConnections(this.connections);
    this.notify();
  }

  deleteConnection(id: string): void {
    this.connections = this.connections.filter((c) => c.id !== id);
    saveConnections(this.connections);
    this.notify();
  }

  purgeAllSecrets(): void {
    this.connections = clearAllStoredSecrets(this.connections);
    if (this.activeConnection) {
      this.activeConnection = scrubSecretsFromConnection(this.activeConnection);
    }
    this.notify();
  }

  addHistory(entry: Omit<QueryHistoryEntry, 'id' | 'timestamp'>): void {
    this.history.unshift({
      ...entry,
      id: `h-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp: Date.now(),
    });
    if (this.history.length > 100) this.history.length = 100;
    saveHistory(this.history);
    this.notify();
  }

  clearHistory(): void {
    this.history = [];
    saveHistory(this.history);
    this.notify();
  }

  addSnippet(title: string, sql: string): void {
    this.snippets.unshift({
      id: `snip-${Date.now()}`,
      title,
      sql,
      dialect: this.activeConnection?.dialect || 'all',
      createdAt: Date.now(),
    });
    saveSnippets(this.snippets);
    this.notify();
  }

  deleteSnippet(id: string): void {
    this.snippets = this.snippets.filter((s) => s.id !== id);
    saveSnippets(this.snippets);
    this.notify();
  }

  saveErModel(model: ERModel): void {
    this.activeErModel = model;
    const idx = this.erModels.findIndex((m) => m.id === model.id);
    if (idx >= 0) this.erModels[idx] = model;
    else this.erModels.unshift(model);
    saveERModels(this.erModels);
    this.notify();
  }

  async connectTo(conn: ConnectionConfig, binaryBytes?: Uint8Array): Promise<void> {
    return trackProgress(async () => {
      const mySeq = ++this.connectSeq;
      this.loadingStatus = `${conn.name} ${t('connectingSuffix')}`;
      this.notify();

      let nextAdapter: DatabaseAdapter | null = null;
      try {
        if (conn.transport === 'wasm') {
          const { SqliteWasmAdapter } = await import('../adapters/sqlite-wasm.js');
          nextAdapter = new SqliteWasmAdapter(conn, binaryBytes);
        } else {
          const { ProxyDatabaseAdapter } = await import('../adapters/proxy-adapter.js');
          nextAdapter = new ProxyDatabaseAdapter(conn);
        }

        // Connect and introspect BEFORE disconnecting previous working adapter (prevents broken state on failure)
        await nextAdapter.connect();
        const nextSchema = await nextAdapter.introspectSchema();

        if (mySeq !== this.connectSeq) {
          await nextAdapter.disconnect();
          return;
        }

        // Sync auto-detected dialect back onto saved connection so future connects skip probing
        const resolvedConn: ConnectionConfig = {
          ...conn,
          dialect: nextSchema.dialect,
          autoDetectDialect: false,
        };
        const savedIdx = this.connections.findIndex((c) => c.id === conn.id);
        if (savedIdx >= 0) {
          this.connections[savedIdx] = resolvedConn;
          saveConnections(this.connections);
        }

        const prevAdapter = this.adapter;
        this.adapter = nextAdapter;
        this.activeConnection = resolvedConn;
        this.schema = nextSchema;
        this.availableDatabases =
          nextSchema.availableDatabases && nextSchema.availableDatabases.length > 0
            ? nextSchema.availableDatabases
            : nextSchema.databaseName
              ? [nextSchema.databaseName]
              : [];
        this.activeDatabase = nextSchema.databaseName || this.availableDatabases[0] || null;
        this.databaseSchemas = {};
        this.expandedDatabases = new Set<string>();
        if (this.activeDatabase) {
          this.databaseSchemas[this.activeDatabase] = nextSchema;
          this.expandedDatabases.add(this.activeDatabase);
        }
        this.schemaRevision++;
        this.selectedTable = nextSchema.tables[0]?.name ?? nextSchema.views[0]?.name ?? null;
        this.activeErModel = null;

        if (prevAdapter && prevAdapter !== nextAdapter) {
          prevAdapter.disconnect().catch(() => {});
        }
      } catch (err) {
        if (nextAdapter) {
          nextAdapter.disconnect().catch(() => {});
        }
        throw err;
      } finally {
        if (mySeq === this.connectSeq) {
          this.loadingStatus = null;
          this.notify();
        }
      }
    });
  }

  async switchDatabase(dbName: string, selectFirstTable = true): Promise<void> {
    if (!this.adapter) return;
    return trackProgress(async () => {
      if (!this.adapter) return;
      const mySeq = ++this.dbSwitchSeq;
      this.loadingDatabase = dbName;
      this.expandedDatabases.add(dbName);
      this.notify();

      try {
        this.adapter.setActiveDatabase?.(dbName);
        const nextSchema = await this.adapter.introspectSchema(dbName);
        if (mySeq !== this.dbSwitchSeq) return;
        this.activeDatabase = nextSchema.databaseName || dbName;
        this.schema = nextSchema;
        this.databaseSchemas[this.activeDatabase] = nextSchema;
        if (nextSchema.availableDatabases && nextSchema.availableDatabases.length > 0) {
          this.availableDatabases = nextSchema.availableDatabases;
        } else if (!this.availableDatabases.includes(this.activeDatabase)) {
          this.availableDatabases = [...this.availableDatabases, this.activeDatabase];
        }
        this.expandedDatabases.add(this.activeDatabase);
        this.schemaRevision++;
        if (selectFirstTable) {
          this.selectedTable = nextSchema.tables[0]?.name ?? nextSchema.views[0]?.name ?? null;
        }
        this.activeErModel = null;
      } finally {
        if (mySeq === this.dbSwitchSeq) {
          this.loadingDatabase = null;
          this.notify();
        }
      }
    });
  }

  async toggleDatabaseNode(dbName: string): Promise<void> {
    const isExpanded = this.expandedDatabases.has(dbName);
    if (isExpanded && this.activeDatabase === dbName) {
      this.expandedDatabases.delete(dbName);
      this.notify();
      return;
    }
    this.expandedDatabases.add(dbName);
    if (this.activeDatabase !== dbName || !this.databaseSchemas[dbName]) {
      await this.switchDatabase(dbName);
    } else {
      this.notify();
    }
  }

  async refreshSchema(): Promise<void> {
    if (!this.adapter) return;
    return trackProgress(async () => {
      if (!this.adapter) return;
      const nextSchema = await this.adapter.introspectSchema(this.activeDatabase ?? undefined);
      this.schema = nextSchema;
      const activeDb = nextSchema.databaseName || this.activeDatabase;
      if (activeDb) {
        this.activeDatabase = activeDb;
        this.databaseSchemas[activeDb] = nextSchema;
        this.expandedDatabases.add(activeDb);
      }
      if (nextSchema.availableDatabases && nextSchema.availableDatabases.length > 0) {
        this.availableDatabases = nextSchema.availableDatabases;
      }
      this.schemaRevision++;
      if (
        this.selectedTable &&
        !this.schema.tables.some((t) => t.name === this.selectedTable) &&
        !this.schema.views.some((v) => v.name === this.selectedTable)
      ) {
        this.selectedTable = this.schema.tables[0]?.name ?? null;
      }
      this.notify();
    });
  }
}

export const store = new AppStore();
