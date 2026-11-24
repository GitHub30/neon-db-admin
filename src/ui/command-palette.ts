import { store } from '../core/state.js';
import { LOCALE_OPTIONS, t } from '../i18n/translations.js';
import { el, openModal } from './dom.js';
import { openConnectionModal } from './connection-modal.js';

interface CommandAction {
  label: string;
  category: string;
  run: () => void;
}

export function openCommandPalette(): void {
  const actions: CommandAction[] = [
    { label: t('tabData'), category: 'View', run: () => store.setActiveView('data') },
    { label: t('tabSql'), category: 'View', run: () => store.setActiveView('sql') },
    { label: t('tabStructure'), category: 'View', run: () => store.setActiveView('structure') },
    { label: t('tabEr'), category: 'View', run: () => store.setActiveView('er') },
    { label: t('tabIo'), category: 'View', run: () => store.setActiveView('import-export') },
    { label: t('tabTools'), category: 'View', run: () => store.setActiveView('tools') },
    { label: t('newConnection'), category: 'Action', run: () => openConnectionModal() },
    { label: t('proxySetup'), category: 'Action', run: () => openConnectionModal(undefined, 'proxy') },
    { label: t('cmdLightMode'), category: 'Theme', run: () => store.setTheme('light') },
    { label: t('cmdDarkMode'), category: 'Theme', run: () => store.setTheme('dark') },
    ...LOCALE_OPTIONS.map((opt) => ({
      label: `${t('selectLanguage')}: ${opt.label} (${opt.short})`,
      category: 'Language',
      run: () => store.setAppLocale(opt.code),
    })),
  ];

  if (store.schema) {
    for (const tbl of store.schema.tables) {
      actions.push({
        label: `Table: ${tbl.name}`,
        category: 'Table',
        run: () => store.selectTable(tbl.name, 'data'),
      });
      actions.push({
        label: `Structure: ${tbl.name}`,
        category: 'DDL',
        run: () => store.selectTable(tbl.name, 'structure'),
      });
    }
    for (const v of store.schema.views) {
      actions.push({
        label: `View: ${v.name}`,
        category: 'View',
        run: () => store.selectTable(v.name, 'data'),
      });
    }
  }

  openModal({
    title: `${t('commandPalette')} (Ctrl+K)`,
    renderBody: (body, close) => {
      let query = '';
      let activeIdx = 0;

      const inp = el('input', {
        type: 'search',
        className: 'input',
        placeholder: t('cmdSearchPlaceholder'),
        'aria-label': t('commandPalette'),
      });
      const listEl = el('div', { className: 'cmd-list' });

      const getFiltered = () => {
        const q = query.trim().toLowerCase();
        if (!q) return actions.slice(0, 14);
        return actions.filter((a) => a.label.toLowerCase().includes(q) || a.category.toLowerCase().includes(q)).slice(0, 14);
      };

      const renderList = () => {
        const items = getFiltered();
        activeIdx = Math.min(activeIdx, Math.max(0, items.length - 1));
        listEl.replaceChildren(
          ...items.map((item, idx) =>
            el(
              'button',
              {
                type: 'button',
                className: `cmd-item ${idx === activeIdx ? 'active' : ''}`,
                onClick: () => {
                  close();
                  item.run();
                },
              },
              el('span', {}, item.label),
              el('span', { className: 'badge' }, item.category)
            )
          )
        );
      };

      inp.addEventListener('input', () => {
        query = inp.value;
        activeIdx = 0;
        renderList();
      });

      inp.addEventListener('keydown', (e: KeyboardEvent) => {
        const items = getFiltered();
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          activeIdx = (activeIdx + 1) % Math.max(1, items.length);
          renderList();
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          activeIdx = (activeIdx - 1 + Math.max(1, items.length)) % Math.max(1, items.length);
          renderList();
        } else if (e.key === 'Enter' && items[activeIdx]) {
          e.preventDefault();
          close();
          items[activeIdx].run();
        }
      });

      body.append(inp, listEl);
      renderList();
      setTimeout(() => inp.focus(), 10);
    },
  });
}
