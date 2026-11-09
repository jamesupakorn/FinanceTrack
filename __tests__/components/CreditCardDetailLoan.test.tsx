// Loan slice S3 — CreditCardDetail loan variant: header metrics (AC-LN-31), hidden credit-only blocks,
// rate-revision UI fully absent (P0-2, AC-LN-S3-02), loan plan-menu copy, and the existing long-plan reveal.
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CreditCardDetail from '../../src/frontend/components/CreditCardDetail';
import { creditCardAPI } from '../../src/shared/utils/frontend/apiUtils';

jest.mock('../../src/shared/utils/frontend/apiUtils', () => ({
  creditCardAPI: { listSpendItems: jest.fn(), deleteSpendItem: jest.fn(), getRevolving: jest.fn() }
}));
jest.mock('../../src/shared/utils/frontend/toast', () => ({ showToast: jest.fn() }));

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
  jest.mocked(creditCardAPI.listSpendItems).mockReturnValue(new Promise(() => undefined) as never);
  jest.mocked(creditCardAPI.getRevolving).mockReturnValue(new Promise(() => undefined) as never);
});

const loanCard = {
  id: 'cc_loan_1', name: 'บ้านลาดพร้าว', cardType: 'home_loan', bankName: 'กสิกรไทย', last4: '1234',
  creditLimit: 0, remainingPrincipal: 950000, remainingPayable: 1500000, availableCredit: 0, statementDay: 'EOM', dueDay: 5
};
const months = 24;
const schedule = Array.from({ length: months }, (_, index) => ({
  no: index + 1,
  dueMonth: `${2026 + Math.floor((index + 10) / 12)}-${String(((index + 10) % 12) + 1).padStart(2, '0')}`,
  payment: 7164.31, principal: 5000, interest: 2164.31, paid: index < 2
}));
const loanPlan = {
  id: 'ip_loan_1', cardId: 'cc_loan_1', itemName: 'สัญญา 123', status: 'ongoing', installmentsPaid: 2, installmentsRemaining: 22,
  months, schedule, nextUnpaid: schedule[2], totalPrice: 1000000, progressPercent: 8.33, monthlyPayment: 7164.31,
  remainingPayable: 157614.82, remainingPrincipal: 940000, interestMode: 'calculated', calcMethod: 'effective', annualRate: 6,
  rateRevisionCount: 0, createdAt: '2026-01-01'
};

describe.each([['mobile', true], ['desktop', false]])('loan detail (%s)', (_name, mobile) => {
  beforeEach(() => setViewport(mobile));

  test('header shows the 4 metrics + due day; credit-only blocks and add-expense are absent', () => {
    render(<CreditCardDetail card={loanCard} plans={[loanPlan]} />);
    const header = screen.getByTestId('loan-detail-header');
    expect(within(header).getByText('สินเชื่อบ้าน · กสิกรไทย · ····1234')).toBeInTheDocument();
    const metric = (label: string) => within(header).getByText(label).nextElementSibling;
    expect(metric('เงินต้นคงเหลือ')).toHaveTextContent('940,000.00 ฿');
    expect(metric('ค่างวดปัจจุบัน')).toHaveTextContent('7,164.31 ฿');
    expect(metric('ดอกเบี้ยปัจจุบัน')).toHaveTextContent('6.00% ต่อปี');
    expect(metric('งวดคงเหลือ')).toHaveTextContent('22 / 24 งวด');
    expect(within(header).getByText(/^ครบกำหนดทุกวันที่ 5/)).toBeInTheDocument();

    const text = document.body.textContent || '';
    expect(text).not.toMatch(/วงเงิน|ใช้วงเงิน|สรุปยอด|ยอดหมุนเวียน|เพิ่มรายจ่าย/);
    expect(screen.queryByRole('heading', { name: 'ชำระรอบบิลนี้' })).toBeNull();
    expect(screen.queryByRole('heading', { name: /^รายการไม่ผ่อน/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /ประวัติยอดหมุนเวียน/ })).toBeNull();
    expect(creditCardAPI.listSpendItems).not.toHaveBeenCalled();
    expect(creditCardAPI.getRevolving).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: 'ตารางผ่อน' })).toBeInTheDocument();
  });

  test('P0-2: no rate-revision section, button or caption at all', () => {
    render(<CreditCardDetail card={loanCard} plans={[loanPlan]} />);
    expect(screen.queryByText(/ประวัติอัตราดอกเบี้ย/)).toBeNull();
    expect(screen.queryByRole('button', { name: /ปรับอัตราดอกเบี้ย/ })).toBeNull();
    expect(screen.queryByText(/ปรับอัตราดอกเบี้ย/)).toBeNull();
  });
});

test('P0-2 holds for a completed and a cancelled loan plan too', () => {
  setViewport(false);
  for (const status of ['completed', 'cancelled_early']) {
    const { unmount } = render(<CreditCardDetail card={loanCard} plans={[{ ...loanPlan, status, nextUnpaid: null }]} />);
    expect(screen.queryByText(/อัตราดอกเบี้ย/)).toBeNull();
    unmount();
  }
});

test('loan without a plan: metrics show "-", empty line has no add-expense wording', () => {
  setViewport(false);
  render(<CreditCardDetail card={loanCard} plans={[]} />);
  const header = screen.getByTestId('loan-detail-header');
  expect(within(header).getByText('เงินต้นคงเหลือ').nextElementSibling).toHaveTextContent('-');
  expect(screen.getByText('ยังไม่มีตารางผ่อนของสินเชื่อนี้')).toBeInTheDocument();
  expect(document.body.textContent).not.toContain('เพิ่มรายจ่าย');
});

test('mobile: no fixed add-expense bar for a loan', () => {
  setViewport(true);
  render(<CreditCardDetail card={loanCard} plans={[loanPlan]} />);
  expect(document.querySelector('[data-add-expense-fallback]')).toBeNull();
});

test('loan plan menu uses ตารางผ่อน copy; edit disabled with a reason once rows are paid', async () => {
  setViewport(false);
  const user = userEvent.setup();
  render(<CreditCardDetail card={loanCard} plans={[loanPlan]} />);
  await user.click(screen.getByRole('button', { name: 'ตัวเลือกของแผน สัญญา 123' }));
  const edit = screen.getByRole('menuitem', { name: /แก้ไขตารางผ่อน/ });
  expect(edit).toHaveAttribute('aria-disabled', 'true');
  expect(document.body.textContent).toContain('แก้ไขไม่ได้เพราะชำระไปแล้ว 2 งวด — ให้ยกเลิกตารางผ่อนแล้วสร้างใหม่');
  expect(screen.getByRole('menuitem', { name: /ยกเลิกตารางผ่อน/ })).toBeInTheDocument();
  expect(screen.getByRole('menuitem', { name: /ลบตารางผ่อน/ })).toBeInTheDocument();
});

test('long loan plan: collapsed preview -> "แสดงเพิ่ม 12 งวด" incremental reveal -> "แสดงทั้งหมด (N งวด)"', async () => {
  setViewport(false);
  const user = userEvent.setup();
  render(<CreditCardDetail card={loanCard} plans={[loanPlan]} />);
  const rowsBefore = document.querySelectorAll('tbody tr').length;
  expect(rowsBefore).toBe(2 + 6);

  // D-S3-3: incremental "show 12 more" step before jumping to "show all"
  await user.click(screen.getByRole('button', { name: 'แสดงเพิ่ม 12 งวด' }));
  expect(document.querySelectorAll('tbody tr').length).toBe(Math.min(2 + 18, months));

  await user.click(screen.getByRole('button', { name: `แสดงทั้งหมด (${months} งวด)` }));
  expect(document.querySelectorAll('tbody tr').length).toBe(months);
});

test('credit-card detail keeps its existing chrome (no loan header)', () => {
  setViewport(false);
  const card = { id: 'cc_x', name: 'KTC', creditLimit: 20000, remainingPrincipal: 5000, remainingPayable: 900, availableCredit: 15000, statementDay: 5, dueDay: 25 };
  render(<CreditCardDetail card={card} plans={[]} />);
  expect(screen.queryByTestId('loan-detail-header')).toBeNull();
  expect(screen.getByText('หนี้คงเหลือรวม 900.00 ฿')).toBeInTheDocument();
  expect(screen.getAllByRole('button', { name: /เพิ่มรายจ่าย/ }).length).toBeGreaterThan(0);
});
