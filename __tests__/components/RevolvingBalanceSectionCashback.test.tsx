import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import RevolvingBalanceSection from '../../src/frontend/components/RevolvingBalanceSection';
import { creditCardAPI, expenseAPI } from '../../src/shared/utils/frontend/apiUtils';
import { buildRevolvingCycles } from '../../src/shared/utils/creditCardUtils';

jest.mock('../../src/shared/utils/frontend/apiUtils', () => ({
  expenseAPI: { getByMonth: jest.fn().mockResolvedValue({}) },
  creditCardAPI: {
    getRevolving: jest.fn(),
    listSpendItems: jest.fn().mockResolvedValue({ items: [], totals: {} }),
    saveRevolvingCashback: jest.fn(),
    setRevolvingAction: jest.fn()
  }
}));

const mockedCreditCardAPI = creditCardAPI as jest.Mocked<typeof creditCardAPI>;
const CARD = { id: 'cc_x', name: 'บัตร X', annualRate: 12, minPaymentPercent: 10, dueDay: 20 };
const JAN = '2099-01';
const FEB = '2099-02';
type StoredCycleInput = NonNullable<Parameters<typeof buildRevolvingCycles>[1]>[number];

const chainResponse = (stored: StoredCycleInput[], throughMonth = JAN) => ({
  success: true,
  cycles: buildRevolvingCycles(CARD, stored.map((cycle, index) => ({ id: `rc_${index}`, cardId: 'cc_x', paidAt: null, paidSource: null, ...cycle })), { throughMonth }),
  truncated: false
});

async function renderWith(
  stored: StoredCycleInput[],
  { month = JAN, throughMonth = month, isMobileView = false }: { month?: string; throughMonth?: string; isMobileView?: boolean } = {}
) {
  mockedCreditCardAPI.getRevolving.mockResolvedValue(chainResponse(stored, throughMonth));
  const utils = render(<RevolvingBalanceSection card={CARD} month={month} isMobileView={isMobileView} />);
  await waitFor(() => expect(screen.getByLabelText('แคชแบคที่ได้รับเดือนนี้ (บาท)')).toBeInTheDocument());
  return utils;
}

afterEach(() => jest.clearAllMocks());

describe('RevolvingBalanceSection cashback input', () => {
  it('refreshes the selected-month card total when the parent reloads the card after an installment change', async () => {
    const expense = expenseAPI.getByMonth as jest.Mock;
    expense.mockResolvedValue({ ccr_x: { actual: 1000, breakdown: { installmentTotal: 0 } } });
    const { rerender } = await renderWith([{ month: JAN, newSpend: 1000, paymentAction: null }]);
    expect(await screen.findByText(/งวดผ่อนเดือนนี้ 0\.00 ฿ · ยอดรวมบัตร 1,000\.00 ฿/)).toBeInTheDocument();
    expense.mockResolvedValue({ ccr_x: { actual: 1300, breakdown: { installmentTotal: 300 } } });
    rerender(<RevolvingBalanceSection card={{ ...CARD }} month={JAN} />);
    expect(await screen.findByText(/งวดผ่อนเดือนนี้ 300\.00 ฿ · ยอดรวมบัตร 1,300\.00 ฿/)).toBeInTheDocument();
    expense.mockResolvedValue({});
  });

  it('AC-CB-60 structure: text input, inputMode decimal, described by the helper, placeholder 0.00', async () => {
    await renderWith([{ month: JAN, newSpend: 1000, paymentAction: null }]);
    const input = screen.getByLabelText('แคชแบคที่ได้รับเดือนนี้ (บาท)');
    expect(input).toHaveAttribute('type', 'text');
    expect(input).toHaveAttribute('inputMode', 'decimal');
    expect(input).toHaveAttribute('placeholder', '0.00');
    expect(input).toHaveAttribute('aria-describedby', 'revolving-cashback-help');
    expect(input.className).toContain('min-h-12');
    expect(document.getElementById('revolving-cashback-help')).toHaveTextContent('กรอกยอดเงินคืนตามที่แสดงใน statement');
  });

  it('AC-CB-61/62/63/64 blur rules: save once with formatted value, no request on no-change, clear sends 0.00, invalid sends nothing', async () => {
    await renderWith([{ month: JAN, newSpend: 1000, cashbackAmount: 100, paymentAction: null }]);
    mockedCreditCardAPI.saveRevolvingCashback.mockResolvedValue(chainResponse([{ month: JAN, newSpend: 1000, cashbackAmount: 150, paymentAction: null }]));
    const input = screen.getByLabelText('แคชแบคที่ได้รับเดือนนี้ (บาท)');
    expect(input).toHaveValue('100.00');

    fireEvent.change(input, { target: { value: '100' } });
    fireEvent.blur(input);
    expect(mockedCreditCardAPI.saveRevolvingCashback).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: '-50' } });
    fireEvent.blur(input);
    expect(mockedCreditCardAPI.saveRevolvingCashback).not.toHaveBeenCalled();
    expect(input).toHaveValue('100.00');
    fireEvent.change(input, { target: { value: 'abc' } });
    fireEvent.blur(input);
    expect(mockedCreditCardAPI.saveRevolvingCashback).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: '150' } });
    fireEvent.blur(input);
    await waitFor(() => expect(mockedCreditCardAPI.saveRevolvingCashback).toHaveBeenCalledTimes(1));
    expect(mockedCreditCardAPI.saveRevolvingCashback).toHaveBeenCalledWith('cc_x', JAN, '150.00');
    expect(mockedCreditCardAPI.setRevolvingAction).not.toHaveBeenCalled();
    await waitFor(() => expect(input).not.toBeDisabled());

    fireEvent.change(input, { target: { value: '' } });
    fireEvent.blur(input);
    await waitFor(() => expect(mockedCreditCardAPI.saveRevolvingCashback).toHaveBeenCalledTimes(2));
    expect(mockedCreditCardAPI.saveRevolvingCashback).toHaveBeenLastCalledWith('cc_x', JAN, '0.00');
  });
});

describe('RevolvingBalanceSection cashback states', () => {
  it('AC-CB-65 positive month: net total, cashback line and pay buttons', async () => {
    await renderWith([{ month: JAN, newSpend: 1000, cashbackAmount: 100, paymentAction: null }]);
    expect(screen.getByText('900.00 ฿')).toBeInTheDocument();
    expect(screen.getByText('หักแคชแบคแล้ว 100.00 ฿')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /จ่ายเต็มจำนวน 900\.00/ })).toBeInTheDocument();
  });

  it('paid full then cashback on a still-positive month shows the settled panel with the net amount', async () => {
    await renderWith([{ month: JAN, newSpend: 1000, cashbackAmount: 100, paymentAction: 'full' }]);
    expect(screen.getByText('✓ จ่ายเต็มจำนวนแล้ว 900.00 ฿')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'ยกเลิกการชำระ' })).toBeInTheDocument();
  });

  it('AC-CB-66 + C-8: zero after cashback with a stored full shows only the zero line', async () => {
    await renderWith([{ month: JAN, newSpend: 1000, cashbackAmount: 1000, paymentAction: 'full' }]);
    expect(screen.getByText('แคชแบคหักยอดเดือนนี้หมดพอดี · ไม่มียอดต้องชำระ')).toBeInTheDocument();
    expect(screen.queryByText(/จ่ายเต็มจำนวนแล้ว/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'ยกเลิกการชำระ' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /จ่ายเต็มจำนวน/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/เครดิตคงเหลือ/)).not.toBeInTheDocument();
  });

  it('a zero month without cashback and a stored full still shows the settled panel as before', async () => {
    await renderWith([{ month: JAN, newSpend: 0, paymentAction: 'full' }]);
    expect(screen.getByText('✓ จ่ายเต็มจำนวนแล้ว 0.00 ฿')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'ยกเลิกการชำระ' })).toBeInTheDocument();
    expect(screen.queryByText(/แคชแบคหักยอดเดือนนี้หมดพอดี/)).not.toBeInTheDocument();
  });

  it.each<'full' | 'minimum' | null>([null, 'full', 'minimum'])('AC-CB-67 credit month (stored %p): credit panel only', async (action) => {
    await renderWith([{ month: JAN, newSpend: 300, cashbackAmount: 500, paymentAction: action }]);
    expect(screen.getByText('เครดิตคงเหลือ 200.00 ฿')).toBeInTheDocument();
    expect(screen.getByText('ไม่มียอดต้องชำระเดือนนี้')).toBeInTheDocument();
    expect(screen.queryByText(/จ่ายเต็มจำนวนแล้ว|จ่ายขั้นต่ำแล้ว/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'ยกเลิกการชำระ' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /จ่ายเต็มจำนวน|จ่ายขั้นต่ำ/ })).not.toBeInTheDocument();
    expect(screen.queryByText('ยอดที่ต้องชำระทั้งหมด')).not.toBeInTheDocument();
  });

  it('AC-CB-68 next month with a carried credit shows its source line without interest', async () => {
    await renderWith([{ month: JAN, newSpend: 300, cashbackAmount: 500, paymentAction: null }], { month: FEB, throughMonth: FEB });
    expect(screen.getByText('เครดิตยกมา')).toBeInTheDocument();
    expect(screen.queryByText('ยอดยกมา')).not.toBeInTheDocument();
    expect(screen.getByText(/· คำนวณจากเดือนก่อนหน้าโดยอัตโนมัติ/)).toBeInTheDocument();
    expect(screen.queryByText(/รวมดอกเบี้ย/)).not.toBeInTheDocument();
    expect(screen.getByText('เครดิตคงเหลือ 200.00 ฿')).toBeInTheDocument();
    expect(screen.queryByText('ยังไม่ได้บันทึกยอดใช้จ่ายของเดือนนี้')).not.toBeInTheDocument();
  });

  it('AC-CB-69 + C-10 (md+ table): cashback column, credit status, and signed carry amounts', async () => {
    const { container } = await renderWith([
      { month: JAN, newSpend: 300, cashbackAmount: 500, paymentAction: 'full' },
      { month: FEB, newSpend: 1000, paymentAction: null }
    ], { month: FEB, throughMonth: FEB });
    const table = container.querySelector('table');
    expect(table).not.toBeNull();
    const headers = Array.from(table!.querySelectorAll('th')).map(header => header.textContent);
    expect(headers).toEqual(['เดือน', 'ยกมา', 'ใช้จ่าย', 'แคชแบค', 'ชำระ', 'ยกไป']);
    const rows = Array.from(table!.querySelectorAll('tbody tr')).map(tableRow => Array.from(tableRow.querySelectorAll('td')).map(cell => cell.textContent));
    const [feb, jan] = rows;
    expect(jan[3]).toBe('500.00');
    expect(jan[4]).toBe('มีเครดิต');
    expect(jan[5]).toBe('เครดิต 200.00');
    expect(feb[1]).toBe('เครดิต 200.00');
    expect(feb[3]).toBe('—');
    expect(feb[4]).toBe('ยังไม่ชำระ');
    expect(feb[5]).toBe('800.00');
    expect(table!.textContent).not.toMatch(/-200/);
  });

  it('AC-CB-69 + C-10 (mobile stack): credit wording, status, and cashback detail line', async () => {
    const { container } = await renderWith([{ month: JAN, newSpend: 300, cashbackAmount: 500, paymentAction: 'full' }], { isMobileView: true });
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    const text = container.textContent || '';
    expect(text).toContain('มีเครดิต');
    expect(text).toContain('ยกมา 0.00 · ใช้จ่าย 300.00 · แคชแบค 500.00');
    expect(text).toContain('ยกไป เครดิต 200.00');
    expect(screen.getAllByText('เครดิต 200.00').length).toBeGreaterThan(0);
    expect(text).not.toMatch(/-200\.00/);
    expect(text).not.toMatch(/เต็ม 0\.00/);
  });
});