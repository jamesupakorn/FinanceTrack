/** @jest-environment node */
// savings-loan-withdrawal S2c, dispatch 3: JSON-mode pre-prune carry-forward hook in POST /api/savings
// (spec §5.3, §5.8 A-1/A-2/A-4; architecture-review-s2c C-S2c-2, C-S2c-11). Real JSON store + audit
// journal in a temp AUDIT_DATA_DIR; nothing is mocked. Both POST branches (normal save, transfer).
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createMocks } from 'node-mocks-http';
import type { NextApiHandler } from 'next';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';

declare const jest: typeof import('@jest/globals').jest;

type Row = Record<string, unknown>;
type Item = { savings_type: string; savings_amount: number; transferKey?: string };

const TEST_SECRET = 'test-secret-do-not-use-in-prod';
const USER_A = 'slw-cf-json-user-a';
const USER_B = 'slw-cf-json-user-b';
const GOAL_ID = 'c0c0c0c0c0c0c0c0c0c0c0c0';
const ABANDONED_GOAL_ID = 'c1c1c1c1c1c1c1c1c1c1c1c1';
const CF_FILE = 'savings-carry-forward.json';
const SAVINGS_FILE = 'savings.json';

let dir = '';
let savingsHandler: NextApiHandler;
let loansHandler: NextApiHandler;
let sessionCookie: typeof import('../../src/shared/utils/backend/sessionCookie');
let jsonStore: typeof import('../../lib/auditJsonStore');

beforeAll(() => {
  process.env.SESSION_SECRET = TEST_SECRET;
  process.env.DATA_MODE = 'json';
  delete process.env.MONGODB_URI;
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slw-cf-json-'));
  process.env.AUDIT_DATA_DIR = dir;

  jest.resetModules();
  savingsHandler = require('../../pages/api/savings').default;
  loansHandler = require('../../pages/api/savings-loans').default;
  sessionCookie = require('../../src/shared/utils/backend/sessionCookie');
  jsonStore = require('../../lib/auditJsonStore');
});

afterAll(() => {
  delete process.env.AUDIT_DATA_DIR;
  fs.rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  jsonStore.jsonTestHooks.beforeAuditAppend = undefined;
  fs.readdirSync(dir).forEach(name => fs.rmSync(path.join(dir, name), { recursive: true, force: true }));
});

// ---- helpers ----

async function call(handler: NextApiHandler, method: 'GET' | 'POST', body?: unknown, userId = USER_A) {
  const { signSession, createSessionId, signCsrfToken, SESSION_COOKIE_NAME } = sessionCookie;
  const sid = createSessionId();
  const { req, res } = createMocks({
    method,
    body: body as never,
    cookies: { [SESSION_COOKIE_NAME]: signSession(userId, sid) },
    headers: { 'x-csrf-token': signCsrfToken(sid) }
  });
  await handler(req as never, res as never);
  const raw = res._getData();
  return { status: res._getStatusCode(), body: raw ? JSON.parse(raw) : null };
}

const postSavings = (body: unknown, userId = USER_A) => call(savingsHandler, 'POST', body, userId);

async function poolBalance(userId = USER_A): Promise<number> {
  const res = await call(loansHandler, 'GET', undefined, userId);
  expect(res.status).toBe(200);
  return res.body.summary.poolBalance;
}

function readJsonFile(name: string): Record<string, Row> {
  const file = path.join(dir, name);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
}

function rawFile(name: string): string | null {
  const file = path.join(dir, name);
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
}

function writeJsonFile(name: string, data: unknown) {
  fs.writeFileSync(path.join(dir, name), JSON.stringify(data));
}

function monthDoc(month: string, items: Item[]) {
  return { month, savings_list: items };
}

/** `count` consecutive months ending at 2026-03 (oldest first): 2026-03 back. */
function monthKeys(count: number, newest = '2026-03'): string[] {
  const [y, m] = newest.split('-').map(Number);
  const keys: string[] = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    keys.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  return keys;
}

function seedSavings(userId: string, docs: Array<{ month: string; savings_list: Item[] }>) {
  writeJsonFile(SAVINGS_FILE, { ...readJsonFile(SAVINGS_FILE), [userId]: Object.fromEntries(docs.map(d => [d.month, d])) });
}

function seedGoals(userId: string, goals: Row[]) {
  writeJsonFile('savings-goals.json', { ...readJsonFile('savings-goals.json'), [userId]: { goals } });
}

function seedCarryForward(userId: string, bucket: Row) {
  writeJsonFile(CF_FILE, { ...readJsonFile(CF_FILE), [userId]: bucket });
}

const savingsMonths = (userId = USER_A) => Object.keys(readJsonFile(SAVINGS_FILE)[userId] ?? {}).sort();
const carryForward = (userId = USER_A) => readJsonFile(CF_FILE)[userId] as Row | undefined;

/**
 * 15 months 2025-01 … 2026-03. The oldest, 2025-01, holds a goal-matched 1000 and an unmatched
 * 250.5; the others hold 100 of unmatched savings each.
 */
function seedStandard(userId = USER_A) {
  const keys = monthKeys(15);
  seedSavings(userId, keys.map((key, i) => (i === 0
    ? monthDoc(key, [{ savings_type: 'เที่ยว', savings_amount: 1000 }, { savings_type: 'ทั่วไป', savings_amount: 250.5 }])
    : monthDoc(key, [{ savings_type: 'ทั่วไป', savings_amount: 100 }]))));
  seedGoals(userId, [
    { _id: GOAL_ID, goalName: ' เที่ยว ', targetAmount: 50000, status: 'active' },
    { _id: ABANDONED_GOAL_ID, goalName: 'เที่ยว', targetAmount: 1, status: 'abandoned' }
  ]);
  return keys;
}

// ---- normal-save branch ----

describe('POST /api/savings (JSON) — normal save prunes and carries forward', () => {
  it('credits a pruned month with real content to the pool and the matching goal, atomically with the prune', async () => {
    seedStandard();

    const res = await postSavings({ month: '2026-04', savings_list: [{ savings_type: 'ทั่วไป', savings_amount: 1 }] });

    expect(res).toEqual({ status: 201, body: { success: true } });
    expect(savingsMonths()).toHaveLength(15);
    expect(savingsMonths()).not.toContain('2025-01');
    expect(savingsMonths()).toContain('2026-04');
    const cf = carryForward()!;
    expect(cf).toEqual({
      poolAmount: 1250.5,
      goalAmounts: { [GOAL_ID]: 1000 },
      goalAudit: { [GOAL_ID]: { goalNameAtPrune: ' เที่ยว ', lastPrunedAt: expect.any(String) } },
      prunedMonths: ['2025-01'],
      updatedAt: expect.any(String)
    });
    expect(cf).not.toHaveProperty('_id');
    expect(cf).not.toHaveProperty('userId');
  });

  it('leaves the pool balance unchanged by the prune (only the new month adds)', async () => {
    seedStandard();
    const before = await poolBalance();

    await postSavings({ month: '2026-04', savings_list: [] });

    expect(await poolBalance()).toBeCloseTo(before, 2);
  });

  it('adds to an existing carry-forward and keeps earlier entries', async () => {
    seedStandard();
    seedCarryForward(USER_A, {
      poolAmount: 10,
      goalAmounts: { other: 5, [GOAL_ID]: 2.25 },
      goalAudit: {},
      prunedMonths: ['2024-12'],
      updatedAt: '2026-01-01T00:00:00.000Z'
    });

    await postSavings({ month: '2026-04', savings_list: [] });

    expect(carryForward()).toMatchObject({
      poolAmount: 1260.5,
      goalAmounts: { other: 5, [GOAL_ID]: 1002.25 },
      prunedMonths: ['2024-12', '2025-01']
    });
  });

  it('a non-pruning save writes no carry-forward', async () => {
    seedStandard();

    await postSavings({ month: '2026-03', savings_list: [{ savings_type: 'ทั่วไป', savings_amount: 7 }] });

    expect(savingsMonths()).toHaveLength(15);
    expect(rawFile(CF_FILE)).toBeNull();
  });

  it('an all-empty pruned month is recorded with poolAmount 0 and no goal entry', async () => {
    const keys = monthKeys(15);
    seedSavings(USER_A, keys.map(key => monthDoc(key, [])));

    await postSavings({ month: '2026-04', savings_list: [] });

    expect(carryForward()).toMatchObject({ poolAmount: 0, goalAmounts: {}, prunedMonths: ['2025-01'] });
  });

  it('is scoped to the requesting user', async () => {
    seedStandard(USER_A);
    seedStandard(USER_B);

    await postSavings({ month: '2026-04', savings_list: [] }, USER_A);

    expect(carryForward(USER_A)).toMatchObject({ prunedMonths: ['2025-01'] });
    expect(carryForward(USER_B)).toBeUndefined();
    expect(savingsMonths(USER_B)).toContain('2025-01');
  });
});

// ---- F-6 / C-S2c-11 ----

describe('POST /api/savings (JSON) — own month (D-SLW-28 as amended, C-S2c-11)', () => {
  it('does NOT credit an own month the request created and its own prune deleted (E-SLW-32)', async () => {
    seedStandard();
    const savingsBefore = rawFile(SAVINGS_FILE);

    const res = await postSavings({ month: '2024-06', savings_list: [{ savings_type: 'เที่ยว', savings_amount: 999 }] });

    expect(res.status).toBe(201);
    expect(savingsMonths()).not.toContain('2024-06');
    // The 15 existing months are untouched (re-serialized, same content).
    expect(readJsonFile(SAVINGS_FILE)).toEqual(JSON.parse(savingsBefore!));
    expect(rawFile(CF_FILE)).toBeNull();
  });

  it('DOES credit a pre-existing own month that the same request prunes, with its post-write content', async () => {
    // 16 months (legacy data): the oldest, 2024-12, already exists and is visible.
    const keys = seedStandard();
    const store = readJsonFile(SAVINGS_FILE)[USER_A] as Row;
    store['2024-12'] = monthDoc('2024-12', [{ savings_type: 'เที่ยว', savings_amount: 300 }]);
    writeJsonFile(SAVINGS_FILE, { [USER_A]: store });
    expect(savingsMonths()).toHaveLength(16);
    expect(keys[0]).toBe('2025-01');
    const before = await poolBalance();

    const res = await postSavings({
      month: '2024-12',
      savings_list: [{ savings_type: 'เที่ยว', savings_amount: 400 }, { savings_type: 'ทั่วไป', savings_amount: 50 }]
    });

    expect(res.status).toBe(201);
    expect(savingsMonths()).toHaveLength(15);
    expect(savingsMonths()).not.toContain('2024-12');
    expect(carryForward()).toMatchObject({
      poolAmount: 450,
      goalAmounts: { [GOAL_ID]: 400 },
      prunedMonths: ['2024-12']
    });
    // poolBalance after = before − old(M) + new(M)
    expect(await poolBalance()).toBeCloseTo(before - 300 + 450, 2);
  });
});

// ---- idempotency ----

describe('POST /api/savings (JSON) — idempotency', () => {
  it('repeated saves do not re-credit', async () => {
    seedStandard();
    await postSavings({ month: '2026-04', savings_list: [] });
    const cfAfterFirst = rawFile(CF_FILE);

    await postSavings({ month: '2026-04', savings_list: [{ savings_type: 'ทั่วไป', savings_amount: 5 }] });
    await postSavings({ month: '2026-04', savings_list: [] });

    expect(rawFile(CF_FILE)).toBe(cfAfterFirst);
  });

  it('a month already in prunedMonths that reappears and is pruned again is not credited twice (A-1)', async () => {
    seedStandard();
    await postSavings({ month: '2026-04', savings_list: [] });
    const cfAfterFirst = rawFile(CF_FILE);
    // Legacy/concurrent re-creation of 2025-01 makes the store 16 months again.
    const store = readJsonFile(SAVINGS_FILE)[USER_A] as Row;
    store['2025-01'] = monthDoc('2025-01', [{ savings_type: 'เที่ยว', savings_amount: 77 }]);
    writeJsonFile(SAVINGS_FILE, { [USER_A]: store });

    await postSavings({ month: '2026-04', savings_list: [] });

    expect(savingsMonths()).not.toContain('2025-01');
    expect(rawFile(CF_FILE)).toBe(cfAfterFirst);
  });

  it('successive prunes each credit only their own month', async () => {
    seedStandard();
    await postSavings({ month: '2026-04', savings_list: [] });
    await postSavings({ month: '2026-05', savings_list: [] });

    expect(carryForward()).toMatchObject({
      poolAmount: 1350.5,
      goalAmounts: { [GOAL_ID]: 1000 },
      prunedMonths: ['2025-01', '2025-02']
    });
  });
});

// ---- transfer branch ----

describe('POST /api/savings (JSON) — transfer branch', () => {
  const transfer = (month: string, key: string, amount = 200) => ({ month, transfer: { amount, key } });

  it('a transfer that creates month 16 credits the pruned oldest month', async () => {
    seedStandard();

    const res = await postSavings(transfer('2026-04', 'tk-1'));

    expect(res).toEqual({ status: 201, body: { success: true, created: true } });
    expect(savingsMonths()).not.toContain('2025-01');
    expect(carryForward()).toMatchObject({
      poolAmount: 1250.5,
      goalAmounts: { [GOAL_ID]: 1000 },
      prunedMonths: ['2025-01']
    });
  });

  it('a transfer into a pre-existing, pruned own month credits it including the transfer item (C-S2c-11)', async () => {
    seedStandard();
    const store = readJsonFile(SAVINGS_FILE)[USER_A] as Row;
    store['2024-12'] = monthDoc('2024-12', [{ savings_type: 'ทั่วไป', savings_amount: 300 }]);
    writeJsonFile(SAVINGS_FILE, { [USER_A]: store });

    const res = await postSavings(transfer('2024-12', 'tk-2', 200));

    expect(res).toEqual({ status: 201, body: { success: true, created: true } });
    expect(savingsMonths()).not.toContain('2024-12');
    expect(carryForward()).toMatchObject({ poolAmount: 500, goalAmounts: {}, prunedMonths: ['2024-12'] });
  });

  it('a transfer that creates a month older than the window credits nothing (E-SLW-32)', async () => {
    seedStandard();

    const res = await postSavings(transfer('2024-06', 'tk-3'));

    expect(res.status).toBe(201);
    expect(savingsMonths()).not.toContain('2024-06');
    expect(rawFile(CF_FILE)).toBeNull();
  });

  it('an idempotent transfer returns early in JSON, prunes nothing and credits nothing (F-9)', async () => {
    seedStandard();
    const store = readJsonFile(SAVINGS_FILE)[USER_A] as Row;
    store['2024-12'] = monthDoc('2024-12', [
      { savings_type: 'ทั่วไป', savings_amount: 300, transferKey: 'tk-dup' }
    ]);
    writeJsonFile(SAVINGS_FILE, { [USER_A]: store });

    const res = await postSavings(transfer('2024-12', 'tk-dup'));

    expect(res).toEqual({ status: 201, body: { success: true, created: false } });
    expect(savingsMonths()).toHaveLength(16);
    expect(savingsMonths()).toContain('2024-12');
    expect(rawFile(CF_FILE)).toBeNull();
  });
});

// ---- atomicity and audit ----

describe('POST /api/savings (JSON) — atomicity and audit', () => {
  it('a failing commit leaves savings, the carry-forward and the audit journal untouched (AC-SLW-40)', async () => {
    seedStandard();
    const before = [SAVINGS_FILE, CF_FILE, 'audit_journal.json'].map(rawFile);
    jsonStore.jsonTestHooks.beforeAuditAppend = () => { throw new Error('boom'); };

    const res = await postSavings({ month: '2026-04', savings_list: [] });

    expect(res).toEqual({ status: 500, body: { error: 'Internal server error' } });
    expect([SAVINGS_FILE, CF_FILE, 'audit_journal.json'].map(rawFile)).toEqual(before);
  });

  it('records carry-forward audit events under source savings without amounts or goal names (C-S2c-7)', async () => {
    seedStandard();

    await postSavings({ month: '2026-04', savings_list: [] });

    const events = ((readJsonFile('audit_journal.json').events as unknown as Row[]) ?? [])
      .filter(e => e.resource === 'savings-carry-forward');
    expect(events.length).toBeGreaterThanOrEqual(1);
    events.forEach(event => {
      expect(event.source).toBe('savings');
      const text = JSON.stringify(event);
      expect(text).not.toContain('1250.5');
      expect(text).not.toContain('เที่ยว');
    });
  });
});
