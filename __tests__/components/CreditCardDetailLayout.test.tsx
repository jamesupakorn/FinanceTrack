// Detail page layout/interaction: AC-CD1, AC-CD10 to AC-CD12, AC-CD20 to AC-CD22, AC-CD24, AC-CD25 (and the card menu, I-3).
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CreditCardDetail from '../../src/frontend/components/CreditCardDetail';
import { creditCardAPI } from '../../src/shared/utils/frontend/apiUtils';

jest.mock('../../src/shared/utils/frontend/apiUtils', () => ({
  creditCardAPI: { listSpendItems: jest.fn(), deleteSpendItem: jest.fn() }
}));
jest.mock('../../src/shared/utils/frontend/toast', () => ({ showToast: jest.fn() }));

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
  // pending by default: the list contents are irrelevant to most cases and a late resolve would leak state updates out of act()
  jest.mocked(creditCardAPI.listSpendItems).mockReturnValue(new Promise(() => undefined) as never);
});

const card = { id: 'cc_x', name: 'บัตรทดสอบ', creditLimit: 20000, remainingPrincipal: 5000, remainingPayable: 900, availableCredit: 15000, statementDay: 5, dueDay: 25, bankName: 'กสิกรไทย', last4: '1234' };
const planBase = {
  cardId: 'cc_x', status: 'ongoing', installmentsPaid: 0, installmentsRemaining: 3, months: 3, totalPrice: 900, progressPercent: 0,
  monthlyPayment: 300, remainingPayable: 900, interestMode: 'manual', manualFeePerMonth: 0, createdAt: '2026-01-01'
};
const schedule = (paid = 0) => [1, 2, 3].map(no => ({ no, dueMonth: `2026-1${no}`.replace('2026-13', '2027-01'), payment: 300, principal: 300, interest: 0, paid: no <= paid }));
const ongoing = { ...planBase, id: 'ip_ongoing', itemName: 'โทรศัพท์', schedule: schedule(0), nextUnpaid: schedule(0)[0] };
const paidPlan = { ...planBase, id: 'ip_paid', itemName: 'ทีวี', installmentsPaid: 2, progressPercent: 66.67, schedule: schedule(2), nextUnpaid: schedule(2)[2] };
const completed = { ...planBase, id: 'ip_done', itemName: 'พัดลม', status: 'completed', installmentsPaid: 3, progressPercent: 100, schedule: schedule(3), nextUnpaid: null };
const cancelled = { ...planBase, id: 'ip_cancel', itemName: 'โซฟา', status: 'cancelled_early', schedule: schedule(0), nextUnpaid: null };

describe('AC-CD1 hierarchy (both viewports)', () => {
  it.each([['mobile', true], ['desktop', false]])('%s: identity, summary, items, plans, cashback, history in DOM order', async (_name, mobile) => {
    setViewport(mobile);
    jest.mocked(creditCardAPI.listSpendItems).mockResolvedValue({ items: [], totals: { cc_x: 0 } } as never);
    const { container } = render(<CreditCardDetail card={card} plans={[ongoing]} />);
    await screen.findByText('รวมรายการไม่ผ่อน 0.00 ฿');
    const identity = container.querySelector('header') as HTMLElement;
    const summary = screen.getByRole('heading', { name: 'ชำระรอบบิลนี้' });
    const items = screen.getByRole('heading', { name: /^รายการไม่ผ่อน/ });
    const plans = screen.getByRole('heading', { name: 'แผนผ่อนชำระ (1)' });
    const cashback = screen.getByRole('button', { name: /^แคชแบค ·/ });
    const history = screen.getByRole('button', { name: /ประวัติยอดหมุนเวียน/ });
    const ordered = [identity, summary, items, plans, cashback, history];
    for (let i = 0; i < ordered.length - 1; i += 1) {
      expect(ordered[i].compareDocumentPosition(ordered[i + 1]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    expect(within(identity).getByRole('heading', { name: 'บัตรทดสอบ' })).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { name: 'บัตรทดสอบ' })).toHaveLength(1);
  });

  it('identity header: debt line demoted to a secondary line, the hero is the cycle total (AC-CD2)', () => {
    setViewport(false);
    render(<CreditCardDetail card={{ ...card, revolvingDue: 200, installmentPayable: 700, revolvingCredit: 30 }} plans={[]} />);
    expect(screen.getByText('หนี้คงเหลือรวม 900.00 ฿')).toBeInTheDocument();
    expect(screen.getByText('ผ่อนชำระ 700.00 · ยอดหมุนเวียน 200.00')).toBeInTheDocument();
    expect(screen.getByText('เครดิตแคชแบค 30.00')).toBeInTheDocument();
    expect(screen.getByText('500.00 ฿').className).toContain('text-3xl');
    expect(screen.getByText('กสิกรไทย · ····1234')).toBeInTheDocument();
  });
});

describe('add entry (AC-CD10 / AC-CD11)', () => {
  it('mobile: exactly one "เพิ่มรายจ่าย", inside a fixed wrapper above the nav (z below 100)', () => {
    setViewport(true);
    render(<CreditCardDetail card={card} plans={[]} />);
    const buttons = screen.getAllByRole('button', { name: 'เพิ่มรายจ่าย' });
    expect(buttons).toHaveLength(1);
    const wrapper = buttons[0].parentElement as HTMLElement;
    expect(wrapper.className).toContain('fixed');
    expect(wrapper.className).toContain('z-[90]');
    expect(wrapper.getAttribute('style')).toContain('--nav-safe-bottom');
    expect(buttons[0]).toHaveAttribute('data-add-expense-fallback');
  });

  it('desktop: exactly one "เพิ่มรายจ่าย", in the header row (not fixed)', () => {
    setViewport(false);
    render(<CreditCardDetail card={card} plans={[]} />);
    const buttons = screen.getAllByRole('button', { name: 'เพิ่มรายจ่าย' });
    expect(buttons).toHaveLength(1);
    expect(buttons[0].closest('.fixed')).toBeNull();
    expect(buttons[0]).toHaveAttribute('data-add-expense-fallback');
  });

  it('the not-found state renders no add bar', () => {
    setViewport(true);
    render(<CreditCardDetail card={null} plans={[]} />);
    expect(screen.queryByRole('button', { name: 'เพิ่มรายจ่าย' })).toBeNull();
  });

  it('AC-CD11: the bar is hidden while a field in the detail has focus and reappears on blur', () => {
    setViewport(true);
    render(<CreditCardDetail card={card} plans={[]} />);
    const wrapper = screen.getByRole('button', { name: 'เพิ่มรายจ่าย' }).parentElement as HTMLElement;
    expect(wrapper).not.toHaveAttribute('hidden');
    const input = screen.getByLabelText('แคชแบคที่ได้รับเดือนนี้ (บาท)');
    act(() => input.focus());
    expect(wrapper).toHaveAttribute('hidden');
    act(() => input.blur());
    expect(wrapper).not.toHaveAttribute('hidden');
  });

  it('the add control hands the card and month to onAddPlanForCard', async () => {
    setViewport(true);
    const onAddPlanForCard = jest.fn();
    render(<CreditCardDetail card={card} plans={[]} onAddPlanForCard={onAddPlanForCard} />);
    fireEvent.click(screen.getByRole('button', { name: 'เพิ่มรายจ่าย' }));
    expect(onAddPlanForCard).toHaveBeenCalledWith(card, expect.stringMatching(/^\d{4}-\d{2}$/));
  });
});

describe('AC-CD12 no inline form', () => {
  it('has no form and no "ชื่อรายการไม่ผ่อน" label', async () => {
    setViewport(false);
    jest.mocked(creditCardAPI.listSpendItems).mockResolvedValue({ items: [], totals: { cc_x: 0 } } as never);
    const { container } = render(<CreditCardDetail card={card} plans={[ongoing]} />);
    await screen.findByText('รวมรายการไม่ผ่อน 0.00 ฿');
    expect(container.querySelector('form')).toBeNull();
    expect(screen.queryByLabelText('ชื่อรายการไม่ผ่อน')).toBeNull();
    expect(container.querySelector('input[type="month"]')).toBeNull();
  });
});

describe('card menu (I-3)', () => {
  it('edit and delete card live in the header menu and call the page callbacks', async () => {
    setViewport(false);
    const user = userEvent.setup();
    const onEditCard = jest.fn();
    const onDeleteCard = jest.fn();
    render(<CreditCardDetail card={card} plans={[]} onEditCard={onEditCard} onDeleteCard={onDeleteCard} />);
    expect(screen.queryByRole('button', { name: 'แก้ไขบัตร' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'ตัวเลือกของบัตร บัตรทดสอบ' }));
    await user.click(screen.getByRole('menuitem', { name: 'แก้ไขบัตร' }));
    expect(onEditCard).toHaveBeenCalledWith(card);
    await user.click(screen.getByRole('button', { name: 'ตัวเลือกของบัตร บัตรทดสอบ' }));
    await user.click(screen.getByRole('menuitem', { name: 'ลบบัตร' }));
    expect(onDeleteCard).toHaveBeenCalledWith(card);
  });
});

describe('plans (AC-CD20 to AC-CD22, AC-CD24)', () => {
  it('AC-CD20 collapsed row (mobile): name, per-installment line, next installment; no totalPrice, interest or schedule', () => {
    setViewport(true);
    render(<CreditCardDetail card={card} plans={[ongoing]} />);
    const toggle = screen.getByRole('button', { name: /^โทรศัพท์/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveAttribute('aria-controls', 'plan-detail-ip_ongoing');
    expect(screen.getByText('งวดละ 300.00 ฿ · ชำระแล้ว 0/3 งวด')).toBeInTheDocument();
    expect(screen.getByText(/งวดถัดไป 1\/3 · 25 พ.ย. 2569/)).toBeInTheDocument();
    expect(screen.queryByText(/ราคารวม/)).toBeNull();
    expect(screen.queryByText(/ค่าธรรมเนียม/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'ยังไม่ชำระ' })).toBeNull();
  });

  it('AC-CD21 expanding reveals totals, interest and the schedule with working paid pills; desktop starts expanded', async () => {
    setViewport(true);
    const onToggleInstallment = jest.fn();
    const { unmount } = render(<CreditCardDetail card={card} plans={[ongoing]} onToggleInstallment={onToggleInstallment} />);
    fireEvent.click(screen.getByRole('button', { name: /^โทรศัพท์/ }));
    expect(screen.getByText('ราคารวม 900.00 ฿ · 3 งวด')).toBeInTheDocument();
    expect(screen.getByText('คงเหลือ 900.00 ฿')).toBeInTheDocument();
    expect(screen.getByText('ชำระแล้ว 0%')).toBeInTheDocument();
    expect(screen.getByText('ค่าธรรมเนียม 0.00 บาท/งวด')).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: /ยังไม่ชำระ/ })[0]);
    expect(onToggleInstallment).toHaveBeenCalledWith('ip_ongoing', 1, true, 'ip_ongoing_1');
    expect(screen.queryByRole('button', { name: 'ดูตารางผ่อน' })).toBeNull();
    unmount();

    setViewport(false);
    render(<CreditCardDetail card={card} plans={[ongoing]} />);
    expect(screen.getByRole('button', { name: /^โทรศัพท์/ })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('ราคารวม 900.00 ฿ · 3 งวด')).toBeInTheDocument();
  });

  it('AC-CD22 menu: with 2 installments paid, edit and delete are aria-disabled with visible reasons and do nothing', async () => {
    setViewport(false);
    const user = userEvent.setup();
    const onEditPlan = jest.fn();
    const onDeletePlan = jest.fn();
    const onRenamePlan = jest.fn();
    render(<CreditCardDetail card={card} plans={[paidPlan]} onEditPlan={onEditPlan} onDeletePlan={onDeletePlan} onRenamePlan={onRenamePlan} />);
    await user.click(screen.getByRole('button', { name: 'ตัวเลือกของแผน ทีวี' }));
    const edit = screen.getByRole('menuitem', { name: 'แก้ไขแผน' });
    const del = screen.getByRole('menuitem', { name: 'ลบแผน' });
    expect(edit).toHaveAttribute('aria-disabled', 'true');
    expect(edit).toHaveAccessibleDescription('แก้ไขไม่ได้เพราะชำระไปแล้ว 2 งวด — ให้ยกเลิกแผนแล้วสร้างใหม่');
    expect(del).toHaveAttribute('aria-disabled', 'true');
    expect(del).toHaveAccessibleDescription('ลบไม่ได้เพราะมีงวดที่ชำระแล้ว — ให้ยกเลิกแผนแทน');
    await user.click(edit);
    await user.click(del);
    expect(onEditPlan).not.toHaveBeenCalled();
    expect(onDeletePlan).not.toHaveBeenCalled();
    await user.click(screen.getByRole('menuitem', { name: 'แก้ไขชื่อรายการ' }));
    expect(onRenamePlan).toHaveBeenCalledWith(paidPlan);
  });

  it('AC-CD22 an untouched plan can be edited, cancelled and deleted from the menu', async () => {
    setViewport(false);
    const user = userEvent.setup();
    const onEditPlan = jest.fn();
    const onCancelPlan = jest.fn();
    const onDeletePlan = jest.fn();
    render(<CreditCardDetail card={card} plans={[ongoing]} onEditPlan={onEditPlan} onCancelPlan={onCancelPlan} onDeletePlan={onDeletePlan} />);
    for (const [name, spy] of [['แก้ไขแผน', onEditPlan], ['ยกเลิกแผน', onCancelPlan], ['ลบแผน', onDeletePlan]] as const) {
      await user.click(screen.getByRole('button', { name: 'ตัวเลือกของแผน โทรศัพท์' }));
      await user.click(screen.getByRole('menuitem', { name }));
      expect(spy).toHaveBeenCalledWith(ongoing);
    }
  });

  it('AC-CD24 completed and cancelled plans are only inside the collapsed "แผนที่จบแล้ว (k)"; heading count still equals plans.length', async () => {
    setViewport(false);
    const user = userEvent.setup();
    render(<CreditCardDetail card={card} plans={[ongoing, completed, cancelled]} />);
    expect(screen.getByRole('heading', { name: 'แผนผ่อนชำระ (3)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^โทรศัพท์/ })).toBeInTheDocument();
    expect(screen.queryByText('พัดลม')).toBeNull();
    expect(screen.queryByText('โซฟา')).toBeNull();
    const group = screen.getByRole('button', { name: 'แผนที่จบแล้ว (2)' });
    expect(group).toHaveAttribute('aria-expanded', 'false');
    await user.click(group);
    expect(screen.getByText('พัดลม')).toBeInTheDocument();
    expect(screen.getByText('✓ ผ่อนครบแล้ว')).toBeInTheDocument();
    expect(screen.getByText('ยกเลิกแผนแล้ว')).toBeInTheDocument();
    // cancelled plan menu
    await user.click(screen.getByRole('button', { name: 'ตัวเลือกของแผน โซฟา' }));
    expect(screen.queryByRole('menuitem', { name: 'ยกเลิกแผน' })).toBeNull();
    expect(screen.getByRole('menuitem', { name: 'แก้ไขแผน' })).toHaveAccessibleDescription('แก้ไขไม่ได้เพราะแผนถูกยกเลิกแล้ว');
  });

  it('no settled group is rendered when every plan is ongoing; empty state keeps its copy', () => {
    setViewport(false);
    const { unmount } = render(<CreditCardDetail card={card} plans={[ongoing]} />);
    expect(screen.queryByRole('button', { name: /แผนที่จบแล้ว/ })).toBeNull();
    unmount();
    render(<CreditCardDetail card={card} plans={[]} />);
    expect(screen.getByText('ยังไม่มีแผนผ่อนในบัตรนี้ — กด “เพิ่มรายจ่าย” เพื่อเริ่มต้น')).toBeInTheDocument();
  });
});

describe('AC-CD25 cashback + history disclosures', () => {
  it('mobile: collapsed; desktop: expanded', () => {
    setViewport(true);
    const { unmount } = render(<CreditCardDetail card={card} plans={[]} />);
    expect(screen.getByRole('button', { name: /^แคชแบค ·/ })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('button', { name: /ประวัติยอดหมุนเวียน/ })).toHaveAttribute('aria-expanded', 'false');
    unmount();
    setViewport(false);
    render(<CreditCardDetail card={card} plans={[]} />);
    expect(screen.getByRole('button', { name: /^แคชแบค ·/ })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: 'ซ่อนประวัติยอดหมุนเวียน' })).toHaveAttribute('aria-expanded', 'true');
  });

  it('section headings carry the viewed month; plans heading does not', async () => {
    setViewport(false);
    render(<CreditCardDetail card={card} plans={[]} />);
    const month = document.querySelector('[data-month]')?.getAttribute('data-month') as string;
    expect(month).toMatch(/^\d{4}-\d{2}$/);
    expect(screen.getByRole('heading', { name: /^รายการไม่ผ่อน · / })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'แผนผ่อนชำระ (0)' })).toBeInTheDocument();
  });
});
