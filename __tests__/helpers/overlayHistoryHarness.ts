/**
 * Test harness for overlayHistory.ts (spec-salary-row-and-back-close §I3 "Test harness contract", binding).
 *
 * - Uses jsdom's real session history. jsdom fires `popstate` after history.back()/go() only after two chained
 *   zero-delay setTimeouts, and under @sinonjs/fake-timers the second one lands at now + 1 (it is created during a
 *   tick). So `advanceTimersByTime(0)` misses the pop, and runAllTimers()/runOnlyPendingTimers() can trip
 *   SELF_POP_TIMEOUT_MS instead. Settle ONLY through settleHistory()/pressBack() (one bounded 20 ms advance).
 * - Requires `jest.useFakeTimers()` in the calling test file.
 * - A Next stand-in popstate listener is registered BEFORE install (Next registers its listener at router
 *   construction), counts pops, and calls the stored beforePopState unless in "isSsr" mode.
 * - The base entry is Next-shaped ({ __N, url, as, options, key }), never jsdom's bare null.
 */

import { act } from '@testing-library/react';
import {
  __resetOverlayHistoryForTests,
  installOverlayHistory,
  type OverlayHistoryRouter
} from '../../src/shared/utils/frontend/overlayHistory';

export const HISTORY_SETTLE_MS = 20;
export const PREVIOUS_PAGE = '/previous-page';

export interface FakeRouter extends OverlayHistoryRouter {
  asPath: string;
  beforePopState: jest.Mock<void, [(state: unknown) => boolean]>;
  replace: jest.Mock<Promise<boolean>, [string, undefined?, { shallow?: boolean; scroll?: boolean }?]>;
}

export interface OverlayHistoryHarness {
  router: FakeRouter;
  /** Next's key on the base entry. */
  baseKey: string;
  baseState: Record<string, unknown>;
  /** Every value the stored beforePopState returned, in order. */
  beforePopStateResults: boolean[];
  /** States beforePopState was called with, in order. */
  beforePopStateCalls: unknown[];
  /** popstate events seen by the Next stand-in so far. */
  popCount(): number;
  /** One bounded settle; returns how many popstates fired during it. */
  settleHistory(): number;
  /** history.back() + one bounded settle; returns how many popstates fired. */
  pressBack(): number;
  emitRouteChangeComplete(): void;
  /** "isSsr" mode: the Next stand-in skips beforePopState, as Next's first-load same-URL early return does. */
  setSsrMode(on: boolean): void;
  teardownInstall: () => void;
  cleanup(): void;
}

let keySeq = 0;

export function createOverlayHistoryHarness(options: { asPath?: string; ssrMode?: boolean } = {}): OverlayHistoryHarness {
  const asPath = options.asPath ?? '/workspace/savings';
  keySeq += 1;
  const baseKey = `k${keySeq}`;
  const baseState = { __N: true, url: asPath, as: asPath, options: {}, key: baseKey };
  // A real previous page below the base, so a 'route' Back always lands on a Next-shaped entry.
  // pushState also discards forward entries left by earlier tests: the base is always the last entry.
  window.history.replaceState({ __N: true, url: PREVIOUS_PAGE, as: PREVIOUS_PAGE, options: {}, key: `${baseKey}-prev` }, '', PREVIOUS_PAGE);
  window.history.pushState(baseState, '', asPath);

  let storedBeforePopState: ((state: unknown) => boolean) | null = null;
  let ssrMode = !!options.ssrMode;
  let pops = 0;
  const beforePopStateResults: boolean[] = [];
  const beforePopStateCalls: unknown[] = [];
  const routeChangeHandlers = new Set<() => void>();

  const router: FakeRouter = {
    asPath,
    beforePopState: jest.fn((cb: (state: unknown) => boolean) => { storedBeforePopState = cb; }),
    replace: jest.fn(async (_url: string, _as?: undefined, _options?: { shallow?: boolean; scroll?: boolean }) => true),
    events: {
      on: (_type, cb) => { routeChangeHandlers.add(cb); },
      off: (_type, cb) => { routeChangeHandlers.delete(cb); }
    }
  };

  const nextStandIn = (event: PopStateEvent) => {
    pops += 1;
    if (ssrMode || !storedBeforePopState) return;
    beforePopStateCalls.push(event.state);
    beforePopStateResults.push(storedBeforePopState(event.state));
  };
  window.addEventListener('popstate', nextStandIn);
  const teardownInstall = installOverlayHistory(router);

  const settleHistory = () => {
    const before = pops;
    act(() => { jest.advanceTimersByTime(HISTORY_SETTLE_MS); });
    return pops - before;
  };

  return {
    router,
    baseKey,
    baseState,
    beforePopStateResults,
    beforePopStateCalls,
    popCount: () => pops,
    settleHistory,
    pressBack: () => {
      window.history.back();
      return settleHistory();
    },
    emitRouteChangeComplete: () => { routeChangeHandlers.forEach(cb => cb()); },
    setSsrMode: (on: boolean) => { ssrMode = on; },
    teardownInstall,
    cleanup: () => {
      __resetOverlayHistoryForTests();
      // drain any traversal a test left in flight so it can't leak into the next test
      act(() => { jest.advanceTimersByTime(HISTORY_SETTLE_MS); });
      window.removeEventListener('popstate', nextStandIn);
    }
  };
}
