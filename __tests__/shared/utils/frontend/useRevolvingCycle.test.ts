import { act, renderHook, waitFor } from '@testing-library/react';
import { useRevolvingCycle } from '../../../../src/shared/utils/frontend/useRevolvingCycle';
import { creditCardAPI, expenseAPI } from '../../../../src/shared/utils/frontend/apiUtils';
import { buildRevolvingCycles, getPayableCycleMonth } from '../../../../src/shared/utils/creditCardUtils';

jest.mock('../../../../src/shared/utils/frontend/apiUtils', () => ({
  expenseAPI: { getByMonth: jest.fn().mockResolvedValue({}) },
  creditCardAPI: {
    getRevolving: jest.fn(),
    saveRevolvingCashback: jest.fn(),
    setRevolvingAction: jest.fn()
  }
}));
jest.mock('../../../../src/shared/utils/frontend/toast', () => ({ showToast: jest.fn() }));

const api = creditCardAPI as jest.Mocked<typeof creditCardAPI>;
const CARD = { id: 'cc_x', name: 'บัตร X', annualRate: 12, minPaymentPercent: 10, dueDay: 20 };
const JAN = '2099-01';
const FEB = '2099-02';
type StoredCycleInput = NonNullable<Parameters<typeof buildRevolvingCycles>[1]>[number];

const chain = (stored: StoredCycleInput[], throughMonth = JAN) => ({
  success: true,
  cycles: buildRevolvingCycles(CARD, stored.map((cycle, index) => ({ id: `rc_${index}`, cardId: 'cc_x', paidAt: null, paidSource: null, ...cycle })), { throughMonth }),
  truncated: false
});

beforeEach(() => {
  jest.clearAllMocks();
  (expenseAPI.getByMonth as jest.Mock).mockResolvedValue({});
  api.getRevolving.mockResolvedValue(chain([{ month: JAN, newSpend: 1000, paymentAction: null }]));
});

it('starts loading and becomes ready with the server-selected current cycle', async () => {
  const { result } = renderHook(() => useRevolvingCycle({ card: CARD, month: JAN }));
  expect(result.current.status).toBe('loading');
  await waitFor(() => expect(result.current.status).toBe('ready'));
  expect(result.current.currentCycle.totalDue).toBe(1000);
  expect(result.current.history.map(c => c.month)).toEqual([JAN]);
});

it('re-fetches the card total when the parent hands over a new card object (installment change)', async () => {
  const expense = expenseAPI.getByMonth as jest.Mock;
  expense.mockResolvedValue({ ccr_x: { actual: 1000, breakdown: { installmentTotal: 0 } } });
  const { result, rerender } = renderHook(({ card }) => useRevolvingCycle({ card, month: JAN }), { initialProps: { card: CARD } });
  await waitFor(() => expect(result.current.cardTotal).toEqual({ actual: 1000, installmentTotal: 0 }));
  expense.mockResolvedValue({ ccr_x: { actual: 1300, breakdown: { installmentTotal: 300 } } });
  rerender({ card: { ...CARD } });
  await waitFor(() => expect(result.current.cardTotal).toEqual({ actual: 1300, installmentTotal: 300 }));
});

it('AC-CD40: offset-0 cards read the card total for the viewed month unchanged', async () => {
  // NB: CARD has no statementDay, which getCardDueMonthOffset treats as EOM (offset 1), so use explicit statement < due cards
  const card520 = { ...CARD, statementDay: 5, dueDay: 20 };
  const { result } = renderHook(() => useRevolvingCycle({ card: card520, month: JAN }));
  await waitFor(() => expect(result.current.status).toBe('ready'));
  expect(expenseAPI.getByMonth).toHaveBeenCalledWith(JAN);

  (expenseAPI.getByMonth as jest.Mock).mockClear();
  const card525 = { ...CARD, statementDay: 5, dueDay: 25 };
  const second = renderHook(() => useRevolvingCycle({ card: card525, month: JAN }));
  await waitFor(() => expect(second.result.current.status).toBe('ready'));
  expect(expenseAPI.getByMonth).toHaveBeenCalledWith(JAN);
  expect(expenseAPI.getByMonth).not.toHaveBeenCalledWith(FEB);
});

describe('card-total table month for offset-1 cards (spec-credit-card-total-month)', () => {
  const CARD_OFFSET1 = { ...CARD, statementDay: 25, dueDay: 10 };
  const getByMonth = expenseAPI.getByMonth as jest.Mock;

  afterEach(() => {
    jest.useRealTimers();
  });

  it('AC-CD39: statement 25 / due 10, cycle 2026-10 reads table month 2026-11 and shows that row', async () => {
    jest.useFakeTimers({ now: new Date('2026-11-05T09:00:00'), doNotFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'clearImmediate', 'queueMicrotask'] });
    expect(getPayableCycleMonth(CARD_OFFSET1, '2026-11')).toBe('2026-10');
    getByMonth.mockImplementation(async (m: string) => ({
      ccr_x: m === '2026-11'
        ? { actual: 4200, breakdown: { installmentTotal: 700 } }
        : { actual: 1, breakdown: { installmentTotal: 1 } }
    }));
    const { result } = renderHook(() => useRevolvingCycle({ card: CARD_OFFSET1, month: '2026-10' }));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(getByMonth).toHaveBeenCalledWith('2026-11');
    expect(getByMonth).not.toHaveBeenCalledWith('2026-10');
    expect(result.current.cardTotal).toEqual({ actual: 4200, installmentTotal: 700 });
  });

  it('AC-CD41: a card-total read held across a month change never overwrites the newer month', async () => {
    let release: (value: unknown) => void = () => undefined;
    const held = new Promise(r => { release = r; });
    const { result, rerender } = renderHook(({ month }) => useRevolvingCycle({ card: CARD_OFFSET1, month }), { initialProps: { month: JAN } });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    // JAN (offset 1) -> table month 2099-02 is held; FEB -> 2099-03 resolves immediately
    getByMonth.mockImplementation((m: string) => (m === '2099-02'
      ? held
      : Promise.resolve({ ccr_x: { actual: 222, breakdown: { installmentTotal: 0 } } })));
    api.setRevolvingAction.mockResolvedValue(chain([{ month: JAN, newSpend: 1000, paymentAction: 'full' }]));
    let pending: Promise<void> = Promise.resolve();
    await act(async () => { pending = result.current.payFull(); });
    rerender({ month: FEB });
    await waitFor(() => expect(result.current.cardTotal).toEqual({ actual: 222, installmentTotal: 0 }));
    await act(async () => {
      release({ ccr_x: { actual: 111, breakdown: { installmentTotal: 0 } } });
      await pending;
    });
    expect(result.current.cardTotal).toEqual({ actual: 222, installmentTotal: 0 });
  });

  it('AC-CD42: the post-action re-read (s-2) uses the same derived key as the load read', async () => {
    const { result } = renderHook(() => useRevolvingCycle({ card: CARD_OFFSET1, month: '2026-10' }));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(getByMonth.mock.calls.map(c => c[0])).toEqual(['2026-11']);

    api.setRevolvingAction.mockResolvedValue(chain([{ month: JAN, newSpend: 1000, paymentAction: 'full' }]));
    await act(async () => { await result.current.payFull(); });
    expect(getByMonth.mock.calls.map(c => c[0])).toEqual(['2026-11', '2026-11']);

    await act(async () => { await result.current.undoPayment(); });
    expect(getByMonth.mock.calls.map(c => c[0])).toEqual(['2026-11', '2026-11', '2026-11']);

    api.saveRevolvingCashback.mockResolvedValue(chain([{ month: JAN, newSpend: 1000, cashbackAmount: 50, paymentAction: null }]));
    await act(async () => { result.current.blurCashback('50'); });
    await waitFor(() => expect(getByMonth).toHaveBeenCalledTimes(4));
    expect(getByMonth.mock.calls.every(c => c[0] === '2026-11')).toBe(true);
  });

  it('AC-CD44: EOM statement / due 10 derives 2026-11 and rolls 2026-12 over to 2027-01', async () => {
    const eom = { ...CARD, statementDay: 'EOM', dueDay: 10 };
    const first = renderHook(() => useRevolvingCycle({ card: eom, month: '2026-10' }));
    await waitFor(() => expect(first.result.current.status).toBe('ready'));
    expect(getByMonth).toHaveBeenCalledWith('2026-11');
    getByMonth.mockClear();
    const second = renderHook(() => useRevolvingCycle({ card: eom, month: '2026-12' }));
    await waitFor(() => expect(second.result.current.status).toBe('ready'));
    expect(getByMonth).toHaveBeenCalledWith('2027-01');
  });
});

it('R2: a refresh with the same card.id and month never flips back to loading and keeps the data', async () => {
  const statuses: string[] = [];
  const { result, rerender } = renderHook(({ card, refreshKey }) => {
    const state = useRevolvingCycle({ card, month: JAN, refreshKey });
    statuses.push(state.status);
    return state;
  }, { initialProps: { card: CARD, refreshKey: 0 } });
  await waitFor(() => expect(result.current.status).toBe('ready'));
  const readyAt = statuses.length;
  api.getRevolving.mockResolvedValue(chain([{ month: JAN, newSpend: 1500, paymentAction: null }]));
  rerender({ card: { ...CARD }, refreshKey: 0 });
  expect(result.current.currentCycle.totalDue).toBe(1000);
  await waitFor(() => expect(result.current.currentCycle.totalDue).toBe(1500));
  rerender({ card: { ...CARD }, refreshKey: 1 });
  await waitFor(() => expect(api.getRevolving).toHaveBeenCalledTimes(3));
  await waitFor(() => expect(result.current.status).toBe('ready'));
  expect(statuses.slice(readyAt)).not.toContain('loading');
});

it('a change of month (or card.id) resets to loading and drops the previous data', async () => {
  const { result, rerender } = renderHook(({ month }) => useRevolvingCycle({ card: CARD, month }), { initialProps: { month: JAN } });
  await waitFor(() => expect(result.current.status).toBe('ready'));
  let resolve: (value: ReturnType<typeof chain>) => void = () => undefined;
  api.getRevolving.mockImplementation(() => new Promise(r => { resolve = r as never; }));
  rerender({ month: FEB });
  await waitFor(() => expect(result.current.status).toBe('loading'));
  expect(result.current.history).toEqual([]);
  await act(async () => { resolve(chain([{ month: FEB, newSpend: 10, paymentAction: null }], FEB)); });
  await waitFor(() => expect(result.current.status).toBe('ready'));
  expect(result.current.currentCycle.totalDue).toBe(10);
});

it('R2: a dirty cashback draft survives a silent refresh', async () => {
  const { result, rerender } = renderHook(({ card }) => useRevolvingCycle({ card, month: JAN }), { initialProps: { card: CARD } });
  await waitFor(() => expect(result.current.status).toBe('ready'));
  act(() => result.current.changeCashbackDraft('77'));
  api.getRevolving.mockResolvedValue(chain([{ month: JAN, newSpend: 1000, cashbackAmount: 100, paymentAction: null }]));
  rerender({ card: { ...CARD } });
  await waitFor(() => expect(result.current.currentCycle.cashbackAmount).toBe(100));
  expect(result.current.cashbackDraft).toBe('77');
});

it('R2: a focused-but-untouched cashback input is not overwritten, a blurred one follows the server', async () => {
  const { result, rerender } = renderHook(({ card }) => useRevolvingCycle({ card, month: JAN }), { initialProps: { card: CARD } });
  await waitFor(() => expect(result.current.status).toBe('ready'));
  act(() => result.current.focusCashback());
  api.getRevolving.mockResolvedValue(chain([{ month: JAN, newSpend: 1000, cashbackAmount: 100, paymentAction: null }]));
  rerender({ card: { ...CARD } });
  await waitFor(() => expect(result.current.currentCycle.cashbackAmount).toBe(100));
  expect(result.current.cashbackDraft).toBe('0.00');
  act(() => result.current.blurCashback('0.00'));
  api.getRevolving.mockResolvedValue(chain([{ month: JAN, newSpend: 1000, cashbackAmount: 200, paymentAction: null }]));
  rerender({ card: { ...CARD } });
  await waitFor(() => expect(result.current.cashbackDraft).toBe('200.00'));
});

it('pay then refresh: busy settles, the settled cycle is kept through the refresh and onChanged fires once', async () => {
  const onChanged = jest.fn();
  const { result, rerender } = renderHook(({ card }) => useRevolvingCycle({ card, month: JAN, onChanged }), { initialProps: { card: CARD } });
  await waitFor(() => expect(result.current.status).toBe('ready'));
  api.setRevolvingAction.mockResolvedValue(chain([{ month: JAN, newSpend: 1000, paymentAction: 'full' }]));
  await act(async () => { await result.current.payFull(); });
  expect(api.setRevolvingAction).toHaveBeenCalledWith('cc_x', JAN, 'full');
  expect(result.current.currentCycle.paymentAction).toBe('full');
  expect(onChanged).toHaveBeenCalledTimes(1);
  api.getRevolving.mockResolvedValue(chain([{ month: JAN, newSpend: 1000, paymentAction: 'full' }]));
  rerender({ card: { ...CARD } });
  expect(result.current.status).toBe('ready');
  expect(result.current.currentCycle.paymentAction).toBe('full');
  await act(async () => {}); // let the silent refetch settle inside act
  expect(result.current.currentCycle.paymentAction).toBe('full');
});

it('payMinimum goes through onConfirmMinimum and only calls the API when confirmed', async () => {
  const onConfirmMinimum = jest.fn();
  const { result } = renderHook(() => useRevolvingCycle({ card: CARD, month: JAN, onConfirmMinimum }));
  await waitFor(() => expect(result.current.status).toBe('ready'));
  act(() => result.current.payMinimum());
  expect(onConfirmMinimum).toHaveBeenCalledTimes(1);
  expect(api.setRevolvingAction).not.toHaveBeenCalled();
  api.setRevolvingAction.mockResolvedValue(chain([{ month: JAN, newSpend: 1000, paymentAction: 'minimum' }]));
  await act(async () => { await onConfirmMinimum.mock.calls[0][0].onConfirm(); });
  expect(api.setRevolvingAction).toHaveBeenCalledWith('cc_x', JAN, 'minimum');
});

it('cashback blur rules: no request when unchanged or invalid, 0.00 when cleared, formatted value when changed', async () => {
  api.getRevolving.mockResolvedValue(chain([{ month: JAN, newSpend: 1000, cashbackAmount: 100, paymentAction: null }]));
  const { result } = renderHook(() => useRevolvingCycle({ card: CARD, month: JAN }));
  await waitFor(() => expect(result.current.cashbackDraft).toBe('100.00'));
  act(() => result.current.blurCashback('100'));
  act(() => result.current.blurCashback('-50'));
  act(() => result.current.blurCashback('abc'));
  expect(api.saveRevolvingCashback).not.toHaveBeenCalled();
  expect(result.current.cashbackDraft).toBe('100.00');
  api.saveRevolvingCashback.mockResolvedValue(chain([{ month: JAN, newSpend: 1000, cashbackAmount: 150, paymentAction: null }]));
  await act(async () => { result.current.blurCashback('150'); });
  await waitFor(() => expect(api.saveRevolvingCashback).toHaveBeenCalledWith('cc_x', JAN, '150.00'));
  await waitFor(() => expect(result.current.busy).toBe(false));
  await act(async () => { result.current.blurCashback(''); });
  await waitFor(() => expect(api.saveRevolvingCashback).toHaveBeenLastCalledWith('cc_x', JAN, '0.00'));
});

it('a failed load ends in the error state (no data, so no pay controls) and retry() re-fetches', async () => {
  api.getRevolving.mockRejectedValueOnce(new Error('boom'));
  const { result } = renderHook(() => useRevolvingCycle({ card: CARD, month: JAN }));
  await waitFor(() => expect(result.current.status).toBe('error'));
  expect(result.current.history).toEqual([]);
  act(() => result.current.retry());
  await waitFor(() => expect(result.current.status).toBe('ready'));
  expect(api.getRevolving).toHaveBeenCalledTimes(2);
});

it('does nothing without a card', () => {
  renderHook(() => useRevolvingCycle({ card: null, month: JAN }));
  expect(api.getRevolving).not.toHaveBeenCalled();
});
