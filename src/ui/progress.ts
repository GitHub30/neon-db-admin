import { t } from '../i18n/translations.js';

export interface ProgressOptions {
  /** Defer showing the bar by this many ms (avoids flashing for instant cached imports). Default: 0. */
  delayMs?: number;
  /** Accessible label announced when active. */
  label?: string;
}

const MIN_VISIBLE_MS = 220;
const FINISH_FADE_MS = 280;

let activeCount = 0;
let visibleCount = 0;
let shownAt = 0;
let minVisibleTimer: ReturnType<typeof setTimeout> | null = null;
let hideTimer: ReturnType<typeof setTimeout> | null = null;

function clearTimers(): void {
  if (minVisibleTimer !== null) {
    clearTimeout(minVisibleTimer);
    minVisibleTimer = null;
  }
  if (hideTimer !== null) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }
}

function getProgressElement(): HTMLElement | null {
  if (typeof document === 'undefined' || !document.body) return null;
  let el = document.getElementById('app-progress');
  if (!el) {
    el = document.createElement('div');
    el.id = 'app-progress';
    el.className = 'linear-progress';
    el.setAttribute('role', 'progressbar');
    el.setAttribute('aria-label', t('loading'));
    el.setAttribute('aria-hidden', 'true');
    for (const cls of [
      'linear-progress-bar linear-progress-bar-primary',
      'linear-progress-bar linear-progress-bar-secondary',
      'linear-progress-bar linear-progress-bar-complete',
    ]) {
      const bar = document.createElement('div');
      bar.className = cls;
      el.appendChild(bar);
    }
    document.body.prepend(el);
  }
  return el;
}

function showBar(label?: string): void {
  clearTimers();
  const el = getProgressElement();
  if (!el) return;
  el.setAttribute('aria-label', label || t('loading'));
  el.setAttribute('aria-hidden', 'false');
  el.setAttribute('aria-busy', 'true');
  el.classList.remove('is-finishing');
  if (!el.classList.contains('is-active')) {
    el.classList.add('is-active');
    shownAt = Date.now();
  }
}

function scheduleHideBar(): void {
  const el = getProgressElement();
  if (!el) return;

  const finish = () => {
    minVisibleTimer = null;
    if (visibleCount > 0) return;
    el.classList.remove('is-active');
    el.classList.add('is-finishing');
    hideTimer = setTimeout(() => {
      hideTimer = null;
      if (visibleCount > 0) return;
      el.classList.remove('is-finishing');
      el.setAttribute('aria-hidden', 'true');
      el.setAttribute('aria-busy', 'false');
    }, FINISH_FADE_MS);
  };

  const elapsed = Date.now() - shownAt;
  const remaining = Math.max(0, MIN_VISIBLE_MS - elapsed);
  if (remaining > 0) {
    clearTimers();
    minVisibleTimer = setTimeout(finish, remaining);
  } else {
    clearTimers();
    finish();
  }
}

/**
 * Starts a reference-counted top linear progress bar task and returns an idempotent stop function.
 */
export function beginProgress(options?: ProgressOptions): () => void {
  const delayMs = options?.delayMs ?? 0;
  let stopped = false;
  let becameVisible = false;
  let delayTimer: ReturnType<typeof setTimeout> | null = null;

  activeCount++;

  const activate = () => {
    if (stopped || becameVisible) return;
    becameVisible = true;
    visibleCount++;
    if (visibleCount === 1) {
      showBar(options?.label);
    }
  };

  if (delayMs > 0) {
    delayTimer = setTimeout(() => {
      delayTimer = null;
      activate();
    }, delayMs);
  } else {
    activate();
  }

  return () => {
    if (stopped) return;
    stopped = true;
    if (delayTimer !== null) {
      clearTimeout(delayTimer);
      delayTimer = null;
    }
    activeCount = Math.max(0, activeCount - 1);
    if (becameVisible) {
      visibleCount = Math.max(0, visibleCount - 1);
      if (visibleCount === 0) {
        scheduleHideBar();
      }
    }
  };
}

/**
 * Tracks a Promise or async function with the top linear progress bar.
 */
export async function trackProgress<T>(
  task: Promise<T> | (() => Promise<T>),
  options?: ProgressOptions
): Promise<T> {
  const stop = beginProgress(options);
  try {
    return await (typeof task === 'function' ? task() : task);
  } finally {
    stop();
  }
}

/**
 * Runs an async button handler while showing the top linear progress bar and preventing double-clicks.
 */
export async function runWithButtonBusy<T>(
  btn: HTMLButtonElement | null | undefined,
  task: () => Promise<T>,
  options?: ProgressOptions
): Promise<T> {
  const prevDisabled = btn ? btn.disabled : false;
  if (btn) {
    btn.disabled = true;
    btn.setAttribute('aria-busy', 'true');
  }
  try {
    return await trackProgress(task, options);
  } finally {
    if (btn) {
      btn.disabled = prevDisabled;
      btn.removeAttribute('aria-busy');
    }
  }
}

export function getActiveProgressCount(): number {
  return activeCount;
}

export function resetProgressForTest(): void {
  clearTimers();
  activeCount = 0;
  visibleCount = 0;
  shownAt = 0;
  const el = typeof document !== 'undefined' ? document.getElementById('app-progress') : null;
  if (el) {
    el.classList.remove('is-active', 'is-finishing');
    el.setAttribute('aria-hidden', 'true');
    el.setAttribute('aria-busy', 'false');
  }
}
