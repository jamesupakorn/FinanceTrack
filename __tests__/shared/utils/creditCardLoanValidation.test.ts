/** @jest-environment node */
// Loan slice S2 — pure-function coverage: cardType constants, normaliseCardDefaults, validateCardInput
// (create/edit), validatePlanInput (cap + forced mode/method), summarisePlan derived fields, and the
// card-total row label (BR-CC-033/035, AC-LN-01…08, AC-LN-15).
import {
  CARD_TYPES,
  CARD_TYPE_LABELS,
  DEFAULT_CARD_TYPE,
  MAX_INSTALLMENTS_PER_PLAN,
  MAX_LOAN_INSTALLMENTS_PER_PLAN,
  MAX_RATE_REVISIONS_PER_PLAN,
  isCardType,
  isLoanCardType,
  normaliseCardDefaults,
  summarisePlan,
  validateCardInput,
  validatePlanInput
} from '../../../src/shared/utils/creditCardUtils';
import { buildCardTotalExpenseRows } from '../../../src/shared/utils/backend/creditCardSync';

const baseCard = { name: 'บ้าน', statementDay: 'EOM', dueDay: 5 };
const loanPlan = {
  cardId: 'cc_aaaaaaaaaaaa',
  itemName: 'บ้าน',
  totalPrice: 1000000,
  months: 240,
  startMonth: '2026-12',
  interestMode: 'calculated',
  annualRate: 6,
  calcMethod: 'effective'
};

describe('cardType constants', () => {
  test('closed set, default, and predicates', () => {
    expect(CARD_TYPES).toEqual(['credit_card', 'personal_loan', 'home_loan']);
    expect(DEFAULT_CARD_TYPE).toBe('credit_card');
    expect(CARD_TYPES.every(isCardType)).toBe(true);
    expect(isCardType('car_loan')).toBe(false);
    expect(isCardType(undefined)).toBe(false);
    expect(isCardType('toString')).toBe(false);
    expect(isLoanCardType('personal_loan')).toBe(true);
    expect(isLoanCardType('home_loan')).toBe(true);
    expect(isLoanCardType('credit_card')).toBe(false);
    expect(isLoanCardType(undefined)).toBe(false);
  });

  test('labels and caps', () => {
    expect(CARD_TYPE_LABELS.credit_card).toEqual({ label: 'บัตรเครดิต', rowPrefix: 'ยอดบัตร' });
    expect(CARD_TYPE_LABELS.personal_loan).toEqual({ label: 'สินเชื่อส่วนบุคคล', rowPrefix: 'ค่างวดสินเชื่อส่วนบุคคล' });
    expect(CARD_TYPE_LABELS.home_loan).toEqual({ label: 'สินเชื่อบ้าน', rowPrefix: 'ค่างวดสินเชื่อบ้าน' });
    expect(MAX_INSTALLMENTS_PER_PLAN).toBe(60);
    expect(MAX_LOAN_INSTALLMENTS_PER_PLAN).toBe(480);
    expect(MAX_RATE_REVISIONS_PER_PLAN).toBe(120);
  });
});

describe('normaliseCardDefaults — cardType default on read (AC-LN-01)', () => {
  test('missing or invalid → credit_card, valid kept', () => {
    expect(normaliseCardDefaults({ id: 'cc_x' }).cardType).toBe('credit_card');
    expect(normaliseCardDefaults({ id: 'cc_x', cardType: 'car_loan' }).cardType).toBe('credit_card');
    expect(normaliseCardDefaults({ id: 'cc_x', cardType: 'home_loan' }).cardType).toBe('home_loan');
  });

  test('does not mutate the stored card', () => {
    const stored = { id: 'cc_x' };
    normaliseCardDefaults(stored);
    expect(stored).toEqual({ id: 'cc_x' });
  });
});

describe('validateCardInput — create mode (AC-LN-02/03)', () => {
  test('single-argument call defaults to create and to credit_card', () => {
    const result = validateCardInput({ ...baseCard, creditLimit: 50000 });
    expect(result.valid).toBe(true);
    expect(result.value.cardType).toBe('credit_card');
    expect(result.value.creditLimit).toBe(50000);
  });

  test('loan type is kept and forces creditLimit 0', () => {
    const result = validateCardInput({ ...baseCard, cardType: 'home_loan', creditLimit: 90000 }, { mode: 'create' });
    expect(result.valid).toBe(true);
    expect(result.value.cardType).toBe('home_loan');
    expect(result.value.creditLimit).toBe(0);
  });

  test('invalid type → errors.cardType, other fields still validated independently', () => {
    const result = validateCardInput({ ...baseCard, cardType: 'car_loan' });
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual({ cardType: 'ประเภทไม่ถูกต้อง' });

    const both = validateCardInput({ ...baseCard, name: '', cardType: 42 });
    expect(Object.keys(both.errors).sort()).toEqual(['cardType', 'name']);
  });
});

describe('validateCardInput — edit mode', () => {
  test('value omits cardType entirely and does not reject or zero anything for type reasons', () => {
    const result = validateCardInput({ ...baseCard, cardType: 'car_loan', creditLimit: 50000 }, { mode: 'edit' });
    expect(result.valid).toBe(true);
    expect('cardType' in result.value).toBe(false);
    expect(result.value.creditLimit).toBe(50000);
  });
});

describe('validatePlanInput — cardType-scoped rules (AC-LN-06/07)', () => {
  test('credit card (default) keeps the 60 cap and its error text', () => {
    const result = validatePlanInput({ ...loanPlan, months: 61 });
    expect(result.errors.months).toBe('จำนวนงวดต้องอยู่ระหว่าง 1–60');
    expect(validatePlanInput({ ...loanPlan, months: 60 }).valid).toBe(true);
  });

  test('loan accepts 480 and rejects 481 with the 1–480 text', () => {
    expect(validatePlanInput({ ...loanPlan, months: 480 }, { cardType: 'home_loan' }).valid).toBe(true);
    const over = validatePlanInput({ ...loanPlan, months: 481 }, { cardType: 'home_loan' });
    expect(over.valid).toBe(false);
    expect(over.errors.months).toBe('จำนวนงวดต้องอยู่ระหว่าง 1–480');
  });

  test('loan rejects manual mode and flat method without coercing them', () => {
    const manual = validatePlanInput({ ...loanPlan, interestMode: 'manual', manualFeePerMonth: 10 }, { cardType: 'personal_loan' });
    expect(manual.valid).toBe(false);
    expect(manual.errors.interestMode).toBe('สินเชื่อคำนวณแบบลดต้นลดดอกเท่านั้น');
    expect(manual.value.interestMode).toBe('manual');
    expect(manual.value.manualFeePerMonth).toBe(10);

    const flat = validatePlanInput({ ...loanPlan, calcMethod: 'flat' }, { cardType: 'personal_loan' });
    expect(flat.valid).toBe(false);
    expect(flat.errors).toEqual({ calcMethod: 'สินเชื่อคำนวณแบบลดต้นลดดอกเท่านั้น' });
    expect(flat.value.calcMethod).toBe('flat');
  });

  test('credit card still allows manual and flat', () => {
    expect(validatePlanInput({ ...loanPlan, months: 12, calcMethod: 'flat' }).valid).toBe(true);
    expect(validatePlanInput({ ...loanPlan, months: 12, interestMode: 'manual' }, { cardType: 'credit_card' }).valid).toBe(true);
  });
});

describe('summarisePlan — derived currentRate / rateRevisionCount', () => {
  test('currentRate echoes annualRate and rateRevisionCount is 0 without revisions', () => {
    const summary = summarisePlan({ id: 'ip_x', annualRate: 6, schedule: [] });
    expect(summary.currentRate).toBe(6);
    expect(summary.rateRevisionCount).toBe(0);
  });

  test('a non-array rateRevisions value still reads as 0', () => {
    expect(summarisePlan({ id: 'ip_x', rateRevisions: 'junk' }).rateRevisionCount).toBe(0);
  });
});

describe('buildCardTotalExpenseRows — row label by type (AC-LN-15)', () => {
  const plan = (cardId: string, id: string) => ({
    id,
    cardId,
    itemName: 'x',
    months: 1,
    status: 'ongoing',
    schedule: [{ no: 1, dueMonth: '2026-12', payment: 100, principal: 100, interest: 0, paid: false }]
  });

  test('credit card unchanged, loans use their rowPrefix, cardType is exposed', () => {
    const rows = buildCardTotalExpenseRows({
      cards: [
        { id: 'cc_aaaaaaaaaaaa', name: 'A', statementDay: 10, dueDay: 25 },
        { id: 'cc_bbbbbbbbbbbb', name: 'B', statementDay: 'EOM', dueDay: 5, cardType: 'home_loan' },
        { id: 'cc_cccccccccccc', name: 'C', statementDay: 'EOM', dueDay: 5, cardType: 'personal_loan' }
      ],
      plans: [plan('cc_aaaaaaaaaaaa', 'ip_aaaaaaaaaaaa'), plan('cc_bbbbbbbbbbbb', 'ip_bbbbbbbbbbbb'), plan('cc_cccccccccccc', 'ip_cccccccccccc')],
      cycles: [],
      spendItems: []
    }, '2026-12');

    expect(rows.ccr_aaaaaaaaaaaa.name).toBe('ยอดบัตร A');
    expect(rows.ccr_aaaaaaaaaaaa.cardType).toBe('credit_card');
    expect(rows.ccr_bbbbbbbbbbbb.name).toBe('ค่างวดสินเชื่อบ้าน B');
    expect(rows.ccr_bbbbbbbbbbbb.cardType).toBe('home_loan');
    // loan offset 0: the schedule month is the table month even with statementDay EOM
    expect(rows.ccr_bbbbbbbbbbbb.cycleMonth).toBe('2026-12');
    expect(rows.ccr_bbbbbbbbbbbb.resolvedDueDate).toBe('2026-12-05');
    expect(rows.ccr_cccccccccccc.name).toBe('ค่างวดสินเชื่อส่วนบุคคล C');
  });
});
