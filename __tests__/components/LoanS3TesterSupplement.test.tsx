// Loan slice S3 — Stage 4 tester supplement. Covers the gaps left by the implementer's own tests:
// D-S3-3 multi-click reveal cap + plan.id reset (incl. a credit-card long plan, since D-S3-3 is generic),
// the P0-1 round trip's failure branch and repeat round trips (no duplicate create), and the rotor
// grid-column fix's class contract (jsdom has no layout, so the class string is what's asserted).
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import CreditCardDetail from '../../src/frontend/components/CreditCardDetail';
import CreditCardTile, { type TileCard } from '../../src/frontend/components/CreditCardTile';
import CreditCardsPage from '../../pages/credits';
import { creditCardAPI, userSettingsAPI } from '../../src/shared/utils/frontend/apiUtils';
import { showToast } from '../../src/shared/utils/frontend/toast';

jest.mock('next/router', () => ({
  useRouter: () => ({ isReady: true, pathname: '/credits', query: {}, push: jest.fn(), replace: jest.fn() })
}));
jest.mock('../../src/frontend/contexts/SessionContext', () => ({
  useSession: () => ({ currentUser: { id: 'u-s3-tester' } })
}));
jest.mock('../../src/frontend/components/Layout', () => ({
  __esModule: true,
  default: ({ children, headerActions }: { children?: ReactNode; headerActions?: ReactNode }) => <div>{headerActions}{children}</div>
}));
jest.mock('../../src/frontend/components/BackdatedInstallmentsDialog', () => ({ BackdatedPaidFailureDialog: () => null }));
jest.mock('../../src/frontend/components/CreditCardForm', () => ({
  __esModule: true,
  default: ({ open, card, onSubmit, onClose }: {
    open: boolean;
    card?: { id: string } | null;
    onSubmit?: (payload: Record<string, unknown>) => void;
    onClose?: () => void;
  }) => (open ? (
    <div data-testid="card-form" data-card-id={card?.id ?? ''}>
      <button type="button" onClick={() => onSubmit?.(card ? { id: card.id, name: 'แก้แล้ว' } : { name: 'บ้าน', cardType: 'home_loan' })}>submit-card</button>
      <button type="button" onClick={onClose}>close-card</button>
    </div>
  ) : null)
}));
jest.mock('../../src/frontend/components/InstallmentPlanForm', () => ({
  __esModule: true,
  default: ({ open, lockedCardId, onEditLockedCard, onClose }: {
    open: boolean;
    lockedCardId?: string | null;
    onEditLockedCard?: () => void;
    onClose?: () => void;
  }) => (open ? (
    <div data-testid="plan-form" data-locked={lockedCardId ?? ''}>
      {onEditLockedCard && <button type="button" onClick={onEditLockedCard}>กลับไปแก้ไขข้อมูลบัตร</button>}
      <button type="button" onClick={onClose}>close-plan</button>
    </div>
  ) : null)
}));
jest.mock('../../src/shared/utils/frontend/toast', () => ({ showToast: jest.fn() }));
jest.mock('../../src/shared/utils/frontend/apiUtils', () => ({
  creditCardAPI: {
    getCards: jest.fn(), getPlans: jest.fn(), saveCard: jest.fn(), deleteCard: jest.fn(),
    listSpendItems: jest.fn(), deleteSpendItem: jest.fn(), getRevolving: jest.fn()
  },
  expenseAPI: { getByMonth: jest.fn().mockResolvedValue({}) },
  userSettingsAPI: { get: jest.fn() }
}));

function setViewport(mobile: boolean) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: mobile ? 390 : 1280 });
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: mobile, media: query, onchange: null,
      addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false
    })
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  setViewport(false);
  jest.mocked(creditCardAPI.listSpendItems).mockReturnValue(new Promise(() => undefined) as never);
  jest.mocked(creditCardAPI.getRevolving).mockReturnValue(new Promise(() => undefined) as never);
  jest.mocked(creditCardAPI.getPlans).mockResolvedValue({ plans: [] } as never);
  jest.mocked(userSettingsAPI.get).mockResolvedValue({ bankAccounts: [] } as never);
});

// --- D-S3-3 -----------------------------------------------------------------------------------

const loanCard = {
  id: 'cc_loan_t', name: 'บ้านทดสอบ', cardType: 'home_loan', creditLimit: 0, remainingPrincipal: 900000,
  remainingPayable: 1000000, availableCredit: 0, statementDay: 'EOM', dueDay: 5
};

function makeSchedule(months: number, paid: number) {
  return Array.from({ length: months }, (_, index) => ({
    no: index + 1,
    dueMonth: `${2026 + Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`,
    payment: 1000, principal: 800, interest: 200, paid: index < paid
  }));
}

function makePlan(id: string, months: number, paid: number, extra: Record<string, unknown> = {}) {
  const schedule = makeSchedule(months, paid);
  return {
    id, cardId: loanCard.id, itemName: `สัญญา ${id}`, status: 'ongoing', installmentsPaid: paid,
    installmentsRemaining: months - paid, months, schedule, nextUnpaid: schedule[paid] ?? null,
    totalPrice: months * 1000, progressPercent: 0, monthlyPayment: 1000, remainingPayable: (months - paid) * 1000,
    interestMode: 'calculated', calcMethod: 'effective', annualRate: 5, createdAt: '2026-01-01', ...extra
  };
}

const rowCount = () => document.querySelectorAll('tbody tr').length;
const moreButton = () => screen.queryByRole('button', { name: 'แสดงเพิ่ม 12 งวด' });

describe('D-S3-3 incremental reveal', () => {
  test('3+ clicks grow by exactly 12 unpaid rows each, cap at the real row count, then both buttons vanish', async () => {
    const user = userEvent.setup();
    // 40 months, 3 paid → 37 unpaid. Unpaid caps: 6 → 18 → 30 → 42 (≥37 → all shown).
    render(<CreditCardDetail card={loanCard} plans={[makePlan('ip_a', 40, 3)]} />);
    expect(rowCount()).toBe(3 + 6);

    await user.click(moreButton()!);
    expect(rowCount()).toBe(3 + 18);
    await user.click(moreButton()!);
    expect(rowCount()).toBe(3 + 30);
    expect(screen.getByRole('button', { name: 'แสดงทั้งหมด (40 งวด)' })).toBeInTheDocument();

    await user.click(moreButton()!);
    expect(rowCount()).toBe(40); // capped, not 3 + 42
    expect(moreButton()).toBeNull();
    expect(screen.queryByRole('button', { name: /^แสดงทั้งหมด/ })).toBeNull();
  });

  test('a 480-month loan never renders more rows than asked for until "แสดงทั้งหมด"', async () => {
    const user = userEvent.setup();
    render(<CreditCardDetail card={loanCard} plans={[makePlan('ip_big', 480, 0)]} />);
    expect(rowCount()).toBe(6);
    for (let click = 1; click <= 4; click += 1) {
      await user.click(moreButton()!);
      expect(rowCount()).toBe(6 + click * 12);
    }
    await user.click(screen.getByRole('button', { name: 'แสดงทั้งหมด (480 งวด)' }));
    expect(rowCount()).toBe(480);
    expect(moreButton()).toBeNull();
  });

  test('switching to a different plan id resets the reveal; a new object for the same plan id does not', async () => {
    const user = userEvent.setup();
    const planA = makePlan('ip_a', 40, 0);
    const { rerender } = render(<CreditCardDetail card={loanCard} plans={[planA]} />);
    await user.click(moreButton()!);
    expect(rowCount()).toBe(18);

    // same id, fresh object (e.g. after a reload) → expansion kept
    rerender(<CreditCardDetail card={loanCard} plans={[{ ...planA, schedule: [...planA.schedule] }]} />);
    expect(rowCount()).toBe(18);

    // different plan → back to the 6-row preview
    rerender(<CreditCardDetail card={loanCard} plans={[makePlan('ip_b', 40, 0)]} />);
    expect(rowCount()).toBe(6);
    expect(moreButton()).toBeInTheDocument();
  });

  test('generic, not loan-gated: a 24-month credit-card plan gets both buttons; ≤12 months gets neither', async () => {
    const user = userEvent.setup();
    const card = { id: 'cc_x', name: 'KTC', creditLimit: 50000, remainingPrincipal: 0, remainingPayable: 0, availableCredit: 50000, statementDay: 5, dueDay: 25 };
    const long = { ...makePlan('ip_cc', 24, 0), cardId: 'cc_x', interestMode: 'calculated', calcMethod: 'flat' };
    const { unmount } = render(<CreditCardDetail card={card} plans={[long]} />);
    expect(rowCount()).toBe(6);
    expect(screen.getByRole('button', { name: 'แสดงทั้งหมด (24 งวด)' })).toBeInTheDocument();
    await user.click(moreButton()!);
    expect(rowCount()).toBe(18);
    await user.click(moreButton()!);
    expect(rowCount()).toBe(24);
    expect(moreButton()).toBeNull();
    unmount();

    render(<CreditCardDetail card={card} plans={[{ ...makePlan('ip_short', 12, 0), cardId: 'cc_x' }]} />);
    expect(rowCount()).toBe(12);
    expect(moreButton()).toBeNull();
  });
});

// --- tile overflow fix ----------------------------------------------------------------------------
// jsdom has no layout, so this pins the invariant measured in headless Chrome (Stage 4 report): a grid item
// with aspect-ratio does not stretch (justify-self normal acts as start), so without an explicit width its
// width is derived from min-height × ratio (13rem × 1.6 = 332.8px) and overflows any narrower cell — the
// rotor's minmax(0,1fr) column alone does not change that. Either an explicit w-full or no aspect ratio.

test('tile faces never derive their width from the aspect ratio (no overflow in cells < 332.8px)', () => {
  const tile: TileCard = {
    id: 'cc_card_1', name: 'KTC', color: '#5d5bff', creditLimit: 10000, remainingPrincipal: 0,
    remainingPayable: 0, availableCredit: 10000, statementDay: 25, dueDay: 10, ongoingPlanCount: 0, totalDueThisMonth: 0
  };
  render(<CreditCardTile card={tile} />);
  const rotor = screen.getByTestId('cc-tile-rotor');
  expect(rotor.className).toContain("[grid-template-areas:'face']");
  expect(rotor.className).toContain('[transform-style:preserve-3d]');
  const faces = rotor.querySelectorAll('[data-face]');
  expect(faces).toHaveLength(2);
  faces.forEach(faceEl => {
    const classes = faceEl.className.split(/\s+/);
    const hasAspect = classes.some(name => name.startsWith('aspect-'));
    expect(classes).toEqual(expect.arrayContaining(['[grid-area:face]', '[backface-visibility:hidden]']));
    expect(!hasAspect || classes.includes('w-full')).toBe(true);
  });
});

// Round 2 (user-confirmed direction, re-measured in headless Chrome): faces are content-sized, not aspect-ratio
// boxes. With aspect-ratio + an explicit min-h the face height is fixed and content spills past the bottom
// (60-87px on loan tiles). Content-sized faces + an h-full rotor let the outer grid's default row stretch make
// every tile in a row, and both faces of one tile, the same height. Guards against resolving the
// develop merge conflict toward develop's `aspect-[1.6/1] ... w-full` FACE, which re-introduces the spill.
test('tile faces are content-sized (no aspect ratio) and the rotor fills the stretched grid cell', () => {
  const tile: TileCard = {
    id: 'cc_card_2', name: 'KTC', color: '#5d5bff', creditLimit: 10000, remainingPrincipal: 0,
    remainingPayable: 0, availableCredit: 10000, statementDay: 25, dueDay: 10, ongoingPlanCount: 0, totalDueThisMonth: 0
  };
  render(<CreditCardTile card={tile} />);
  const rotor = screen.getByTestId('cc-tile-rotor');
  expect(rotor.className.split(/\s+/)).toEqual(expect.arrayContaining(['h-full', 'w-full']));
  rotor.querySelectorAll('[data-face]').forEach(faceEl => {
    const classes = faceEl.className.split(/\s+/);
    expect(classes.some(name => name.startsWith('aspect-'))).toBe(false);
    expect(classes).toEqual(expect.arrayContaining(['w-full', 'min-h-[13rem]']));
  });
});

// --- P0-1 failure + repeat round trips ---------------------------------------------------------

const pageLoan = {
  id: 'cc_loan_new', name: 'บ้าน', cardType: 'home_loan', creditLimit: 0, statementDay: 'EOM', dueDay: 5,
  remainingPayable: 0, availableCredit: 0, ongoingPlanCount: 0, installmentCount: 0
};

async function renderPage(cards: unknown[]) {
  jest.mocked(creditCardAPI.getCards).mockResolvedValue({ cards, totals: null } as never);
  render(<CreditCardsPage />);
  await waitFor(() => expect(creditCardAPI.getCards).toHaveBeenCalled());
}

test('P0-1: a failed save in the round trip keeps the edit open with an error toast; cancel still returns to step 2', async () => {
  await renderPage([pageLoan]);
  fireEvent.click(await screen.findByRole('button', { name: '+ เพิ่มตารางผ่อน', hidden: true }));
  fireEvent.click(screen.getByRole('button', { name: 'กลับไปแก้ไขข้อมูลบัตร' }));

  jest.mocked(creditCardAPI.saveCard).mockRejectedValueOnce(new Error('บันทึกบัตรไม่สำเร็จ'));
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'submit-card' })); });
  expect(showToast).toHaveBeenCalledWith('บันทึกบัตรไม่สำเร็จ', 'error');
  expect(screen.getByTestId('card-form')).toHaveAttribute('data-card-id', 'cc_loan_new');
  expect(screen.queryByTestId('plan-form')).toBeNull();

  fireEvent.click(screen.getByRole('button', { name: 'close-card' }));
  expect(screen.getByTestId('plan-form')).toHaveAttribute('data-locked', 'cc_loan_new');
});

test('P0-1: two back-to-back round trips always save as an edit (id present, no cardType) and never create a card', async () => {
  await renderPage([pageLoan]);
  fireEvent.click(await screen.findByRole('button', { name: '+ เพิ่มตารางผ่อน', hidden: true }));
  jest.mocked(creditCardAPI.saveCard).mockResolvedValue({ success: true, card: { ...pageLoan, name: 'แก้แล้ว' } } as never);

  for (let trip = 0; trip < 2; trip += 1) {
    fireEvent.click(screen.getByRole('button', { name: 'กลับไปแก้ไขข้อมูลบัตร' }));
    expect(screen.getByTestId('card-form')).toHaveAttribute('data-card-id', 'cc_loan_new');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'submit-card' })); });
    expect(screen.getByTestId('plan-form')).toHaveAttribute('data-locked', 'cc_loan_new');
  }
  expect(creditCardAPI.saveCard).toHaveBeenCalledTimes(2);
  jest.mocked(creditCardAPI.saveCard).mock.calls.forEach(([payload]) => {
    expect(payload).toEqual({ id: 'cc_loan_new', name: 'แก้แล้ว' });
  });
  expect(showToast).not.toHaveBeenCalled();

  // after leaving the flow, a normal edit of the same loan gets the ordinary close + toast (state was cleared)
  fireEvent.click(screen.getByRole('button', { name: 'close-plan' }));
  expect(screen.queryByTestId('plan-form')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /ตัวเลือกของบัตร บ้าน/, hidden: true }));
  fireEvent.click(screen.getByRole('menuitem', { name: /แก้ไขสินเชื่อ/, hidden: true }));
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'submit-card' })); });
  expect(screen.queryByTestId('card-form')).toBeNull();
  expect(screen.queryByTestId('plan-form')).toBeNull();
  expect(showToast).toHaveBeenCalledWith('แก้ไขบัตรแล้ว');
});
