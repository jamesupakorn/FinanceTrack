/**
 * WorkspaceShell's route guard (registerPopGuard) + UnsavedChangesDialog's own Back-to-close and sequenced
 * leave (spec-salary-row-and-back-close §I4, AC-SBC-40…45).
 *
 * Same binding harness contract as overlayHistory.test.ts/useBackToClose.test.tsx: fake timers, settle only
 * through the harness's bounded HISTORY_SETTLE_MS advance, pop/call counts beside every negative assertion.
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { useState } from 'react';
import WorkspaceShell from '../../src/frontend/components/WorkspaceShell';
import { useBackToClose } from '../../src/shared/utils/frontend/useBackToClose';
import { __resetOverlayHistoryForTests } from '../../src/shared/utils/frontend/overlayHistory';
import { expenseAPI, incomeAPI, savingsAPI, salaryAPI, investmentAPI } from '../../src/shared/utils/frontend/apiUtils';
import { createOverlayHistoryHarness, type OverlayHistoryHarness } from '../helpers/overlayHistoryHarness';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let currentRouter: any;

jest.mock('next/router', () => ({
  useRouter: () => currentRouter
}));

jest.mock('../../src/frontend/contexts/SessionContext', () => ({
  useSession: () => ({ currentUser: { id: 'u-backguard' }, isReady: true, selectUser: jest.fn(), logout: jest.fn() })
}));

jest.mock('../../src/frontend/components/Layout', () => ({
  __esModule: true,
  default: ({ children }: { children?: ReactNode }) => <div>{children}</div>
}));

jest.mock('../../src/frontend/components/MonthManager', () => ({
  __esModule: true,
  default: () => null
}));

jest.mock('../../src/shared/utils/frontend/apiUtils', () => ({
  expenseAPI: { getAll: jest.fn() },
  incomeAPI: { getAll: jest.fn() },
  savingsAPI: { getAll: jest.fn() },
  salaryAPI: { getAll: jest.fn() },
  investmentAPI: { getAll: jest.fn() }
}));

function mockReads() {
  jest.mocked(expenseAPI.getAll).mockResolvedValue({ months: { '2026-10': {} } });
  jest.mocked(incomeAPI.getAll).mockResolvedValue({ months: {} });
  jest.mocked(savingsAPI.getAll).mockResolvedValue({ months: {} });
  jest.mocked(salaryAPI.getAll).mockResolvedValue({ months: {} });
  jest.mocked(investmentAPI.getAll).mockResolvedValue({});
}

/** AC-SBC-42's "test-local overlay": a tiny component calling useBackToClose, rendered as WorkspaceShell's
 * child via its `overlay` prop (MonthManager only gets its own hook in D6). */
function TestOverlay({ onBack }: { onBack: () => void }) {
  useBackToClose(true, onBack);
  return <div role="dialog" aria-label="test-overlay">test overlay</div>;
}

function ShellWithOptionalOverlay({ overlayInitiallyOpen }: { overlayInitiallyOpen: boolean }) {
  const [overlayOpen, setOverlayOpen] = useState(overlayInitiallyOpen);
  return (
    <WorkspaceShell section="income" overlay={overlayOpen ? <TestOverlay onBack={() => setOverlayOpen(false)} /> : null}>
      {({ markDirty, isDirty }) => (
        <>
          <button type="button" onClick={markDirty}>mark-dirty</button>
          <p data-testid="dirty-flag">{isDirty ? 'dirty' : 'clean'}</p>
        </>
      )}
    </WorkspaceShell>
  );
}

let h: OverlayHistoryHarness | null = null;
const harness = () => {
  h = createOverlayHistoryHarness({ asPath: '/workspace/income' });
  currentRouter = {
    ...h.router,
    pathname: h.router.asPath,
    query: {},
    isReady: true,
    push: jest.fn()
  };
  return h;
};

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function renderShellWithOverlay(overlayInitiallyOpen = false) {
  const view = render(<ShellWithOptionalOverlay overlayInitiallyOpen={overlayInitiallyOpen} />);
  await flush();
  return view;
}

beforeEach(() => {
  jest.useFakeTimers();
  mockReads();
  localStorage.clear();
});

afterEach(() => {
  h?.cleanup();
  h = null;
  __resetOverlayHistoryForTests();
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe('AC-SBC-40 registers through registerPopGuard, unregisters on unmount', () => {
  it('a mounted, dirty guard intercepts Back; after unmount the slot is cleared, not left stale', async () => {
    const t = harness();
    const { unmount } = await renderShellWithOverlay();
    fireEvent.click(screen.getByText('mark-dirty'));

    // Mounted + dirty: registerPopGuard's slot holds this guard, so Back is intercepted (AC-41 covers the
    // dialog/pushState detail; here only the interception itself matters).
    expect(t.pressBack()).toBe(1);
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    // Back on the dialog itself = stay, so the next press returns to a clean, guard-reachable state.
    expect(t.pressBack()).toBe(1);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();

    unmount();

    // If the unregister returned by registerPopGuard hadn't actually cleared the slot, this unmounted
    // guard (still dirty, per its closed-over isDirtyRef) would intercept this Back too and return false.
    // A correctly unregistered slot has no guard, so beforePopState's default (true) passes through.
    const resultsBefore = t.beforePopStateResults.length;
    expect(t.pressBack()).toBe(1);
    expect(t.beforePopStateResults.slice(resultsBefore)).toEqual([true]);
  });
});

describe('AC-SBC-41 dirty, no overlay, Back opens UnsavedChangesDialog', () => {
  it('opens the dialog and restores history with pushState(nextState, "", asPath)', async () => {
    const t = harness();
    await renderShellWithOverlay();
    fireEvent.click(screen.getByText('mark-dirty'));
    expect(screen.getByTestId('dirty-flag')).toHaveTextContent('dirty');

    const pushState = jest.spyOn(window.history, 'pushState');
    expect(t.pressBack()).toBe(1);

    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    // The guard's own restore call. (A second pushState also happens: the now-open dialog is itself an
    // overlay, per D4, and its own useBackToClose effect pushes its own history entry on top.)
    expect(pushState).toHaveBeenCalledWith(expect.anything(), '', t.router.asPath);
  });
});

describe('AC-SBC-42 dirty, with an open overlay: overlay consumes Back first', () => {
  it('closes the overlay, never opens the dialog, and the guard is not reached', async () => {
    const t = harness();
    await renderShellWithOverlay(true);
    expect(screen.getByRole('dialog', { name: 'test-overlay' })).toBeInTheDocument();
    fireEvent.click(screen.getByText('mark-dirty'));

    expect(t.pressBack()).toBe(1);

    expect(screen.queryByRole('dialog', { name: 'test-overlay' })).not.toBeInTheDocument();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.getByTestId('dirty-flag')).toHaveTextContent('dirty');
  });
});

describe('AC-SBC-43 Back while UnsavedChangesDialog is open = stay', () => {
  it('runs onStay, closes the dialog, keeps isDirty true, and navigates nowhere', async () => {
    const t = harness();
    await renderShellWithOverlay();
    fireEvent.click(screen.getByText('mark-dirty'));
    expect(t.pressBack()).toBe(1);
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();

    expect(t.pressBack()).toBe(1);

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.getByTestId('dirty-flag')).toHaveTextContent('dirty');
    expect(currentRouter.push).toHaveBeenCalledTimes(0);
  });
});

describe('AC-SBC-44 "ออกโดยไม่บันทึก" is sequenced after the dialogs own pop', () => {
  it('defers onLeave until the self-pop settles, then the bypassed back passes the guard', async () => {
    const t = harness();
    await renderShellWithOverlay();
    fireEvent.click(screen.getByText('mark-dirty'));
    expect(t.pressBack()).toBe(1);
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();

    const go = jest.spyOn(window.history, 'go');
    const resultsBefore = t.beforePopStateResults.length;

    fireEvent.click(screen.getByRole('button', { name: 'ออกโดยไม่บันทึก' }));
    // back.release(onLeave) released the dialog's own entry (one go), but onLeave is deferred: the
    // dialog is still rendered until that traversal settles (F-SBC-7).
    expect(go).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();

    // settle the dialog's self-pop: flush runs WorkspaceShell's onLeave, which sets bypassRef and
    // issues a second, independent history.back() only now that the first traversal is done (INV-4).
    expect(t.settleHistory()).toBeGreaterThanOrEqual(1);
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());

    // drain the bypassed back's own popstate
    t.settleHistory();
    expect(t.beforePopStateResults.slice(resultsBefore)).toContain(true);
  });

  it('a double-click on the leave button runs the release/onLeave path only once', async () => {
    const t = harness();
    await renderShellWithOverlay();
    fireEvent.click(screen.getByText('mark-dirty'));
    expect(t.pressBack()).toBe(1);

    const go = jest.spyOn(window.history, 'go');
    const leaveButton = screen.getByRole('button', { name: 'ออกโดยไม่บันทึก' });
    fireEvent.click(leaveButton);
    fireEvent.click(leaveButton);

    expect(go).toHaveBeenCalledTimes(1);
    t.settleHistory();
    t.settleHistory();
  });
});

/* Tester additions (Stage 4, D4). The tests above prove the dialog stays rendered until the self-pop settles
 * and that go() runs once; these pin the two properties the architecture review named directly:
 * the bypassed history.back() fires only after the dialog's own popstate (INV-4), and onLeave runs once on a
 * double-click (the leavingRef guard, not just the idempotent releaseOverlay). */
describe('AC-SBC-44 tester additions: ordering and once-only leave', () => {
  async function openBackTriggeredDialog() {
    const t = harness();
    await renderShellWithOverlay();
    fireEvent.click(screen.getByText('mark-dirty'));
    expect(t.pressBack()).toBe(1);
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    return t;
  }

  it('the bypassed history.back() is issued only after the dialog self-pop popstate was delivered (INV-4)', async () => {
    const t = await openBackTriggeredDialog();
    const popsAtBackCall: number[] = [];
    const realBack = window.history.back.bind(window.history);
    jest.spyOn(window.history, 'back').mockImplementation(() => {
      popsAtBackCall.push(t.popCount());
      realBack();
    });
    const resultsBefore = t.beforePopStateResults.length;
    const popsAtClick = t.popCount();

    fireEvent.click(screen.getByRole('button', { name: 'ออกโดยไม่บันทึก' }));
    // nothing navigates while the dialog's own go(-1) is in flight
    expect(popsAtBackCall).toEqual([]);

    t.settleHistory();
    t.settleHistory();

    // exactly one bypassed back, issued after exactly one popstate (the self-pop) had landed
    expect(popsAtBackCall).toEqual([popsAtClick + 1]);
    // self-pop is swallowed (false), the bypassed back passes the guard once (true), nothing else
    expect(t.beforePopStateResults.slice(resultsBefore)).toEqual([false, true]);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('a double-click runs onLeave (the bypassed back) exactly once', async () => {
    const t = await openBackTriggeredDialog();
    const back = jest.spyOn(window.history, 'back');
    const resultsBefore = t.beforePopStateResults.length;
    const leaveButton = screen.getByRole('button', { name: 'ออกโดยไม่บันทึก' });

    fireEvent.click(leaveButton);
    fireEvent.click(leaveButton);
    t.settleHistory();
    t.settleHistory();
    t.settleHistory();

    expect(back).toHaveBeenCalledTimes(1);
    expect(t.beforePopStateResults.slice(resultsBefore)).toEqual([false, true]);
  });

  it('non-Back path (nav link): router.push runs only after the dialog entry is popped, once', async () => {
    const t = harness();
    await renderShellWithOverlay();
    fireEvent.click(screen.getByText('mark-dirty'));
    const target = screen.getAllByRole('link').find(link => !link.hasAttribute('aria-current'));
    expect(target).toBeDefined();
    fireEvent.click(target as HTMLElement);
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(currentRouter.push).toHaveBeenCalledTimes(0);
    // the dialog holds its own entry
    expect(window.history.state).toHaveProperty('__ftOverlay');

    const go = jest.spyOn(window.history, 'go');
    fireEvent.click(screen.getByRole('button', { name: 'ออกโดยไม่บันทึก' }));
    expect(go).toHaveBeenCalledTimes(1);
    expect(currentRouter.push).toHaveBeenCalledTimes(0);

    expect(t.settleHistory()).toBe(1);
    expect(currentRouter.push).toHaveBeenCalledTimes(1);
    expect(window.history.state).not.toHaveProperty('__ftOverlay');
  });
});

describe('D4 follow-up fix: stay paths are no-ops once a leave is in flight (review.md Minor #1)', () => {
  it.each([
    ['the "กลับไปบันทึก" button', () => fireEvent.click(screen.getByRole('button', { name: 'กลับไปบันทึก' }))],
    ['Escape', () => fireEvent.keyDown(document, { key: 'Escape' })],
    ['the ✕ button', () => fireEvent.click(screen.getByRole('button', { name: 'ปิด' }))]
  ])('%s while "ออกโดยไม่บันทึก" is still pending does not cancel it; onLeave still fires exactly once', async (_label, attemptStay) => {
    const t = harness();
    await renderShellWithOverlay();
    fireEvent.click(screen.getByText('mark-dirty'));
    expect(t.pressBack()).toBe(1);
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();

    const go = jest.spyOn(window.history, 'go');
    const resultsBefore = t.beforePopStateResults.length;

    fireEvent.click(screen.getByRole('button', { name: 'ออกโดยไม่บันทึก' }));
    expect(go).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();

    // Attempt to stay while the dialog's own self-pop (go(-1)) hasn't settled yet. Before the fix, this
    // ran onStay and the dialog's own code paths looked "closed", but the already-queued onLeave still
    // fired once the pop settled. After the fix it is a no-op: no extra go(), dialog still shown, edits
    // still dirty.
    attemptStay();
    expect(go).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(screen.getByTestId('dirty-flag')).toHaveTextContent('dirty');
    expect(currentRouter.push).toHaveBeenCalledTimes(0);

    // Settle the dialog's self-pop (dialog unmounts), then the bypassed back's own popstate — onLeave's
    // single navigation, not cancelled by the stay attempt above.
    expect(t.settleHistory()).toBeGreaterThanOrEqual(1);
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    t.settleHistory();

    expect(t.beforePopStateResults.slice(resultsBefore)).toEqual([false, true]);
  });

  it('a nav-link leave still pushes exactly once even if "กลับไปบันทึก" is clicked while it is pending', async () => {
    const t = harness();
    await renderShellWithOverlay();
    fireEvent.click(screen.getByText('mark-dirty'));
    const target = screen.getAllByRole('link').find(link => !link.hasAttribute('aria-current'));
    expect(target).toBeDefined();
    fireEvent.click(target as HTMLElement);
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'ออกโดยไม่บันทึก' }));
    expect(currentRouter.push).toHaveBeenCalledTimes(0);

    // stay attempt during the in-flight window: must not short-circuit the queued router.push
    fireEvent.click(screen.getByRole('button', { name: 'กลับไปบันทึก' }));
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(currentRouter.push).toHaveBeenCalledTimes(0);

    expect(t.settleHistory()).toBe(1);
    expect(currentRouter.push).toHaveBeenCalledTimes(1);
  });
});

describe('UnsavedChangesDialog non-Back closes leave no history trace (R-SBC-7)', () => {
  it.each([
    ['the "กลับไปบันทึก" button', () => fireEvent.click(screen.getByRole('button', { name: 'กลับไปบันทึก' }))],
    ['Escape', () => fireEvent.keyDown(document, { key: 'Escape' })],
    ['the ✕ button', () => fireEvent.click(screen.getByRole('button', { name: 'ปิด' }))]
  ])('%s closes the Back-opened dialog, pops its entry, keeps edits, navigates nowhere', async (_label, close) => {
    const t = harness();
    await renderShellWithOverlay();
    fireEvent.click(screen.getByText('mark-dirty'));
    expect(t.pressBack()).toBe(1);
    expect(window.history.state).toHaveProperty('__ftOverlay');
    const go = jest.spyOn(window.history, 'go');
    const resultsBefore = t.beforePopStateResults.length;

    close();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(go).toHaveBeenCalledTimes(1);
    expect(t.settleHistory()).toBe(1);

    expect(window.history.state).not.toHaveProperty('__ftOverlay');
    expect(t.beforePopStateResults.slice(resultsBefore)).toEqual([false]);
    expect(screen.getByTestId('dirty-flag')).toHaveTextContent('dirty');
    expect(currentRouter.push).toHaveBeenCalledTimes(0);
  });
});
