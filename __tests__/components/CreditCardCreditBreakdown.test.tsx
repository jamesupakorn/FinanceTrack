import { fireEvent, render, screen, within } from '@testing-library/react';
import CreditCardCreditBreakdown, { rankCardsByAvailableCredit } from '../../src/frontend/components/CreditCardCreditBreakdown';

type C = { id: string; name: string; last4?: string; creditLimit?: number | string; availableCredit: number | string };
const card = (id: string, name: string, availableCredit: number | string, creditLimit?: number | string, last4?: string): C =>
  ({ id, name, availableCredit, creditLimit, last4 });

describe('rankCardsByAvailableCredit', () => {
  it('orders limited cards by available ascending, then unlimited last', () => {
    const ranked = rankCardsByAvailableCredit([
      card('a', 'ก', 0, undefined),
      card('b', 'ข', 900, 1000),
      card('c', 'ค', 100, 1000),
      card('d', 'ง', 5, ''),
      card('e', 'จ', 7, 'abc')
    ]);
    expect(ranked.map(c => c.id)).toEqual(['c', 'b', 'a', 'd', 'e']);
  });

  it('parses strings numerically and treats non-finite available as 0', () => {
    const ranked = rankCardsByAvailableCredit([
      card('a', 'ก', '1200.5', '30000'),
      card('b', 'ข', 'NaNx', '1000'),
      card('c', 'ค', '99', '1000')
    ]);
    expect(ranked.map(c => c.id)).toEqual(['b', 'c', 'a']);
  });

  it('breaks ties by Thai name then id, and does not mutate input', () => {
    const input = [card('2', 'ข', 10, 100), card('1', 'ข', 10, 100), card('0', 'ก', 10, 100)];
    const copy = [...input];
    expect(rankCardsByAvailableCredit(input).map(c => c.id)).toEqual(['0', '1', '2']);
    expect(input).toEqual(copy);
  });
});

describe('CreditCardCreditBreakdown', () => {
  const cards = [
    card('a', 'บัตรเอ', '1200.5', '30000', '4321'),
    card('b', 'บัตรบี', 0, 0)
  ];
  const setup = () => {
    const onClose = jest.fn();
    const onOpenCard = jest.fn();
    render(<CreditCardCreditBreakdown id="cc-credit-breakdown" cards={cards} totalAvailable={777} totalLimit={999} onOpenCard={onOpenCard} onClose={onClose} />);
    return { onClose, onOpenCard };
  };

  it('shows headline from props, not from rows', () => {
    setup();
    expect(screen.getByText('777.00 / 999.00 บาท · 2 บัตร')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'วงเงินคงเหลือแยกตามบัตร' })).toBeInTheDocument();
  });

  it('renders amounts, no-limit text and aria-labels', () => {
    setup();
    const list = screen.getByRole('list', { name: 'บัตรเรียงตามวงเงินคงเหลือจากน้อยไปมาก' });
    expect(within(list).getByRole('button', { name: 'ดูรายละเอียดบัตร บัตรเอ ····4321 วงเงินคงเหลือ 1,200.50 จาก 30,000.00 บาท' })).toHaveTextContent('1,200.50 / 30,000.00 บาท');
    expect(within(list).getByRole('button', { name: 'ดูรายละเอียดบัตร บัตรบี ไม่ได้ระบุวงเงิน' })).toHaveTextContent('ไม่ได้ระบุวงเงิน');
  });

  it('calls onOpenCard, onClose on hide and on Escape', () => {
    const { onClose, onOpenCard } = setup();
    fireEvent.click(screen.getByRole('button', { name: /บัตรเอ/ }));
    expect(onOpenCard).toHaveBeenCalledWith('a');
    fireEvent.click(screen.getByRole('button', { name: 'ซ่อนรายละเอียด' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(screen.getByRole('button', { name: /บัตรเอ/ }), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
