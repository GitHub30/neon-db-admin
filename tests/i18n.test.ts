import { describe, expect, it } from 'vitest';
import { ensureLocaleLoaded, getLocaleOption, LOCALE_OPTIONS, setLocale, t, type TranslationKey } from '../src/i18n/translations.js';

const SAMPLE_KEYS: TranslationKey[] = [
  'connect',
  'newConnection',
  'uploadSqlite',
  'proxySetup',
  'tabData',
  'tabSql',
  'tabEr',
  'emptyHeroTitle',
  'openConnManagerBtn',
  'noConnectionsOption',
  'proxyTokenPlaceholder',
  'downloadPhpBtn',
  'downloadNodeBtn',
  'selectLanguage',
];

describe('i18n translations (JA / EN / ZH / KO / VI)', () => {
  it('exposes all 5 supported locales in LOCALE_OPTIONS', () => {
    expect(LOCALE_OPTIONS.map((o) => o.code)).toEqual(['ja', 'en', 'zh', 'ko', 'vi']);
    expect(getLocaleOption('zh').htmlLang).toBe('zh-CN');
    expect(getLocaleOption('ko').label).toBe('한국어');
    expect(getLocaleOption('vi').label).toBe('Tiếng Việt');
  });

  it('returns non-empty, localized strings for Chinese, Korean, Vietnamese, English, and Japanese', async () => {
    const byLocale: Record<string, Record<string, string>> = {};
    for (const opt of LOCALE_OPTIONS) {
      await ensureLocaleLoaded(opt.code);
      setLocale(opt.code);
      byLocale[opt.code] = {};
      for (const k of SAMPLE_KEYS) {
        const val = t(k);
        expect(val.trim().length, `${opt.code}.${k} should not be empty`).toBeGreaterThan(0);
        byLocale[opt.code][k] = val;
      }
    }
    // Verify distinct translations across languages
    expect(byLocale.zh.connect).toBe('连接管理');
    expect(byLocale.ko.connect).toBe('연결 관리');
    expect(byLocale.vi.connect).toBe('Quản lý kết nối');
    expect(byLocale.en.connect).toBe('Connections');
    expect(byLocale.ja.connect).toBe('接続管理');
    // Reset default
    setLocale('ja');
  });
});
