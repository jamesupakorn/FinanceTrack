import { fireEvent, render, screen, within } from '@testing-library/react';
import CreditCardDebtBreakdown, { rankCardsByRemainingDebt } from '../../src/frontend/components/CreditCardDebtBreakdown';

const card = (id: string, name: string, remainingPayable: number | string, last4?: string) => ({ id, name, remainingPayable, last4 });

describe('rankCardsByRemainingDebt', () => {
  it('sorts by debt desc, then Thai name, then id', () => {
    const { withDebt } = rankCardsByRemainingDebt([
      card('3', 'ข', 100), card('2', 'ก', 100), card('1', 'ก', 100), card('4', 'ค', 500)
    ]);
    expect(withDebt.map(c => c.id)).toEqual(['4', '1', '2', '3']);
  });

  it('parses strings and treats invalid/empty/zero as zero-debt', () => {
    const { withDebt, zeroCount } = rankCardsByRemainingDebt([
      card('a', 'A', '1200.5'), card('b', 'B', ''), card('c', 'C', 'abc'), card('d', 'D', 0), card('e', 'E', 50)
    ]);
    expect(withDebt.map(c => c.id)).toEqual(['a', 'e']);
    expect(zeroCount).toBe(3);
  });
});

describe('CreditCardDebtBreakdown', () => {
  it('renders rows, labels, header and zero footer', () => {
    render(<CreditCardDebtBreakdown id="p" cards={[card('a', 'บัตรเอ', '1200.5', '1234'), card('b', 'บัตรบี', 0)]} total={1200.5} onClose={jest.fn()} />);
    const panel = screen.getByRole('region', { name: 'หนี้คงเหลือแยกตามบัตร' });
    expect(within(panel).getByText('รวม 1,200.50 บาท · 1 บัตร')).toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: 'ดูรายละเอียดบัตร บัตรเอ ····1234 หนี้คงเหลือ 1,200.50 บาท' })).toBeInTheDocument();
    expect(within(panel).getByText('บัตรที่ไม่มีหนี้คงเหลือ 1 ใบ')).toBeInTheDocument();
  });

  it('stacks the amount under a long name below md and goes side by side from md', () => {
    const longName = 'บัตรเครดิต'.repeat(10);
    render(<CreditCardDebtBreakdown id="p" cards={[card('a', longName, '1234567.89')]} total={1234567.89} onClose={jest.fn()} />);
    const row = screen.getByRole('button', { name: new RegExp(`ดูรายละเอียดบัตร ${longName}`) });
    expect(row.className).toContain('flex-col');
    expect(row.className).toContain('md:flex-row');
    expect(row.className).not.toMatch(/(^|\s)(sm|lg|xl|2xl):/);
    const amount = within(row).getByText('1,234,567.89 บาท');
    expect(amount.className).toContain('whitespace-nowrap');
    expect(amount.parentElement?.className).toContain('w-full');
    expect(within(row).getByText(longName).className).toContain('break-words');
  });

  it('shows the empty state without list or footer when all zero', () => {
    render(<CreditCardDebtBreakdown id="p" cards={[card('a', 'A', 0), card('b', 'B', 'x')]} total={0} onClose={jest.fn()} />);
    expect(screen.getByText('ไม่มีหนี้คงเหลือในบัตรใด')).toBeInTheDocument();
    expect(screen.getByText('รวม 0.00 บาท · 0 บัตร')).toBeInTheDocument();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
    expect(screen.queryByText(/บัตรที่ไม่มีหนี้คงเหลือ/)).not.toBeInTheDocument();
  });

  it('calls onOpenCard with the row id and onClose on Escape and hide button', () => {
    const onOpenCard = jest.fn();
    const onClose = jest.fn();
    render(<CreditCardDebtBreakdown id="p" cards={[card('a', 'บัตรเอ', 10)]} total={10} onOpenCard={onOpenCard} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: /ดูรายละเอียดบัตร บัตรเอ/ }));
    expect(onOpenCard).toHaveBeenCalledWith('a');
    fireEvent.keyDown(screen.getByRole('button', { name: /ดูรายละเอียดบัตร/ }), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'ซ่อนรายละเอียด' }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('renders all 20 cards without truncation', () => {
    const many = Array.from({ length: 20 }, (_, i) => card(`c${i}`, `บัตร${i}`, 100 + i));
    render(<CreditCardDebtBreakdown id="p" cards={many} total={1} onClose={jest.fn()} />);
    expect(screen.getAllByRole('listitem')).toHaveLength(20);
  });
});
