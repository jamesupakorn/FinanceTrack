/** @jest-environment node */
// savings-loan-withdrawal S3 / d5 — POST /api/monthly_expense { month, repayment } in JSON mode.
// spec §4.9/§4.10, D-SLW-10/13/22/23, AC-SLW-16…19; architecture-review C-S3-1, C-S3-3…C-S3-6, C-S3-13…C-S3-15.
// Real JSON store in a temp AUDIT_DATA_DIR, through withAudit. Only Date is faked (timers stay real).
// The Mongo mode is covered by dispatch 6.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createMocks } from 'node-mocks-http';
import type { NextApiHandler } from 'next';

type Row = Record<string, unknown>;

const TEST_SECRET = 'test-secret-do-not-use-in-prod';
const USER_A = 'slr-repay-user-a';
const USER_B = 'slr-repay-user-b';
const EXPENSE_FILE = 'monthly_expense.json';
const LOANS_FILE = 'savings-loans.json';
const GOALS_FILE = 'savings-goals.json';
const LOAN_ID = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const GOAL_ID = 'bbbbbbbbbbbbbbbbbbbbbbbb';
const CREATED_AT = '2026-10-01T03:00:00.000Z';
// Asia/Bangkok 2026-11-15 12:00 → current month 2026-11, day 15 in any server timezone.
const NOW = '2026-11-15T05:00:00.000Z';
const SLR_KEY_RE = /^slr_[0-9a-f]{24}$/;

const FAKE_DATE_ONLY = {
  doNotFake: [
    'hrtime', 'nextTick', 'performance', 'queueMicrotask', 'requestAnimationFrame', 'cancelAnimationFrame',
    'requestIdleCallback', 'cancelIdleCallback', 'setImmediate', 'clearImmediate', 'setInterval',
    'clearInterval', 'setTimeout', 'clearTimeout'
  ]
} as const;

const loan = (extra: Row = {}): Row => ({
  _id: LOAN_ID,
  userId: USER_A,
  source: { type: 'pool' },
  principalAmount: 3000,
  outstandingAmount: 3000,
  status: 'open',
  note: null,
  createdAt: CREATED_AT,
  updatedAt: CREATED_AT,
  closedAt: null,
  repayments: [],
  ...extra
});
const ordinaryRow = (extra: Row = {}): Row => ({ name: 'กาแฟ', actual: 50, account: 'กรุงศรี', paid: false, dueDay: 'EOM', ...extra });

function setNow(iso: string) {
  jest.useFakeTimers({ ...FAKE_DATE_ONLY, now: new Date(iso) } as any);
}

function loadRepaymentHandler(): { handler: NextApiHandler; sessionCookie: any } {
  return {
    handler: require('../../pages/api/monthly_expense').default,
    sessionCookie: require('../../src/shared/utils/backend/sessionCookie')
  };
}

function useJsonStore() {
  const state = { dir: '' };
  beforeAll(() => {
    process.env.SESSION_SECRET = TEST_SECRET;
    process.env.DATA_MODE = 'json';
    delete process.env.MONGODB_URI;
    state.dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slr-repay-json-'));
    process.env.AUDIT_DATA_DIR = state.dir;
  });
  afterAll(() => {
    delete process.env.AUDIT_DATA_DIR;
    fs.rmSync(state.dir, { recursive: true, force: true });
  });
  beforeEach(() => {
    fs.readdirSync(state.dir).forEach(name => fs.rmSync(path.join(state.dir, name), { recursive: true, force: true }));
    setNow(NOW);
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  const file = (name: string) => path.join(state.dir, name);
  const readRaw = (name: string): string | null => (fs.existsSync(file(name)) ? fs.readFileSync(file(name), 'utf8') : null);
  const readJson = (name: string): Record<string, any> => JSON.parse(readRaw(name) ?? '{}');
  const writeJson = (name: string, value: unknown) => fs.writeFileSync(file(name), JSON.stringify(value));

  return {
    readRaw,
    seedLoans: (loans: Row[], userId = USER_A) => {
      const current = readJson(LOANS_FILE);
      writeJson(LOANS_FILE, { ...current, [userId]: { loans } });
    },
    seedGoals: (goals: Row[]) => writeJson(GOALS_FILE, { [USER_A]: { goals } }),
    seedExpenseMonths: (months: Record<string, Row>) => writeJson(EXPENSE_FILE, { [USER_A]: months }),
    readLoan: (): Row | undefined => readJson(LOANS_FILE)[USER_A]?.loans?.find((l: Row) => l._id === LOAN_ID),
    readMonth: (month: string): Row | undefined => readJson(EXPENSE_FILE)[USER_A]?.[month],
    expenseMonths: (): string[] => Object.keys(readJson(EXPENSE_FILE)[USER_A] ?? {}).sort()
  };
}

async function callPost(handler: NextApiHandler, sessionCookie: any, body: unknown, userId = USER_A) {
  const { signSession, createSessionId, signCsrfToken, SESSION_COOKIE_NAME } = sessionCookie;
  const sid = createSessionId();
  const { req, res } = createMocks({
    method: 'POST',
    body: body as any,
    cookies: { [SESSION_COOKIE_NAME]: signSession(userId, sid) },
    headers: { 'x-csrf-token': signCsrfToken(sid) }
  } as any);
  await handler(req as any, res as any);
  const raw = res._getData();
  return { status: res._getStatusCode(), json: raw ? JSON.parse(raw) : null };
}

const repay = (month: string, repayment: Row) => ({ month, repayment: { loanId: LOAN_ID, ...repayment } });

describe('POST /api/monthly_expense repayment (json mode)', () => {
  const store = useJsonStore();
  let handler: NextApiHandler;
  let sessionCookie: any;

  beforeAll(() => {
    jest.resetModules();
    ({ handler, sessionCookie } = loadRepaymentHandler());
  });

  const post = (body: unknown, userId?: string) => callPost(handler, sessionCookie, body, userId);

  /** Snapshot of the data files a rejected repayment must leave untouched. */
  const snapshot = () => [EXPENSE_FILE, LOANS_FILE].map(store.readRaw);

  it('AC-SLW-16: writes the slr_ row and appends the repayment in one request (pool loan, current month)', async () => {
    store.seedLoans([loan()]);
    store.seedExpenseMonths({ '2026-11': { month: '2026-11', coffee: ordinaryRow() } });

    const result = await post(repay('2026-11', { amount: '1,200.50', account: '  กรุงศรี  ' }));

    expect(result.status).toBe(201);
    const { rowKey, repayment } = result.json;
    expect(rowKey).toMatch(SLR_KEY_RE);
    expect(result.json).toEqual({
      success: true,
      repayment: { _id: rowKey.slice(4), amount: 1200.5, expenseMonth: '2026-11', expenseRowKey: rowKey, createdAt: NOW },
      appliedAmount: 1200.5,
      outstandingAmount: 1799.5,
      status: 'open',
      rowKey
    });

    // D-SLW-13/23: exactly the 5 standard fields; no loanId/amount/date on the row itself.
    const month = store.readMonth('2026-11');
    expect(month?.[rowKey]).toEqual({ name: 'คืนเงินกู้ · ยอดกลาง', actual: 1200.5, account: 'กรุงศรี', paid: true, dueDay: 15 });
    expect(month?.coffee).toEqual(ordinaryRow());

    expect(store.readLoan()).toEqual(loan({ outstandingAmount: 1799.5, updatedAt: NOW, repayments: [repayment] }));
  });

  it('creates the month document when it does not exist yet', async () => {
    store.seedLoans([loan()]);

    const result = await post(repay('2026-10', { amount: 100, account: 'ttb' }));

    expect(result.status).toBe(201);
    const month = store.readMonth('2026-10');
    expect(month?.month).toBe('2026-10');
    expect(typeof month?._id).toBe('string');
    expect(month?.[result.json.rowKey]).toEqual({ name: 'คืนเงินกู้ · ยอดกลาง', actual: 100, account: 'ttb', paid: true, dueDay: 'EOM' });
  });

  it('AC-SLW-18: clamps to outstanding, closes the loan, labels a goal loan and defaults the account', async () => {
    const longName = 'ท'.repeat(130);
    store.seedGoals([{ _id: GOAL_ID, goalName: longName, targetAmount: 10000, status: 'active' }]);
    const earlier = { _id: 'c'.repeat(24), amount: 2500, expenseMonth: '2026-10', expenseRowKey: `slr_${'c'.repeat(24)}`, createdAt: CREATED_AT };
    store.seedLoans([loan({ source: { type: 'goal', goalId: GOAL_ID }, outstandingAmount: 500, repayments: [earlier] })]);

    const result = await post(repay('2026-09', { amount: 9999 }));

    expect(result.status).toBe(201);
    expect(result.json).toMatchObject({ appliedAmount: 500, outstandingAmount: 0, status: 'closed' });
    const row = store.readMonth('2026-09')?.[result.json.rowKey] as Row;
    expect(row).toEqual({ name: `คืนเงินกู้ · เป้าหมาย ${'ท'.repeat(100)}`, actual: 500, account: 'ไม่ระบุบัญชี', paid: true, dueDay: 'EOM' });

    const stored = store.readLoan();
    expect(stored).toMatchObject({ outstandingAmount: 0, status: 'closed', closedAt: NOW, updatedAt: NOW });
    expect(stored?.repayments).toEqual([earlier, result.json.repayment]);
    expect(result.json.repayment.amount).toBe(row.actual);
  });

  it('uses the bare goal label when the goal is gone (E-SLW-16)', async () => {
    store.seedGoals([{ _id: GOAL_ID, goalName: 'ทริป', targetAmount: 1, status: 'abandoned' }]);
    store.seedLoans([loan({ source: { type: 'goal', goalId: GOAL_ID } })]);

    const result = await post(repay('2026-11', { amount: 10 }));

    expect(result.status).toBe(201);
    expect((store.readMonth('2026-11')?.[result.json.rowKey] as Row).name).toBe('คืนเงินกู้ · เป้าหมาย');
  });

  it('409 loan_closed writes nothing', async () => {
    store.seedLoans([loan({ outstandingAmount: 0, status: 'closed', closedAt: CREATED_AT })]);
    store.seedExpenseMonths({ '2026-11': { month: '2026-11', coffee: ordinaryRow() } });
    const before = snapshot();

    const result = await post(repay('2026-11', { amount: 10 }));

    expect(result).toEqual({ status: 409, json: { error: 'loan_closed' } });
    expect(snapshot()).toEqual(before);
  });

  it('409 repayment_limit (361st) writes nothing', async () => {
    const repayments = Array.from({ length: 360 }, (_, i) => {
      const id = i.toString(16).padStart(24, '0');
      return { _id: id, amount: 1, expenseMonth: '2026-10', expenseRowKey: `slr_${id}`, createdAt: CREATED_AT };
    });
    store.seedLoans([loan({ outstandingAmount: 100, repayments })]);
    const before = snapshot();

    const result = await post(repay('2026-11', { amount: 10 }));

    expect(result).toEqual({ status: 409, json: { error: 'repayment_limit' } });
    expect(snapshot()).toEqual(before);
  });

  it('404 loan_not_found for an unknown id and for another user\'s loan, writing nothing', async () => {
    store.seedLoans([loan({ userId: USER_B })], USER_B);
    const before = snapshot();

    const crossUser = await post(repay('2026-11', { amount: 10 }));
    const unknown = await post({ month: '2026-11', repayment: { loanId: 'd'.repeat(24), amount: 10 } });

    expect(crossUser).toEqual({ status: 404, json: { error: 'loan_not_found' } });
    expect(unknown).toEqual({ status: 404, json: { error: 'loan_not_found' } });
    expect(snapshot()).toEqual(before);
  });

  it('C-S3-15: a legacy month document returns the existing 409 string and writes nothing', async () => {
    store.seedLoans([loan()]);
    store.seedExpenseMonths({ '2026-11': { month: '2026-11', actual: { rent: 5000 } } });
    const before = snapshot();

    const result = await post(repay('2026-11', { amount: 10 }));

    expect(result).toEqual({ status: 409, json: { error: 'Legacy expense document cannot be updated per row' } });
    expect(snapshot()).toEqual(before);
  });

  it.each([
    ['too old', '2025-08'],
    ['future', '2026-12']
  ])('D-SLW-22: 400 month_out_of_range (%s) writes nothing', async (_label, month) => {
    store.seedLoans([loan()]);
    const before = snapshot();

    const result = await post(repay(month, { amount: 10 }));

    expect(result).toEqual({ status: 400, json: { error: 'month_out_of_range' } });
    expect(snapshot()).toEqual(before);
  });

  it.each([0, -5, '0.004', 'abc', '1000000000'])('400 invalid_amount for %p', async amount => {
    store.seedLoans([loan()]);
    const before = snapshot();

    const result = await post(repay('2026-11', { amount }));

    expect(result).toEqual({ status: 400, json: { error: 'invalid_amount' } });
    expect(snapshot()).toEqual(before);
  });

  it.each([
    ['an operator object as loanId', { month: '2026-11', repayment: { loanId: { $ne: null }, amount: 10 } }],
    ['an extra repayment field', { month: '2026-11', repayment: { loanId: LOAN_ID, amount: 10, outstandingAmount: 0 } }],
    ['expense_data next to repayment', { month: '2026-11', repayment: { loanId: LOAN_ID, amount: 10 }, expense_data: {} }],
    ['a malformed month', { month: '2026-13', repayment: { loanId: LOAN_ID, amount: 10 } }]
  ])('400 Zod validation for %s (E-SLW-18)', async (_label, body) => {
    store.seedLoans([loan()]);
    const before = snapshot();

    const result = await post(body);

    expect(result.status).toBe(400);
    expect(result.json.error).toBe('Validation failed');
    expect(snapshot()).toEqual(before);
  });

  it('C-S3-14: a repayment whose month is pruned by the same request still succeeds', async () => {
    store.seedLoans([loan()]);
    // 2025-10 … 2026-12 = 15 real months (2026-12 is current+1, never skipped); the repayment month 2025-09 is the 16th.
    const months: Record<string, Row> = {};
    for (let i = 0; i < 15; i += 1) {
      const key = new Date(Date.UTC(2025, 9 + i, 1)).toISOString().slice(0, 7);
      months[key] = { month: key, coffee: ordinaryRow() };
    }
    store.seedExpenseMonths(months);

    const result = await post(repay('2025-09', { amount: 400 }));

    expect(result.status).toBe(201);
    expect(result.json).toMatchObject({ appliedAmount: 400, outstandingAmount: 2600 });
    // The loan keeps the repayment; only the visual row went with its month (E-SLW-23 / KL-3).
    expect(store.readLoan()).toMatchObject({ outstandingAmount: 2600, repayments: [result.json.repayment] });
    expect(store.readMonth('2025-09')).toBeUndefined();
    expect(store.expenseMonths()).toEqual(Object.keys(months).sort());
    expect(store.expenseMonths()).toHaveLength(15);
  });

  describe('C-S3-13 Asia/Bangkok boundary', () => {
    // 2026-12-01 00:30 in Bangkok is still 2026-11-30 in UTC.
    const BOUNDARY = '2026-12-01T00:30:00+07:00';

    it('accepts the Bangkok current month and uses its day as dueDay', async () => {
      setNow(BOUNDARY);
      store.seedLoans([loan()]);

      const result = await post(repay('2026-12', { amount: 10 }));

      expect(result.status).toBe(201);
      expect((store.readMonth('2026-12')?.[result.json.rowKey] as Row).dueDay).toBe(1);
      expect(result.json.repayment.createdAt).toBe(new Date(BOUNDARY).toISOString());
    });

    it('treats the UTC month as a past month (dueDay EOM) and the next Bangkok month as future', async () => {
      setNow(BOUNDARY);
      store.seedLoans([loan()]);

      const previous = await post(repay('2026-11', { amount: 10 }));
      const future = await post(repay('2027-01', { amount: 10 }));

      expect(previous.status).toBe(201);
      expect((store.readMonth('2026-11')?.[previous.json.rowKey] as Row).dueDay).toBe('EOM');
      expect(future).toEqual({ status: 400, json: { error: 'month_out_of_range' } });
    });

    it('lower bound follows the Bangkok month too (current − 14)', async () => {
      setNow(BOUNDARY);
      store.seedLoans([loan()]);

      expect((await post(repay('2025-10', { amount: 10 }))).status).toBe(201);
      expect(await post(repay('2025-09', { amount: 10 }))).toEqual({ status: 400, json: { error: 'month_out_of_range' } });
    });
  });

  it('a body without `repayment` still takes the normal save path (AC-SLW-20)', async () => {
    store.seedLoans([loan()]);

    const result = await post({ month: '2026-11', expense_data: { coffee: ordinaryRow() } });

    expect(result).toEqual({ status: 200, json: { success: true } });
    expect(store.readMonth('2026-11')?.coffee).toEqual(ordinaryRow());
    expect(store.readLoan()).toEqual(loan());
  });
});

// replaceLoan is a store collaborator; replacing it (not the DB) is allowed by CODING_STANDARD:116-119.
describe.each([
  ['returns false (loan deleted concurrently)', 'false', 404],
  ['throws (AC-SLW-17)', 'throw', 500]
])('POST repayment when replaceLoan %s (json mode)', (_label, behaviour, expectedStatus) => {
  const store = useJsonStore();
  // Slr_ keys staged in the month at the moment replaceLoan runs — proves the row write happened first (C-S3-5).
  const mockStagedRowKeys: string[] = [];
  let handler: NextApiHandler;
  let sessionCookie: any;

  beforeAll(() => {
    jest.resetModules();
    jest.doMock('../../src/shared/utils/backend/savingsLedgerStore', () => {
      const actual = jest.requireActual('../../src/shared/utils/backend/savingsLedgerStore');
      return {
        ...actual,
        replaceLoan: jest.fn(async (userId: string) => {
          const { getUserData } = require('../../src/backend/data/userUtils');
          const staged = getUserData('monthly_expense.json', userId)['2026-11'] ?? {};
          mockStagedRowKeys.push(...Object.keys(staged).filter(key => /^slr_[0-9a-f]{24}$/.test(key)));
          if (behaviour === 'throw') throw new Error('simulated replaceLoan failure');
          return false;
        })
      };
    });
    ({ handler, sessionCookie } = loadRepaymentHandler());
  });

  afterAll(() => {
    jest.dontMock('../../src/shared/utils/backend/savingsLedgerStore');
  });

  it('rolls back the already-written row and leaves the loan unchanged', async () => {
    mockStagedRowKeys.length = 0;
    store.seedLoans([loan()]);
    store.seedExpenseMonths({ '2026-11': { month: '2026-11', coffee: ordinaryRow() } });
    const before = [EXPENSE_FILE, LOANS_FILE].map(store.readRaw);
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const result = await callPost(handler, sessionCookie, repay('2026-11', { amount: 10 }));
    errorSpy.mockRestore();

    expect(result.status).toBe(expectedStatus);
    if (expectedStatus === 404) expect(result.json).toEqual({ error: 'loan_not_found' });
    expect(mockStagedRowKeys).toHaveLength(1);
    expect([EXPENSE_FILE, LOANS_FILE].map(store.readRaw)).toEqual(before);
    expect(Object.keys(store.readMonth('2026-11') ?? {}).some(key => SLR_KEY_RE.test(key))).toBe(false);
  });
});
