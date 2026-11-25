import { store } from '../core/state.js';
import { getLocaleOption, LOCALE_OPTIONS, t } from '../i18n/translations.js';
import type { DbDialect, ThemeMode } from '../types/db.js';
import { el } from './dom.js';
import { flagIcon, icon } from './icons.js';

const DIALECT_BADGES: Record<DbDialect, { label: string; colorClass: string }> = {
  sqlite: { label: 'SQLite', colorClass: 'badge-sqlite' },
  mysql: { label: 'MySQL', colorClass: 'badge-mysql' },
  mariadb: { label: 'MariaDB', colorClass: 'badge-mariadb' },
  postgresql: { label: 'PostgreSQL', colorClass: 'badge-pg' },
  d1: { label: 'D1', colorClass: 'badge-d1' },
  'd1-binding': { label: 'D1 Binding', colorClass: 'badge-d1' },
  libsql: { label: 'LibSQL', colorClass: 'badge-libsql' },
};

export interface TopbarCallbacks {
  onOpenConnections: () => void;
  onUploadSqlite: () => void;
  onOpenCommandPalette: () => void;
  onInstallPwa?: () => void;
  canInstallPwa: () => boolean;
}

let cleanupLocaleListeners: (() => void) | null = null;

export function renderTopbar(container: HTMLElement, cb: TopbarCallbacks): void {
  cleanupLocaleListeners?.();
  cleanupLocaleListeners = null;

  const conn = store.activeConnection;
  const badgeInfo = conn ? DIALECT_BADGES[conn.dialect] : null;
  const currentLoc = getLocaleOption(store.locale);

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
        'aria-label': t('toggleSidebar'),
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

  // Flag Language Dropdown (accessible custom listbox with inline SVG flags)
  let menuOpen = false;
  const localeMenu = el('div', {
    id: 'locale-dropdown-menu',
    className: 'locale-menu',
    role: 'listbox',
    'aria-label': t('selectLanguage'),
    hidden: true,
  });

  const localeTrigger = el(
    'button',
    {
      type: 'button',
      id: 'btn-locale-toggle',
      className: 'btn btn-ghost btn-sm topbar-action-btn locale-trigger',
      'aria-label': `${t('selectLanguage')}: ${currentLoc.label}`,
      'aria-haspopup': 'listbox',
      'aria-expanded': 'false',
      'aria-controls': 'locale-dropdown-menu',
      title: `${t('selectLanguage')} (${currentLoc.label})`,
    },
    flagIcon(currentLoc.code, 20, 14),
    el('span', {}, currentLoc.short),
    icon('chevronDown', 14)
  );

  const optionButtons: HTMLButtonElement[] = [];
  let menuPopulated = false;

  const ensureMenuPopulated = () => {
    if (menuPopulated) return;
    menuPopulated = true;
    LOCALE_OPTIONS.forEach((opt, idx) => {
      const isSelected = opt.code === store.locale;
      const btn = el(
        'button',
        {
          type: 'button',
          role: 'option',
          className: 'locale-option',
          'aria-selected': String(isSelected),
          dataset: { locale: opt.code },
          onClick: async () => {
            setMenuOpen(false);
            if (opt.code !== store.locale) {
              await store.setAppLocale(opt.code);
            }
            document.getElementById('btn-locale-toggle')?.focus();
          },
          onKeydown: (e: KeyboardEvent) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              optionButtons[(idx + 1) % optionButtons.length]?.focus();
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              optionButtons[(idx - 1 + optionButtons.length) % optionButtons.length]?.focus();
            } else if (e.key === 'Home') {
              e.preventDefault();
              optionButtons[0]?.focus();
            } else if (e.key === 'End') {
              e.preventDefault();
              optionButtons[optionButtons.length - 1]?.focus();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              setMenuOpen(false);
              localeTrigger.focus();
            }
          },
        },
        el('span', { className: 'locale-option-main' }, flagIcon(opt.code, 20, 14), el('span', {}, opt.label)),
        isSelected ? icon('check', 14) : null
      );
      optionButtons.push(btn);
      localeMenu.append(btn);
    });
  };

  const setMenuOpen = (open: boolean, focusSelected = false) => {
    if (open) ensureMenuPopulated();
    menuOpen = open;
    localeMenu.hidden = !open;
    localeTrigger.setAttribute('aria-expanded', String(open));
    if (open && focusSelected) {
      const selectedIdx = LOCALE_OPTIONS.findIndex((o) => o.code === store.locale);
      optionButtons[Math.max(0, selectedIdx)]?.focus();
    }
  };

  localeTrigger.addEventListener('click', (e: Event) => {
    e.stopPropagation();
    setMenuOpen(!menuOpen, false);
  });

  localeTrigger.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setMenuOpen(true, true);
    } else if (e.key === 'Escape' && menuOpen) {
      e.preventDefault();
      setMenuOpen(false);
    }
  });

  const localeDropdown = el('div', { className: 'locale-dropdown' }, localeTrigger, localeMenu);

  const onDocPointerDown = (e: Event) => {
    if (menuOpen && !localeDropdown.contains(e.target as Node)) {
      setMenuOpen(false);
    }
  };
  const onDocKeyDown = (e: KeyboardEvent) => {
    if (menuOpen && e.key === 'Escape') {
      setMenuOpen(false);
      localeTrigger.focus();
    }
  };
  document.addEventListener('pointerdown', onDocPointerDown);
  document.addEventListener('keydown', onDocKeyDown);
  cleanupLocaleListeners = () => {
    document.removeEventListener('pointerdown', onDocPointerDown);
    document.removeEventListener('keydown', onDocKeyDown);
  };

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
    localeDropdown,
    el(
      'button',
      {
        type: 'button',
        id: 'btn-theme-toggle',
        className: 'btn btn-ghost btn-sm topbar-action-btn',
        'aria-label': `${t('switchTheme')} (${themeLabel})`,
        title: `${t('switchTheme')}: ${themeLabel}`,
        onClick: cycleTheme,
      },
      icon(themeIcon, 15),
      el('span', { className: 'hide-sm' }, themeLabel)
    )
  );

  container.replaceChildren(left, right);
}
