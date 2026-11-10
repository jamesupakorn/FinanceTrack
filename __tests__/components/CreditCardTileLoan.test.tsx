// Loan slice S3 — loan tile variant: type chip (AC-LN-31), empty-schedule state with the CTA on the BACK
// (P1-1, AC-LN-S3-04) and the muted FRONT filler (P1-2, AC-LN-S3-05), wrap-not-truncate row (P3-1,
// AC-LN-S3-08), the "งวดที่ k จาก N" sub-line, and the loan ⚙ menu (แก้ไข/ลบสินเชื่อ only).
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CreditCardTile, { type TileCard } from '../../src/frontend/components/CreditCardTile';
import CreditCardTileGrid from '../../src/frontend/components/CreditCardTileGrid';
import { CardMenu } from '../../src/frontend/components/CreditCardDashboard';
import { getCurrentMonthKey } from '../../src/shared/utils/creditCardUtils';

const loan: TileCard = {
  id: 'cc_loan_1', name: 'บ้านลาดพร้าว', color: '#138f2d', bankIssuer: 'kbank', bankName: 'กสิกรไทย', last4: '1234',
  creditLimit: 0, remainingPrincipal: 950000, remainingPayable: 1500000, availableCredit: 0,
  statementDay: 'EOM', dueDay: 5, nextDueDate: null, ongoingPlanCount: 0, cardType: 'home_loan',
  totalDueThisMonth: 0, installmentDueThisMonth: 0, revolvingDueThisMonth: 0, installmentCount: 0, installmentPaidCount: 0
};
const ongoingLoan: TileCard = {
  ...loan, ongoingPlanCount: 1, totalDueThisMonth: 7164.31, installmentDueThisMonth: 7164.31, installmentCount: 1
};
const creditCard: TileCard = {
  id: 'cc_card_1', name: 'KTC', color: '#5d5bff', creditLimit: 10000, remainingPrincipal: 2000,
  remainingPayable: 2000, availableCredit: 8000, statementDay: 25, dueDay: 10, ongoingPlanCount: 0, totalDueThisMonth: 0
};

const face = (container: HTMLElement, side: 'front' | 'back') =>
  container.querySelector(`[data-face="${side}"]`) as HTMLElement;

describe('empty-schedule loan tile', () => {
  test('FRONT: chip + ยังไม่มีตารางผ่อน + muted calendar filler, no button, no credit-only parts', () => {
    const { container } = render(<CreditCardTile card={loan} loanProgress={{ hasPlan: false, currentNo: null, months: 0 }} />);
    const front = face(container, 'front');
    expect(within(front).getByTestId('cc-tile-type-chip')).toHaveTextContent('สินเชื่อบ้าน');
    expect(within(front).getByTestId('cc-tile-loan-empty')).toHaveTextContent('ยังไม่มีตารางผ่อน');
    const filler = within(front).getByTestId('cc-tile-loan-empty-filler');
    const icon = filler.querySelector('[aria-hidden="true"]') as HTMLElement;
    expect(icon.className).toContain('opacity-30');
    expect(icon.querySelector('svg')).not.toBeNull();
    expect(within(front).queryAllByRole('button')).toHaveLength(0);
    expect(within(front).queryByTestId('cc-tile-amount')).toBeNull();
    expect(front.textContent).not.toMatch(/วงเงิน|สรุปยอด|เพิ่มรายจ่าย/);
  });

  test('BACK: "+ เพิ่มตารางผ่อน" stacked above "ดูรายละเอียด"; it calls onAddPlanForCard', () => {
    const onAddPlanForCard = jest.fn();
    const { container } = render(
      <CreditCardTile card={loan} loanProgress={{ hasPlan: false, currentNo: null, months: 0 }} onAddPlanForCard={onAddPlanForCard} />
    );
    const back = face(container, 'back');
    const add = within(back).getByRole('button', { name: '+ เพิ่มตารางผ่อน', hidden: true });
    const details = within(back).getByRole('button', { name: 'ดูรายละเอียด', hidden: true });
    expect(add.compareDocumentPosition(details) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(add.parentElement).toBe(details.parentElement);
    expect(add.parentElement?.className).toContain('flex-col');
    expect(back.textContent).toContain('เงินต้นคงเหลือ');
    expect(back.textContent).toContain('ครบกำหนดทุกวันที่ 5');
    expect(back.textContent).not.toMatch(/วงเงิน|สรุปยอด/);
    fireEvent.click(add);
    expect(onAddPlanForCard).toHaveBeenCalledWith(loan);
  });

  test('without loanProgress the tile falls back to ongoingPlanCount/installmentCount for the empty gate', () => {
    const { container } = render(<CreditCardTile card={loan} />);
    expect(within(face(container, 'front')).getByTestId('cc-tile-loan-empty')).toBeInTheDocument();
  });
});

describe('loan tile with a plan', () => {
  test('FRONT: amount, งวดที่ k จาก N, no ผ่อน/ไม่ผ่อน sub-line, no filler; BACK has only ดูรายละเอียด', () => {
    const { container } = render(<CreditCardTile card={ongoingLoan} loanProgress={{ hasPlan: true, currentNo: 13, months: 240 }} />);
    const front = face(container, 'front');
    expect(within(front).getByText('ค่างวดเดือนนี้')).toBeInTheDocument();
    expect(within(front).getByTestId('cc-tile-amount')).toHaveTextContent('7,164.31');
    expect(within(front).getByTestId('cc-tile-loan-subline')).toHaveTextContent('งวดที่ 13 จาก 240');
    expect(within(front).queryByTestId('cc-tile-subline')).toBeNull();
    expect(within(front).queryByTestId('cc-tile-loan-empty-filler')).toBeNull();
    const back = face(container, 'back');
    expect(within(back).queryByRole('button', { name: '+ เพิ่มตารางผ่อน', hidden: true })).toBeNull();
    expect(within(back).getByRole('button', { name: 'ดูรายละเอียด', hidden: true })).toBeInTheDocument();
  });

  test('a loan whose plan is completed is not "empty" (one plan ever, BR-CC-034) and has no due this month', () => {
    const { container } = render(<CreditCardTile card={loan} loanProgress={{ hasPlan: true, currentNo: null, months: 12 }} />);
    const front = face(container, 'front');
    expect(within(front).queryByTestId('cc-tile-loan-empty')).toBeNull();
    expect(within(front).getByTestId('cc-tile-loan-subline')).toHaveTextContent('ไม่มีค่างวดเดือนนี้');
  });

  test('personal loan chip label', () => {
    const { container } = render(<CreditCardTile card={{ ...ongoingLoan, cardType: 'personal_loan' }} />);
    expect(within(face(container, 'front')).getByTestId('cc-tile-type-chip')).toHaveTextContent('สินเชื่อส่วนบุคคล');
  });
});

test('credit-card tile: no type chip, no filler, no loan sub-line (unchanged)', () => {
  const { container } = render(<CreditCardTile card={creditCard} />);
  const front = face(container, 'front');
  expect(within(front).queryByTestId('cc-tile-type-chip')).toBeNull();
  expect(within(front).queryByTestId('cc-tile-loan-empty-filler')).toBeNull();
  expect(within(front).queryByTestId('cc-tile-loan-subline')).toBeNull();
  expect(within(front).getByText('ยอดที่ต้องจ่ายรอบนี้')).toBeInTheDocument();
});

test('P3-1: the name/chip row wraps; neither the chip nor the name truncates', () => {
  const longName = 'สินเชื่อบ้านหลังที่สองของครอบครัวย่านลาดพร้าวซอยยาวมาก';
  const { container } = render(<CreditCardTile card={{ ...ongoingLoan, name: longName }} />);
  const chip = within(face(container, 'front')).getByTestId('cc-tile-type-chip');
  const row = chip.parentElement as HTMLElement;
  expect(row.className).toContain('flex-wrap');
  expect(chip.className).not.toMatch(/truncate|whitespace-nowrap/);
  const name = within(row).getByText(longName);
  expect(name.className).not.toMatch(/truncate|whitespace-nowrap/);
});

test('grid derives loan progress from plans: current-month row number and the any-status plan gate', () => {
  const month = getCurrentMonthKey();
  const plans = [{ id: 'ip_1', cardId: 'cc_loan_1', status: 'ongoing', months: 240, schedule: [{ no: 13, dueMonth: month, paid: false }] }];
  render(<CreditCardTileGrid cards={[{ ...ongoingLoan, dueMonth: month }, { ...loan, id: 'cc_loan_2' }]} plans={plans} />);
  expect(screen.getByTestId('cc-tile-cc_loan_1')).toHaveTextContent('งวดที่ 13 จาก 240');
  expect(within(screen.getByTestId('cc-tile-cc_loan_2')).getByTestId('cc-tile-loan-empty')).toBeInTheDocument();
});

describe('⚙ CardMenu', () => {
  test('loan: แก้ไขสินเชื่อ / ลบสินเชื่อ only, no เพิ่มรายจ่าย', async () => {
    const user = userEvent.setup();
    render(<CardMenu card={loan} onEdit={jest.fn()} onAddPlan={jest.fn()} onDelete={jest.fn()} />);
    await user.click(screen.getByRole('button', { name: /ตัวเลือกของบัตร/ }));
    const items = screen.getAllByRole('menuitem').map(item => item.textContent?.trim());
    expect(items).toEqual(['แก้ไขสินเชื่อ', 'ลบสินเชื่อ']);
  });

  test('credit card: unchanged three items', async () => {
    const user = userEvent.setup();
    render(<CardMenu card={creditCard} onEdit={jest.fn()} onAddPlan={jest.fn()} onDelete={jest.fn()} />);
    await user.click(screen.getByRole('button', { name: /ตัวเลือกของบัตร/ }));
    expect(screen.getAllByRole('menuitem').map(item => item.textContent?.trim())).toEqual(['แก้ไขบัตร', 'เพิ่มรายจ่าย', 'ลบบัตร']);
  });
});
