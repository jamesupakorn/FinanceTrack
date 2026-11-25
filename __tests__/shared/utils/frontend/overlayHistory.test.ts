/**
 * overlayHistory.ts (spec-salary-row-and-back-close §I3, AC-SBC-20…35 + AC-SBC-E1).
 * Settling follows the spec's binding harness contract: fake timers, one bounded HISTORY_SETTLE_MS advance,
 * a pop count beside every negative assertion, and getTimerCount() === 0 after normal self-pops.
 */

import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import {
  OVERLAY_STATE_KEY,
  SELF_POP_TIMEOUT_MS,
  __resetOverlayHistoryForTests,
  isOverlayHeld,
  pushOverlay,
  registerPopGuard,
  releaseOverlay,
  runAfterOverlayHistory
} from '../../../../src/shared/utils/frontend/overlayHistory';
import {
  HISTORY_SETTLE_MS,
  PREVIOUS_PAGE,
  createOverlayHistoryHarness,
  type OverlayHistoryHarness
} from '../../../helpers/overlayHistoryHarness';

const makeOverlay = (blocked = false) => {
  const state = { blocked };
  return {
    state,
    onBack: jest.fn(),
    isBlocked: jest.fn(() => state.blocked)
  };
};

const currentState = () => window.history.state as Record<string, unknown> | null;

let h: OverlayHistoryHarness | null = null;
const harness = (options?: Parameters<typeof createOverlayHistoryHarness>[0]) => {
  h = createOverlayHistoryHarness(options);
  return h;
};

const spyHistory = () => ({
  pushState: jest.spyOn(window.history, 'pushState'),
  replaceState: jest.spyOn(window.history, 'replaceState'),
  go: jest.spyOn(window.history, 'go')
});

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

describe('jsdom traversal probe (R-SBC-2)', () => {
  it('fires popstate after history.back() only past a zero-length advance, and within one bounded settle', () => {
    const t = harness();
    window.history.pushState({ ...t.baseState, key: 'probe' }, '', window.location.href);
    window.history.back();
    jest.advanceTimersByTime(0);
    expect(t.popCount()).toBe(0);
    expect(t.settleHistory()).toBe(1);
    expect(jest.getTimerCount()).toBe(0);
  });
});

describe('AC-SBC-20 not installed', () => {
  it('is a complete no-op and runs waiters synchronously', () => {
    __resetOverlayHistoryForTests();
    const spies = spyHistory();
    const overlay = makeOverlay();

    const token = pushOverlay(overlay);
    releaseOverlay(token);
    const waiter = jest.fn();
    runAfterOverlayHistory(waiter);

    expect(token).toBeNull();
    expect(isOverlayHeld(token)).toBe(false);
    expect(waiter).toHaveBeenCalledTimes(1);
    expect(spies.pushState).toHaveBeenCalledTimes(0);
    expect(spies.replaceState).toHaveBeenCalledTimes(0);
    expect(spies.go).toHaveBeenCalledTimes(0);
    expect(jest.getTimerCount()).toBe(0);
  });
});

describe('AC-SBC-21 single overlay Back', () => {
  it('pushes a tagged entry and Back calls onBack once without routing', () => {
    const t = harness();
    const guard = jest.fn(() => true);
    registerPopGuard(guard);
    const spies = spyHistory();
    const a = makeOverlay();

    const token = pushOverlay(a);
    expect(spies.pushState).toHaveBeenCalledTimes(1);
    const pushed = spies.pushState.mock.calls[0][0] as Record<string, unknown>;
    expect(typeof pushed[OVERLAY_STATE_KEY]).toBe('string');
    expect(pushed[OVERLAY_STATE_KEY]).toBe(token);
    expect(pushed.key).toBe(t.baseKey);
    expect(isOverlayHeld(token)).toBe(true);

    expect(t.pressBack()).toBe(1);
    expect(a.onBack).toHaveBeenCalledTimes(1);
    expect(t.beforePopStateResults).toEqual([false]);
    expect(t.router.replace).toHaveBeenCalledTimes(0);
    expect(guard).toHaveBeenCalledTimes(0);
    expect(isOverlayHeld(token)).toBe(false);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('(b) still closes when Next skips beforePopState (isSsr first-load pop)', () => {
    const t = harness({ ssrMode: true });
    const a = makeOverlay();
    const token = pushOverlay(a);

    expect(t.pressBack()).toBe(1);
    expect(t.beforePopStateCalls).toHaveLength(0);
    expect(a.onBack).toHaveBeenCalledTimes(1);
    expect(isOverlayHeld(token)).toBe(false);
  });
});

describe('AC-SBC-22 nested overlays close one layer per Back', () => {
  it.each([
    ['guard registered', false],
    ['no guard', undefined]
  ])('%s', (_label, guardResult) => {
    const t = harness();
    const guard = jest.fn(() => guardResult as boolean);
    if (guardResult !== undefined) registerPopGuard(guard);
    const a = makeOverlay();
    const b = makeOverlay();
    pushOverlay(a);
    pushOverlay(b);

    expect(t.pressBack()).toBe(1);
    expect(b.onBack).toHaveBeenCalledTimes(1);
    expect(a.onBack).toHaveBeenCalledTimes(0);

    expect(t.pressBack()).toBe(1);
    expect(b.onBack).toHaveBeenCalledTimes(1);
    expect(a.onBack).toHaveBeenCalledTimes(1);

    expect(t.pressBack()).toBe(1);
    expect(t.beforePopStateResults).toEqual([false, false, guardResult ?? true]);
    expect(guard).toHaveBeenCalledTimes(guardResult === undefined ? 0 : 1);
    expect(currentState()?.as).toBe(PREVIOUS_PAGE);
  });
});

describe('AC-SBC-23 programmatic release', () => {
  it('goes back one entry, consumes the pop silently, and clears the timer via the popstate', () => {
    const t = harness();
    const guard = jest.fn(() => true);
    registerPopGuard(guard);
    const a = makeOverlay();
    const token = pushOverlay(a);
    const spies = spyHistory();

    releaseOverlay(token);
    expect(spies.go).toHaveBeenCalledTimes(1);
    expect(spies.go).toHaveBeenCalledWith(-1);
    expect(isOverlayHeld(token)).toBe(false);

    expect(t.settleHistory()).toBe(1);
    expect(a.onBack).toHaveBeenCalledTimes(0);
    expect(guard).toHaveBeenCalledTimes(0);
    expect(t.beforePopStateResults).toEqual([false]);
    expect(currentState()?.key).toBe(t.baseKey);
    expect(currentState()?.[OVERLAY_STATE_KEY]).toBeUndefined();
    expect(jest.getTimerCount()).toBe(0);

    releaseOverlay(token);
    expect(spies.go).toHaveBeenCalledTimes(1);
  });
});

describe('AC-SBC-24 serialization (INV-4)', () => {
  it('queues a push behind an in-flight self-pop', () => {
    const t = harness();
    const initialLength = window.history.length;
    const a = makeOverlay();
    const b = makeOverlay();
    const tokenA = pushOverlay(a);
    const spies = spyHistory();
    const pushesSeenAtPop: number[] = [];
    window.addEventListener('popstate', function record() {
      pushesSeenAtPop.push(spies.pushState.mock.calls.length);
      window.removeEventListener('popstate', record);
    });

    releaseOverlay(tokenA);
    const tokenB = pushOverlay(b);
    expect(typeof tokenB).toBe('string');
    expect(spies.pushState).toHaveBeenCalledTimes(0);
    expect(isOverlayHeld(tokenB)).toBe(false);

    expect(t.settleHistory()).toBe(1);
    expect(pushesSeenAtPop).toEqual([1]); // B pushed inside the popstate that settled A, not before it
    expect(spies.pushState).toHaveBeenCalledTimes(1);
    expect(window.history.length).toBe(initialLength + 1);
    expect(currentState()?.[OVERLAY_STATE_KEY]).toBe(tokenB);
    expect(isOverlayHeld(tokenB)).toBe(true);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('(b) two releases in one tick never have two history.go calls in flight', () => {
    let inFlight = 0;
    let maxInFlight = 0;
    // registered before the harness (and so before the module's listener), like Next's own listener
    const countLanding = () => { inFlight -= 1; };
    window.addEventListener('popstate', countLanding);
    const t = harness();
    const a = makeOverlay();
    const b = makeOverlay();
    const tokenA = pushOverlay(a);
    const tokenB = pushOverlay(b);
    const realGo = window.history.go.bind(window.history);
    const go = jest.spyOn(window.history, 'go').mockImplementation((delta?: number) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      realGo(delta);
    });

    releaseOverlay(tokenB);
    releaseOverlay(tokenA);
    expect(go).toHaveBeenCalledTimes(1);

    expect(t.settleHistory()).toBe(2);
    window.removeEventListener('popstate', countLanding);
    expect(go.mock.calls).toEqual([[-1], [-1]]);
    expect(maxInFlight).toBe(1);
    expect(inFlight).toBe(0);
    expect(currentState()?.key).toBe(t.baseKey);
    expect(currentState()?.[OVERLAY_STATE_KEY]).toBeUndefined();
    expect(isOverlayHeld(tokenA)).toBe(false);
    expect(isOverlayHeld(tokenB)).toBe(false);
    expect(a.onBack).toHaveBeenCalledTimes(0);
    expect(b.onBack).toHaveBeenCalledTimes(0);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('cancels a still-queued push on release, and a queued token is never held', () => {
    const t = harness();
    const tokenA = pushOverlay(makeOverlay());
    const spies = spyHistory();

    releaseOverlay(tokenA);
    const tokenB = pushOverlay(makeOverlay());
    expect(isOverlayHeld(tokenB)).toBe(false);
    releaseOverlay(tokenB);

    expect(t.settleHistory()).toBe(1);
    expect(spies.pushState).toHaveBeenCalledTimes(0);
    expect(spies.go).toHaveBeenCalledTimes(1);
    expect(isOverlayHeld(tokenB)).toBe(false);
    expect(currentState()?.[OVERLAY_STATE_KEY]).toBeUndefined();
    expect(jest.getTimerCount()).toBe(0);
  });
});

describe('AC-SBC-25 blocked overlay', () => {
  it('re-arms on Back while blocked, closes once unblocked', () => {
    const t = harness();
    const a = makeOverlay(true);
    const token = pushOverlay(a);
    const spies = spyHistory();

    expect(t.pressBack()).toBe(1);
    expect(a.isBlocked).toHaveBeenCalledTimes(1);
    expect(a.onBack).toHaveBeenCalledTimes(0);
    expect(spies.pushState).toHaveBeenCalledTimes(1); // the re-arm
    expect(currentState()?.[OVERLAY_STATE_KEY]).toBe(token);
    expect(currentState()?.key).toBe(t.baseKey);
    expect(isOverlayHeld(token)).toBe(true);

    a.state.blocked = false;
    expect(t.pressBack()).toBe(1);
    expect(a.onBack).toHaveBeenCalledTimes(1);
    expect(isOverlayHeld(token)).toBe(false);
  });
});

describe('AC-SBC-26 route guard slot', () => {
  it('calls the guard for a route pop with an empty stack', () => {
    const t = harness();
    const guard = jest.fn(() => false);
    registerPopGuard(guard);

    expect(t.pressBack()).toBe(1);
    expect(guard).toHaveBeenCalledTimes(1);
    expect(guard).toHaveBeenCalledWith(expect.objectContaining({ as: PREVIOUS_PAGE }));
    expect(t.beforePopStateResults).toEqual([false]);
  });

  it('does not call the guard while an overlay consumes Back', () => {
    const t = harness();
    const guard = jest.fn(() => true);
    registerPopGuard(guard);
    const a = makeOverlay();
    pushOverlay(a);

    expect(t.pressBack()).toBe(1);
    expect(a.onBack).toHaveBeenCalledTimes(1);
    expect(guard).toHaveBeenCalledTimes(0);
  });

  it('last registration wins, and a stale unregister leaves the newer guard in place', () => {
    const t = harness();
    const first = jest.fn(() => true);
    const second = jest.fn(() => true);
    const unregisterFirst = registerPopGuard(first);
    const unregisterSecond = registerPopGuard(second);
    const routePop = () => {
      window.history.pushState({ ...t.baseState, key: `nav-${t.popCount()}` }, '', window.location.href);
      return t.pressBack();
    };

    expect(routePop()).toBe(1);
    expect(first).toHaveBeenCalledTimes(0);
    expect(second).toHaveBeenCalledTimes(1);

    unregisterFirst();
    expect(routePop()).toBe(1);
    expect(first).toHaveBeenCalledTimes(0);
    expect(second).toHaveBeenCalledTimes(2);

    unregisterSecond();
    expect(routePop()).toBe(1);
    expect(second).toHaveBeenCalledTimes(2);
    expect(t.beforePopStateResults).toEqual([true, true, true]);
  });
});

describe('AC-SBC-27 resync after a shallow replace rewrote the overlay entry', () => {
  it('closes the overlay and replaces the landed entry with asPath', () => {
    const t = harness();
    const a = makeOverlay();
    pushOverlay(a);
    const newAsPath = '/workspace/savings?month=2099-02';
    t.router.asPath = newAsPath;
    // Next's shallow replace: same key, new url/as, our tag dropped
    window.history.replaceState({ ...t.baseState, url: newAsPath, as: newAsPath }, '', newAsPath);

    expect(t.pressBack()).toBe(1);
    expect(a.onBack).toHaveBeenCalledTimes(1);
    expect(t.router.replace).toHaveBeenCalledTimes(1);
    expect(t.router.replace).toHaveBeenCalledWith(newAsPath, undefined, { shallow: true, scroll: false });
  });
});

describe('AC-SBC-28 release after a navigation pushed past the entry', () => {
  it('touches no history and drops the hold', () => {
    const t = harness();
    const a = makeOverlay();
    const token = pushOverlay(a);
    window.history.pushState({ ...t.baseState, url: '/other', as: '/other', key: 'k-nav' }, '', '/other');
    const spies = spyHistory();

    releaseOverlay(token);
    expect(spies.go).toHaveBeenCalledTimes(0);
    expect(isOverlayHeld(token)).toBe(false);
    expect(t.settleHistory()).toBe(0);
    expect(spies.pushState).toHaveBeenCalledTimes(0);
    expect(a.onBack).toHaveBeenCalledTimes(0);
    expect(jest.getTimerCount()).toBe(0);
  });
});

describe('AC-SBC-29 waiters', () => {
  it('runs a waiter once, after the self-pop popstate', () => {
    const t = harness();
    const token = pushOverlay(makeOverlay());
    const popsSeenByWaiter: number[] = [];
    const then = jest.fn(() => { popsSeenByWaiter.push(t.popCount()); });

    releaseOverlay(token);
    runAfterOverlayHistory(then);
    expect(then).toHaveBeenCalledTimes(0);

    expect(t.settleHistory()).toBe(1);
    expect(then).toHaveBeenCalledTimes(1);
    expect(popsSeenByWaiter).toEqual([1]);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('runs a waiter synchronously when nothing is pending', () => {
    harness();
    pushOverlay(makeOverlay());
    const then = jest.fn();
    runAfterOverlayHistory(then);
    expect(then).toHaveBeenCalledTimes(1);
  });
});

describe('AC-SBC-30 self-pop timeout (restated)', () => {
  it('flushes the queue exactly at SELF_POP_TIMEOUT_MS when the traversal is lost', () => {
    harness();
    const tokenA = pushOverlay(makeOverlay());
    const pushState = jest.spyOn(window.history, 'pushState');
    const go = jest.spyOn(window.history, 'go').mockImplementation(() => {});

    releaseOverlay(tokenA);
    expect(go).toHaveBeenCalledTimes(1);
    const tokenB = pushOverlay(makeOverlay());
    expect(pushState).toHaveBeenCalledTimes(0);

    jest.advanceTimersByTime(SELF_POP_TIMEOUT_MS - 1);
    expect(pushState).toHaveBeenCalledTimes(0);
    expect(isOverlayHeld(tokenB)).toBe(false);

    jest.advanceTimersByTime(1);
    expect(pushState).toHaveBeenCalledTimes(1);
    expect(isOverlayHeld(tokenB)).toBe(true);
    go.mockRestore();
  });

  it('negative control: the real popstate clears the timer well before it would fire', () => {
    const t = harness();
    const tokenA = pushOverlay(makeOverlay());
    const pushState = jest.spyOn(window.history, 'pushState');

    releaseOverlay(tokenA);
    const tokenB = pushOverlay(makeOverlay());
    expect(t.settleHistory()).toBe(1);
    expect(jest.getTimerCount()).toBe(0);
    expect(pushState).toHaveBeenCalledTimes(1);
    expect(isOverlayHeld(tokenB)).toBe(true);
  });
});

describe('AC-SBC-31 reset on a multi-step pop', () => {
  it('closes every overlay top to bottom and lets the guard decide', () => {
    const t = harness();
    const guard = jest.fn(() => false);
    registerPopGuard(guard);
    const order: string[] = [];
    const a = makeOverlay();
    const b = makeOverlay();
    a.onBack.mockImplementation(() => { order.push('A'); });
    b.onBack.mockImplementation(() => { order.push('B'); });
    const tokenA = pushOverlay(a);
    const tokenB = pushOverlay(b);

    window.history.go(-2);
    expect(t.settleHistory()).toBe(1);
    expect(order).toEqual(['B', 'A']);
    expect(guard).toHaveBeenCalledTimes(1);
    expect(t.beforePopStateResults).toEqual([false]);
    expect(isOverlayHeld(tokenA)).toBe(false);
    expect(isOverlayHeld(tokenB)).toBe(false);

    // the stack really is empty: the next Back is a plain route pop
    expect(t.pressBack()).toBe(1);
    expect(guard).toHaveBeenCalledTimes(2);
  });

  it('skips tombstoned entries', () => {
    const t = harness();
    const a = makeOverlay();
    const b = makeOverlay();
    const tokenA = pushOverlay(a);
    pushOverlay(b);
    releaseOverlay(tokenA);

    window.history.go(-2);
    expect(t.settleHistory()).toBe(1);
    expect(b.onBack).toHaveBeenCalledTimes(1);
    expect(a.onBack).toHaveBeenCalledTimes(0);
    expect(t.beforePopStateResults).toEqual([true]);
  });
});

describe('AC-SBC-32 stale overlay entry', () => {
  it('ignores Forward onto a leftover same-page overlay entry', () => {
    const t = harness();
    const guard = jest.fn(() => true);
    registerPopGuard(guard);
    const a = makeOverlay();
    pushOverlay(a);
    expect(t.pressBack()).toBe(1);
    expect(a.onBack).toHaveBeenCalledTimes(1);

    window.history.forward();
    expect(t.settleHistory()).toBe(1);
    expect(t.beforePopStateResults).toEqual([false, false]);
    expect(a.onBack).toHaveBeenCalledTimes(1);
    expect(guard).toHaveBeenCalledTimes(0);
  });
});

describe('AC-SBC-33 INV-1 single beforePopState owner', () => {
  const root = join(__dirname, '../../../..');
  const sourceFiles = (dir: string): string[] => readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
  const callsBeforePopState = (path: string) => readFileSync(path, 'utf8').split('\n').some(line => {
    const code = line.trim();
    if (code.startsWith('//') || code.startsWith('*') || code.startsWith('/*')) return false;
    return /\bbeforePopState\(/.test(code);
  });

  it('only overlayHistory.ts calls it (D4: WorkspaceShell now registers through registerPopGuard)', () => {
    const callers = [...sourceFiles(join(root, 'src')), ...sourceFiles(join(root, 'pages'))]
      .filter(callsBeforePopState)
      .map(path => path.slice(root.length + 1));
    expect(callers).toEqual(['src/shared/utils/frontend/overlayHistory.ts']);
  });
});

describe('AC-SBC-34 teardown', () => {
  it('restores beforePopState(() => true) and becomes inert', () => {
    const t = harness();
    const a = makeOverlay();
    pushOverlay(a);
    t.teardownInstall();

    const lastCallback = t.router.beforePopState.mock.calls.at(-1)?.[0];
    expect(lastCallback?.({})).toBe(true);
    expect(t.pressBack()).toBe(1);
    expect(a.onBack).toHaveBeenCalledTimes(0);
    expect(t.beforePopStateResults).toEqual([true]);
    expect(pushOverlay(makeOverlay())).toBeNull();
  });
});

describe('AC-SBC-35 re-tag after routeChangeComplete', () => {
  it('restores the tag Next replace dropped, and leaves a tagged entry alone', () => {
    const t = harness();
    const token = pushOverlay(makeOverlay());
    const replaceState = jest.spyOn(window.history, 'replaceState');

    t.emitRouteChangeComplete();
    expect(replaceState).toHaveBeenCalledTimes(0);

    window.history.replaceState({ ...t.baseState, url: '/workspace/savings?x=1', as: '/workspace/savings?x=1' }, '', '/workspace/savings?x=1');
    expect(currentState()?.[OVERLAY_STATE_KEY]).toBeUndefined();
    t.emitRouteChangeComplete();
    expect(replaceState).toHaveBeenCalledTimes(2);
    expect(currentState()?.[OVERLAY_STATE_KEY]).toBe(token);
    expect(currentState()?.as).toBe('/workspace/savings?x=1');
  });
});

describe('INV-2 beforePopState is read-only', () => {
  it('a direct beforePopState call on an overlay pop changes nothing', () => {
    const t = harness();
    const a = makeOverlay();
    const token = pushOverlay(a);
    const callback = t.router.beforePopState.mock.calls[0][0];

    expect(callback(t.baseState)).toBe(false);
    expect(callback(t.baseState)).toBe(false);
    expect(a.onBack).toHaveBeenCalledTimes(0);
    expect(a.isBlocked).toHaveBeenCalledTimes(0);
    expect(isOverlayHeld(token)).toBe(true);

    expect(t.pressBack()).toBe(1);
    expect(a.onBack).toHaveBeenCalledTimes(1);
  });
});

describe('AC-SBC-E1 tombstones (non-top release)', () => {
  it('a non-top release touches no history; the top release sweeps both in one go(-2)', () => {
    const t = harness();
    const a = makeOverlay();
    const b = makeOverlay();
    const tokenA = pushOverlay(a);
    const tokenB = pushOverlay(b);
    const go = jest.spyOn(window.history, 'go');

    releaseOverlay(tokenA);
    expect(go).toHaveBeenCalledTimes(0);
    expect(isOverlayHeld(tokenA)).toBe(false);
    expect(isOverlayHeld(tokenB)).toBe(true);
    expect(t.settleHistory()).toBe(0);
    releaseOverlay(tokenA); // already released: still nothing
    expect(go).toHaveBeenCalledTimes(0);

    releaseOverlay(tokenB);
    expect(go).toHaveBeenCalledTimes(1);
    expect(go).toHaveBeenCalledWith(-2);
    expect(t.settleHistory()).toBe(1);
    expect(isOverlayHeld(tokenA)).toBe(false);
    expect(isOverlayHeld(tokenB)).toBe(false);
    expect(a.onBack).toHaveBeenCalledTimes(0);
    expect(b.onBack).toHaveBeenCalledTimes(0);
    expect(currentState()?.key).toBe(t.baseKey);
    expect(currentState()?.[OVERLAY_STATE_KEY]).toBeUndefined();
    expect(jest.getTimerCount()).toBe(0);
  });

  it('Back on the live top closes only it; the next Back sweeps the exposed tombstone silently', () => {
    const t = harness();
    const guard = jest.fn(() => true);
    registerPopGuard(guard);
    const a = makeOverlay();
    const b = makeOverlay();
    const tokenA = pushOverlay(a);
    pushOverlay(b);
    releaseOverlay(tokenA);

    expect(t.pressBack()).toBe(1);
    expect(b.onBack).toHaveBeenCalledTimes(1);
    expect(a.onBack).toHaveBeenCalledTimes(0);

    expect(t.pressBack()).toBe(1); // lands on the base below A's dead entry
    expect(a.onBack).toHaveBeenCalledTimes(0);
    expect(guard).toHaveBeenCalledTimes(0);
    expect(currentState()?.key).toBe(t.baseKey);

    expect(t.pressBack()).toBe(1); // stack is empty again: a normal route pop
    expect(guard).toHaveBeenCalledTimes(1);
    expect(t.beforePopStateResults).toEqual([false, false, true]);
  });

  it('a tombstone-top pop does not call the live entry it exposes', () => {
    const t = harness();
    const live = makeOverlay();
    const dead = makeOverlay();
    const top = makeOverlay();
    pushOverlay(live);
    const tokenDead = pushOverlay(dead);
    const tokenTop = pushOverlay(top);
    releaseOverlay(tokenDead);

    expect(t.pressBack()).toBe(1); // closes top
    expect(top.onBack).toHaveBeenCalledTimes(1);
    expect(isOverlayHeld(tokenTop)).toBe(false);
    expect(t.pressBack()).toBe(1); // sweeps the dead entry, lands on live's entry
    expect(dead.onBack).toHaveBeenCalledTimes(0);
    expect(live.onBack).toHaveBeenCalledTimes(0);
    expect(t.pressBack()).toBe(1); // live is a normal overlay again
    expect(live.onBack).toHaveBeenCalledTimes(1);
    expect(t.beforePopStateResults).toEqual([false, false, false]);
  });

  it('two exposed tombstones are swept one per Back, so the stack stays in step with history', () => {
    // history: base, L, T1, T2, B. Each Back lands on exactly one entry below, so a tombstone-top pop may only
    // drop the entry it left; dropping T1 together with T2 while standing on T1's entry would desync the stack
    // and turn the later Back onto L's entry into a 'reset' (guard consulted, L closed one press early).
    const t = harness();
    const guard = jest.fn(() => true);
    registerPopGuard(guard);
    const live = makeOverlay();
    const t1 = makeOverlay();
    const t2 = makeOverlay();
    const top = makeOverlay();
    pushOverlay(live);
    const token1 = pushOverlay(t1);
    const token2 = pushOverlay(t2);
    pushOverlay(top);
    releaseOverlay(token1);
    releaseOverlay(token2);

    expect(t.pressBack()).toBe(1); // closes top, lands on T2's entry
    expect(top.onBack).toHaveBeenCalledTimes(1);
    expect(t.pressBack()).toBe(1); // T2 swept, lands on T1's entry
    expect(t.pressBack()).toBe(1); // T1 swept, lands on L's entry
    expect(live.onBack).toHaveBeenCalledTimes(0);
    expect(t.pressBack()).toBe(1); // L closes, lands on the base
    expect(live.onBack).toHaveBeenCalledTimes(1);
    expect(guard).toHaveBeenCalledTimes(0);
    expect(currentState()?.key).toBe(t.baseKey);
    expect(currentState()?.[OVERLAY_STATE_KEY]).toBeUndefined();
    expect(t1.onBack).toHaveBeenCalledTimes(0);
    expect(t2.onBack).toHaveBeenCalledTimes(0);
    expect(t.beforePopStateResults).toEqual([false, false, false, false]);
  });
});

// Stage 4 tester additions: each pins a binding implementer note / spec branch that no test above
// distinguished (each was confirmed by reverting the guarded line and watching only these go red).
describe('Stage 4 additions: queue drain and release edge branches', () => {
  it('flush stops at a queued release that starts its own traversal; the push behind it waits (INV-4)', () => {
    const t = harness();
    const initialLength = window.history.length;
    const a = makeOverlay();
    const b = makeOverlay();
    const c = makeOverlay();
    const tokenA = pushOverlay(a);
    const tokenB = pushOverlay(b);
    const go = jest.spyOn(window.history, 'go');

    releaseOverlay(tokenB);
    releaseOverlay(tokenA); // queued behind B's in-flight self-pop
    const tokenC = pushOverlay(c); // queued behind the release
    expect(go).toHaveBeenCalledTimes(1);

    expect(t.settleHistory()).toBe(2);
    expect(go.mock.calls).toEqual([[-1], [-1]]);
    expect(isOverlayHeld(tokenC)).toBe(true);
    expect(currentState()?.[OVERLAY_STATE_KEY]).toBe(tokenC);
    expect(currentState()?.key).toBe(t.baseKey);
    expect(window.history.length).toBe(initialLength + 1);
    expect(a.onBack).toHaveBeenCalledTimes(0);
    expect(b.onBack).toHaveBeenCalledTimes(0);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('a re-entrant push from a waiter lands behind the items still queued', () => {
    const t = harness();
    const a = makeOverlay();
    const c = makeOverlay();
    const d = makeOverlay();
    const tokenA = pushOverlay(a);
    let tokenD: string | null = null;

    releaseOverlay(tokenA);
    runAfterOverlayHistory(() => { tokenD = pushOverlay(d); });
    const tokenC = pushOverlay(c);

    expect(t.settleHistory()).toBe(1);
    expect(isOverlayHeld(tokenC)).toBe(true);
    expect(isOverlayHeld(tokenD)).toBe(true);
    expect(currentState()?.[OVERLAY_STATE_KEY]).toBe(tokenD);

    expect(t.pressBack()).toBe(1);
    expect(d.onBack).toHaveBeenCalledTimes(1);
    expect(c.onBack).toHaveBeenCalledTimes(0);
  });

  it('release still goes back when Next replace dropped the tag but kept the key (baseKey branch), then resyncs', () => {
    const t = harness();
    const guard = jest.fn(() => true);
    registerPopGuard(guard);
    const a = makeOverlay();
    const token = pushOverlay(a);
    const newAsPath = '/profiles';
    t.router.asPath = newAsPath;
    window.history.replaceState({ ...t.baseState, url: newAsPath, as: newAsPath }, '', newAsPath);
    const go = jest.spyOn(window.history, 'go');

    releaseOverlay(token);
    expect(go).toHaveBeenCalledTimes(1);
    expect(go).toHaveBeenCalledWith(-1);

    expect(t.settleHistory()).toBe(1);
    expect(t.beforePopStateResults).toEqual([false]);
    expect(guard).toHaveBeenCalledTimes(0);
    expect(a.onBack).toHaveBeenCalledTimes(0);
    expect(t.router.replace).toHaveBeenCalledTimes(1);
    expect(t.router.replace).toHaveBeenCalledWith(newAsPath, undefined, { shallow: true, scroll: false });
    expect(jest.getTimerCount()).toBe(0);
  });

  it('a throwing waiter does not strand the queued items behind it, and its error still surfaces', () => {
    const t = harness();
    const tokenA = pushOverlay(makeOverlay());
    const errors: unknown[] = [];
    const onError = (event: ErrorEvent) => { errors.push(event.error); event.preventDefault(); };
    window.addEventListener('error', onError);
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const boom = new Error('waiter failed');
    const later = jest.fn();

    releaseOverlay(tokenA);
    runAfterOverlayHistory(() => { throw boom; });
    const tokenC = pushOverlay(makeOverlay());
    runAfterOverlayHistory(later);

    expect(t.settleHistory()).toBe(1);
    window.removeEventListener('error', onError);
    expect(errors).toEqual([boom]);
    expect(isOverlayHeld(tokenC)).toBe(true);
    expect(later).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('re-tag does nothing while a self-pop is in flight', () => {
    const t = harness();
    const tokenA = pushOverlay(makeOverlay());
    const tokenB = pushOverlay(makeOverlay());
    const replaceState = jest.spyOn(window.history, 'replaceState');

    releaseOverlay(tokenB);
    t.emitRouteChangeComplete(); // history.state is still B's entry; top is now A
    expect(replaceState).toHaveBeenCalledTimes(0);

    expect(t.settleHistory()).toBe(1);
    expect(currentState()?.[OVERLAY_STATE_KEY]).toBe(tokenA);
    expect(isOverlayHeld(tokenA)).toBe(true);
    expect(jest.getTimerCount()).toBe(0);
  });
});
