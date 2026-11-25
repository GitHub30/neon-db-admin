import type { Locale } from '../types/db.js';

export const DEFAULT_WORKER_PROXY_URL = 'https://neon-db-admin-proxy.6u.workers.dev';

export interface LocaleOption {
  code: Locale;
  htmlLang: string;
  label: string;
  short: string;
}

export const LOCALE_OPTIONS: readonly LocaleOption[] = [
  { code: 'ja', htmlLang: 'ja', label: '日本語', short: 'JA' },
  { code: 'en', htmlLang: 'en', label: 'English', short: 'EN' },
  { code: 'zh', htmlLang: 'zh-CN', label: '中文 (简体)', short: 'ZH' },
  { code: 'ko', htmlLang: 'ko', label: '한국어', short: 'KO' },
  { code: 'vi', htmlLang: 'vi', label: 'Tiếng Việt', short: 'VI' },
] as const;

const ja = {
  appName: 'Neon DB Admin',
  tagline: 'ユニバーサル データベース管理 & ER図デザイナー',
  connect: '接続管理',
  newConnection: '新規接続',
  uploadSqlite: 'SQLiteファイルを開く',
  proxySetup: 'プロキシ設定 / ダウンロード',
  commandPalette: 'コマンドパレット',
  docsFaq: 'ドキュメント / FAQ',
  installPwa: 'アプリをインストール',
  themeLight: 'ライト',
  themeDark: 'ダーク',
  themeSystem: 'システム',
  searchObjects: 'テーブル・ビューを検索...',
  connections: '接続一覧',
  tables: 'テーブル',
  views: 'ビュー',
  triggers: 'トリガー',
  indexes: 'インデックス',
  foreignKeys: '外部キー',
  refresh: '再読み込み',
  createTable: 'テーブル作成',
  tabData: 'データ閲覧・編集',
  tabSql: 'SQLエディタ',
  tabStructure: '構造・DDL',
  tabEr: 'ER図デザイナー',
  tabIo: 'インポート / エクスポート',
  tabTools: '便利ツール・分析',
  runQuery: '実行 (Ctrl+Enter)',
  runSelected: '選択実行',
  explainQuery: '実行計画 (EXPLAIN)',
  formatSql: 'SQL整形',
  saveSnippet: 'スニペット保存',
  clear: 'クリア',
  history: 'クエリ履歴',
  snippets: '保存済みスニペット',
  results: '実行結果',
  chartView: 'チャート表示',
  tableView: 'テーブル表示',
  addRow: '行を追加',
  deleteSelected: '選択行を削除',
  commitChanges: '変更を保存',
  discardChanges: '変更を破棄',
  previewSql: 'SQLプレビュー',
  filter: 'フィルタ',
  addFilter: '条件を追加',
  applyFilter: '適用',
  resetFilter: 'リセット',
  quickSearch: 'クイック検索...',
  rowsPerPage: '表示件数',
  prevPage: '前へ',
  nextPage: '次へ',
  exportCsv: 'CSV',
  exportJson: 'JSON',
  exportSql: 'SQL INSERT',
  exportMarkdown: 'Markdown',
  exportSqlite: 'SQLite保存 (.sqlite)',
  noTableSelected: '左のサイドバーからテーブルを選択するか、SQLエディタでクエリを実行してください。',
  cellInspector: 'セル詳細インスペクタ',
  setNull: 'NULL に設定',
  saveCell: '適用',
  cancel: 'キャンセル',
  confirm: '実行する',
  close: '閉じる',
  erReverse: 'DBからリバース生成',
  erForward: 'DDL生成・DBへ適用',
  erAddTable: 'テーブル追加',
  erAddRelation: 'リレーション追加',
  erAutoLayout: '自動レイアウト',
  erFitView: '全体表示',
  erExportSvg: 'SVG出力',
  erExportPng: 'PNG出力',
  erExportMermaid: 'Mermaid出力',
  erExportDbml: 'DBML出力',
  erExportSql: 'DDL出力',
  erSaveModel: 'モデル保存',
  erLoadModel: 'モデル読込',
  connected: '接続中',
  disconnected: '未接続',
  loading: '読み込み中...',
  rows: '行',
  affected: '影響行',
  ms: 'ms',
  offlineReady: 'オフライン利用可能 (PWA)',
  dropSqliteHint: 'ここに .sqlite / .db / .sql ファイルをドロップして開く',
  destructiveTitle: '破壊的操作の確認',
  destructiveDesc: 'この操作はデータベースの内容を変更・削除します。実行するSQLを確認してください。',
  copied: 'クリップボードにコピーしました',
  saved: '保存しました',
  deleted: '削除しました',
  emptySqlite: '新規SQLiteデータベース',
  serverInfo: 'サーバー情報・設定',
  healthCheck: 'スキーマ健全性診断',
  schemaDiff: 'スキーマ差分 & マイグレーション',
  mockGenerator: 'テストデータ自動生成',
  ddlConverter: '方言間DDL変換',
  toggleSidebar: 'サイドバー開閉',
  selectLanguage: '言語を選択',
  switchTheme: 'テーマ切替',
  emptyHeroTitle: 'データベースに接続して開始',
  emptyHeroDesc: 'ローカルの SQLite ファイルを開くか、「接続管理」から MySQL・MariaDB・PostgreSQL・Cloudflare D1 へ接続してください。',
  openConnManagerBtn: '接続管理（リモートDB・プロキシ）',
  noConnectionsOption: '接続先なし（＋新規接続）',
  selectConnectionOption: '接続先を選択...',
  editConnection: '接続を編集',
  deleteConnection: '接続を削除',
  noTables: 'テーブルはありません',
  schemaRefreshed: 'スキーマを更新しました',
  connectFirstHint: '先にデータベースへ接続するか、新規SQLiteを作成してください',
  newSqliteCreated: '新規 SQLite データベースを作成しました',
  connectingSuffix: 'に接続中...',
  connectedSuffix: 'に接続しました',
  connTabSettings: '接続設定',
  connEditSuffix: '編集',
  localSqliteTitle: 'ローカル SQLite (ブラウザ WASM)',
  openSqliteFileBtn: 'SQLiteファイルを開く (.sqlite/.db)',
  remoteDbTitle: 'リモートデータベース接続設定 (Cloudflare Workers / PHP / Node プロキシ)',
  getProxyFilesBtn: 'proxy.php / proxy-node.mjs を取得',
  connNameLabel: '接続名',
  dialectLabel: 'データベース種別',
  proxyMethodLabel: '接続プロキシ方式',
  proxyUrlLabel: 'プロキシ URL',
  proxyTokenLabel: 'プロキシ認証トークン (任意)',
  proxyTokenPlaceholder: 'X-Proxy-Token (任意 — 未設定でも利用可能)',
  connUrlLabel: '接続文字列 URL (任意・入力するとホスト等を上書き)',
  sqlitePathLabel: 'サーバー上の SQLite ファイルパス (SQLITE_ALLOWED_DIR内)',
  d1BindingNote: 'セルフホストした Cloudflare Worker に `[[d1_databases]] binding = "DB"` がバインドされている場合、追加の認証情報なしでクエリできます。',
  sslEnableLabel: 'SSL / TLS 暗号化通信を有効にする（推奨）',
  sslSelfSignedLabel: '自己署名証明書を許可する（開発用・非推奨）',
  rememberSecretsLabel: '認証情報をローカルに永続保存する（未チェック時はタブ終了で消去）',
  purgeSecretsBtn: '保存済み秘密情報を全消去',
  secretsPurgedToast: '保存された認証情報およびメモリ上の秘密情報をすべて消去しました',
  testConnectionBtn: '接続テスト',
  saveAndConnectBtn: '保存して接続',
  testingConnStatus: '接続テスト実行中...',
  connTestSuccess: '接続成功',
  connTestError: '接続エラー',
  proxyStatusChecking: 'ステータス確認中...',
  proxyStatusLive: '稼働中',
  proxyStatusOffline: 'オフライン / 到達不可',
  proxyCardWorkerTitle: '1. Cloudflare Workers プロキシ（全リモートDB対応）',
  proxyCardWorkerDesc: 'Cloudflare Workers の TCP Socket と Fetch API により、MySQL / MariaDB / PostgreSQL / Cloudflare D1 / LibSQL へ CORS (Access-Control-Allow-Origin: *) 対応で接続できます。',
  copyUrlBtn: 'URLをコピー',
  proxyCardPhpTitle: '2. シングルファイル PHP プロキシ (proxy.php)',
  proxyCardPhpDesc: '依存関係ゼロの PHP PDO プロキシ。MySQL / MariaDB / PostgreSQL / SQLite に対応。NEON_DB_PROXY_TOKEN は任意（未設定のまま配置しても動作します）。Access-Control-Allow-Origin: * 標準対応。',
  downloadPhpBtn: 'proxy.php をダウンロード',
  proxyCardNodeTitle: '3. スタンドアロン Node.js プロキシ (proxy-node.mjs)',
  proxyCardNodeDesc: 'ローカル環境や社内ネットワークのDB向け軽量 Node.js 22+ プロキシ。NEON_DB_PROXY_TOKEN は任意（未設定でも動作します）。',
  downloadNodeBtn: 'proxy-node.mjs をダウンロード',
  cmdSearchPlaceholder: 'テーブル名・機能・テーマ・言語を検索...',
  cmdLightMode: 'ライトモードに切替 (Light Mode)',
  cmdDarkMode: 'ダークモードに切替 (Dark Mode)',
  proxyOptWorker: 'Cloudflare Workers プロキシ (CORS対応・ライブ利用可)',
  proxyOptPhp: 'PHP プロキシ (proxy.php)',
  proxyOptNode: 'Node.js プロキシ (proxy-node.mjs)',
  dropTableTitle: 'テーブル削除',
  databases: 'データベース',
  advancedSettingsSummary: '詳細設定（接続URL・接続名・プロキシURL・トークン・DB種別）',
  dialectAutoOption: '自動判別 (MySQL / MariaDB / PostgreSQL / 接続URL)',
  portOptionalPlaceholder: '自動 (3306 / 5432)',
  databaseOptionalLabel: 'Database (任意)',
  databaseOptionalPlaceholder: '未指定でDB一覧を取得',
  connNameAutoHint: '空欄時は $username@$host',
  specialDbToggleBtn: 'Cloudflare D1 / LibSQL / サーバーSQLite を指定',
  standardDbToggleBtn: '通常の SQL サーバー（自動判別）へ戻る',
} as const;

export type TranslationKey = keyof typeof ja;

const dict: Partial<Record<Locale, Record<TranslationKey, string>>> = { ja };

let currentLocale: Locale = 'ja';
let extraLoaded = false;

export async function ensureLocaleLoaded(locale: Locale): Promise<void> {
  if (locale === 'ja' || extraLoaded) return;
  const mod = await import('./locales-extra.js');
  Object.assign(dict, mod.EXTRA_LOCALES);
  extraLoaded = true;
}

export function getLocaleOption(locale: Locale = currentLocale): LocaleOption {
  return LOCALE_OPTIONS.find((o) => o.code === locale) ?? LOCALE_OPTIONS[0];
}

export function setLocale(locale: Locale): void {
  currentLocale = locale;
  if (typeof document !== 'undefined') {
    document.documentElement.lang = getLocaleOption(locale).htmlLang;
  }
}

export function getLocale(): Locale {
  return currentLocale;
}

export function t(key: TranslationKey): string {
  return dict[currentLocale]?.[key] ?? ja[key] ?? key;
}
