import { afterEach, describe, expect, it } from 'vitest';
import {
  beginProgress,
  getActiveProgressCount,
  resetProgressForTest,
  runWithButtonBusy,
  trackProgress,
} from '../src/ui/progress.js';

describe('top linear progress bar manager', () => {
  afterEach(() => {
    resetProgressForTest();
  });

  it('tracks nested and concurrent tasks with idempotent stop functions', () => {
    expect(getActiveProgressCount()).toBe(0);
    const stop1 = beginProgress();
    const stop2 = beginProgress();
    expect(getActiveProgressCount()).toBe(2);

    stop1();
    stop1(); // idempotent — must not decrement twice
    expect(getActiveProgressCount()).toBe(1);

    stop2();
    expect(getActiveProgressCount()).toBe(0);
  });

  it('decrements active count cleanly even when tracked async task throws', async () => {
    await expect(
      trackProgress(async () => {
        expect(getActiveProgressCount()).toBe(1);
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');
    expect(getActiveProgressCount()).toBe(0);
  });

  it('toggles button disabled and aria-busy attributes safely during runWithButtonBusy', async () => {
    const attrs = new Map<string, string>();
    const fakeBtn = {
      disabled: false,
      setAttribute: (k: string, v: string) => attrs.set(k, v),
      removeAttribute: (k: string) => attrs.delete(k),
    } as unknown as HTMLButtonElement;

    const val = await runWithButtonBusy(fakeBtn, async () => {
      expect(fakeBtn.disabled).toBe(true);
      expect(attrs.get('aria-busy')).toBe('true');
      expect(getActiveProgressCount()).toBe(1);
      return 42;
    });

    expect(val).toBe(42);
    expect(fakeBtn.disabled).toBe(false);
    expect(attrs.has('aria-busy')).toBe(false);
    expect(getActiveProgressCount()).toBe(0);
  });
});
