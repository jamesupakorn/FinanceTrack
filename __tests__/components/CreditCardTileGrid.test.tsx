import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderToString } from 'react-dom/server';
import { hydrateRoot } from 'react-dom/client';
import CreditCardTileGrid from '../../src/frontend/components/CreditCardTileGrid';
import CreditCardDashboard from '../../src/frontend/components/CreditCardDashboard';
import type { TileCard } from '../../src/frontend/components/CreditCardTile';
import { ISSUER_FILTER_STORAGE_KEY, getLocalTodayIso } from '../../src/shared/utils/frontend/creditCardTileUtils';

function isoInDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return getLocalTodayIso(d);
}

const card = (id: string, name: string, bankIssuer: string, nextDueDate: string | null): TileCard => ({
  id, name, bankIssuer, color: '#4e2a84', remainingPayable: 0, availableCredit: 0, nextDueDate, ongoingPlanCount: 0
});

const CARDS: TileCard[] = [
  card('a', 'Alpha', 'kbank', isoInDays(10)),
  card('b', 'Bravo', 'scb', isoInDays(-3)),
  card('c', 'Charlie', 'kbank', null),
  card('d', 'Delta', 'ktb', isoInDays(2))
];

const tileOrder = () => screen.getAllByTestId(/^cc-tile-[a-z]$/).map(el => el.getAttribute('data-testid'));

beforeEach(() => {
  window.localStorage.clear();
  jest.restoreAllMocks();
});

describe('CreditCardTileGrid', () => {
  test('sorted by due (overdue first, null last) with the single-breakpoint grid class', () => {
    render(<CreditCardTileGrid cards={CARDS} />);
    expect(tileOrder()).toEqual(['cc-tile-b', 'cc-tile-d', 'cc-tile-a', 'cc-tile-c']);
    const grid = screen.getByTestId('cc-tile-grid');
    expect(grid.className).toBe('grid grid-cols-1 gap-space-4 md:grid-cols-[repeat(auto-fill,minmax(18rem,1fr))]');
    expect(grid.className).not.toMatch(/lg:/);
  });

  test('AC-FL4: with a tile menu open, tapping another tile front closes the menu only and does not flip it', async () => {
    const user = userEvent.setup();
    render(<CreditCardTileGrid cards={CARDS} />);
    const tileA = screen.getByTestId('cc-tile-a');
    const tileB = screen.getByTestId('cc-tile-b');
    await user.click(within(tileA).getByTestId('cc-tile-amount'));
    expect(tileA).toHaveAttribute('data-side', 'back');
    await user.click(within(tileA).getByRole('button', { name: 'ตัวเลือกของบัตร Alpha' }));
    expect(screen.getByRole('menu')).toBeInTheDocument();
    await user.click(within(tileB).getByTestId('cc-tile-amount'));
    expect(screen.queryByRole('menu')).toBeNull();
    expect(tileB).toHaveAttribute('data-side', 'front');
    expect(tileA).toHaveAttribute('data-side', 'back');
    await user.click(within(tileB).getByTestId('cc-tile-amount'));
    expect(tileB).toHaveAttribute('data-side', 'back');
  });

  test('multi-select shows exactly the chosen banks; none selected == all; persists', async () => {
    const user = userEvent.setup();
    render(<CreditCardTileGrid cards={CARDS} />);
    expect(screen.getByRole('button', { name: /ทั้งหมด \(4\)/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /ธนาคารกสิกรไทย \(2\)/ })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /ธนาคารกสิกรไทย/ }));
    await user.click(screen.getByRole('button', { name: /ธนาคารกรุงไทย/ }));
    expect(tileOrder()).toEqual(['cc-tile-d', 'cc-tile-a', 'cc-tile-c']);
    expect(JSON.parse(window.localStorage.getItem(ISSUER_FILTER_STORAGE_KEY) as string)).toEqual(['kbank', 'ktb']);
    expect(screen.getByTestId('cc-filter-live')).toHaveTextContent('แสดง 3 จาก 4 บัตร');
    await user.click(screen.getByRole('button', { name: /ธนาคารกสิกรไทย/ }));
    await user.click(screen.getByRole('button', { name: /ธนาคารกรุงไทย/ }));
    expect(tileOrder()).toHaveLength(4);
    expect(screen.getByRole('button', { name: /ทั้งหมด/ })).toHaveAttribute('aria-pressed', 'true');
  });

  test('restores the saved filter after mount, drops unknown keys, no announcement on first render', () => {
    window.localStorage.setItem(ISSUER_FILTER_STORAGE_KEY, JSON.stringify(['scb', 'nope']));
    render(<CreditCardTileGrid cards={CARDS} />);
    expect(tileOrder()).toEqual(['cc-tile-b']);
    expect(screen.getByRole('button', { name: /ธนาคารไทยพาณิชย์/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('cc-filter-live')).toHaveTextContent('');
  });

  test('T10b: server HTML shows all cards and hydrates without warnings', async () => {
    window.localStorage.setItem(ISSUER_FILTER_STORAGE_KEY, JSON.stringify(['scb']));
    const html = renderToString(<CreditCardTileGrid cards={CARDS} />);
    ['Alpha', 'Bravo', 'Charlie', 'Delta'].forEach(name => expect(html).toContain(name));
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const host = document.createElement('div');
    host.innerHTML = html;
    document.body.appendChild(host);
    let root: ReturnType<typeof hydrateRoot> | undefined;
    await act(async () => {
      root = hydrateRoot(host, <CreditCardTileGrid cards={CARDS} />, { onRecoverableError: e => { throw e; } });
    });
    expect(errorSpy).not.toHaveBeenCalled();
    expect(within(host).getAllByTestId(/^cc-tile-[a-z]$/)).toHaveLength(1);
    act(() => root?.unmount());
    host.remove();
  });

  test('localStorage that throws: renders all cards and filtering still works', async () => {
    const user = userEvent.setup();
    jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    render(<CreditCardTileGrid cards={CARDS} />);
    expect(tileOrder()).toHaveLength(4);
    await user.click(screen.getByRole('button', { name: /ธนาคารไทยพาณิชย์/ }));
    expect(tileOrder()).toEqual(['cc-tile-b']);
  });

  test('empty result shows message and ล้างตัวกรอง restores all cards', async () => {
    const user = userEvent.setup();
    window.localStorage.setItem(ISSUER_FILTER_STORAGE_KEY, JSON.stringify(['uob']));
    render(<CreditCardTileGrid cards={CARDS} />);
    expect(screen.getByText('ไม่มีบัตรของธนาคารที่เลือก')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'ล้างตัวกรอง' }));
    expect(tileOrder()).toHaveLength(4);
    expect(window.localStorage.getItem(ISSUER_FILTER_STORAGE_KEY)).toBe('[]');
  });

  test('flip state survives re-order (keyed by card.id)', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<CreditCardTileGrid cards={CARDS} />);
    await user.click(within(screen.getByTestId('cc-tile-a')).getByTestId('cc-tile-amount'));
    rerender(<CreditCardTileGrid cards={[...CARDS].reverse()} />);
    expect(screen.getByTestId('cc-tile-a')).toHaveAttribute('data-side', 'back');
    expect(screen.getByTestId('cc-tile-b')).toHaveAttribute('data-side', 'front');
  });

  test('passes overdue installment count from plans to the tile', () => {
    const plans = [{ cardId: 'a', status: 'ongoing', schedule: [{ no: 1, paid: false, dueMonth: '2000-01', payment: 1 }] }];
    render(<CreditCardTileGrid cards={[{ ...CARDS[0], dueDay: 10 }]} plans={plans} />);
    expect(screen.getByTestId('cc-tile-overdue-installments')).toHaveTextContent('เลยกำหนด 1 งวด');
  });
});

describe('CreditCardDashboard integration', () => {
  test('bank group headers are gone; tiles render inside บัตรทั้งหมด', () => {
    const { container } = render(<CreditCardDashboard cards={CARDS} plans={[]} />);
    expect(container.querySelector('[id^="cc-issuer-group-"]')).toBeNull();
    expect(screen.getByRole('heading', { name: 'บัตรทั้งหมด' })).toBeInTheDocument();
    expect(screen.getAllByTestId(/^cc-tile-[a-z]$/)).toHaveLength(4);
  });

  test('loading skeleton uses the new grid class', () => {
    const { container } = render(<CreditCardDashboard loading />);
    expect(container.innerHTML).toContain('md:grid-cols-[repeat(auto-fill,minmax(18rem,1fr))]');
    expect(container.innerHTML).not.toContain('lg:grid-cols-3');
  });
});

describe('add-expense labels (AC-AE1)', () => {
  test('Dashboard primary button says เพิ่มรายจ่าย, old label gone', () => {
    const { container } = render(<CreditCardDashboard cards={CARDS} plans={[]} onAddPlan={jest.fn()} onAddPlanForCard={jest.fn()} />);
    expect(screen.getByRole('button', { name: 'เพิ่มรายจ่าย' })).toBeInTheDocument();
    expect(container.textContent).not.toContain('เพิ่มแผนผ่อนในบัตรนี้');
    expect(screen.queryByText(/เพิ่มแผนผ่อนในบัตรนี้/)).toBeNull();
  });
});
