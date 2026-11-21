/**
 * SavingsLoanBadge (UX_SPEC-savings-loan-withdrawal.md §9) — new component, S6.
 */
import { render, screen } from '@testing-library/react';
import SavingsLoanBadge from '../../src/frontend/components/SavingsLoanBadge';

describe('SavingsLoanBadge', () => {
  it('renders nothing when totalOutstanding is 0', () => {
    const { container } = render(<SavingsLoanBadge totalOutstanding={0} openLoanCount={0} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when totalOutstanding is negative (defensive — should never happen server-side)', () => {
    const { container } = render(<SavingsLoanBadge totalOutstanding={-5} openLoanCount={0} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the full-width link card with the exact copy, aria-label, and href when totalOutstanding > 0', () => {
    render(<SavingsLoanBadge totalOutstanding={1200} openLoanCount={2} />);
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', '/workspace/savings#savings-ledger');
    expect(link).toHaveAttribute('aria-label', 'ยืมเงินออมค้างอยู่ 1,200.00 บาท 2 รายการ ดูรายละเอียด');
    expect(screen.getByText(/ยืมเงินออมค้างอยู่/)).toBeTruthy();
    expect(screen.getByText('1,200.00 ฿')).toBeTruthy();
    expect(screen.getByText('2 รายการ · ดูรายละเอียด →')).toBeTruthy();
  });

  it('gives the amount text-warn emphasis (the badge’s one deliberate exception to D-SLW-9)', () => {
    render(<SavingsLoanBadge totalOutstanding={500} openLoanCount={1} />);
    expect(screen.getByText('500.00 ฿').className).toContain('text-warn');
  });
});
