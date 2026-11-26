/**
 * Overlay history: Back closes the top-most overlay first (spec-salary-row-and-back-close §I3, ADR-036).
 *
 * Module singleton, installed once by pages/_app.tsx. Every open overlay owns one same-URL history entry
 * tagged with `__ftOverlay`. Two callbacks split the work (F-SBC-4):
 *   - the router's single `beforePopState` callback only READS state and decides whether Next routes (INV-2);
 *   - a window `popstate` listener does every state change. It also runs on the pops Next swallows before
 *     calling `beforePopState` (first-load `isSsr`, Safari's first pop), which is why it must own the work.
 * Both classify the same `event.state` against the same module state, so they always agree.
 *
 * History ops are serialized (INV-4): while one of our own `history.go` traversals is in flight
 * (`pendingPops === 1`), pushes, releases and waiters are queued and drained FIFO once it settles.
 *
 * ⚠ Relies on Next 16 router internals (state `key`/`as`/`__N`, push mints a key, replace keeps it, Next's
 *   popstate listener registers before ours). Re-check `next/dist/shared/lib/router/router.js` on upgrade.
 * No module-level `window` access: this file is SSR-safe to import.
 */

import { randomBase36 } from '../randomId';

export const OVERLAY_STATE_KEY = '__ftOverlay';
export const SELF_POP_TIMEOUT_MS = 1000;           // D-SBC-7 safety valve

/** The router surface the module uses. `import Router from 'next/router'` (the singleton, whose asPath is a live
 *  getter) satisfies it. Tests pass a fake. Never pass a useRouter() value: its fields are a render-time snapshot. */
export interface OverlayHistoryRouter {
  readonly asPath: string;
  beforePopState(cb: (state: unknown) => boolean): void;
  replace(url: string, as?: undefined, options?: { shallow?: boolean; scroll?: boolean }): Promise<boolean>;
  events: { on(type: 'routeChangeComplete', cb: () => void): void; off(type: 'routeChangeComplete', cb: () => void): void };
}
export interface OverlayRegistration { onBack: () => void; isBlocked: () => boolean }

type HistoryState = Record<string, unknown>;

interface Entry {
  token: string;
  /** Next's `key` of the entry this one was pushed over. Every overlay entry copies it, so it is the page's key. */
  baseKey: unknown;
  /** `__ftOverlay` of the entry this one was pushed over (undefined over the page entry). */
  belowToken: unknown;
  registration: OverlayRegistration;
  /** Released while not on top (E-1 option (a)). Kept only so the top's own release sweeps its entry too. */
  tombstoned: boolean;
}

type QueueItem =
  | { kind: 'push'; token: string; registration: OverlayRegistration }
  | { kind: 'release'; token: string }
  | { kind: 'wait'; run: () => void };

type PopClass = 'self' | 'tombstone' | 'overlay' | 'reset' | 'stale' | 'route';

interface GuardSlot { fn: (state: unknown) => boolean }

let installed = false;
let router: OverlayHistoryRouter | null = null;
let stack: Entry[] = [];
/** Our own traversals not yet seen. Only ever 0 or 1 (INV-4). */
let pendingPops = 0;
let queue: QueueItem[] = [];
let guard: GuardSlot | null = null;
let selfPopTimer: ReturnType<typeof setTimeout> | null = null;
/** Identifies the active install, so a stale teardown (StrictMode, double install) can't tear down a newer one. */
let installId = 0;

const asRecord = (value: unknown): HistoryState | null =>
  value !== null && typeof value === 'object' ? (value as HistoryState) : null;

const readHistoryState = (): HistoryState | null => asRecord(window.history.state);

const topEntry = (): Entry | undefined => stack[stack.length - 1];

// ---- classification (pure: reads module state, never writes it) ----

function classify(rawState: unknown): PopClass {
  if (pendingPops > 0) return 'self';
  const state = asRecord(rawState);
  const top = topEntry();
  if (top) {
    const landedBelowTop = state?.key === top.baseKey && state?.[OVERLAY_STATE_KEY] === top.belowToken;
    if (!landedBelowTop) return 'reset';
    return top.tombstoned ? 'tombstone' : 'overlay';
  }
  if (typeof state?.[OVERLAY_STATE_KEY] === 'string' && router && state.as === router.asPath) return 'stale';
  return 'route';
}

/** The app's only beforePopState callback. Read-only (INV-2): every mutation lives in handlePopState. */
function handleBeforePopState(state: unknown): boolean {
  switch (classify(state)) {
    case 'reset':
    case 'route':
      return guard ? guard.fn(state) : true;
    default:
      return false;
  }
}

// ---- mutation (popstate listener, push/release, queue) ----

/** F-SBC-6: a shallow replace may have rewritten the entry we left instead of the one we landed on. */
function resync(rawState: unknown): void {
  const state = asRecord(rawState);
  if (!router || typeof state?.as !== 'string' || state.as === router.asPath) return;
  void router.replace(router.asPath, undefined, { shallow: true, scroll: false });
}

function clearSelfPopTimer(): void {
  if (selfPopTimer === null) return;
  clearTimeout(selfPopTimer);
  selfPopTimer = null;
}

/** Starts our own traversal. The only place pendingPops is incremented. */
function startSelfPop(delta: number): void {
  if (pendingPops !== 0) throw new Error('overlayHistory: a self-pop is already in flight (INV-4)');
  pendingPops = 1;
  selfPopTimer = setTimeout(handleSelfPopTimeout, SELF_POP_TIMEOUT_MS);
  window.history.go(-delta);
}

function handleSelfPopTimeout(): void {
  selfPopTimer = null;
  pendingPops = 0;
  flush();
}

/**
 * Drains the queue FIFO. Exactly two callers: the self-pop settle and the timeout handler.
 * Each item is shifted before it runs; the loop stops as soon as an item starts a new traversal, and
 * anything an item enqueues re-entrantly lands behind the items still waiting.
 */
function flush(): void {
  clearSelfPopTimer();
  let firstError: unknown = null;
  while (pendingPops === 0 && queue.length > 0) {
    const item = queue.shift() as QueueItem;
    try {
      runQueueItem(item);
    } catch (error) {
      // a throwing waiter must not strand the items behind it; rethrown once the drain stops
      if (firstError === null) firstError = error;
    }
  }
  if (firstError !== null) throw firstError;
}

function runQueueItem(item: QueueItem): void {
  if (item.kind === 'push') applyPush(item.token, item.registration);
  else if (item.kind === 'release') releaseOverlay(item.token);
  else item.run();
}

function applyPush(token: string, registration: OverlayRegistration): void {
  const state = readHistoryState();
  window.history.pushState({ ...(state ?? {}), [OVERLAY_STATE_KEY]: token }, '', window.location.href);
  stack.push({ token, baseKey: state?.key, belowToken: state?.[OVERLAY_STATE_KEY], registration, tombstoned: false });
}

function handlePopState(event: PopStateEvent): void {
  const state = event.state as unknown;
  switch (classify(state)) {
    case 'self':
      pendingPops -= 1;
      resync(state);
      if (pendingPops === 0) flush();
      return;
    case 'tombstone':
      // The landed entry is the one directly below the tombstoned top, so only that one entry is gone.
      // No onBack for it, and none for the live entry it exposes. See changes.md (D3) for why a further
      // tombstone below is NOT dropped here.
      stack.pop();
      resync(state);
      return;
    case 'overlay': {
      const top = stack.pop() as Entry;
      if (top.registration.isBlocked()) {
        // A pop can't be cancelled: re-arm the entry so the overlay stays open and stays closable (E-SBC-12).
        window.history.pushState({ ...(asRecord(state) ?? {}), [OVERLAY_STATE_KEY]: top.token }, '', window.location.href);
        stack.push(top);
        return;
      }
      resync(state);
      top.registration.onBack();
      return;
    }
    case 'reset': {
      const closing = stack.slice().reverse();
      stack = [];
      for (const entry of closing) {
        if (!entry.tombstoned) entry.registration.onBack();
      }
      return;
    }
    default:
      // 'stale' and 'route': nothing to do
      return;
  }
}

/** Next's replace keeps `key` but drops our tag. Restore it on the top overlay's entry. */
function handleRouteChangeComplete(): void {
  const top = topEntry();
  if (pendingPops !== 0 || !top) return;
  const state = readHistoryState();
  if (state?.key !== top.baseKey || state?.[OVERLAY_STATE_KEY] === top.token) return;
  window.history.replaceState({ ...state, [OVERLAY_STATE_KEY]: top.token }, '', window.location.href);
}

function clearModuleState(): void {
  clearSelfPopTimer();
  installed = false;
  router = null;
  stack = [];
  pendingPops = 0;
  queue = [];
  guard = null;
}

// ---- public API ----

/** Called once, by pages/_app.tsx. Owns the app's only router.beforePopState. Returns teardown, which restores
 *  beforePopState(() => true), removes the listener, and clears all module state. */
export function installOverlayHistory(nextRouter: OverlayHistoryRouter): () => void {
  if (installed) __resetOverlayHistoryForTests();
  installId += 1;
  const id = installId;
  installed = true;
  router = nextRouter;
  nextRouter.beforePopState(handleBeforePopState);
  window.addEventListener('popstate', handlePopState);
  nextRouter.events.on('routeChangeComplete', handleRouteChangeComplete);
  return () => {
    if (!installed || installId !== id) return;
    teardownInstall(nextRouter);
  };
}

function teardownInstall(activeRouter: OverlayHistoryRouter): void {
  activeRouter.beforePopState(() => true);
  window.removeEventListener('popstate', handlePopState);
  activeRouter.events.off('routeChangeComplete', handleRouteChangeComplete);
  clearModuleState();
}

/** The route guard slot (WorkspaceShell). Single slot, last registration wins, the same semantics
 *  router.beforePopState had. The returned unregister clears the slot only if it still holds this guard. */
export function registerPopGuard(guardFn: (state: unknown) => boolean): () => void {
  const slot: GuardSlot = { fn: guardFn };
  guard = slot;
  return () => {
    if (guard === slot) guard = null;
  };
}

/** Opens an overlay history entry. Returns null and does nothing when not installed (F-SBC-9). */
export function pushOverlay(registration: OverlayRegistration): string | null {
  if (!installed) return null;
  const token = randomBase36(12);
  if (pendingPops > 0 || queue.length > 0) {
    queue.push({ kind: 'push', token, registration });
  } else {
    applyPush(token, registration);
  }
  return token;
}

/** Closes it from the app side (Escape, button, parent, unmount). No-op for null/unknown/already-released tokens. */
export function releaseOverlay(token: string | null): void {
  if (token === null || !installed) return;

  const queuedPush = queue.findIndex(item => item.kind === 'push' && item.token === token);
  if (queuedPush !== -1) {
    queue.splice(queuedPush, 1);
    return;
  }

  const idx = stack.findIndex(entry => entry.token === token);
  if (idx === -1 || stack[idx].tombstoned) return;

  if (pendingPops > 0) {
    // Re-evaluated after the in-flight traversal settles; two history.go calls never overlap (INV-4).
    queue.push({ kind: 'release', token });
    return;
  }

  const lastIdx = stack.length - 1;
  if (idx !== lastIdx) {
    // An independent overlay sits above it (E-1 option (a)). Touch no history, call no onBack.
    stack[idx].tombstoned = true;
    return;
  }

  const top = stack[lastIdx];
  const state = readHistoryState();
  const isCurrent = state?.[OVERLAY_STATE_KEY] === top.token
    || (top.baseKey !== undefined && state?.key === top.baseKey);

  // The top leaves together with every tombstoned entry directly beneath it.
  let firstRemoved = lastIdx;
  while (firstRemoved > 0 && stack[firstRemoved - 1].tombstoned) firstRemoved -= 1;
  const removedCount = stack.length - firstRemoved;
  stack.splice(firstRemoved);

  // Not current: a navigation pushed past our entry, so there is nothing of ours to pop.
  if (isCurrent) startSelfPop(removedCount);
}

/** True only while the token has a real history entry: false for queued, released or tombstoned tokens. */
export function isOverlayHeld(token: string | null): boolean {
  if (token === null) return false;
  return stack.some(entry => entry.token === token && !entry.tombstoned);
}

/** Runs fn synchronously when no self-pop is pending and no push is queued. Otherwise runs it once, after they settle. */
export function runAfterOverlayHistory(fn: () => void): void {
  if (pendingPops === 0 && queue.length === 0) {
    fn();
    return;
  }
  queue.push({ kind: 'wait', run: fn });
}

export function __resetOverlayHistoryForTests(): void {
  if (installed && router) {
    teardownInstall(router);
    return;
  }
  clearModuleState();
}
