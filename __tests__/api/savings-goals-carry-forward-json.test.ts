/** @jest-environment node */
// savings-loan-withdrawal S2c, dispatch 5: GET /api/savings-goals (JSON mode) reads savings +
// carry-forward through loadLedgerContext's revision bracket (architecture-review-s2c C-S2c-4,
// C-S2c-10, F-2). Real JSON store in a temp AUDIT_DATA_DIR. The only test double is a pass-through
// wrapper on userUtils.getUserData: when armed, it runs a hook just before each `savings.json` read,
// which the bracket tests use to apply a prune "from another process" mid-read. Unarmed it does
// nothing, so the surfacing and race tests run against unmodified behaviour.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createMocks } from 'node-mocks-http';
import type { NextApiHandler } from 'next';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';

declare const jest: typeof import('@jest/globals').jest;

type Row = Record<string, unknown>;
type Item = { savings_type: string; savings_amount: number };
type UserUtils = typeof import('../../src/backend/data/userUtils');
type GoalBody = { _id: string; currentAmount: number };

const TEST_SECRET = 'test-secret-do-not-use-in-prod';
const USER_A = 'slw-goals-cf-json-user-a';
const USER_B = 'slw-goals-cf-json-user-b';
const GOAL_ID = 'd0d0d0d0d0d0d0d0d0d0d0d0';
const OTHER_GOAL_ID = 'd1d1d1d1d1d1d1d1d1d1d1d1';
const CF_FILE = 'savings-carry-forward.json';
const SAVINGS_FILE = 'savings.json';

/** Armed by the bracket tests; runs before each savings.json read. */
let beforeSavingsRead: (() => void) | null = null;
let savingsReadCount = 0;

let dir = '';
let goalsHandler: NextApiHandler;
let loansHandler: NextApiHandler;
let savingsHandler: NextApiHandler;
let sessionCookie: typeof import('../../src/shared/utils/backend/sessionCookie');

beforeAll(() => {
  process.env.SESSION_SECRET = TEST_SECRET;
  process.env.DATA_MODE = 'json';
  delete process.env.MONGODB_URI;
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slw-goals-cf-json-'));
  process.env.AUDIT_DATA_DIR = dir;

  jest.resetModules();
  jest.doMock('../../src/backend/data/userUtils', () => {
    const actual = jest.requireActual('../../src/backend/data/userUtils') as UserUtils;
    return {
      ...actual,
      getUserData: (filename: string, userId: string) => {
        if (filename === SAVINGS_FILE && beforeSavingsRead) {
          savingsReadCount += 1;
          beforeSavingsRead();
        }
        return actual.getUserData(filename, userId);
      }
    };
  });
  goalsHandler = require('../../pages/api/savings-goals').default;
  loansHandler = require('../../pages/api/savings-loans').default;
  savingsHandler = require('../../pages/api/savings').default;
  sessionCookie = require('../../src/shared/utils/backend/sessionCookie');
});

afterAll(() => {
  delete process.env.AUDIT_DATA_DIR;
  fs.rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  beforeSavingsRead = null;
  savingsReadCount = 0;
  fs.readdirSync(dir).forEach(name => fs.rmSync(path.join(dir, name), { recursive: true, force: true }));
});

afterEach(() => {
  jest.restoreAllMocks();
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

async function goalAmount(goalId = GOAL_ID, userId = USER_A): Promise<number> {
  const res = await call(goalsHandler, 'GET', undefined, userId);
  expect(res.status).toBe(200);
  const goal = (res.body.goals as GoalBody[]).find(g => g._id === goalId);
  expect(goal).toBeDefined();
  return goal!.currentAmount;
}

async function poolBalance(userId = USER_A): Promise<number> {
  const res = await call(loansHandler, 'GET', undefined, userId);
  expect(res.status).toBe(200);
  return res.body.summary.poolBalance;
}

function readJsonFile(name: string): Record<string, Row> {
  const file = path.join(dir, name);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
}

function writeJsonFile(name: string, data: unknown) {
  fs.writeFileSync(path.join(dir, name), JSON.stringify(data));
}

/** `count` consecutive months ending at 2026-03, oldest first. */
function monthKeys(count: number, newest = '2026-03'): string[] {
  const [y, m] = newest.split('-').map(Number);
  const keys: string[] = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    keys.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  return keys;
}

const matched = (amount: number): Item => ({ savings_type: 'เที่ยว', savings_amount: amount });
const plain = (amount: number): Item => ({ savings_type: 'ทั่วไป', savings_amount: amount });

function seedCarryForward(userId: string, bucket: Row) {
  writeJsonFile(CF_FILE, { ...readJsonFile(CF_FILE), [userId]: bucket });
}

/**
 * 15 months 2025-01 … 2026-03. The oldest holds a goal-matched 1000 and an unmatched 250.5; each
 * other month holds 100 matched + 100 unmatched. Goal = 1000 + 14·100 = 2400; pool = 1250.5 + 14·200 = 4050.5.
 */
function seedStandard(userId = USER_A) {
  const keys = monthKeys(15);
  const bucket = Object.fromEntries(keys.map((month, i) => [month, {
    month,
    savings_list: i === 0 ? [matched(1000), plain(250.5)] : [matched(100), plain(100)]
  }]));
  writeJsonFile(SAVINGS_FILE, { ...readJsonFile(SAVINGS_FILE), [userId]: bucket });
  writeJsonFile('savings-goals.json', {
    ...readJsonFile('savings-goals.json'),
    [userId]: {
      goals: [
        { _id: GOAL_ID, goalName: 'เที่ยว', targetAmount: 50000, status: 'active' },
        { _id: OTHER_GOAL_ID, goalName: 'บ้าน', targetAmount: 50000, status: 'active' }
      ]
    }
  });
  return keys;
}
const STANDARD_GOAL = 2400;
const STANDARD_POOL = 4050.5;

function sumItems(items: Item[], goalOnly: boolean): number {
  return items
    .filter(i => !goalOnly || i.savings_type === 'เที่ยว')
    .reduce((sum, i) => sum + i.savings_amount, 0);
}

/**
 * Stands in for a pruning commit landing mid-read: removes the user's oldest month from
 * savings.json and credits it to the carry-forward bucket (pool + goal, prunedMonths appended).
 * Applied before the savings read it precedes, so that read already sees the month gone.
 */
function commitConcurrentPrune(userId = USER_A): void {
  const savings = readJsonFile(SAVINGS_FILE);
  const bucket = { ...(savings[userId] as Record<string, { savings_list: Item[] }>) };
  const oldest = Object.keys(bucket).sort()[0];
  const list = bucket[oldest].savings_list;
  delete bucket[oldest];
  writeJsonFile(SAVINGS_FILE, { ...savings, [userId]: bucket });

  const current = (readJsonFile(CF_FILE)[userId] ?? {}) as Row;
  const goalAmounts = { ...((current.goalAmounts as Record<string, number>) ?? {}) };
  goalAmounts[GOAL_ID] = (goalAmounts[GOAL_ID] ?? 0) + sumItems(list, true);
  seedCarryForward(userId, {
    poolAmount: Math.round((((current.poolAmount as number) ?? 0) + sumItems(list, false)) * 100) / 100,
    goalAmounts,
    goalAudit: {},
    prunedMonths: [...((current.prunedMonths as string[]) ?? []), oldest],
    updatedAt: new Date().toISOString()
  });
}

// ---- carry-forward surfaced by GET ----

describe('GET /api/savings-goals (JSON) — carry-forward credit enters currentAmount', () => {
  it('adds a stored goalAmounts credit to the matching goal only', async () => {
    seedStandard();
    seedCarryForward(USER_A, {
      poolAmount: 900, goalAmounts: { [GOAL_ID]: 700.25 }, goalAudit: {},
      prunedMonths: ['2024-12'], updatedAt: '2026-01-01T00:00:00.000Z'
    });

    expect(await goalAmount(GOAL_ID)).toBe(STANDARD_GOAL + 700.25);
    expect(await goalAmount(OTHER_GOAL_ID)).toBe(0);
  });

  it('without a carry-forward bucket the result is the S2 value', async () => {
    seedStandard();

    expect(await goalAmount(GOAL_ID)).toBe(STANDARD_GOAL);
  });

  it('is user-scoped: another user\'s carry-forward never reaches this user', async () => {
    seedStandard();
    seedCarryForward(USER_B, {
      poolAmount: 5, goalAmounts: { [GOAL_ID]: 5 }, goalAudit: {},
      prunedMonths: ['2024-12'], updatedAt: '2026-01-01T00:00:00.000Z'
    });

    expect(await goalAmount(GOAL_ID)).toBe(STANDARD_GOAL);
  });

  it('end to end: a pruning POST leaves the goal currentAmount unchanged (AC-SLW-38, C-S2c-8)', async () => {
    const keys = seedStandard();
    const before = await goalAmount(GOAL_ID);

    expect((await call(savingsHandler, 'POST', { month: '2026-04', savings_list: [] })).status).toBe(201);

    expect(Object.keys(readJsonFile(SAVINGS_FILE)[USER_A])).not.toContain(keys[0]);
    expect(await goalAmount(GOAL_ID)).toBeCloseTo(before, 2);
  });
});

// ---- F-2 / C-S2c-10: the revision bracket protects the GETs ----

describe('GET (JSON) — revision bracket against a prune landing mid-read (F-2)', () => {
  it('a prune landing between the carry-forward read and the savings read is retried, not mis-paired', async () => {
    seedStandard();
    let commits = 0;
    beforeSavingsRead = () => {
      if (commits === 0) {
        commits += 1;
        commitConcurrentPrune();
      }
    };

    // Unbracketed, attempt 1 would pair "carry-forward without M" with "savings without M": the goal
    // would lose M's 1000. The bracket sees the revision change and re-reads a consistent pair.
    expect(await goalAmount(GOAL_ID)).toBe(STANDARD_GOAL);
    expect(savingsReadCount).toBe(2);
  });

  it('the same protection covers GET /api/savings-loans (pool figures)', async () => {
    seedStandard();
    let commits = 0;
    beforeSavingsRead = () => {
      if (commits === 0) {
        commits += 1;
        commitConcurrentPrune();
      }
    };

    expect(await poolBalance()).toBe(STANDARD_POOL);
    expect(savingsReadCount).toBe(2);
  });

  it('a carry-forward that keeps changing makes GET /api/savings-goals answer 500 after 3 attempts', async () => {
    seedStandard();
    beforeSavingsRead = () => commitConcurrentPrune();
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    const res = await call(goalsHandler, 'GET');

    expect(res).toEqual({ status: 500, body: { error: 'Internal server error' } });
    expect(savingsReadCount).toBe(3);
    expect(errorSpy).toHaveBeenCalledWith('savings-goals GET failed', 'carry-forward changed during read');
  });

  it('an undisturbed GET reads savings exactly once', async () => {
    seedStandard();
    beforeSavingsRead = () => undefined;

    expect(await goalAmount(GOAL_ID)).toBe(STANDARD_GOAL);
    expect(savingsReadCount).toBe(1);
  });

  it('race: one pruning POST and 20 GETs in flight together all see the pre-POST balances', async () => {
    seedStandard();
    const goalBefore = await goalAmount(GOAL_ID);
    const poolBefore = await poolBalance();

    const post = call(savingsHandler, 'POST', { month: '2026-04', savings_list: [] });
    const gets = Array.from({ length: 20 }, (_, i) =>
      call(i % 2 === 0 ? goalsHandler : loansHandler, 'GET'));
    const [postRes, ...getRes] = await Promise.all([post, ...gets]);

    expect(postRes.status).toBe(201);
    getRes.forEach((res, i) => {
      expect(res.status).toBe(200);
      if (i % 2 === 0) {
        const goal = (res.body.goals as GoalBody[]).find(g => g._id === GOAL_ID)!;
        expect(goal.currentAmount).toBeCloseTo(goalBefore, 2);
      } else {
        expect(res.body.summary.poolBalance).toBeCloseTo(poolBefore, 2);
      }
    });
  });
});
