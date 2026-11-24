import { store } from '../core/state.js';
import { getDialectBadgeInfo } from '../core/dialect.js';
import { t } from '../i18n/translations.js';
import type { ThemeMode } from '../types/db.js';
import { el } from './dom.js';
import { icon } from './icons.js';

export interface TopbarCallbacks {
  onOpenConnections: () => void;
  onUploadSqlite: () => void;
  onOpenCommandPalette: () => void;
  onInstallPwa?: () => void;
  canInstallPwa: () => boolean;
}

export function renderTopbar(container: HTMLElement, cb: TopbarCallbacks): void {
  const conn = store.activeConnection;
  const badgeInfo = conn ? getDialectBadgeInfo(conn.dialect) : null;

  const cycleTheme = () => {
    const order: ThemeMode[] = ['light', 'dark', 'system'];
    const next = order[(order.indexOf(store.theme) + 1) % order.length];
    store.setTheme(next);
  };

  const themeIcon = store.theme === 'dark' ? 'moon' : store.theme === 'light' ? 'sun' : 'monitor';
  const themeLabel = store.theme === 'dark' ? t('themeDark') : store.theme === 'light' ? t('themeLight') : t('themeSystem');

  const left = el(
    'div',
    { className: 'topbar-left' },
    el(
      'button',
      {
        type: 'button',
        className: 'btn btn-ghost btn-icon mobile-menu-btn',
        'aria-label': 'サイドバー開閉',
        'aria-expanded': String(store.sidebarOpen),
        onClick: () => {
          store.sidebarOpen = !store.sidebarOpen;
          store.notify();
        },
      },
      icon('menu', 18)
    ),
    el(
      'a',
      { href: '#workbench', className: 'brand' },
      el('span', { className: 'brand-mark' }, icon('database', 15)),
      el('span', { className: 'brand-name' }, t('appName'))
    ),
    el(
      'button',
      {
        type: 'button',
        id: 'btn-connection-switcher',
        className: 'conn-pill',
        title: t('connect'),
        onClick: cb.onOpenConnections,
      },
      el('span', { className: `status-dot ${conn ? '' : 'offline'}` }),
      el('span', { className: 'conn-pill-text' }, conn ? conn.name : t('disconnected')),
      badgeInfo ? el('span', { className: `badge ${badgeInfo.colorClass} hide-sm` }, badgeInfo.label) : null
    )
  );

  const right = el(
    'div',
    { className: 'topbar-right' },
    el(
      'button',
      {
        type: 'button',
        id: 'btn-upload-sqlite',
        className: 'btn btn-sm hide-sm',
        onClick: cb.onUploadSqlite,
      },
      icon('upload', 14),
      t('uploadSqlite')
    ),
    el(
      'button',
      {
        type: 'button',
        id: 'btn-cmd-palette',
        className: 'btn btn-sm hide-sm',
        title: `${t('commandPalette')} (Ctrl+K)`,
        onClick: cb.onOpenCommandPalette,
      },
      icon('command', 14),
      'Ctrl+K'
    ),
    cb.canInstallPwa()
      ? el(
          'button',
          {
            type: 'button',
            id: 'btn-install-pwa',
            className: 'btn btn-sm btn-primary hide-sm',
            onClick: () => cb.onInstallPwa?.(),
          },
          icon('download', 14),
          t('installPwa')
        )
      : null,
    el(
      'button',
      {
        type: 'button',
        id: 'btn-locale-toggle',
        className: 'btn btn-ghost btn-sm topbar-action-btn',
        'aria-label': '言語切替 (JA / EN)',
        onClick: () => store.setAppLocale(store.locale === 'ja' ? 'en' : 'ja'),
      },
      icon('globe', 14),
      store.locale.toUpperCase()
    ),
    el(
      'button',
      {
        type: 'button',
        id: 'btn-theme-toggle',
        className: 'btn btn-ghost btn-sm topbar-action-btn',
        'aria-label': `テーマ切替 (${themeLabel})`,
        title: `Theme: ${themeLabel}`,
        onClick: cycleTheme,
      },
      icon(themeIcon, 15),
      el('span', { className: 'hide-sm' }, themeLabel)
    )
  );

  container.replaceChildren(left, right);
}
