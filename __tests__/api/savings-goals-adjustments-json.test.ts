/** @jest-environment node */
// Savings goal adjustments S1 — JSON-mode coverage for PUT /api/savings-goals action branch and the GET
// formula (spec-savings-goal-adjustments §4.2, AC-SGA-07…14 + GET legacy/normalization). This route had no
// JSON-mode test before (validation F-4). Harness modelled on __tests__/api/credit-cards/rate-revisions.test.ts:
// real JSON store + audit journal in a temp AUDIT_DATA_DIR, handler required fresh after setting env.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createMocks } from 'node-mocks-http';
import type { RequestMethod } from 'node-mocks-http';
import type { NextApiHandler } from 'next';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';

declare const jest: typeof import('@jest/globals').jest;

type Row = Record<string, unknown>;
type AdjustmentErrorCase = [label: string, body: Row, status: number, error: string];

const TEST_SECRET = 'test-secret-do-not-use-in-prod';
const USER_A = 'sga-user-a';
const USER_B = 'sga-user-b';
const GOALS_FILE = 'savings-goals.json';
const SAVINGS_FILE = 'savings.json';
const AUDIT_JOURNAL = 'audit_journal.json';

const ADJ_GOAL_ID = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const ADJ_ID = 'adj000000000000000000001';
const SEEDED_AT = '2026-10-01T00:00:00.000Z';
const ADJUSTMENT_KEYS = ['_id', 'amount', 'createdAt', 'note', 'updatedAt'];

// Same table as the Mongo describe in __tests__/api/savings-goals.test.ts (mode parity).
const ADJUSTMENT_ERROR_CASES: AdjustmentErrorCase[] = [
  ['unknown action', { action: 'foo', goalId: ADJ_GOAL_ID }, 400, 'unknown action'],
  ['null action', { action: null, goalId: ADJ_GOAL_ID }, 400, 'unknown action'],
  ['missing goalId', { action: 'addAdjustment', amount: 10, note: 'x' }, 400, 'goalId required'],
  ['empty goalId', { action: 'addAdjustment', goalId: '', amount: 10, note: 'x' }, 400, 'goalId required'],
  ['object goalId', { action: 'addAdjustment', goalId: { $ne: null }, amount: 10, note: 'x' }, 400, 'goalId required'],
  ['id alias not accepted', { action: 'addAdjustment', id: ADJ_GOAL_ID, amount: 10, note: 'x' }, 400, 'goalId required'],
  ['edit missing adjustmentId', { action: 'editAdjustment', goalId: ADJ_GOAL_ID, amount: 10, note: 'x' }, 400, 'adjustmentId required'],
  ['delete object adjustmentId', { action: 'deleteAdjustment', goalId: ADJ_GOAL_ID, adjustmentId: { $ne: null } }, 400, 'adjustmentId required'],
  ['zero amount', { action: 'addAdjustment', goalId: ADJ_GOAL_ID, amount: 0, note: 'x' }, 400, 'amount must be a non-zero number'],
  ['dust amount', { action: 'addAdjustment', goalId: ADJ_GOAL_ID, amount: '0.001', note: 'x' }, 400, 'amount must be a non-zero number'],
  ['non-numeric amount', { action: 'editAdjustment', goalId: ADJ_GOAL_ID, adjustmentId: ADJ_ID, amount: 'abc', note: 'x' }, 400, 'amount must be a non-zero number'],
  ['boolean amount', { action: 'addAdjustment', goalId: ADJ_GOAL_ID, amount: true, note: 'x' }, 400, 'amount must be a non-zero number'],
  ['overflowing amount (H-4)', { action: 'addAdjustment', goalId: ADJ_GOAL_ID, amount: 1e307, note: 'x' }, 400, 'amount must be a non-zero number'],
  ['amount above cap', { action: 'addAdjustment', goalId: ADJ_GOAL_ID, amount: -10000000, note: 'x' }, 400, 'amount too large'],
  // tester supplement (Stage 4): cap + H-4 on edit, check order, trimmed length on edit
  ['edit amount above cap', { action: 'editAdjustment', goalId: ADJ_GOAL_ID, adjustmentId: ADJ_ID, amount: '10,000,000', note: 'x' }, 400, 'amount too large'],
  ['edit overflowing amount string (H-4)', { action: 'editAdjustment', goalId: ADJ_GOAL_ID, adjustmentId: ADJ_ID, amount: '1e307', note: 'x' }, 400, 'amount must be a non-zero number'],
  ['huge finite amount hits cap, not overflow', { action: 'addAdjustment', goalId: ADJ_GOAL_ID, amount: 1.7e306, note: 'x' }, 400, 'amount too large'],
  ['cap checked before note', { action: 'addAdjustment', goalId: ADJ_GOAL_ID, amount: 10000000, note: '' }, 400, 'amount too large'],
  ['edit note too long', { action: 'editAdjustment', goalId: ADJ_GOAL_ID, adjustmentId: ADJ_ID, amount: 10, note: '  ' + 'x'.repeat(121) + '  ' }, 400, 'note too long'],
  ['400 before 404: bad amount on unknown goal', { action: 'addAdjustment', goalId: 'bbbbbbbbbbbbbbbbbbbbbbbb', amount: 'abc', note: 'x' }, 400, 'amount must be a non-zero number'],
  ['blank note', { action: 'addAdjustment', goalId: ADJ_GOAL_ID, amount: 10, note: '   ' }, 400, 'note required'],
  ['missing note', { action: 'addAdjustment', goalId: ADJ_GOAL_ID, amount: 10 }, 400, 'note required'],
  ['note too long', { action: 'addAdjustment', goalId: ADJ_GOAL_ID, amount: 10, note: 'x'.repeat(121) }, 400, 'note too long'],
  ['unknown goal', { action: 'addAdjustment', goalId: 'bbbbbbbbbbbbbbbbbbbbbbbb', amount: 10, note: 'x' }, 404, 'Goal not found'],
  ['edit unknown adjustment', { action: 'editAdjustment', goalId: ADJ_GOAL_ID, adjustmentId: 'nope', amount: 10, note: 'x' }, 404, 'Adjustment not found'],
  ['delete unknown adjustment', { action: 'deleteAdjustment', goalId: ADJ_GOAL_ID, adjustmentId: 'nope' }, 404, 'Adjustment not found'],
];

let handler: NextApiHandler;
let sessionCookie: typeof import('../../src/shared/utils/backend/sessionCookie');
let dir = '';

beforeAll(() => {
  process.env.SESSION_SECRET = TEST_SECRET;
  process.env.DATA_MODE = 'json';
  delete process.env.MONGODB_URI;
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'savings-goal-adj-json-'));
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
  fs.readdirSync(dir).forEach(name => fs.rmSync(path.join(dir, name), { recursive: true, force: true }));
});

function seededAdjustment(overrides: Row = {}): Row {
  return { _id: ADJ_ID, amount: 500, note: 'ยอดตกหล่น', createdAt: SEEDED_AT, updatedAt: SEEDED_AT, ...overrides };
}

/** Same shape JSON-mode POST writes (no stored currentAmount/metadata), plus optional overrides. */
function makeGoal(overrides: Row = {}, userId = USER_A): Row {
  return {
    _id: ADJ_GOAL_ID,
    userId,
    goalName: 'ทองคำ',
    description: null,
    targetAmount: 10000,
    currency: 'THB',
    category: 'other',
    priority: 'medium',
    status: 'active',
    endDate: null,
    notes: null,
    allocationPercent: null,
    createdAt: SEEDED_AT,
    updatedAt: SEEDED_AT,
    ...overrides,
  };
}

function writeFile(name: string, data: unknown) {
  fs.writeFileSync(path.join(dir, name), JSON.stringify(data));
}

function seedGoal(overrides: Row = {}) {
  writeFile(GOALS_FILE, { [USER_A]: { goals: [makeGoal(overrides)] } });
}

function readFile(name: string): Row {
  const file = path.join(dir, name);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
}

function readGoal(userId = USER_A): Row | undefined {
  const bucket = readFile(GOALS_FILE)[userId] as { goals?: Row[] } | undefined;
  return bucket?.goals?.find(g => g._id === ADJ_GOAL_ID);
}

function auditEvents(): Row[] {
  return (readFile(AUDIT_JOURNAL).events as Row[] | undefined) ?? [];
}

async function call(method: RequestMethod, body?: Row, userId = USER_A) {
  const { signSession, createSessionId, signCsrfToken, SESSION_COOKIE_NAME } = sessionCookie;
  const sid = createSessionId();
  const mutating = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);
  const { req, res } = createMocks({
    method,
    body,
    cookies: { [SESSION_COOKIE_NAME]: signSession(userId, sid) },
    headers: mutating ? { 'x-csrf-token': signCsrfToken(sid) } : {},
  });
  await handler(req, res);
  const raw = res._getData();
  return { status: res._getStatusCode(), body: raw ? JSON.parse(raw) : null };
}

const put = (body: Row, userId = USER_A) => call('PUT', body, userId);

async function getGoal() {
  const res = await call('GET');
  expect(res.status).toBe(200);
  return res.body.goals.find((g: Row) => g._id === ADJ_GOAL_ID);
}

describe('/api/savings-goals adjustments (JSON mode)', () => {
  // --- GET formula ---

  it('AC-SGA-01/04: currentAmount = savings sum + rounded adjustments total', async () => {
    seedGoal({ adjustments: [seededAdjustment({ amount: 0.1 }), seededAdjustment({ _id: 'adj2', amount: 0.2 })] });
    writeFile(SAVINGS_FILE, { [USER_A]: { '2026-01': { savings_list: [{ savings_type: 'ทองคำ', savings_amount: 3000 }] } } });

    const goal = await getGoal();
    expect(goal.currentAmount).toBe(3000.3);
    expect(goal.metadata.adjustmentsTotal).toBe(0.3);
    expect(goal.adjustments).toHaveLength(2);
    expect(goal.metadata.progressPercentage).toBe(30);
  });

  it('AC-SGA-03/E-SGA-1: legacy goal gets adjustments [] / adjustmentsTotal 0 and unchanged numbers', async () => {
    seedGoal();
    writeFile(SAVINGS_FILE, { [USER_A]: { '2026-01': { savings_list: [{ savings_type: 'ทองคำ', savings_amount: '2,000.50' }] } } });

    const goal = await getGoal();
    expect(goal.adjustments).toEqual([]);
    expect(Object.is(goal.metadata.adjustmentsTotal, 0)).toBe(true);
    expect(goal.currentAmount).toBe(2000.5);
    expect(goal.metadata.progressPercentage).toBe(20.01);
    expect(goal.metadata.remainingAmount).toBe(7999.5);
  });

  it('AC-SGA-05: negative currentAmount is not clamped', async () => {
    seedGoal({ adjustments: [seededAdjustment({ amount: -2000 })] });

    const goal = await getGoal();
    expect(goal.currentAmount).toBe(-2000);
    expect(goal.metadata.remainingAmount).toBe(12000);
    expect(goal.metadata.progressPercentage).toBe(-20);
  });

  it('AC-SGA-06 + H-2: junk stored adjustments/metadata.adjustmentsTotal are normalized in the response', async () => {
    seedGoal({
      adjustments: [seededAdjustment({ amount: 100 }), null, 'junk', { _id: '', amount: 5, note: 'x' }],
      metadata: { adjustmentsTotal: 999 },
    });

    const goal = await getGoal();
    expect(goal.adjustments).toEqual([seededAdjustment({ amount: 100 })]);
    expect(goal.metadata.adjustmentsTotal).toBe(100);
    expect(goal.currentAmount).toBe(100);
  });

  it.each([[null], [{ a: 1 }], ['abc']])('E-SGA-2: non-array stored adjustments %p reads as [] and the next add writes [entry]', async (stored) => {
    seedGoal({ adjustments: stored });
    expect((await getGoal()).adjustments).toEqual([]);

    const res = await put({ action: 'addAdjustment', goalId: ADJ_GOAL_ID, amount: 10, note: 'x' });
    expect(res.status).toBe(200);
    expect(readGoal()?.adjustments).toEqual([res.body.adjustment]);
  });

  // --- actions ---

  it('AC-SGA-07: addAdjustment appends an ISO-stamped entry; GET reflects it', async () => {
    seedGoal();

    const res = await put({ action: 'addAdjustment', goalId: ADJ_GOAL_ID, amount: '1,500.50', note: '  ยอดตกหล่น  ' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const adjustment = res.body.adjustment;
    expect(Object.keys(adjustment).sort()).toEqual(ADJUSTMENT_KEYS);
    expect(adjustment).toMatchObject({ amount: 1500.5, note: 'ยอดตกหล่น' });
    expect(adjustment._id).toMatch(/^[0-9a-f]{24}$/);
    expect(adjustment.createdAt).toBe(adjustment.updatedAt);

    const stored = readGoal();
    expect(stored?.adjustments).toEqual([adjustment]);
    expect(stored?.updatedAt).toBe(adjustment.updatedAt);

    const goal = await getGoal();
    expect(goal.currentAmount).toBe(1500.5);
    expect(auditEvents()).toHaveLength(1);
  });

  it('AC-SGA-08: editAdjustment replaces amount/note only, bumps updatedAt, keeps _id/createdAt/position', async () => {
    const first = seededAdjustment({ _id: 'first' });
    const last = seededAdjustment({ _id: 'last' });
    seedGoal({ adjustments: [first, seededAdjustment(), last] });

    const res = await put({ action: 'editAdjustment', goalId: ADJ_GOAL_ID, adjustmentId: ADJ_ID, amount: -42.5, note: 'แก้' });

    expect(res.status).toBe(200);
    expect(Object.keys(res.body.adjustment).sort()).toEqual(ADJUSTMENT_KEYS);
    expect(res.body.adjustment).toMatchObject({ _id: ADJ_ID, amount: -42.5, note: 'แก้', createdAt: SEEDED_AT });
    expect(res.body.adjustment.updatedAt).not.toBe(SEEDED_AT);
    expect(readGoal()?.adjustments).toEqual([first, res.body.adjustment, last]);
  });

  it('AC-SGA-09: deleteAdjustment removes exactly that entry', async () => {
    const keep = seededAdjustment({ _id: 'keep' });
    seedGoal({ adjustments: [seededAdjustment(), keep] });

    const res = await put({ action: 'deleteAdjustment', goalId: ADJ_GOAL_ID, adjustmentId: ADJ_ID });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
    expect(readGoal()?.adjustments).toEqual([keep]);
  });

  it.each(ADJUSTMENT_ERROR_CASES)('AC-SGA-10/13: %s → exact error, file unchanged, no audit event', async (_label, body, status, error) => {
    seedGoal({ adjustments: [seededAdjustment()] });
    const before = readFile(GOALS_FILE);

    const res = await put(body);

    expect(res.status).toBe(status);
    expect(res.body).toEqual({ error });
    expect(readFile(GOALS_FILE)).toEqual(before);
    expect(auditEvents()).toEqual([]);
  });

  it('AC-SGA-11: cross-user access → 404, both users\' data unchanged', async () => {
    writeFile(GOALS_FILE, {
      [USER_A]: { goals: [makeGoal({ adjustments: [seededAdjustment()] })] },
      [USER_B]: { goals: [] },
    });
    const before = readFile(GOALS_FILE);

    for (const body of [
      { action: 'addAdjustment', goalId: ADJ_GOAL_ID, amount: 10, note: 'x' },
      { action: 'editAdjustment', goalId: ADJ_GOAL_ID, adjustmentId: ADJ_ID, amount: 10, note: 'x' },
      { action: 'deleteAdjustment', goalId: ADJ_GOAL_ID, adjustmentId: ADJ_ID },
    ]) {
      const res = await put(body, USER_B);
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: 'Goal not found' });
    }
    expect(readFile(GOALS_FILE)).toEqual(before);
  });

  it('AC-SGA-12 + H-1: client extra fields are ignored; only adjustments + updatedAt change', async () => {
    seedGoal();
    const before = readGoal() as Row;

    const res = await put({
      action: 'addAdjustment',
      goalId: ADJ_GOAL_ID,
      amount: 100,
      note: 'x',
      currentAmount: 999999,
      _id: 'evil',
      createdAt: '2000-01-01T00:00:00.000Z',
      goalName: 'renamed',
      targetAmount: 1,
      allocations: [{ goalId: ADJ_GOAL_ID, allocationPercent: 50 }],
      adjustmentsTotal: 5,
      metadata: { adjustmentsTotal: 5 },
    });

    expect(res.status).toBe(200);
    expect(res.body.adjustment._id).not.toBe('evil');
    const stored = readGoal() as Row;
    const { adjustments, updatedAt, ...rest } = stored;
    const { updatedAt: beforeUpdatedAt, ...beforeRest } = before;
    expect(rest).toEqual(beforeRest);
    expect(adjustments).toEqual([res.body.adjustment]);
    expect(updatedAt).not.toBe(beforeUpdatedAt);
    expect(stored).not.toHaveProperty('adjustmentsTotal');
    expect(stored).not.toHaveProperty('currentAmount');
    expect(stored).not.toHaveProperty('metadata');
  });

  it('AC-SGA-14/E-SGA-12: 121st add → 409; edit and delete still work at the cap', async () => {
    seedGoal({ adjustments: Array.from({ length: 120 }, (_, i) => seededAdjustment({ _id: `adj${i}` })) });
    const before = readFile(GOALS_FILE);

    const add = await put({ action: 'addAdjustment', goalId: ADJ_GOAL_ID, amount: 1, note: 'x' });
    expect(add.status).toBe(409);
    expect(add.body).toEqual({ error: 'adjustment limit reached (120)' });
    expect(readFile(GOALS_FILE)).toEqual(before);

    expect((await put({ action: 'editAdjustment', goalId: ADJ_GOAL_ID, adjustmentId: 'adj7', amount: 2, note: 'y' })).status).toBe(200);
    expect((await put({ action: 'deleteAdjustment', goalId: ADJ_GOAL_ID, adjustmentId: 'adj7' })).status).toBe(200);
    expect(readGoal()?.adjustments as unknown[]).toHaveLength(119);
  });

  it('AC-SGA-16: existing single-goal PUT (no action) behaves as before and leaves adjustments alone', async () => {
    seedGoal({ adjustments: [seededAdjustment()] });

    const res = await put({ goalId: ADJ_GOAL_ID, goalName: 'ทองคำแท่ง' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
    expect(readGoal()?.goalName).toBe('ทองคำแท่ง');
    expect(readGoal()?.adjustments).toEqual([seededAdjustment()]);
  });

  it('E-SGA-14: action + allocations → action runs, allocations ignored', async () => {
    seedGoal();

    const res = await put({ action: 'addAdjustment', goalId: ADJ_GOAL_ID, amount: 10, note: 'x', allocations: [{ goalId: ADJ_GOAL_ID, allocationPercent: 40 }] });

    expect(res.status).toBe(200);
    expect(readGoal()?.allocationPercent).toBeNull();
  });

  // ---- tester supplement (Stage 4) ----

  it('cap boundary: ±9,999,999.99 accepted on add and edit (both signs, comma string)', async () => {
    seedGoal();

    const add = await put({ action: 'addAdjustment', goalId: ADJ_GOAL_ID, amount: '9,999,999.99', note: 'max' });
    expect(add.status).toBe(200);
    expect(add.body.adjustment.amount).toBe(9999999.99);

    const edit = await put({ action: 'editAdjustment', goalId: ADJ_GOAL_ID, adjustmentId: add.body.adjustment._id, amount: -9999999.99, note: 'min' });
    expect(edit.status).toBe(200);
    expect(edit.body.adjustment.amount).toBe(-9999999.99);
    expect((readGoal())?.adjustments).toEqual([edit.body.adjustment]);
  });

  it('cross-user access writes no audit event', async () => {
    seedGoal();
    for (const body of [
      { action: 'addAdjustment', goalId: ADJ_GOAL_ID, amount: 10, note: 'x' },
      { action: 'editAdjustment', goalId: ADJ_GOAL_ID, adjustmentId: 'whatever', amount: 10, note: 'x' },
      { action: 'deleteAdjustment', goalId: ADJ_GOAL_ID, adjustmentId: 'whatever' },
    ]) {
      expect((await put(body, USER_B)).status).toBe(404);
    }
    expect(auditEvents().length).toBe(0);
  });
});

