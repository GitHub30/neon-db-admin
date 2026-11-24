import { t } from '../i18n/translations.js';
import { icon } from './icons.js';

export type ChildNode = Node | string | number | null | undefined | false;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, unknown> = {},
  ...children: ChildNode[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'className') {
      node.className = String(v);
    } else if (k === 'style' && typeof v === 'object') {
      for (const [sk, sv] of Object.entries(v as Record<string, string>)) {
        if (sk.startsWith('--')) node.style.setProperty(sk, sv);
        else (node.style as unknown as Record<string, string>)[sk] = sv;
      }
    } else if (k.startsWith('on') && typeof v === 'function') {
      node.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    } else if (k === 'dataset' && typeof v === 'object') {
      for (const [dk, dv] of Object.entries(v as Record<string, string>)) {
        node.dataset[dk] = dv;
      }
    } else if (k === 'checked' || k === 'disabled' || k === 'selected' || k === 'multiple' || k === 'readOnly') {
      (node as unknown as Record<string, unknown>)[k] = Boolean(v);
    } else if (k === 'value') {
      (node as HTMLInputElement).value = String(v);
    } else {
      node.setAttribute(k, v === true ? '' : String(v));
    }
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    node.appendChild(typeof child === 'string' || typeof child === 'number' ? document.createTextNode(String(child)) : child);
  }
  return node;
}

let toastHost: HTMLElement | null = null;

function getToastHost(): HTMLElement {
  if (!toastHost || !document.body.contains(toastHost)) {
    toastHost = el('div', { className: 'toast-container', role: 'status', 'aria-live': 'polite' });
    document.body.appendChild(toastHost);
  }
  return toastHost;
}

export function toast(message: string, variant: 'info' | 'success' | 'error' = 'info', ms = 3200): void {
  const host = getToastHost();
  const item = el('div', { className: `toast toast-${variant}` }, message);
  host.appendChild(item);
  setTimeout(() => {
    item.style.opacity = '0';
    item.style.transition = 'opacity 180ms ease';
    setTimeout(() => item.remove(), 200);
  }, ms);
}

export async function copyToClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    toast(t('copied'), 'success', 2000);
  } catch {
    const ta = el('textarea', { value: text });
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    toast(t('copied'), 'success', 2000);
  }
}

export interface ModalHandle {
  close: () => void;
  body: HTMLElement;
  footer: HTMLElement;
}

// Track open modal stack so Escape closes ONLY the topmost modal (H11)
const modalStack: Array<{ close: () => void; panel: HTMLElement }> = [];
let fieldIdCounter = 1;

export function nextFieldId(prefix = 'fld'): string {
  return `${prefix}-${fieldIdCounter++}`;
}

export function labeledField(labelText: string, control: HTMLElement, extraLabel?: Node | null): HTMLElement {
  const id = control.id || nextFieldId();
  control.id = id;
  return el(
    'div',
    { className: 'field' },
    el('label', { className: 'label', for: id }, labelText, extraLabel ? ' ' : null, extraLabel || null),
    control
  );
}

export function openModal(opts: {
  title: string;
  large?: boolean;
  onClose?: () => void;
  renderBody: (body: HTMLElement, close: () => void) => void;
  renderFooter?: (footer: HTMLElement, close: () => void) => void;
}): ModalHandle {
  const previouslyFocused = document.activeElement as HTMLElement | null;
  const titleId = `modal-title-${Date.now()}-${fieldIdCounter++}`;
  let closed = false;

  const close = () => {
    if (closed) return;
    closed = true;
    const idx = modalStack.findIndex((m) => m.close === close);
    if (idx >= 0) modalStack.splice(idx, 1);
    document.removeEventListener('keydown', onKey);
    backdrop.remove();
    opts.onClose?.();
    previouslyFocused?.focus?.();
  };

  const closeBtn = el(
    'button',
    {
      type: 'button',
      className: 'btn btn-ghost btn-icon',
      'aria-label': t('close'),
      onClick: close,
    },
    icon('close', 16)
  );

  const header = el(
    'div',
    { className: 'modal-header' },
    el('h2', { id: titleId, className: 'modal-title' }, opts.title),
    closeBtn
  );

  const body = el('div', { className: 'modal-body' });
  const footer = el('div', { className: 'modal-footer' });

  const panel = el(
    'div',
    {
      className: `modal-panel ${opts.large ? 'modal-panel-lg' : ''}`,
      role: 'dialog',
      'aria-modal': 'true',
      'aria-labelledby': titleId,
      onClick: (e: Event) => e.stopPropagation(),
    },
    header,
    body,
    ...(opts.renderFooter ? [footer] : [])
  );

  const backdrop = el('div', { className: 'modal-backdrop', onClick: close }, panel);

  const onKey = (e: KeyboardEvent) => {
    const top = modalStack[modalStack.length - 1];
    if (!top || top.close !== close) return;

    if (e.key === 'Escape') {
      e.preventDefault();
      close();
      return;
    }

    // Accessible Tab focus trap inside topmost modal
    if (e.key === 'Tab') {
      const focusables = Array.from(
        panel.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      ).filter((node) => node.offsetParent !== null);
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };

  modalStack.push({ close, panel });
  opts.renderBody(body, close);
  opts.renderFooter?.(footer, close);

  document.body.appendChild(backdrop);
  document.addEventListener('keydown', onKey);
  closeBtn.focus();

  return { close, body, footer };
}

export function confirmSqlModal(opts: {
  title?: string;
  description?: string;
  sql: string;
  danger?: boolean;
}): Promise<boolean> {
  return new Promise((resolve) => {
    let decided = false;
    openModal({
      title: opts.title || t('destructiveTitle'),
      onClose: () => {
        if (!decided) resolve(false);
      },
      renderBody: (body) => {
        body.append(
          el('p', { style: { margin: '0', color: 'var(--ink-secondary)' } }, opts.description || t('destructiveDesc')),
          el('pre', { className: 'code-block' }, opts.sql)
        );
      },
      renderFooter: (footer, close) => {
        footer.append(
          el(
            'button',
            {
              type: 'button',
              className: 'btn',
              onClick: () => {
                decided = true;
                close();
                resolve(false);
              },
            },
            t('cancel')
          ),
          el(
            'button',
            {
              type: 'button',
              className: `btn ${opts.danger !== false ? 'btn-danger' : 'btn-primary'}`,
              onClick: () => {
                decided = true;
                close();
                resolve(true);
              },
            },
            t('confirm')
          )
        );
      },
    });
  });
}
