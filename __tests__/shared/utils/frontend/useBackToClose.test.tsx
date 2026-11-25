/**
 * useBackToClose (spec-salary-row-and-back-close §I3, AC-SBC-20 hook half, AC-SBC-29 hook half, AC-SBC-36).
 * Same binding harness contract as overlayHistory.test.ts: fake timers, settle only via the harness's bounded
 * HISTORY_SETTLE_MS advance, pop counts beside negative assertions. No getTimerCount() checks here (React's
 * scheduler can hold fake timers); the bounded settle alone rules out the SELF_POP_TIMEOUT_MS valve.
 */

import { StrictMode, useState } from 'react';
import { act, render, renderHook, screen } from '@testing-library/react';
import { useBackToClose } from '../../../../src/shared/utils/frontend/useBackToClose';
import {
  OVERLAY_STATE_KEY,
  __resetOverlayHistoryForTests
} from '../../../../src/shared/utils/frontend/overlayHistory';
import { createOverlayHistoryHarness, type OverlayHistoryHarness } from '../../../helpers/overlayHistoryHarness';

interface HookProps { open: boolean; onBack: () => void; blocked?: boolean }
const useHook = ({ open, onBack, blocked }: HookProps) => useBackToClose(open, onBack, { blocked });

let h: OverlayHistoryHarness | null = null;
const harness = () => {
  h = createOverlayHistoryHarness();
  return h;
};

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  h?.cleanup();
  h = null;
  __resetOverlayHistoryForTests();
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe('not installed (INV-5)', () => {
  it('pushes nothing and runs release(then) synchronously', () => {
    __resetOverlayHistoryForTests();
    const pushState = jest.spyOn(window.history, 'pushState');
    const go = jest.spyOn(window.history, 'go');
    const { result, unmount } = renderHook(useHook, { initialProps: { open: true, onBack: jest.fn() } });

    expect(result.current.isHeld()).toBe(false);
    const then = jest.fn();
    result.current.release(then);
    expect(then).toHaveBeenCalledTimes(1);
    unmount();
    expect(pushState).toHaveBeenCalledTimes(0);
    expect(go).toHaveBeenCalledTimes(0);
  });
});

describe('AC-SBC-36 effect lifecycle', () => {
  it('open false → true → false produces exactly one push then one release', () => {
    const t = harness();
    const pushState = jest.spyOn(window.history, 'pushState');
    const go = jest.spyOn(window.history, 'go');
    const onBack = jest.fn();
    const { result, rerender } = renderHook(useHook, { initialProps: { open: false, onBack } });
    expect(pushState).toHaveBeenCalledTimes(0);

    rerender({ open: true, onBack });
    expect(pushState).toHaveBeenCalledTimes(1);
    expect(result.current.isHeld()).toBe(true);

    rerender({ open: false, onBack });
    expect(go).toHaveBeenCalledTimes(1);
    expect(go).toHaveBeenCalledWith(-1);
    expect(t.settleHistory()).toBe(1);
    expect(result.current.isHeld()).toBe(false);
    expect(onBack).toHaveBeenCalledTimes(0);
    expect(window.history.state?.[OVERLAY_STATE_KEY]).toBeUndefined();
  });

  it('a new onBack arrow on rerender neither re-pushes nor releases, and Back calls the latest one', () => {
    const t = harness();
    const pushState = jest.spyOn(window.history, 'pushState');
    const go = jest.spyOn(window.history, 'go');
    const first = jest.fn();
    const latest = jest.fn();
    const { rerender } = renderHook(useHook, { initialProps: { open: true, onBack: () => first() } });
    rerender({ open: true, onBack: () => first() });
    rerender({ open: true, onBack: () => latest() });

    expect(pushState).toHaveBeenCalledTimes(1);
    expect(go).toHaveBeenCalledTimes(0);
    expect(t.pressBack()).toBe(1);
    expect(latest).toHaveBeenCalledTimes(1);
    expect(first).toHaveBeenCalledTimes(0);
  });

  it('Back closes a real overlay once, and its unmount cleanup touches no history', () => {
    const t = harness();
    function Host() {
      const [open, setOpen] = useState(true);
      return open ? <Sheet onClose={() => setOpen(false)} /> : <p>closed</p>;
    }
    function Sheet({ onClose }: { onClose: () => void }) {
      useBackToClose(true, onClose);
      return <div role="dialog" aria-modal="true">sheet</div>;
    }
    render(<Host />);
    const go = jest.spyOn(window.history, 'go');
    const pushState = jest.spyOn(window.history, 'pushState');

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(t.pressBack()).toBe(1);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByText('closed')).toBeInTheDocument();
    expect(go).toHaveBeenCalledTimes(0);
    expect(pushState).toHaveBeenCalledTimes(0);
    expect(t.router.replace).toHaveBeenCalledTimes(0);
  });

  it('blocked makes Back inert until it clears', () => {
    const t = harness();
    const onBack = jest.fn();
    const { result, rerender } = renderHook(useHook, { initialProps: { open: true, onBack, blocked: true } });

    expect(t.pressBack()).toBe(1);
    expect(onBack).toHaveBeenCalledTimes(0);
    expect(result.current.isHeld()).toBe(true);

    rerender({ open: true, onBack, blocked: false });
    expect(t.pressBack()).toBe(1);
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('StrictMode double effects (E-SBC-21) end with one held entry', () => {
    const t = harness();
    const onBack = jest.fn();
    const { result } = renderHook(useHook, { initialProps: { open: true, onBack }, wrapper: StrictMode });

    expect(t.settleHistory()).toBe(1);
    expect(result.current.isHeld()).toBe(true);
    expect(typeof window.history.state?.[OVERLAY_STATE_KEY]).toBe('string');
    expect(t.pressBack()).toBe(1);
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(window.history.state?.key).toBe(t.baseKey);
    expect(window.history.state?.[OVERLAY_STATE_KEY]).toBeUndefined();
  });
});

describe('AC-SBC-29 release(then)', () => {
  it('runs then once, after the popstate, while held', () => {
    const t = harness();
    const go = jest.spyOn(window.history, 'go');
    const popsSeenByThen: number[] = [];
    const then = jest.fn(() => { popsSeenByThen.push(t.popCount()); });
    const { result, rerender } = renderHook(useHook, { initialProps: { open: true, onBack: jest.fn() } });
    const popsBefore = t.popCount();

    act(() => { result.current.release(then); });
    expect(then).toHaveBeenCalledTimes(0);
    expect(go).toHaveBeenCalledTimes(1);

    expect(t.settleHistory()).toBe(1);
    expect(then).toHaveBeenCalledTimes(1);
    expect(popsSeenByThen).toEqual([popsBefore + 1]);

    rerender({ open: false, onBack: jest.fn() }); // the later effect cleanup is a no-op
    expect(t.settleHistory()).toBe(0);
    expect(go).toHaveBeenCalledTimes(1);
    expect(then).toHaveBeenCalledTimes(1);
  });

  it('runs then synchronously while not held', () => {
    harness();
    const { result } = renderHook(useHook, { initialProps: { open: false, onBack: jest.fn() } });
    const then = jest.fn();
    result.current.release(then);
    expect(then).toHaveBeenCalledTimes(1);
    expect(result.current.isHeld()).toBe(false);
  });
});
