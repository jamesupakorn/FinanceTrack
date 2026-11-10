// Loan slice S4 / D5 — LoanRateHistory (UX_SPEC loan-installments §6): empty line and populated history.
import { describe, expect, it } from '@jest/globals';
import { render, screen, within } from '@testing-library/react';
import LoanRateHistory, { type LoanRateRevisionRecord } from '../../src/frontend/components/LoanRateHistory';

// Midday UTC so the local calendar day is the same in any test-runner timezone between UTC-11 and UTC+11.
const REVISIONS: LoanRateRevisionRecord[] = [
  {
    id: 'rr_first',
    effectiveMonth: '2027-01',
    fromInstallmentNo: 13,
    previousRate: 6,
    newRate: 7,
    revisedAt: '2026-11-03T12:00:00.000Z'
  },
  {
    id: 'rr_second',
    effectiveMonth: '2027-07',
    fromInstallmentNo: 19,
    previousRate: 7,
    newRate: 6.5,
    revisedAt: '2027-06-15T12:00:00.000Z'
  }
];

describe('LoanRateHistory', () => {
  it('shows the empty line with the contract rate when there are no revisions', () => {
    render(<LoanRateHistory revisions={[]} currentRate={6} />);
    expect(screen.getByText('ยังไม่เคยปรับ · อัตราตามสัญญา 6.00%')).toBeTruthy();
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('treats a missing revisions array as empty', () => {
    render(<LoanRateHistory revisions={undefined} currentRate={5.25} />);
    expect(screen.getByText('ยังไม่เคยปรับ · อัตราตามสัญญา 5.25%')).toBeTruthy();
  });

  it('renders one row per revision in stored (chronological) order with month, installment, rates and recorded date', () => {
    render(<LoanRateHistory revisions={REVISIONS} currentRate={6.5} />);

    const items = within(screen.getByRole('list', { name: 'ประวัติอัตราดอกเบี้ย' })).getAllByRole('listitem');
    expect(items).toHaveLength(2);

    expect(items[0].textContent).toBe('มีผล ม.ค. 2570 (งวด 13): 6.00% → 7.00%บันทึกเมื่อ 3 พ.ย. 2569');
    expect(items[1].textContent).toBe('มีผล ก.ค. 2570 (งวด 19): 7.00% → 6.50%บันทึกเมื่อ 15 มิ.ย. 2570');

    expect(screen.queryByText(/ยังไม่เคยปรับ/)).toBeNull();
  });
});
