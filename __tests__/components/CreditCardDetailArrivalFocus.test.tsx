// spec-dashboard-upcoming-click-to-view-s2 §Acceptance Criteria AC-16..AC-21 (credits-receiver slice, S2)
import { act, render, screen, waitFor } from '@testing-library/react';
import CreditCardDetail from '../../src/frontend/components/CreditCardDetail';
import { creditCardAPI } from '../../src/shared/utils/frontend/apiUtils';
import { addMonths, getCurrentMonthKey } from '../../src/shared/utils/creditCardUtils';
import { revolvingFocusKey } from '../../src/shared/utils/frontend/upcomingLinks';

jest.mock('../../src/shared/utils/frontend/apiUtils', () => ({
  creditCardAPI: { listSpendItems: jest.fn(), deleteSpendItem: jest.fn(), getRevolving: jest.fn() }
}));
jest.mock('../../src/shared/utils/frontend/toast', () => ({ showToast: jest.fn() }));

// เหมือน CreditCardDetailLayout.test.tsx — mock useRevolvingCycle ให้พร้อมใช้ทันที ไม่ต้องรอ fetch จริง
const mockRevolving = {
  cycle: null as null | Record<string, unknown>
};
jest.mock('../../src/shared/utils/frontend/useRevolvingCycle', () => {
  const actual = jest.requireActual('../../src/shared/utils/frontend/useRevolvingCycle');
  return {
    ...actual,
    useRevolvingCycle: () => {
      const currentCycle = { ...actual.EMPTY_CYCLE, totalDue: 500, minPaymentDue: 50, newSpend: 500, stored: true, isImplicit: false, month: '2026-10', ...(mockRevolving.cycle ?? {}) };
      return {
        status: 'ready', currentCycle, previousMonthCycle: null, history: [currentCycle], truncated: false,
        cardTotal: null, cashbackDraft: '', busy: false,
        changeCashbackDraft: jest.fn(), focusCashback: jest.fn(), blurCashback: jest.fn(),
        payFull: jest.fn(), payMinimum: jest.fn(), undoPayment: jest.fn(), retry: jest.fn()
      };
    }
  };
});

function setViewport(mobile: boolean) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: mobile ? 390 : 1280 });
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: mobile, media: query, onchange: null,
      addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false
    })
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockRevolving.cycle = null;
  // pending by default: เนื้อหารายการไม่ผ่อนไม่เกี่ยวกับ test นี้ — resolve ช้าจะทำให้ state อัปเดตหลุด act()
  jest.mocked(creditCardAPI.listSpendItems).mockReturnValue(new Promise(() => undefined) as never);
  jest.mocked(creditCardAPI.getRevolving).mockReturnValue(new Promise(() => undefined) as never);
  Element.prototype.scrollIntoView = jest.fn();
});

afterEach(() => { jest.useRealTimers(); });

// offset = 0 (dueDay > statementDay) ⇒ payableCycle = เดือนปฏิทินปัจจุบันเสมอ ไม่ต้องพึ่งวันที่จริงตอนรัน
const CARD_ID = 'cc_x';
const card = {
  id: CARD_ID, name: 'บัตรทดสอบ', creditLimit: 20000, remainingPrincipal: 5000, remainingPayable: 900,
  availableCredit: 15000, statementDay: 5, dueDay: 25, bankName: 'กสิกรไทย', last4: '1234'
};
const loanCard = {
  id: 'cc_loan_1', name: 'บ้านลาดพร้าว', cardType: 'home_loan', bankName: 'กสิกรไทย', last4: '1234',
  creditLimit: 0, remainingPrincipal: 950000, remainingPayable: 1500000, availableCredit: 0, statementDay: 'EOM', dueDay: 5
};

const planBase = {
  cardId: CARD_ID, installmentsPaid: 0, installmentsRemaining: 3, months: 3, totalPrice: 900, progressPercent: 0,
  monthlyPayment: 300, remainingPayable: 900, interestMode: 'manual', manualFeePerMonth: 0, createdAt: '2026-01-01'
};
const schedule = (paid = 0) => [1, 2, 3].map(no => ({ no, dueMonth: `2026-1${no}`.replace('2026-13', '2027-01'), payment: 300, principal: 300, interest: 0, paid: no <= paid }));
const ongoing = { ...planBase, id: 'ip_ongoing', itemName: 'โทรศัพท์', status: 'ongoing', schedule: schedule(0), nextUnpaid: schedule(0)[0] };
const loanPlan = { ...planBase, id: 'ip_loan', cardId: 'cc_loan_1', itemName: 'สัญญา', status: 'ongoing', months: 24, schedule: [], nextUnpaid: null };
const completed = { ...planBase, id: 'ip_done', itemName: 'พัดลม', status: 'completed', installmentsPaid: 3, progressPercent: 100, schedule: schedule(3), nextUnpaid: null };

describe('CreditCardDetail arrival focus (dashboard-upcoming-click-to-view S2)', () => {
  it('AC-16: focusKey=<planId> of an ongoing plan, mobile + collapsed PlanRow — scrolls, expands, focuses the toggle, and highlights, clearing after 4000ms', async () => {
    jest.useFakeTimers({ doNotFake: ['queueMicrotask'] });
    setViewport(true);
    render(<CreditCardDetail card={card} plans={[ongoing]} focusKey="ip_ongoing" />);

    // ต้นทาง: PlanRow มือถือพับไว้ (open = !isMobileView) — ต้องถูก force-open จาก ?focus=
    await act(async () => {
      await jest.advanceTimersByTimeAsync(0); // flush requestAnimationFrame ของ scroll effect
    });
    await act(async () => {
      await jest.advanceTimersByTimeAsync(80); // เผื่อ retry รอบสอง (DOM ช้า)
    });

    expect(document.getElementById('plan-detail-ip_ongoing')).toBeTruthy();
    const planWrapper = document.querySelector('[data-plan-key="ip_ongoing"]') as HTMLElement;
    expect(planWrapper).toBeTruthy();
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
    expect((Element.prototype.scrollIntoView as jest.Mock).mock.instances).toContain(planWrapper);

    const toggle = screen.getByRole('button', { name: /^โทรศัพท์/ });
    expect(toggle).toHaveAttribute('aria-controls', 'plan-detail-ip_ongoing');
    expect(document.activeElement).toBe(toggle);
    expect(planWrapper.className).toMatch(/outline-accent/);

    act(() => { jest.advanceTimersByTime(4000); });
    expect(planWrapper.className).not.toMatch(/outline-accent/);
  });

  it('AC-17: focusKey=<planId> of a completed plan — opens the settled panel and scrolls/focuses/highlights it', async () => {
    setViewport(false);
    render(<CreditCardDetail card={card} plans={[ongoing, completed]} focusKey="ip_done" />);

    await waitFor(() => expect(document.getElementById('settled-plans-panel')).toBeTruthy());
    await waitFor(() => expect(document.getElementById('plan-detail-ip_done')).toBeTruthy());

    const planWrapper = document.querySelector('[data-plan-key="ip_done"]') as HTMLElement;
    expect(planWrapper).toBeTruthy();
    await waitFor(() => expect(Element.prototype.scrollIntoView).toHaveBeenCalled());
    expect((Element.prototype.scrollIntoView as jest.Mock).mock.instances).toContain(planWrapper);

    const toggle = screen.getByRole('button', { name: /^พัดลม/ });
    expect(toggle).toHaveAttribute('aria-controls', 'plan-detail-ip_done');
    await waitFor(() => expect(document.activeElement).toBe(toggle));
    expect(planWrapper.className).toMatch(/outline-accent/);
  });

  it('AC-18: focusKey=<cardId>_<M> on a credit card — switches to month M, scrolls/focuses/highlights the revolving wrapper', async () => {
    setViewport(false);
    const currentMonth = getCurrentMonthKey();
    const targetMonth = addMonths(currentMonth, -1); // ต่างจากรอบที่ต้องชำระ (currentMonth, offset=0) เพื่อยืนยัน E-11
    const focusKey = revolvingFocusKey(CARD_ID, targetMonth);

    render(<CreditCardDetail card={card} plans={[]} focusKey={focusKey} />);

    const switcherMonth = () => document.querySelector('[data-month]')?.getAttribute('data-month');
    await waitFor(() => expect(switcherMonth()).toBe(targetMonth));

    const wrapperSelector = `[data-revolving-key="${revolvingFocusKey(CARD_ID, targetMonth)}"]`;
    const wrapper = () => document.querySelector(wrapperSelector) as HTMLElement | null;
    await waitFor(() => expect(wrapper()).toBeTruthy());
    await waitFor(() => expect(Element.prototype.scrollIntoView).toHaveBeenCalled());
    expect((Element.prototype.scrollIntoView as jest.Mock).mock.instances).toContain(wrapper());
    await waitFor(() => expect(document.activeElement).toBe(wrapper()));
    expect((wrapper() as HTMLElement).className).toMatch(/outline-accent/);
  });

  it('AC-19: revolving focus on a loan card is ignored silently — no scrollIntoView call, no thrown error', async () => {
    setViewport(false);
    const focusKey = revolvingFocusKey('cc_loan_1', '2026-05');
    expect(() => render(<CreditCardDetail card={loanCard} plans={[loanPlan]} focusKey={focusKey} />)).not.toThrow();

    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
  });

  it('AC-19: an unknown plan id is a silent no-op — no scrollIntoView call, no thrown error', async () => {
    setViewport(false);
    expect(() => render(<CreditCardDetail card={card} plans={[ongoing]} focusKey="ip_does_not_exist" />)).not.toThrow();

    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
  });

  it('AC-20: a re-render with new plans (silent refresh) after a successful arrival does not trigger a second scrollIntoView', async () => {
    setViewport(true);
    const { rerender } = render(<CreditCardDetail card={card} plans={[ongoing]} focusKey="ip_ongoing" />);

    await waitFor(() => expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(1));

    // plans refetch เงียบ ๆ (array reference ใหม่ แต่เนื้อหาเดิม) — card.id/focusKey ไม่เปลี่ยน ต้องไม่ยิง scroll ซ้ำ
    const refreshedPlans = [{ ...ongoing }];
    rerender(<CreditCardDetail card={card} plans={refreshedPlans} focusKey="ip_ongoing" />);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it('AC-21 (regression): with no focusKey, behaves exactly as before — no scroll/focus side effects, no highlight outline', async () => {
    setViewport(true);
    render(<CreditCardDetail card={card} plans={[ongoing]} />);

    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
    const planWrapper = document.querySelector('[data-plan-key="ip_ongoing"]') as HTMLElement;
    expect(planWrapper).toBeTruthy();
    expect(planWrapper.className).not.toMatch(/outline-accent/);
    // D-S3: มือถือ PlanRow ต้นทางพับไว้ตามปกติ ไม่มีการบังคับกาง
    expect(screen.getByRole('button', { name: /^โทรศัพท์/ })).toHaveAttribute('aria-expanded', 'false');
  });
});
