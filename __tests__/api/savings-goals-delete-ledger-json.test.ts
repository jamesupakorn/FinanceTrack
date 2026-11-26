/** @jest-environment node */
// savings-loan-withdrawal S2, dispatch 4 — JSON-mode coverage for the DELETE /api/savings-goals
// open-loan guard (spec §4.7 step "S2, DELETE", C-S2-4). A new, dedicated test file so this
// dispatch's own setup (clearing the whole temp data dir, which covers savings-loans.json /
// savings-withdrawals.json / savings-goals.json alike) never touches the existing Mongo-mode
// `beforeEach` in __tests__/api/savings-goals.test.ts (C-S2-6: that hook only clears
// `savingsGoals`/`savings` and must not be edited). JSON mode has no `savingsLedgerGuards`
// collection (D-SLW-16: guard is a Mongo-only no-op in JSON), so nothing extra is needed there.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createMocks } from 'node-mocks-http';
import type { RequestMethod } from 'node-mocks-http';
import type { NextApiHandler } from 'next';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';

declare const jest: typeof import('@jest/globals').jest;

type Row = Record<string, unknown>;

const TEST_SECRET = 'test-secret-do-not-use-in-prod';
const USER_A = 'slw-del-user-a';
const GOALS_FILE = 'savings-goals.json';
const LOANS_FILE = 'savings-loans.json';
const WITHDRAWALS_FILE = 'savings-withdrawals.json';

const GOAL_ID = 'd0d0d0d0d0d0d0d0d0d0d0d0';
const GHOST_GOAL_ID = 'd9d9d9d9d9d9d9d9d9d9d9d9';
const LOAN_1 = 'e1e1e1e1e1e1e1e1e1e1e1e1';
const WD_1 = 'f1f1f1f1f1f1f1f1f1f1f1f1';
const NOW = '2026-11-16T00:00:00.000Z';

let handler: NextApiHandler;
let sessionCookie: typeof import('../../src/shared/utils/backend/sessionCookie');
let dir = '';

beforeAll(() => {
  process.env.SESSION_SECRET = TEST_SECRET;
  process.env.DATA_MODE = 'json';
  delete process.env.MONGODB_URI;
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slw-del-goals-json-'));
  process.env.AUDIT_DATA_DIR = dir;

  jest.resetModules();
  handler = require('../../pages/api/savings-goals').default;
  sessionCookie = require('../../src/shared/utils/backend/sessionCookie');
});

afterAll(() => {
  delete process.env.AUDIT_DATA_DIR;
  fs.rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  // Clears the whole per-test data dir (goals, loans, withdrawals, audit journal alike) —
  // satisfies C-S2-6 without touching the Mongo-mode suite's own beforeEach.
  fs.readdirSync(dir).forEach(name => fs.rmSync(path.join(dir, name), { recursive: true, force: true }));
});

function writeFile(name: string, data: unknown) {
  fs.writeFileSync(path.join(dir, name), JSON.stringify(data));
}

function readFile(name: string): Row {
  const file = path.join(dir, name);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
}

function makeGoal(id: string, overrides: Row = {}): Row {
  return {
    _id: id,
    userId: USER_A,
    goalName: 'เที่ยว',
    description: null,
    targetAmount: 20000,
    currency: 'THB',
    category: 'other',
    priority: 'medium',
    status: 'active',
    endDate: null,
    notes: null,
    allocationPercent: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function seedGoals(goals: Row[]) {
  writeFile(GOALS_FILE, { [USER_A]: { goals } });
}

function makeLoan(id: string, overrides: Row = {}): Row {
  return {
    _id: id,
    userId: USER_A,
    source: { type: 'goal', goalId: GOAL_ID },
    principalAmount: 1000,
    outstandingAmount: 1000,
    status: 'open',
    note: null,
    createdAt: NOW,
    updatedAt: NOW,
    closedAt: null,
    repayments: [],
    ...overrides,
  };
}

function seedLoans(loans: Row[]) {
  writeFile(LOANS_FILE, { [USER_A]: { loans } });
}

function makeWithdrawal(id: string, overrides: Row = {}): Row {
  return { _id: id, userId: USER_A, source: { type: 'goal', goalId: GOAL_ID }, amount: 500, note: null, createdAt: NOW, ...overrides };
}

function seedWithdrawals(withdrawals: Row[]) {
  writeFile(WITHDRAWALS_FILE, { [USER_A]: { withdrawals } });
}

function readGoals(): Row[] {
  const bucket = readFile(GOALS_FILE)[USER_A] as { goals?: Row[] } | undefined;
  return bucket?.goals ?? [];
}

async function call(method: RequestMethod, body?: Row) {
  const { signSession, createSessionId, signCsrfToken, SESSION_COOKIE_NAME } = sessionCookie;
  const sid = createSessionId();
  const mutating = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);
  const { req, res } = createMocks({
    method,
    body,
    cookies: { [SESSION_COOKIE_NAME]: signSession(USER_A, sid) },
    headers: mutating ? { 'x-csrf-token': signCsrfToken(sid) } : {},
  });
  await handler(req as never, res as never);
  const raw = res._getData();
  return { status: res._getStatusCode(), body: raw ? JSON.parse(raw) : null };
}

describe('DELETE /api/savings-goals — JSON mode open-loan guard (S2, C-S2-3/C-S2-4)', () => {
  it('a goal with an open loan against it → 409 goal_has_open_loans, goal NOT deleted', async () => {
    seedGoals([makeGoal(GOAL_ID)]);
    seedLoans([makeLoan(LOAN_1, { outstandingAmount: 750 })]);

    const r = await call('DELETE', { goalId: GOAL_ID });
    expect(r).toEqual({ status: 409, body: { error: 'goal_has_open_loans', outstanding: 750 } });
    expect(readGoals().map(g => g._id)).toEqual([GOAL_ID]);
  });

  it('a goal with only closed loans and withdrawals (no open loan) → succeeds as before', async () => {
    seedGoals([makeGoal(GOAL_ID)]);
    seedLoans([makeLoan(LOAN_1, { status: 'closed', outstandingAmount: 0, closedAt: NOW })]);
    seedWithdrawals([makeWithdrawal(WD_1)]);

    const r = await call('DELETE', { goalId: GOAL_ID });
    expect(r).toEqual({ status: 200, body: { success: true } });
    expect(readGoals()).toEqual([]);
  });

  it('S2-F-3 regression: deleting an already-nonexistent goal id returns 404, not 409, even with a stray open loan referencing it', async () => {
    seedGoals([makeGoal(GOAL_ID)]); // GHOST_GOAL_ID is not a real goal
    seedLoans([makeLoan(LOAN_1, { source: { type: 'goal', goalId: GHOST_GOAL_ID }, outstandingAmount: 400 })]);

    const r = await call('DELETE', { goalId: GHOST_GOAL_ID });
    expect(r).toEqual({ status: 404, body: { error: 'Goal not found' } });
  });

  it('a goal with no ledger activity at all → succeeds exactly as before (regression guard)', async () => {
    seedGoals([makeGoal(GOAL_ID)]);

    const r = await call('DELETE', { goalId: GOAL_ID });
    expect(r).toEqual({ status: 200, body: { success: true } });
    expect(readGoals()).toEqual([]);
  });

  it('a loan sourced from the pool never blocks a goal delete', async () => {
    seedGoals([makeGoal(GOAL_ID)]);
    seedLoans([makeLoan(LOAN_1, { source: { type: 'pool' } })]);

    const r = await call('DELETE', { goalId: GOAL_ID });
    expect(r).toEqual({ status: 200, body: { success: true } });
  });

  it('an open loan against a different goal never blocks this goal\'s delete', async () => {
    const OTHER_GOAL_ID = 'c3c3c3c3c3c3c3c3c3c3c3c3';
    seedGoals([makeGoal(GOAL_ID), makeGoal(OTHER_GOAL_ID, { goalName: 'อื่น' })]);
    seedLoans([makeLoan(LOAN_1, { source: { type: 'goal', goalId: OTHER_GOAL_ID } })]);

    const r = await call('DELETE', { goalId: GOAL_ID });
    expect(r).toEqual({ status: 200, body: { success: true } });
    expect(readGoals().map(g => g._id)).toEqual([OTHER_GOAL_ID]);
  });
});

// ---- Stage 4 (tester) additions: gaps against C-S2-4 / C-S2-5 / AC-SLW-11 and cross-user isolation ----

const USER_B = 'slw-del-user-b';
const SAVINGS_FILE = 'savings.json';

async function callAs(userId: string, method: RequestMethod, body?: Row) {
  const { signSession, createSessionId, signCsrfToken, SESSION_COOKIE_NAME } = sessionCookie;
  const sid = createSessionId();
  const mutating = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);
  const { req, res } = createMocks({
    method,
    body,
    cookies: { [SESSION_COOKIE_NAME]: signSession(userId, sid) },
    headers: mutating ? { 'x-csrf-token': signCsrfToken(sid) } : {},
  });
  await handler(req as never, res as never);
  const raw = res._getData();
  return { status: res._getStatusCode(), body: raw ? JSON.parse(raw) : null };
}

describe('DELETE /api/savings-goals — JSON mode, tester additions (S2)', () => {
  it('C-S2-4: an abandoned goal with an open loan still returns 409 and is not deleted', async () => {
    seedGoals([makeGoal(GOAL_ID, { status: 'abandoned' })]);
    seedLoans([makeLoan(LOAN_1, { outstandingAmount: 300 })]);

    const r = await call('DELETE', { goalId: GOAL_ID });
    expect(r).toEqual({ status: 409, body: { error: 'goal_has_open_loans', outstanding: 300 } });
    expect(readGoals().map(g => g._id)).toEqual([GOAL_ID]);
  });

  it('409 outstanding sums every open loan on the goal (rounded to 2dp) and ignores closed ones', async () => {
    seedGoals([makeGoal(GOAL_ID)]);
    seedLoans([
      makeLoan(LOAN_1, { outstandingAmount: 0.1 }),
      makeLoan('e2e2e2e2e2e2e2e2e2e2e2e2', { outstandingAmount: 0.2 }),
      makeLoan('e3e3e3e3e3e3e3e3e3e3e3e3', { status: 'closed', outstandingAmount: 0, closedAt: NOW }),
    ]);

    const r = await call('DELETE', { goalId: GOAL_ID });
    expect(r).toEqual({ status: 409, body: { error: 'goal_has_open_loans', outstanding: 0.3 } });
  });

  it('409 rolls back: the goals file is byte-identical after a refused delete', async () => {
    seedGoals([makeGoal(GOAL_ID)]);
    seedLoans([makeLoan(LOAN_1)]);
    const before = fs.readFileSync(path.join(dir, GOALS_FILE), 'utf8');

    await call('DELETE', { goalId: GOAL_ID });
    expect(fs.readFileSync(path.join(dir, GOALS_FILE), 'utf8')).toBe(before);
  });

  it('cross-user: another user cannot delete (or probe open loans on) user A\'s goal — 404, not 409', async () => {
    seedGoals([makeGoal(GOAL_ID)]);
    seedLoans([makeLoan(LOAN_1)]);

    const r = await callAs(USER_B, 'DELETE', { goalId: GOAL_ID });
    expect(r).toEqual({ status: 404, body: { error: 'Goal not found' } });
    expect(readGoals().map(g => g._id)).toEqual([GOAL_ID]);
  });

  it('cross-user: user A\'s open loan naming user B\'s goal id never blocks user B\'s delete', async () => {
    writeFile(GOALS_FILE, { [USER_B]: { goals: [makeGoal(GOAL_ID, { userId: USER_B })] } });
    seedLoans([makeLoan(LOAN_1)]); // USER_A's loan, source.goalId === GOAL_ID

    const r = await callAs(USER_B, 'DELETE', { goalId: GOAL_ID });
    expect(r).toEqual({ status: 200, body: { success: true } });
  });

  it('goalId via query string still works and is still guarded', async () => {
    seedGoals([makeGoal(GOAL_ID)]);
    seedLoans([makeLoan(LOAN_1)]);
    const { signSession, createSessionId, signCsrfToken, SESSION_COOKIE_NAME } = sessionCookie;
    const sid = createSessionId();
    const { req, res } = createMocks({
      method: 'DELETE',
      query: { goalId: GOAL_ID },
      cookies: { [SESSION_COOKIE_NAME]: signSession(USER_A, sid) },
      headers: { 'x-csrf-token': signCsrfToken(sid) },
    });
    await handler(req as never, res as never);
    expect(res._getStatusCode()).toBe(409);
  });

  it('missing goalId → 400 before any ledger read (unchanged contract)', async () => {
    const r = await call('DELETE', {});
    expect(r).toEqual({ status: 400, body: { error: 'goalId required' } });
  });
});

describe('GET /api/savings-goals — JSON mode, tester additions (AC-SLW-11, C-S2-5)', () => {
  function seedSavingsFile(entries: Array<[string, number]>) {
    writeFile(SAVINGS_FILE, {
      [USER_A]: { '2026-10': { month: '2026-10', savings_list: entries.map(([savings_type, savings_amount]) => ({ savings_type, savings_amount })) } },
    });
  }

  it('AC-SLW-11 / S2-F-5: a zero-ledger float-dust goal stays bit-identical (unrounded) while another goal has ledger activity', async () => {
    const OTHER = 'c3c3c3c3c3c3c3c3c3c3c3c3';
    seedSavingsFile([['เที่ยว', 0.1], ['เที่ยว', 0.2], ['อื่น', 0.7], ['อื่น', 0.1]]);
    seedGoals([makeGoal(GOAL_ID, { targetAmount: 1 }), makeGoal(OTHER, { goalName: 'อื่น', targetAmount: 1 })]);
    seedLoans([makeLoan(LOAN_1, { source: { type: 'goal', goalId: OTHER }, principalAmount: 0.3, outstandingAmount: 0.3 })]);

    const r = await call('GET');
    expect(r.status).toBe(200);
    const dust = r.body.goals.find((g: Row) => g._id === GOAL_ID);
    expect(dust.currentAmount).toBe(0.1 + 0.2); // 0.30000000000000004, no "free" rounding
    expect(dust.metadata).toMatchObject({ outstandingLoansTotal: 0, withdrawalsTotal: 0 });
    const other = r.body.goals.find((g: Row) => g._id === OTHER);
    expect(other.currentAmount).toBe(0.5); // round2(0.7999… - 0.3)
    expect(other.metadata.outstandingLoansTotal).toBe(0.3);
  });

  it('C-S2-5: stored junk metadata.outstandingLoansTotal / withdrawalsTotal never leaks through GET', async () => {
    seedGoals([makeGoal(GOAL_ID, { metadata: { outstandingLoansTotal: 999999, withdrawalsTotal: 'junk', keepMe: 'x' } })]);
    seedWithdrawals([makeWithdrawal(WD_1, { amount: 40 })]);

    const r = await call('GET');
    const goal = r.body.goals[0];
    expect(goal.metadata).toMatchObject({ outstandingLoansTotal: 0, withdrawalsTotal: 40, keepMe: 'x' });
    expect(goal.currentAmount).toBe(-40);
  });

  it('cross-user: user B\'s ledger rows never reduce user A\'s goal', async () => {
    seedGoals([makeGoal(GOAL_ID)]);
    writeFile(LOANS_FILE, { [USER_B]: { loans: [makeLoan(LOAN_1, { userId: USER_B })] } });

    const r = await call('GET');
    expect(r.body.goals[0].currentAmount).toBe(0);
    expect(r.body.goals[0].metadata.outstandingLoansTotal).toBe(0);
  });
});

describe('GET /api/savings-goals — JSON mode, tester additions (AC-SLW-12 / 13 / 15)', () => {
  function seedMatched(amount: number) {
    writeFile(SAVINGS_FILE, { [USER_A]: { '2026-10': { month: '2026-10', savings_list: [{ savings_type: 'เที่ยว', savings_amount: amount }] } } });
  }

  it('AC-SLW-12: open loan 1,200 + withdrawals 500 → matched − 1,700; after a full repayment the loan stops counting', async () => {
    seedMatched(10000);
    seedGoals([makeGoal(GOAL_ID)]);
    seedLoans([makeLoan(LOAN_1, { principalAmount: 1200, outstandingAmount: 1200 })]);
    seedWithdrawals([makeWithdrawal(WD_1, { amount: 300 }), makeWithdrawal('f2f2f2f2f2f2f2f2f2f2f2f2', { amount: 200 })]);

    let goal = (await call('GET')).body.goals[0];
    expect(goal.currentAmount).toBe(8300);
    expect(goal.metadata).toMatchObject({ outstandingLoansTotal: 1200, withdrawalsTotal: 500, progressPercentage: 41.5, remainingAmount: 11700 });

    // State after a 1,200 repayment (repay route is a later slice): outstanding 0, closed.
    seedLoans([makeLoan(LOAN_1, { principalAmount: 1200, outstandingAmount: 0, status: 'closed', closedAt: NOW,
      repayments: [{ _id: 'r1r1r1r1r1r1r1r1r1r1r1r1', amount: 1200, paidAt: NOW, note: null }] })]);
    goal = (await call('GET')).body.goals[0];
    expect(goal.currentAmount).toBe(9500);
    expect(goal.metadata.outstandingLoansTotal).toBe(0);
  });

  it('AC-SLW-13: pool-sourced loans/withdrawals never change any goal\'s numbers', async () => {
    seedMatched(4000);
    seedGoals([makeGoal(GOAL_ID)]);
    const before = (await call('GET')).body.goals[0];

    seedLoans([makeLoan(LOAN_1, { source: { type: 'pool' }, principalAmount: 700, outstandingAmount: 700 })]);
    seedWithdrawals([makeWithdrawal(WD_1, { source: { type: 'pool' }, amount: 300 })]);
    const after = (await call('GET')).body.goals[0];
    expect(after).toEqual(before);
  });

  it('AC-SLW-15: currentAmount = matched + adjustments − ledger', async () => {
    seedMatched(1000);
    seedGoals([makeGoal(GOAL_ID, { adjustments: [{ _id: 'a1a1a1a1a1a1a1a1a1a1a1a1', amount: 250.5, note: 'n', createdAt: NOW, updatedAt: NOW }] })]);
    seedLoans([makeLoan(LOAN_1, { principalAmount: 100.25, outstandingAmount: 100.25 })]);
    seedWithdrawals([makeWithdrawal(WD_1, { amount: 50 })]);

    const goal = (await call('GET')).body.goals[0];
    expect(goal.currentAmount).toBe(1100.25);
    expect(goal.metadata).toMatchObject({ adjustmentsTotal: 250.5, outstandingLoansTotal: 100.25, withdrawalsTotal: 50 });
  });
});
