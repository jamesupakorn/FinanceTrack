// RevolvingBalanceSection is now the cashback disclosure + history disclosure fed by useRevolvingCycle.
// AC-CB-60 to AC-CB-64 and AC-CB-69 are kept here against a small hook harness; AC-CB-65 to AC-CB-68 moved to
// CardPayNextSummary.test.tsx and the card-total refresh case moved to useRevolvingCycle.test.ts.
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import RevolvingBalanceSection from '../../src/frontend/components/RevolvingBalanceSection';
import { useRevolvingCycle } from '../../src/shared/utils/frontend/useRevolvingCycle';
import { creditCardAPI } from '../../src/shared/utils/frontend/apiUtils';
import { buildRevolvingCycles } from '../../src/shared/utils/creditCardUtils';

jest.mock('../../src/shared/utils/frontend/apiUtils', () => ({
  expenseAPI: { getByMonth: jest.fn().mockResolvedValue({}) },
  creditCardAPI: {
    getRevolving: jest.fn(),
    saveRevolvingCashback: jest.fn(),
    setRevolvingAction: jest.fn()
  }
}));
jest.mock('../../src/shared/utils/frontend/toast', () => ({ showToast: jest.fn() }));

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

function Harness({ month, isMobileView }: { month: string; isMobileView: boolean }) {
  const rev = useRevolvingCycle({ card: CARD, month });
  return (
    <>
      <button type="button">outside</button>
      <RevolvingBalanceSection month={month} isMobileView={isMobileView} rev={rev} />
    </>
  );
}

async function renderWith(
  stored: StoredCycleInput[],
  { month = JAN, throughMonth = month, isMobileView = false }: { month?: string; throughMonth?: string; isMobileView?: boolean } = {}
) {
  mockedCreditCardAPI.getRevolving.mockResolvedValue(chainResponse(stored, throughMonth));
  const utils = render(<Harness month={month} isMobileView={isMobileView} />);
  await waitFor(() => expect(screen.getByLabelText('แคชแบคที่ได้รับเดือนนี้ (บาท)')).not.toBeDisabled());
  return utils;
}

afterEach(() => jest.clearAllMocks());

describe('RevolvingBalanceSection cashback input', () => {
  it('AC-CB-60 structure: text input, inputMode decimal, described by the helper, placeholder 0.00', async () => {
    await renderWith([{ month: JAN, newSpend: 1000, paymentAction: null }]);
    const input = screen.getByLabelText('แคชแบคที่ได้รับเดือนนี้ (บาท)');
    expect(input).toHaveAttribute('id', 'revolving-cashback');
    expect(input).toHaveAttribute('name', 'cashbackAmount');
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

describe('AC-CD25 cashback disclosure', () => {
  it('is collapsed below 768px (hidden, not unmounted) and expanded at or above it', async () => {
    const { unmount } = await renderWith([{ month: JAN, newSpend: 1000, cashbackAmount: 100, paymentAction: null }], { isMobileView: true });
    const toggle = screen.getByRole('button', { name: /แคชแบค · ม\.ค\. 2642/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveTextContent('100.00 ฿');
    expect(screen.getByLabelText('แคชแบคที่ได้รับเดือนนี้ (บาท)')).toBeInTheDocument();
    expect(document.getElementById('revolving-cashback-panel')).toHaveAttribute('hidden');
    unmount();
    await renderWith([{ month: JAN, newSpend: 1000, paymentAction: null }], { isMobileView: false });
    expect(screen.getByRole('button', { name: /แคชแบค · ม\.ค\. 2642/ })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: /แคชแบค · ม\.ค\. 2642/ })).toHaveTextContent('ยังไม่ได้กรอก');
    expect(document.getElementById('revolving-cashback-panel')).not.toHaveAttribute('hidden');
  });

  it('collapsing while a changed value is focused saves it once', async () => {
    const user = userEvent.setup();
    await renderWith([{ month: JAN, newSpend: 1000, cashbackAmount: 100, paymentAction: null }], { isMobileView: false });
    mockedCreditCardAPI.saveRevolvingCashback.mockResolvedValue(chainResponse([{ month: JAN, newSpend: 1000, cashbackAmount: 150, paymentAction: null }]));
    const input = screen.getByLabelText('แคชแบคที่ได้รับเดือนนี้ (บาท)');
    await user.clear(input);
    await user.type(input, '150');
    expect(input).toHaveFocus();
    await user.click(screen.getByRole('button', { name: /แคชแบค · ม\.ค\. 2642/ }));
    await waitFor(() => expect(mockedCreditCardAPI.saveRevolvingCashback).toHaveBeenCalledTimes(1));
    expect(mockedCreditCardAPI.saveRevolvingCashback).toHaveBeenCalledWith('cc_x', JAN, '150.00');
    expect(document.getElementById('revolving-cashback-panel')).toHaveAttribute('hidden');
    await waitFor(() => expect(screen.getByRole('button', { name: /แคชแบค · ม\.ค\. 2642/ })).toHaveTextContent('150.00 ฿'));
  });
});

describe('history (AC-CB-69 / AC-CD26)', () => {
  it('AC-CB-69 + C-10 (md+ table): cashback column, credit status, signed carry amounts, selected month marked', async () => {
    const { container } = await renderWith([
      { month: JAN, newSpend: 300, cashbackAmount: 500, paymentAction: 'full' },
      { month: FEB, newSpend: 1000, paymentAction: null }
    ], { month: FEB, throughMonth: FEB });
    const table = container.querySelector('table');
    expect(table).not.toBeNull();
    const headers = Array.from(table!.querySelectorAll('th')).map(header => header.textContent);
    expect(headers).toEqual(['เดือน', 'ยกมา', 'ใช้จ่าย', 'แคชแบค', 'ชำระ', 'ยกไป']);
    const bodyRows = Array.from(table!.querySelectorAll('tbody tr'));
    const rows = bodyRows.map(tableRow => Array.from(tableRow.querySelectorAll('td')).map(cell => cell.textContent));
    const [feb, jan] = rows;
    expect(jan[3]).toBe('500.00');
    expect(jan[4]).toBe('มีเครดิต');
    expect(jan[5]).toBe('เครดิต 200.00');
    expect(feb[1]).toBe('เครดิต 200.00');
    expect(feb[3]).toBe('—');
    expect(feb[4]).toBe('ยังไม่ชำระ');
    expect(feb[5]).toBe('800.00');
    expect(table!.textContent).not.toMatch(/-200/);
    expect(bodyRows[0]).toHaveAttribute('aria-current', 'true');
    expect(bodyRows[1]).not.toHaveAttribute('aria-current');
  });

  it('AC-CB-69 + C-10 (mobile stack): the history toggle (targeted by name) expands credit wording, status and cashback detail', async () => {
    const { container } = await renderWith([{ month: JAN, newSpend: 300, cashbackAmount: 500, paymentAction: 'full' }], { isMobileView: true });
    // several aria-expanded:false disclosures exist now, so target the history one by its name
    const historyToggle = screen.getByRole('button', { name: /ประวัติยอดหมุนเวียน/ });
    expect(historyToggle).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(historyToggle);
    expect(screen.getByRole('button', { name: 'ซ่อนประวัติยอดหมุนเวียน' })).toHaveAttribute('aria-expanded', 'true');
    const text = container.textContent || '';
    expect(text).toContain('มีเครดิต');
    expect(text).toContain('ยกมา 0.00 · ใช้จ่าย 300.00 · แคชแบค 500.00');
    expect(text).toContain('ยกไป เครดิต 200.00');
    expect(screen.getAllByText('เครดิต 200.00').length).toBeGreaterThan(0);
    expect(text).not.toMatch(/-200\.00/);
    expect(text).not.toMatch(/เต็ม 0\.00/);
  });
});
