/**
 * Stage 4 tester addition for credit-card-cashback: DOM-level checks of RevolvingBalanceSection's
 * cashback states (C-4/C-8/C-10, AC-CB-61…69 structure). These do NOT replace the manual visual
 * pass at 375px / ≥ 768px — they prove which elements render for each server state and what the
 * blur handler sends. Cycles come from the real buildRevolvingCycles (the server's own math), so the
 * component is fed exactly what the API would return.
 */
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import RevolvingBalanceSection from '../../src/frontend/components/RevolvingBalanceSection';
import { creditCardAPI } from '../../src/shared/utils/frontend/apiUtils';
import { buildRevolvingCycles } from '../../src/shared/utils/creditCardUtils';

jest.mock('../../src/shared/utils/frontend/apiUtils', () => ({
  creditCardAPI: {
    getRevolving: jest.fn(),
    saveRevolvingSpend: jest.fn(),
    saveRevolvingCashback: jest.fn(),
    setRevolvingAction: jest.fn()
  }
}));

const CARD = { id: 'cc_x', name: 'บัตร X', annualRate: 12, minPaymentPercent: 10, dueDay: 20 };
const JAN = '2099-01';
const FEB = '2099-02';

const chainResponse = (stored, throughMonth = JAN) => ({
  success: true,
  cycles: buildRevolvingCycles(CARD, stored.map((c, i) => ({ id: `rc_${i}`, cardId: 'cc_x', paidAt: null, paidSource: null, ...c })), { throughMonth }),
  truncated: false
});

async function renderWith(stored, { month = JAN, throughMonth = month, isMobileView = false } = {}) {
  creditCardAPI.getRevolving.mockResolvedValue(chainResponse(stored, throughMonth));
  const utils = render(<RevolvingBalanceSection card={CARD} month={month} isMobileView={isMobileView} />);
  await waitFor(() => expect(screen.getByLabelText('แคชแบคที่ได้รับเดือนนี้ (บาท)')).toBeInTheDocument());
  return utils;
}

afterEach(() => jest.clearAllMocks());

describe('RevolvingBalanceSection cashback input', () => {
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

  it('AC-CB-61/62/63/64 blur rules: save once with the formatted value, no request on no-change, clear sends 0.00, invalid sends nothing', async () => {
    await renderWith([{ month: JAN, newSpend: 1000, cashbackAmount: 100, paymentAction: null }]);
    creditCardAPI.saveRevolvingCashback.mockResolvedValue(chainResponse([{ month: JAN, newSpend: 1000, cashbackAmount: 150, paymentAction: null }]));
    const input = screen.getByLabelText('แคชแบคที่ได้รับเดือนนี้ (บาท)');
    expect(input).toHaveValue('100.00');

    // no change (re-typed as '100') -> no request
    fireEvent.change(input, { target: { value: '100' } });
    fireEvent.blur(input);
    expect(creditCardAPI.saveRevolvingCashback).not.toHaveBeenCalled();

    // invalid -> revert, no request
    fireEvent.change(input, { target: { value: '-50' } });
    fireEvent.blur(input);
    expect(creditCardAPI.saveRevolvingCashback).not.toHaveBeenCalled();
    expect(input).toHaveValue('100.00');
    fireEvent.change(input, { target: { value: 'abc' } });
    fireEvent.blur(input);
    expect(creditCardAPI.saveRevolvingCashback).not.toHaveBeenCalled();

    // valid change -> one save with the formatted string
    fireEvent.change(input, { target: { value: '150' } });
    fireEvent.blur(input);
    await waitFor(() => expect(creditCardAPI.saveRevolvingCashback).toHaveBeenCalledTimes(1));
    expect(creditCardAPI.saveRevolvingCashback).toHaveBeenCalledWith('cc_x', JAN, '150.00');
    expect(creditCardAPI.setRevolvingAction).not.toHaveBeenCalled();
    await waitFor(() => expect(input).not.toBeDisabled());

    // clear -> sends '0.00', never ''
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.blur(input);
    await waitFor(() => expect(creditCardAPI.saveRevolvingCashback).toHaveBeenCalledTimes(2));
    expect(creditCardAPI.saveRevolvingCashback).toHaveBeenLastCalledWith('cc_x', JAN, '0.00');
  });
});

describe('RevolvingBalanceSection cashback states', () => {
  it('AC-CB-65 positive month: net total, the "หักแคชแบคแล้ว" line and pay buttons', async () => {
    await renderWith([{ month: JAN, newSpend: 1000, cashbackAmount: 100, paymentAction: null }]);
    expect(screen.getByText('900.00 ฿')).toBeInTheDocument();
    expect(screen.getByText('หักแคชแบคแล้ว 100.00 ฿')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /จ่ายเต็มจำนวน 900\.00/ })).toBeInTheDocument();
  });

  it('UX §3.8: paid full then cashback on a still-positive month shows the settled panel with the NET amount', async () => {
    await renderWith([{ month: JAN, newSpend: 1000, cashbackAmount: 100, paymentAction: 'full' }]);
    expect(screen.getByText('✓ จ่ายเต็มจำนวนแล้ว 900.00 ฿')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'ยกเลิกการชำระ' })).toBeInTheDocument();
  });

  it('AC-CB-66 + C-8: zero after cashback with a stored full shows ONLY the zero line (no settled panel, no undo, no pay buttons)', async () => {
    await renderWith([{ month: JAN, newSpend: 1000, cashbackAmount: 1000, paymentAction: 'full' }]);
    expect(screen.getByText('แคชแบคหักยอดเดือนนี้หมดพอดี · ไม่มียอดต้องชำระ')).toBeInTheDocument();
    expect(screen.queryByText(/จ่ายเต็มจำนวนแล้ว/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'ยกเลิกการชำระ' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /จ่ายเต็มจำนวน/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/เครดิตคงเหลือ/)).not.toBeInTheDocument();
  });

  it('C-8 regression: a zero month WITHOUT cashback and a stored full still shows the settled panel as before', async () => {
    await renderWith([{ month: JAN, newSpend: 0, paymentAction: 'full' }]);
    expect(screen.getByText('✓ จ่ายเต็มจำนวนแล้ว 0.00 ฿')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'ยกเลิกการชำระ' })).toBeInTheDocument();
    expect(screen.queryByText(/แคชแบคหักยอดเดือนนี้หมดพอดี/)).not.toBeInTheDocument();
  });

  it.each([null, 'full', 'minimum'])('AC-CB-67 credit month (stored %p): credit panel only, no pay buttons, no settled panel', async (action) => {
    await renderWith([{ month: JAN, newSpend: 300, cashbackAmount: 500, paymentAction: action }]);
    expect(screen.getByText('เครดิตคงเหลือ 200.00 ฿')).toBeInTheDocument();
    expect(screen.getByText('ไม่มียอดต้องชำระเดือนนี้')).toBeInTheDocument();
    expect(screen.queryByText(/จ่ายเต็มจำนวนแล้ว|จ่ายขั้นต่ำแล้ว/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'ยกเลิกการชำระ' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /จ่ายเต็มจำนวน|จ่ายขั้นต่ำ/ })).not.toBeInTheDocument();
    expect(screen.queryByText('ยอดที่ต้องชำระทั้งหมด')).not.toBeInTheDocument();
  });

  it('AC-CB-68 next month with a carried credit: เครดิตยกมา row + source line without interest, no ยอดยกมา', async () => {
    await renderWith(
      [{ month: JAN, newSpend: 300, cashbackAmount: 500, paymentAction: null }],
      { month: FEB, throughMonth: FEB }
    );
    expect(screen.getByText('เครดิตยกมา')).toBeInTheDocument();
    expect(screen.queryByText('ยอดยกมา')).not.toBeInTheDocument();
    expect(screen.getByText(/· คำนวณจากเดือนก่อนหน้าโดยอัตโนมัติ/)).toBeInTheDocument();
    expect(screen.queryByText(/รวมดอกเบี้ย/)).not.toBeInTheDocument();
    // implicit month still carrying the credit -> credit panel, no "not recorded yet" line
    expect(screen.getByText('เครดิตคงเหลือ 200.00 ฿')).toBeInTheDocument();
    expect(screen.queryByText('ยังไม่ได้บันทึกยอดใช้จ่ายของเดือนนี้')).not.toBeInTheDocument();
  });

  it('AC-CB-69 + C-10 (md+ table): cashback column, มีเครดิต status even with stored full, signed ยกมา/ยกไป', async () => {
    const { container } = await renderWith(
      [{ month: JAN, newSpend: 300, cashbackAmount: 500, paymentAction: 'full' }, { month: FEB, newSpend: 1000, paymentAction: null }],
      { month: FEB, throughMonth: FEB }
    );
    const table = container.querySelector('table');
    expect(table).not.toBeNull();
    const headers = Array.from(table.querySelectorAll('th')).map(th => th.textContent);
    expect(headers).toEqual(['เดือน', 'ยกมา', 'ใช้จ่าย', 'แคชแบค', 'ชำระ', 'ยกไป']);
    const rows = Array.from(table.querySelectorAll('tbody tr')).map(tr => Array.from(tr.querySelectorAll('td')).map(td => td.textContent));
    // history is newest first: FEB, JAN
    const [feb, jan] = rows;
    expect(jan[3]).toBe('500.00');
    expect(jan[4]).toBe('มีเครดิต');
    expect(jan[5]).toBe('เครดิต 200.00');
    expect(feb[1]).toBe('เครดิต 200.00');
    expect(feb[3]).toBe('—');
    expect(feb[4]).toBe('ยังไม่ชำระ');
    expect(feb[5]).toBe('800.00');
    expect(table.textContent).not.toMatch(/-200/);
  });

  it('AC-CB-69 + C-10 (mobile stack): big number reads เครดิต X, status มีเครดิต, cashback in the detail line', async () => {
    const { container } = await renderWith(
      [{ month: JAN, newSpend: 300, cashbackAmount: 500, paymentAction: 'full' }],
      { isMobileView: true }
    );
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    const text = container.textContent;
    expect(text).toContain('มีเครดิต');
    expect(text).toContain('ยกมา 0.00 · ใช้จ่าย 300.00 · แคชแบค 500.00');
    expect(text).toContain('ยกไป เครดิต 200.00');
    expect(screen.getAllByText('เครดิต 200.00').length).toBeGreaterThan(0);
    expect(text).not.toMatch(/-200\.00/);
    expect(text).not.toMatch(/เต็ม 0\.00/);
  });
});
