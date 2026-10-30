import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'fs';
import path from 'path';
import CreditCardTile, { type TileCard } from '../../src/frontend/components/CreditCardTile';
import { getTabbableElements } from '../../src/shared/utils/frontend/focusTrap';
import { contrastRatio, getLocalTodayIso, pickTileTextColor } from '../../src/shared/utils/frontend/creditCardTileUtils';
import { BANK_ISSUERS } from '../../src/shared/utils/creditCardBankCatalog';

function isoInDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return getLocalTodayIso(d);
}

const baseCard: TileCard = {
  id: 'cc_1',
  name: 'Shopee',
  color: '#138f2d',
  bankIssuer: 'kbank',
  bankName: 'กสิกร',
  last4: '1234',
  creditLimit: 10000,
  remainingPrincipal: 2500,
  remainingPayable: 7000,
  availableCredit: 7500,
  statementDay: 25,
  dueDay: 10,
  nextDueDate: isoInDays(3),
  ongoingPlanCount: 2,
  totalDueThisMonth: 5929.33,
  installmentDueThisMonth: 4534,
  revolvingDueThisMonth: 1395.33
};

const face = (container: HTMLElement, side: 'front' | 'back') =>
  container.querySelector(`[data-face="${side}"]`) as HTMLElement;

describe('CreditCardTile', () => {
  test('front shows amount, ผ่อน/ไม่ผ่อน sub-line and due chip; back hidden + inert', () => {
    const { container } = render(<CreditCardTile card={baseCard} />);
    const front = face(container, 'front');
    expect(within(front).getByText('ยอดที่ต้องจ่ายรอบนี้')).toBeInTheDocument();
    expect(within(front).getByTestId('cc-tile-amount')).toHaveTextContent('5,929.33');
    expect(within(front).getByTestId('cc-tile-subline')).toHaveTextContent('ผ่อน 4,534.00 · ไม่ผ่อน 1,395.33');
    expect(within(front).getByTestId('cc-tile-due-chip')).toHaveTextContent('ครบกำหนดใน 3 วัน');
    expect(within(front).getByText(/····1234/)).toBeInTheDocument();
    const back = face(container, 'back');
    expect(back).toHaveAttribute('inert');
    expect(back).toHaveAttribute('aria-hidden', 'true');
    expect(getTabbableElements(back)).toHaveLength(0);
    expect(front).not.toHaveAttribute('inert');
    expect(front).not.toHaveAttribute('aria-hidden');
  });

  test('overdue chip keeps existing semantics', () => {
    const { container } = render(<CreditCardTile card={{ ...baseCard, nextDueDate: isoInDays(-5) }} />);
    expect(within(face(container, 'front')).getByTestId('cc-tile-due-chip')).toHaveTextContent('เลยกำหนด 5 วัน');
  });

  test('sub-line omits zero parts and disappears when both are 0', () => {
    const { rerender } = render(<CreditCardTile card={{ ...baseCard, revolvingDueThisMonth: 0 }} />);
    expect(screen.getByTestId('cc-tile-subline')).toHaveTextContent(/^ผ่อน 4,534\.00$/);
    rerender(<CreditCardTile card={{ ...baseCard, installmentDueThisMonth: 0 }} />);
    expect(screen.getByTestId('cc-tile-subline')).toHaveTextContent(/^ไม่ผ่อน 1,395\.33$/);
    rerender(<CreditCardTile card={{ ...baseCard, installmentDueThisMonth: 0, revolvingDueThisMonth: 0, totalDueThisMonth: undefined }} />);
    expect(screen.queryByTestId('cc-tile-subline')).toBeNull();
    expect(screen.getByTestId('cc-tile-amount')).toHaveTextContent('0.00');
  });

  test('no flip buttons on either face; tap flips, focus moves to the menu trigger, Escape returns', async () => {
    const user = userEvent.setup();
    const { container } = render(<CreditCardTile card={baseCard} />);
    const back = face(container, 'back');
    const front = face(container, 'front');
    expect(within(front).queryByRole('button')).toBeNull();
    expect(screen.queryByRole('button', { name: /แสดงด้านหลังบัตร/ })).toBeNull();
    await user.click(screen.getByTestId('cc-tile-amount'));

    expect(within(back).queryByRole('button', { name: /กลับด้านหน้าบัตร/ })).toBeNull();
    expect(back.querySelector('[aria-pressed]')).toBeNull();
    expect(document.activeElement).toBe(within(back).getByRole('button', { name: 'ตัวเลือกของบัตร Shopee' }));
    expect(back).not.toHaveAttribute('inert');
    expect(front).toHaveAttribute('inert');
    expect(front).toHaveAttribute('aria-hidden', 'true');
    expect(getTabbableElements(front)).toHaveLength(0);
    expect(front.contains(document.activeElement)).toBe(false);

    await user.keyboard('{Escape}');
    expect(container.querySelector('[data-side]')).toHaveAttribute('data-side', 'front');
    expect(back).toHaveAttribute('inert');
    expect(back.contains(document.activeElement)).toBe(false);
  });

  test('focus moves to the new face before the old face is hidden', async () => {
    const user = userEvent.setup();
    const { container } = render(<CreditCardTile card={baseCard} />);
    const front = face(container, 'front');
    const states: Array<string | null> = [];
    const back = face(container, 'back');
    back.addEventListener('focusin', () => states.push(front.getAttribute('aria-hidden')));
    await user.click(screen.getByTestId('cc-tile-amount'));
    expect(states[0]).toBeNull();
  });

  test('reduced motion: instant swap classes, no cross-fade', () => {
    const { container } = render(<CreditCardTile card={baseCard} />);
    const rotor = screen.getByTestId('cc-tile-rotor');
    expect(rotor.className).toContain('motion-reduce:transition-none');
    expect(face(container, 'back').className).toContain('motion-reduce:invisible');
    expect(container.innerHTML).not.toMatch(/transition-opacity/);
  });

  test('back side content; overdue installments only when K > 0; menu callbacks', async () => {
    const user = userEvent.setup();
    const onEdit = jest.fn();
    const onOpen = jest.fn();
    const { container, rerender } = render(
      <CreditCardTile card={baseCard} overdueInstallmentCount={0} onEditCard={onEdit} onOpenCard={onOpen} />
    );
    const back = face(container, 'back');
    expect(within(back).getByText('หนี้คงเหลือรวม')).toBeInTheDocument();
    expect(back).toHaveTextContent('7,000.00');
    expect(back).toHaveTextContent('วงเงิน 10,000.00 · ใช้ไป 25.0% · เหลือ 7,500.00');
    expect(back).toHaveTextContent('สรุปยอด');
    expect(back).toHaveTextContent('2 แผนกำลังผ่อน');
    expect(within(back).queryByTestId('cc-tile-overdue-installments')).toBeNull();
    expect(back).not.toHaveTextContent('งวด');

    rerender(<CreditCardTile card={baseCard} overdueInstallmentCount={3} onEditCard={onEdit} onOpenCard={onOpen} />);
    expect(within(back).getByTestId('cc-tile-overdue-installments')).toHaveTextContent('เลยกำหนด 3 งวด');

    await user.click(screen.getByTestId('cc-tile-amount'));
    await user.click(within(back).getByRole('button', { name: 'ดูรายละเอียด' }));
    expect(onOpen).toHaveBeenCalledWith('cc_1');
    await user.click(within(back).getByRole('button', { name: 'ตัวเลือกของบัตร Shopee' }));
    await user.click(screen.getByRole('menuitem', { name: /แก้ไขบัตร/ }));
    expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ id: 'cc_1' }));
  });

  test('Escape while the card menu is open closes the menu only', async () => {
    const user = userEvent.setup();
    const { container } = render(<CreditCardTile card={baseCard} />);
    await user.click(screen.getByTestId('cc-tile-amount'));
    await user.click(screen.getByRole('button', { name: 'ตัวเลือกของบัตร Shopee' }));
    screen.getAllByRole('menuitem')[0].focus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(container.querySelector('[data-side]')).toHaveAttribute('data-side', 'back');
  });

  test('text colour from pickTileTextColor reaches >= 4.5:1, incl. mid-luminance (T19b)', () => {
    const colours = [...Object.values(BANK_ISSUERS).map(i => i.color), '#F5A623', '#ffcc00', '#ff8800', '#111111', '#fafafa'];
    colours.forEach(colour => {
      const { container, unmount } = render(<CreditCardTile card={{ ...baseCard, color: colour }} />);
      const front = face(container, 'front');
      const expected = pickTileTextColor(colour).color;
      expect(front.style.color).toBe(hexToRgb(expected));
      expect(contrastRatio(colour, expected)).toBeGreaterThanOrEqual(4.5);
      unmount();
    });
  });

  test('44px targets and no lg:/sm: prefixes', () => {
    render(<CreditCardTile card={baseCard} />);
    expect(screen.queryByRole('button', { name: /กลับด้านหน้าบัตร|แสดงด้านหลังบัตร/, hidden: true })).toBeNull();
    ['CreditCardTile.tsx', 'CreditCardFilterBar.tsx', 'CreditCardTileGrid.tsx'].forEach(file => {
      const src = readFileSync(path.join(__dirname, '../../src/frontend/components', file), 'utf8');
      expect(src).not.toMatch(/\b(lg|sm|xl|2xl):/);
    });
  });
});

function hexToRgb(hex: string): string {
  const v = hex.replace('#', '');
  return `rgb(${parseInt(v.slice(0, 2), 16)}, ${parseInt(v.slice(2, 4), 16)}, ${parseInt(v.slice(4, 6), 16)})`;
}
