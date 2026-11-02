// Moved from RevolvingBalanceSectionCashback.test.tsx (AC-CB-65 to AC-CB-68) with unchanged strings, plus the new
// summary behaviour: AC-CD2, AC-CD3, AC-CD8, AC-CD9 and the R2 "pay -> refresh keeps focus" guarantee.
import { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CardPayNextSummary from '../../src/frontend/components/CardPayNextSummary';
import { useRevolvingCycle, EMPTY_CYCLE } from '../../src/shared/utils/frontend/useRevolvingCycle';
import { creditCardAPI, expenseAPI } from '../../src/shared/utils/frontend/apiUtils';
import { buildRevolvingCycles } from '../../src/shared/utils/creditCardUtils';

jest.mock('../../src/shared/utils/frontend/apiUtils', () => ({
  expenseAPI: { getByMonth: jest.fn().mockResolvedValue({}) },
  creditCardAPI: { getRevolving: jest.fn(), setRevolvingAction: jest.fn() }
}));
jest.mock('../../src/shared/utils/frontend/toast', () => ({ showToast: jest.fn() }));

const api = creditCardAPI as jest.Mocked<typeof creditCardAPI>;
const CARD = { id: 'cc_x', name: 'บัตร X', annualRate: 12, minPaymentPercent: 10, dueDay: 20 };
const JAN = '2099-01';
const FEB = '2099-02';
type StoredCycleInput = NonNullable<Parameters<typeof buildRevolvingCycles>[1]>[number];

const cyclesFor = (stored: StoredCycleInput[], throughMonth = JAN) => buildRevolvingCycles(
  CARD,
  stored.map((cycle, index) => ({ id: `rc_${index}`, cardId: 'cc_x', paidAt: null, paidSource: null, ...cycle })),
  { throughMonth }
);

/** Renders the presentational summary straight from a server-shaped cycle chain (no fetching). */
function renderSummary(
  stored: StoredCycleInput[],
  options: {
    month?: string;
    throughMonth?: string;
    card?: Record<string, unknown> & { id: string };
    status?: 'loading' | 'ready' | 'error';
    cardTotal?: { actual: number; installmentTotal: number } | null;
  } = {}
) {
  const { month = JAN, throughMonth = month, card = CARD, status = 'ready', cardTotal = null } = options;
  const cycles = cyclesFor(stored, throughMonth);
  const currentCycle = cycles.find(c => c.month === month) || EMPTY_CYCLE;
  const previousMonthCycle = [...cycles].filter(c => c.month < month).sort((a, b) => a.month.localeCompare(b.month)).pop() || null;
  const handlers = { onPayFull: jest.fn(), onPayMinimum: jest.fn(), onUndo: jest.fn(), onRetry: jest.fn() };
  const utils = render(
    <CardPayNextSummary
      card={card}
      month={month}
      status={status}
      currentCycle={currentCycle}
      previousMonthCycle={previousMonthCycle}
      cardTotal={cardTotal}
      busy={false}
      {...handlers}
    />
  );
  return { ...utils, ...handlers };
}

afterEach(() => jest.clearAllMocks());

describe('CardPayNextSummary cashback states (moved from RevolvingBalanceSection)', () => {
  it('AC-CB-65 positive month: net total, cashback line and pay buttons', () => {
    renderSummary([{ month: JAN, newSpend: 1000, cashbackAmount: 100, paymentAction: null }]);
    expect(screen.getByText('900.00 ฿')).toBeInTheDocument();
    expect(screen.getByText('หักแคชแบคแล้ว 100.00 ฿')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /จ่ายเต็มจำนวน 900\.00/ })).toBeInTheDocument();
  });

  it('paid full then cashback on a still-positive month shows the settled panel with the net amount', () => {
    renderSummary([{ month: JAN, newSpend: 1000, cashbackAmount: 100, paymentAction: 'full' }]);
    expect(screen.getByText('✓ จ่ายเต็มจำนวนแล้ว 900.00 ฿')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'ยกเลิกการชำระ' })).toBeInTheDocument();
  });

  it('AC-CB-66 + C-8: zero after cashback with a stored full shows only the zero line', () => {
    renderSummary([{ month: JAN, newSpend: 1000, cashbackAmount: 1000, paymentAction: 'full' }]);
    expect(screen.getByText('แคชแบคหักยอดเดือนนี้หมดพอดี · ไม่มียอดต้องชำระ')).toBeInTheDocument();
    expect(screen.queryByText(/จ่ายเต็มจำนวนแล้ว/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'ยกเลิกการชำระ' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /จ่ายเต็มจำนวน/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/เครดิตคงเหลือ/)).not.toBeInTheDocument();
  });

  it('a zero month without cashback and a stored full still shows the settled panel as before', () => {
    renderSummary([{ month: JAN, newSpend: 0, paymentAction: 'full' }]);
    expect(screen.getByText('✓ จ่ายเต็มจำนวนแล้ว 0.00 ฿')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'ยกเลิกการชำระ' })).toBeInTheDocument();
    expect(screen.queryByText(/แคชแบคหักยอดเดือนนี้หมดพอดี/)).not.toBeInTheDocument();
  });

  it.each<'full' | 'minimum' | null>([null, 'full', 'minimum'])('AC-CB-67 credit month (stored %p): credit panel only', (action) => {
    renderSummary([{ month: JAN, newSpend: 300, cashbackAmount: 500, paymentAction: action }]);
    expect(screen.getByText('เครดิตคงเหลือ 200.00 ฿')).toBeInTheDocument();
    expect(screen.getByText('ไม่มียอดต้องชำระเดือนนี้')).toBeInTheDocument();
    expect(screen.queryByText(/จ่ายเต็มจำนวนแล้ว|จ่ายขั้นต่ำแล้ว/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'ยกเลิกการชำระ' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /จ่ายเต็มจำนวน|จ่ายขั้นต่ำ/ })).not.toBeInTheDocument();
    expect(screen.queryByText('ยอดที่ต้องชำระทั้งหมด')).not.toBeInTheDocument();
  });

  it('AC-CB-68 next month with a carried credit shows its source line without interest (inside "รายละเอียดยอด")', () => {
    renderSummary([{ month: JAN, newSpend: 300, cashbackAmount: 500, paymentAction: null }], { month: FEB, throughMonth: FEB });
    expect(screen.queryByText('เครดิตยกมา')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'รายละเอียดยอด' }));
    expect(screen.getByText('เครดิตยกมา')).toBeInTheDocument();
    expect(screen.queryByText('ยอดยกมา')).not.toBeInTheDocument();
    expect(screen.getByText(/· คำนวณจากเดือนก่อนหน้าโดยอัตโนมัติ/)).toBeInTheDocument();
    expect(screen.queryByText(/รวมดอกเบี้ย/)).not.toBeInTheDocument();
    expect(screen.getByText('เครดิตคงเหลือ 200.00 ฿')).toBeInTheDocument();
    expect(screen.queryByText('ยังไม่ได้บันทึกยอดใช้จ่ายของเดือนนี้')).not.toBeInTheDocument();
  });
});

describe('CardPayNextSummary hero and states', () => {
  it('AC-CD2 hero shows currentCycle.totalDue and the minimum; the "รายละเอียดยอด" disclosure is collapsed by default', () => {
    renderSummary([{ month: JAN, newSpend: 1000, paymentAction: null }]);
    expect(screen.getByRole('heading', { name: 'ชำระรอบบิลนี้' })).toBeInTheDocument();
    expect(screen.getByText('ยอดที่ต้องชำระทั้งหมด')).toBeInTheDocument();
    expect(screen.getByText('1,000.00 ฿').className).toContain('text-3xl');
    expect(screen.getByText('ขั้นต่ำ 10% = 100.00 ฿')).toBeInTheDocument();
    const toggle = screen.getByRole('button', { name: 'รายละเอียดยอด' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText(/ยอดใช้จ่ายใหม่/)).not.toBeInTheDocument();
    fireEvent.click(toggle);
    expect(screen.getByText('ยอดใช้จ่ายใหม่ 1,000.00 ฿')).toBeInTheDocument();
  });

  it('keeps the card-total line verbatim under the minimum', () => {
    renderSummary([{ month: JAN, newSpend: 1000, paymentAction: null }], { cardTotal: { actual: 1300, installmentTotal: 300 } });
    expect(screen.getByText(/งวดผ่อนเดือนนี้ 300\.00 ฿ · ยอดรวมบัตร 1,300\.00 ฿/)).toBeInTheDocument();
  });

  it('AC-CD3 due line is the full due date: EOM/10 card cycle 2026-10 -> 10 พ.ย. 2569; 5/25 card -> 25 ต.ค. 2569', () => {
    const { unmount } = renderSummary([{ month: '2026-10', newSpend: 1000, paymentAction: null }], {
      month: '2026-10', card: { ...CARD, statementDay: 'EOM', dueDay: 10 } as never
    });
    expect(screen.getByText('ครบกำหนด 10 พ.ย. 2569')).toBeInTheDocument();
    unmount();
    renderSummary([{ month: '2026-10', newSpend: 1000, paymentAction: null }], {
      month: '2026-10', card: { ...CARD, statementDay: 5, dueDay: 25 } as never
    });
    expect(screen.getByText('ครบกำหนด 25 ต.ค. 2569')).toBeInTheDocument();
  });

  it('nothing due: new copy, plus the "not saved yet" hint only when nothing is stored and nothing carried', () => {
    renderSummary([]);
    expect(screen.getByText('ไม่มียอดใช้จ่ายหมุนเวียนต้องชำระในรอบนี้')).toBeInTheDocument();
    expect(screen.getByText('ยังไม่ได้บันทึกยอดใช้จ่ายของเดือนนี้')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /จ่ายเต็มจำนวน|จ่ายขั้นต่ำ/ })).not.toBeInTheDocument();
  });

  it('AC-CD8 error: alert + retry, and no pay buttons', () => {
    const { onRetry } = renderSummary([{ month: JAN, newSpend: 1000, paymentAction: null }], { status: 'error' });
    expect(screen.getByRole('alert')).toHaveTextContent('โหลดยอดใช้จ่ายหมุนเวียนไม่สำเร็จ');
    expect(screen.queryByRole('button', { name: /จ่ายเต็มจำนวน|จ่ายขั้นต่ำ/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'ลองใหม่' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('loading shows the status skeleton and no controls', () => {
    renderSummary([{ month: JAN, newSpend: 1000, paymentAction: null }], { status: 'loading' });
    expect(screen.getByRole('status')).toHaveTextContent('กำลังโหลดยอดใช้จ่ายหมุนเวียน');
    expect(screen.queryByRole('button', { name: /จ่ายเต็มจำนวน/ })).not.toBeInTheDocument();
  });

  it('the action buttons call the handlers', () => {
    const { onPayFull, onPayMinimum } = renderSummary([{ month: JAN, newSpend: 1000, paymentAction: null }]);
    fireEvent.click(screen.getByRole('button', { name: /จ่ายเต็มจำนวน 1,000\.00/ }));
    fireEvent.click(screen.getByRole('button', { name: /จ่ายขั้นต่ำ 100\.00/ }));
    expect(onPayFull).toHaveBeenCalledTimes(1);
    expect(onPayMinimum).toHaveBeenCalledTimes(1);
  });
});

/** Summary fed by the real hook, with a button that simulates the page's silent loadData (new card object, same id). */
function Harness() {
  const [card, setCard] = useState({ ...CARD });
  const rev = useRevolvingCycle({ card, month: JAN });
  return (
    <>
      <button type="button" onClick={() => setCard({ ...CARD })}>refresh-card</button>
      <CardPayNextSummary
        card={card}
        month={JAN}
        status={rev.status}
        currentCycle={rev.currentCycle}
        previousMonthCycle={rev.previousMonthCycle}
        cardTotal={rev.cardTotal}
        busy={rev.busy}
        onPayFull={() => { void rev.payFull(); }}
        onPayMinimum={rev.payMinimum}
        onUndo={() => { void rev.undoPayment(); }}
        onRetry={rev.retry}
      />
    </>
  );
}

describe('AC-CD9 focus handling and R2 silent refresh', () => {
  beforeEach(() => {
    (expenseAPI.getByMonth as jest.Mock).mockResolvedValue({});
    api.getRevolving.mockResolvedValue({ success: true, cycles: cyclesFor([{ month: JAN, newSpend: 1000, paymentAction: null }]), truncated: false });
  });

  it('after "จ่ายเต็มจำนวน" focus is on "ยกเลิกการชำระ"; after undo it is back on "จ่ายเต็มจำนวน"', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const payFull = await screen.findByRole('button', { name: /จ่ายเต็มจำนวน 1,000\.00/ });
    api.setRevolvingAction.mockResolvedValueOnce({ success: true, cycles: cyclesFor([{ month: JAN, newSpend: 1000, paymentAction: 'full' }]), truncated: false });
    await user.click(payFull);
    const undo = await screen.findByRole('button', { name: 'ยกเลิกการชำระ' });
    await waitFor(() => expect(undo).toHaveFocus());

    api.setRevolvingAction.mockResolvedValueOnce({ success: true, cycles: cyclesFor([{ month: JAN, newSpend: 1000, paymentAction: null }]), truncated: false });
    await user.click(undo);
    await waitFor(() => expect(screen.getByRole('button', { name: /จ่ายเต็มจำนวน 1,000\.00/ })).toHaveFocus());
  });

  it('R2: pay -> page refresh (new card object, same id): the focused control stays in the document and focused', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    api.setRevolvingAction.mockResolvedValueOnce({ success: true, cycles: cyclesFor([{ month: JAN, newSpend: 1000, paymentAction: 'full' }]), truncated: false });
    await user.click(await screen.findByRole('button', { name: /จ่ายเต็มจำนวน 1,000\.00/ }));
    const undo = await screen.findByRole('button', { name: 'ยกเลิกการชำระ' });
    await waitFor(() => expect(undo).toHaveFocus());

    api.getRevolving.mockClear();
    api.getRevolving.mockResolvedValue({ success: true, cycles: cyclesFor([{ month: JAN, newSpend: 1000, paymentAction: 'full' }]), truncated: false });
    fireEvent.click(screen.getByRole('button', { name: 'refresh-card' }));
    // synchronously after the card changes there is no skeleton and the same node is still mounted
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    await waitFor(() => expect(api.getRevolving).toHaveBeenCalledTimes(1));
    expect(undo.isConnected).toBe(true);
    expect(screen.getByRole('button', { name: 'ยกเลิกการชำระ' })).toBe(undo);
    expect(undo).toHaveFocus();
  });

  it('m-1: a cancelled minimum confirm (busy never true) does not steal focus after the month changes', () => {
    const stored = [
      { month: JAN, newSpend: 1000, paymentAction: null },
      { month: FEB, newSpend: 500, paymentAction: 'full' as const }
    ];
    const cycles = cyclesFor(stored, FEB);
    const at = (month: string) => ({
      card: CARD,
      month,
      status: 'ready' as const,
      currentCycle: cycles.find(c => c.month === month) || EMPTY_CYCLE,
      previousMonthCycle: null,
      cardTotal: null,
      busy: false,
      onPayFull: jest.fn(), onPayMinimum: jest.fn(), onUndo: jest.fn(), onRetry: jest.fn()
    });
    const { rerender } = render(<><button type="button">other</button><CardPayNextSummary {...at(JAN)} /></>);
    fireEvent.click(screen.getByRole('button', { name: /จ่ายขั้นต่ำ/ }));
    const other = screen.getByRole('button', { name: 'other' });
    other.focus();
    rerender(<><button type="button">other</button><CardPayNextSummary {...at(FEB)} /></>);
    expect(screen.getByRole('button', { name: 'ยกเลิกการชำระ' })).toBeInTheDocument();
    expect(other).toHaveFocus();
  });
});
