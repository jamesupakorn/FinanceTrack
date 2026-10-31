import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CreditCardTile, { type TileCard } from '../../src/frontend/components/CreditCardTile';

const card: TileCard = {
  id: 'cc_1', name: 'Shopee', color: '#138f2d', last4: '1234', creditLimit: 10000,
  remainingPrincipal: 2500, remainingPayable: 7000, availableCredit: 7500,
  statementDay: 25, dueDay: 10, ongoingPlanCount: 2, totalDueThisMonth: 100
};
const tile = () => screen.getByTestId('cc-tile-cc_1');
const front = (c: HTMLElement) => c.querySelector('[data-face="front"]') as HTMLElement;
const back = (c: HTMLElement) => c.querySelector('[data-face="back"]') as HTMLElement;

describe('CreditCardTile tap-to-flip', () => {
  test('front has no flip button; tap flips to back; back-face tap flips once; no back button', async () => {
    const user = userEvent.setup();
    const { container } = render(<CreditCardTile card={card} />);
    expect(screen.queryByRole('button', { name: /แสดงด้านหลังบัตร/ })).toBeNull();
    await user.click(screen.getByTestId('cc-tile-amount'));
    expect(tile()).toHaveAttribute('data-side', 'back');
    expect(screen.queryByRole('button', { name: /กลับด้านหน้าบัตร/ })).toBeNull();
    await user.click(screen.getByText('หนี้คงเหลือรวม'));
    expect(tile()).toHaveAttribute('data-side', 'front');
    await user.click(screen.getByTestId('cc-tile-amount'));
    expect(tile()).toHaveAttribute('data-side', 'back');
    expect(back(container)).not.toHaveAttribute('inert');
  });

  test('back text flips to front; details button and menu items do not flip', async () => {
    const user = userEvent.setup();
    const onOpenCard = jest.fn();
    const onAdd = jest.fn();
    render(<CreditCardTile card={card} onOpenCard={onOpenCard} onAddPlanForCard={onAdd} />);
    await user.click(screen.getByTestId('cc-tile-amount'));
    await user.click(screen.getByRole('button', { name: 'ดูรายละเอียด' }));
    expect(onOpenCard).toHaveBeenCalledTimes(1);
    expect(tile()).toHaveAttribute('data-side', 'back');
    const trigger = screen.getByRole('button', { name: 'ตัวเลือกของบัตร Shopee' });
    await user.click(trigger);
    await user.click(screen.getByRole('menuitem', { name: /เพิ่มรายจ่าย/ }));
    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(tile()).toHaveAttribute('data-side', 'back');
    expect(trigger).toHaveFocus();
    await user.click(screen.getByText('หนี้คงเหลือรวม'));
    expect(tile()).toHaveAttribute('data-side', 'front');
  });

  test('first tap with menu open closes the menu without flipping; next tap flips', async () => {
    const user = userEvent.setup();
    render(<CreditCardTile card={card} />);
    await user.click(screen.getByTestId('cc-tile-amount'));
    await user.click(screen.getByRole('button', { name: 'ตัวเลือกของบัตร Shopee' }));
    expect(screen.getByRole('menu')).toBeInTheDocument();
    await user.click(screen.getByText('หนี้คงเหลือรวม'));
    expect(screen.queryByRole('menu')).toBeNull();
    expect(tile()).toHaveAttribute('data-side', 'back');
    await user.click(screen.getByText('หนี้คงเหลือรวม'));
    expect(tile()).toHaveAttribute('data-side', 'front');
  });

  test('drag, right-click, modifier and selection do not flip', () => {
    const { container } = render(<CreditCardTile card={card} />);
    const amount = screen.getByTestId('cc-tile-amount');
    fireEvent.mouseDown(amount, { clientX: 0, clientY: 0 });
    fireEvent.click(amount, { clientX: 40, clientY: 0 });
    expect(tile()).toHaveAttribute('data-side', 'front');
    fireEvent.click(amount, { button: 2 });
    fireEvent.click(amount, { ctrlKey: true });
    expect(tile()).toHaveAttribute('data-side', 'front');
    const range = document.createRange();
    range.selectNodeContents(amount);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
    fireEvent.click(amount);
    expect(tile()).toHaveAttribute('data-side', 'front');
    sel.removeAllRanges();
    fireEvent.click(amount);
    expect(tile()).toHaveAttribute('data-side', 'back');
    expect(front(container)).toHaveAttribute('inert');
  });

  test('faces have no role/tabIndex; hidden face ignores clicks', () => {
    const { container } = render(<CreditCardTile card={card} />);
    [front(container), back(container)].forEach(el => {
      expect(el).not.toHaveAttribute('role');
      expect(el).not.toHaveAttribute('tabindex');
    });
    fireEvent.click(back(container));
    expect(tile()).toHaveAttribute('data-side', 'front');
  });
});

describe('AC-FL7 after flip', () => {
  test('hidden face is inert + aria-hidden, shown face is not', async () => {
    const user = userEvent.setup();
    const { container } = render(<CreditCardTile card={card} />);
    await user.click(screen.getByTestId('cc-tile-amount'));
    expect(front(container)).toHaveAttribute('inert');
    expect(front(container)).toHaveAttribute('aria-hidden', 'true');
    expect(back(container)).not.toHaveAttribute('inert');
    expect(back(container)).not.toHaveAttribute('aria-hidden');
  });
});
