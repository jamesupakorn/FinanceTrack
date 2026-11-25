/**
 * Hook: useBackToClose — Back closes this overlay, exactly like its Escape (spec-salary-row-and-back-close §I3,
 * R-SBC-8). Holds one overlay history entry (overlayHistory.ts) while `open` is true.
 *
 * ⚠ The push/release effect depends on `[open]` only. `onBack`/`blocked` are read through refs at pop time, so a
 *   parent passing an inline arrow doesn't release and re-push on every render (BUG-2 lesson).
 * Call it above any early `return null` (hooks rule). Components mounted only while open pass `true`.
 * When overlayHistory isn't installed (component tests without _app) every call is a no-op (INV-5).
 */

import { useEffect, useMemo, useRef } from 'react';
import { isOverlayHeld, pushOverlay, releaseOverlay, runAfterOverlayHistory } from './overlayHistory';

export interface BackToCloseOptions { /** Back is inert while true, the same rule as that overlay's Escape. */ blocked?: boolean }
export interface BackToCloseHandle {
  isHeld(): boolean;
  /** Release this overlay's entry now and run `then` once that traversal is done. Runs `then` synchronously when
   *  nothing is held or pending. Call it only on a path that is closing this overlay. */
  release(then?: () => void): void;
}

const noop = () => {};

export function useBackToClose(open: boolean, onBack: () => void, options?: BackToCloseOptions): BackToCloseHandle {
  const blocked = !!options?.blocked;
  const onBackRef = useRef(onBack);
  const blockedRef = useRef(blocked);
  const tokenRef = useRef<string | null>(null);

  // same latest-value ref pattern as WorkspaceShell's leaveCopyRef
  useEffect(() => { onBackRef.current = onBack; }, [onBack]);
  useEffect(() => { blockedRef.current = blocked; }, [blocked]);

  useEffect(() => {
    if (!open) return undefined;
    const token = pushOverlay({ onBack: () => onBackRef.current(), isBlocked: () => blockedRef.current });
    tokenRef.current = token;
    return () => {
      releaseOverlay(token);
      if (tokenRef.current === token) tokenRef.current = null;
    };
  }, [open]);

  return useMemo<BackToCloseHandle>(() => ({
    isHeld: () => isOverlayHeld(tokenRef.current),
    release: (then?: () => void) => {
      releaseOverlay(tokenRef.current);
      runAfterOverlayHistory(then ?? noop);
    }
  }), []);
}
