import { render, screen, within } from '@testing-library/react';
import CreditCardTile, { type TileCard } from '../../src/frontend/components/CreditCardTile';
import { getLocalTodayIso } from '../../src/shared/utils/frontend/creditCardTileUtils';

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

// The bank line is always the last child rendered on the front face (after the
// loanEmpty/not-loanEmpty branch), regardless of which branch renders.
function getBankLine(front: HTMLElement): HTMLElement {
  return front.lastElementChild as HTMLElement;
}

describe('CreditCardTile bank line bottom anchor (I1, AC-TDC-01..03)', () => {
  test('AC-TDC-01: loan tile with creditLimit 0 and a non-empty schedule anchors the bank line with mt-auto', () => {
    const { container } = render(
      <CreditCardTile
        card={{
          ...baseCard,
          cardType: 'personal_loan',
          creditLimit: 0,
          installmentCount: 3,
          installmentPaidCount: 1,
          ongoingPlanCount: 1
        }}
      />
    );
    const front = face(container, 'front');
    const bankLine = getBankLine(front);
    expect(bankLine.className.split(' ')).toContain('mt-auto');
  });

  test('AC-TDC-02: credit card with creditLimit > 0 does not anchor the bank line; utilisation wrapper keeps its own mt-auto', () => {
    const { container } = render(<CreditCardTile card={baseCard} />);
    const front = face(container, 'front');
    const bankLine = getBankLine(front);
    expect(bankLine.className.split(' ')).not.toContain('mt-auto');

    const utilisationBar = within(front).getByRole('img', { name: /^ใช้วงเงินไป/ });
    const utilisationWrapper = utilisationBar.parentElement as HTMLElement;
    expect(utilisationWrapper.className.split(' ')).toContain('mt-auto');
  });

  test('AC-TDC-03: loanEmpty tile does not anchor the bank line; the loan-empty filler keeps mt-auto and flex-1', () => {
    const { container } = render(
      <CreditCardTile
        card={{
          ...baseCard,
          cardType: 'home_loan',
          creditLimit: 0,
          installmentCount: 0,
          ongoingPlanCount: 0
        }}
      />
    );
    const front = face(container, 'front');
    const bankLine = getBankLine(front);
    expect(bankLine.className.split(' ')).not.toContain('mt-auto');

    const filler = screen.getByTestId('cc-tile-loan-empty-filler');
    expect(filler.className.split(' ')).toContain('mt-auto');
    expect(filler.className.split(' ')).toContain('flex-1');
  });
});
