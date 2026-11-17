/** @jest-environment node */
// savings-loan-withdrawal S2c, dispatch 2: the carry-forward read side (savingsCarryForward.ts readers) and its
// wiring into the ledger store.
// - `readConsistentWithCarryForward` (C-S2c-10 revision bracket) with collaborator stubs: one attempt when the
//   revision is stable, a retry on change, a throw after 3 changed brackets, and the returned carry-forward is the
//   one read in the accepted attempt.
// - `readCarryForward` in JSON and Mongo mode: absent → zeros, defensive normalization (C-S2c-4), user scoping.
// - `loadLedgerContext` sets `ctx.carryForward` iff `includeSavings`, from the bracketed read.
// - `computeLedgerSummary` / `computeAvailableBalance` pick up `ctx.carryForward` when present and are unchanged
//   without it.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { ObjectId, type Db } from 'mongodb';
import { MongoMemoryServer } from '../../../helpers/mongoReplSet';
import type { LedgerContext } from '../../../../src/shared/utils/backend/savingsLedgerStore';
import type { CarryForwardTotals } from '../../../../src/shared/utils/backend/savingsCarryForward';

type Mode = 'json' | 'mongo';
type StoreModule = typeof import('../../../../src/shared/utils/backend/savingsLedgerStore');
type CarryForwardModule = typeof import('../../../../src/shared/utils/backend/savingsCarryForward');

const USER_A = 'slw-cf-user-a';
const USER_B = 'slw-cf-user-b';
const GOAL_ID = 'c0c0c0c0c0c0c0c0c0c0c0c0';
const CF_COLLECTIONS = ['savingsCarryForward', 'savings', 'savingsGoals', 'savingsLoans', 'savingsWithdrawals'];

function totals(prunedMonths: string[], poolAmount = 0): CarryForwardTotals {
  return { poolAmount, goalAmounts: {}, prunedMonths };
}

// ---------------------------------------------------------------------------
// Pure bracket helper (collaborator stubs; no store I/O)
// ---------------------------------------------------------------------------

describe('readConsistentWithCarryForward (C-S2c-10)', () => {
  let carryForward: CarryForwardModule;

  beforeAll(() => {
    jest.resetModules();
    carryForward = require('../../../../src/shared/utils/backend/savingsCarryForward');
  });

  /** A carry-forward reader that returns the given states in order (the last one repeats). */
  function sequence(states: CarryForwardTotals[], log: string[]) {
    let index = 0;
    return jest.fn(async () => {
      log.push('cf');
      const state = states[Math.min(index, states.length - 1)];
      index += 1;
      return state;
    });
  }

  function savingsReader(log: string[]) {
    let attempt = 0;
    return jest.fn(async () => {
      log.push('savings');
      attempt += 1;
      return `savings-${attempt}`;
    });
  }

  it('returns after one attempt when the revision is unchanged, reading cf → savings → cf', async () => {
    const log: string[] = [];
    const cf = totals(['2024-01'], 100);
    const readCf = sequence([cf], log);
    const readSavings = savingsReader(log);

    const result = await carryForward.readConsistentWithCarryForward(readCf, readSavings);

    expect(result).toEqual({ value: 'savings-1', carryForward: cf });
    expect(log).toEqual(['cf', 'savings', 'cf']);
    expect(readSavings).toHaveBeenCalledTimes(1);
  });

  it('retries once on a changed revision and returns the second attempt\'s pair', async () => {
    const log: string[] = [];
    const stale = totals([], 0);
    const fresh = totals(['2024-01'], 100);
    // attempt 1: before=stale, after=fresh (changed) → retry; attempt 2: fresh, fresh → accept.
    const readCf = sequence([stale, fresh, fresh, fresh], log);
    const readSavings = savingsReader(log);

    const result = await carryForward.readConsistentWithCarryForward(readCf, readSavings);

    expect(result.value).toBe('savings-2');
    expect(result.carryForward).toBe(fresh);
    expect(readSavings).toHaveBeenCalledTimes(2);
    expect(log).toEqual(['cf', 'savings', 'cf', 'cf', 'savings', 'cf']);
  });

  it('returns the carry-forward read at the start of the accepted attempt', async () => {
    const log: string[] = [];
    const first = totals(['2024-01'], 100);
    const second = totals(['2024-01', '2024-02'], 250);
    const secondReread = totals(['2024-02', '2024-03'], 999); // same length, different object
    const readCf = sequence([first, second, second, secondReread], log);

    const result = await carryForward.readConsistentWithCarryForward(readCf, savingsReader(log));

    expect(result.value).toBe('savings-2');
    expect(result.carryForward).toBe(second);
  });

  it('throws after exactly 3 changed brackets and never returns a mismatched pair', async () => {
    const log: string[] = [];
    let revision = 0;
    const readCf = jest.fn(async () => {
      revision += 1;
      return totals(Array.from({ length: revision }, (_, i) => `m-${i}`));
    });
    const readSavings = savingsReader(log);

    await expect(carryForward.readConsistentWithCarryForward(readCf, readSavings))
      .rejects.toThrow('carry-forward changed during read');
    expect(readSavings).toHaveBeenCalledTimes(3);
    expect(readCf).toHaveBeenCalledTimes(6);
  });

  it('honours a custom maxAttempts', async () => {
    let revision = 0;
    const readCf = jest.fn(async () => totals(Array.from({ length: ++revision }, (_, i) => `m-${i}`)));
    const readSavings = jest.fn(async () => 'x');

    await expect(carryForward.readConsistentWithCarryForward(readCf, readSavings, 1)).rejects.toThrow();
    expect(readSavings).toHaveBeenCalledTimes(1);
  });

  it('propagates a failing read without retrying it', async () => {
    const readCf = jest.fn(async () => { throw new Error('db down'); });
    const readSavings = jest.fn(async () => 'x');

    await expect(carryForward.readConsistentWithCarryForward(readCf, readSavings)).rejects.toThrow('db down');
    expect(readSavings).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Dual-mode store reads
// ---------------------------------------------------------------------------

describe.each<Mode>(['json', 'mongo'])('carry-forward reads — %s mode', (mode) => {
  let store: StoreModule;
  let carryForward: CarryForwardModule;
  let dir = '';
  let mongod: MongoMemoryServer | null = null;
  let db: Db | null = null;

  beforeAll(async () => {
    if (mode === 'json') {
      process.env.DATA_MODE = 'json';
      delete process.env.MONGODB_URI;
      dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slw-cf-json-'));
      process.env.AUDIT_DATA_DIR = dir;
    } else {
      mongod = await MongoMemoryServer.create();
      process.env.MONGODB_URI = mongod.getUri();
      process.env.DATA_MODE = 'mongo';
      delete process.env.AUDIT_DATA_DIR;
    }
    jest.resetModules();
    store = require('../../../../src/shared/utils/backend/savingsLedgerStore');
    carryForward = require('../../../../src/shared/utils/backend/savingsCarryForward');
    if (mode === 'mongo') db = await require('../../../../lib/mongodb').getDbPromise();
  }, 60000);

  afterAll(async () => {
    if (mode === 'json') {
      delete process.env.AUDIT_DATA_DIR;
      fs.rmSync(dir, { recursive: true, force: true });
    }
    if (db?.client) await db.client.close();
    if (mongod) await mongod.stop();
  });

  beforeEach(async () => {
    if (mode === 'json') {
      fs.readdirSync(dir).forEach(name => fs.rmSync(path.join(dir, name), { recursive: true, force: true }));
    } else {
      for (const name of CF_COLLECTIONS) await db!.collection(name).deleteMany({});
    }
  });

  function readJsonFile(name: string): Record<string, unknown> {
    const file = path.join(dir, name);
    return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  }

  function writeJsonFile(name: string, data: unknown) {
    fs.writeFileSync(path.join(dir, name), JSON.stringify(data));
  }

  /** Stores a raw (possibly malformed) carry-forward for a user, bypassing every normalizer. */
  async function seedCarryForward(userId: string, raw: Record<string, unknown>) {
    if (mode === 'json') {
      writeJsonFile('savings-carry-forward.json', { ...readJsonFile('savings-carry-forward.json'), [userId]: raw });
      return;
    }
    await db!.collection('savingsCarryForward').insertOne({ ...raw, _id: userId, userId } as never);
  }

  async function seedSavings(userId: string, docs: Array<{ month: string; savings_list: unknown[] }>) {
    if (mode === 'json') {
      writeJsonFile('savings.json', {
        ...readJsonFile('savings.json'),
        [userId]: Object.fromEntries(docs.map(d => [d.month, d])),
      });
      return;
    }
    await db!.collection('savings').insertMany(docs.map(d => ({ ...d, userId })));
  }

  async function seedGoal(userId: string) {
    const goal = { _id: GOAL_ID, goalName: 'เที่ยว', targetAmount: 10000, status: 'active' };
    if (mode === 'json') {
      writeJsonFile('savings-goals.json', { ...readJsonFile('savings-goals.json'), [userId]: { goals: [goal] } });
      return;
    }
    await db!.collection('savingsGoals').insertOne({ ...goal, userId, _id: new ObjectId(GOAL_ID) });
  }

  describe('readCarryForward', () => {
    it('reads an absent carry-forward as zeros (DATA_MODEL invariant 7)', async () => {
      expect(await carryForward.readCarryForward(USER_A)).toEqual({ poolAmount: 0, goalAmounts: {}, prunedMonths: [] });
    });

    it('returns pool, goal amounts and pruned months as stored', async () => {
      await seedCarryForward(USER_A, {
        poolAmount: 1234.5,
        goalAmounts: { [GOAL_ID]: 300.25 },
        goalAudit: { [GOAL_ID]: { goalNameAtPrune: 'เที่ยว', lastPrunedAt: '2026-11-01T00:00:00.000Z' } },
        prunedMonths: ['2024-01', '2024-02'],
        updatedAt: '2026-11-01T00:00:00.000Z',
      });
      expect(await carryForward.readCarryForward(USER_A)).toEqual({
        poolAmount: 1234.5,
        goalAmounts: { [GOAL_ID]: 300.25 },
        prunedMonths: ['2024-01', '2024-02'],
      });
    });

    it('normalizes junk defensively (C-S2c-4)', async () => {
      await seedCarryForward(USER_A, {
        poolAmount: 'lots',
        goalAmounts: { [GOAL_ID]: 10, bad: 'x', nul: null, nested: { a: 1 } },
        prunedMonths: ['2024-01', '', 7, null, '2024-02'],
      });
      expect(await carryForward.readCarryForward(USER_A)).toEqual({
        poolAmount: 0,
        goalAmounts: { [GOAL_ID]: 10 },
        prunedMonths: ['2024-01', '2024-02'],
      });
    });

    it('reads non-object goalAmounts and non-array prunedMonths as empty', async () => {
      await seedCarryForward(USER_A, { poolAmount: 5, goalAmounts: [1, 2], prunedMonths: '2024-01' });
      expect(await carryForward.readCarryForward(USER_A)).toEqual({ poolAmount: 5, goalAmounts: {}, prunedMonths: [] });
    });

    it('never yields an inherited key for a goal id', async () => {
      await seedCarryForward(USER_A, { poolAmount: 1, goalAmounts: {}, prunedMonths: [] });
      const { goalAmounts } = await carryForward.readCarryForward(USER_A);
      expect(Object.hasOwn(goalAmounts, 'constructor')).toBe(false);
      expect(Object.keys(goalAmounts)).toEqual([]);
    });

    it('is scoped to one user', async () => {
      await seedCarryForward(USER_B, { poolAmount: 999, goalAmounts: { [GOAL_ID]: 9 }, prunedMonths: ['2024-01'] });
      expect(await carryForward.readCarryForward(USER_A)).toEqual({ poolAmount: 0, goalAmounts: {}, prunedMonths: [] });
    });

    it('rejects a missing or non-string userId', async () => {
      await expect(carryForward.readCarryForward('')).rejects.toThrow('savingsCarryForward: userId is required');
      await expect(carryForward.readCarryForward({ $ne: null })).rejects.toThrow('savingsCarryForward: userId is required');
    });
  });

  describe('loadLedgerContext carry-forward wiring (C-S2c-10)', () => {
    it('sets ctx.carryForward from the store when includeSavings is set', async () => {
      await seedCarryForward(USER_A, {
        poolAmount: 2000.5,
        goalAmounts: { [GOAL_ID]: 700.25, junk: 'x' },
        prunedMonths: ['2024-01', ''],
      });
      const ctx = await store.loadLedgerContext(USER_A, { includeSavings: true });
      expect(ctx.carryForward).toEqual({
        poolAmount: 2000.5,
        goalAmounts: { [GOAL_ID]: 700.25 },
        prunedMonths: ['2024-01'],
      });
    });

    it('reads an absent carry-forward as zeros', async () => {
      const ctx = await store.loadLedgerContext(USER_A, { includeSavings: true });
      expect(ctx.carryForward).toEqual({ poolAmount: 0, goalAmounts: {}, prunedMonths: [] });
    });

    it('does not set carryForward without includeSavings', async () => {
      await seedCarryForward(USER_A, { poolAmount: 5, goalAmounts: {}, prunedMonths: ['2024-01'] });
      expect('carryForward' in await store.loadLedgerContext(USER_A)).toBe(false);
      expect('carryForward' in await store.loadLedgerContext(USER_A, { includeGoals: true })).toBe(false);
    });

    it('is scoped to the caller', async () => {
      await seedCarryForward(USER_B, { poolAmount: 999, goalAmounts: { [GOAL_ID]: 9 }, prunedMonths: ['2024-01'] });
      const ctx = await store.loadLedgerContext(USER_A, { includeSavings: true });
      expect(ctx.carryForward).toEqual({ poolAmount: 0, goalAmounts: {}, prunedMonths: [] });
    });

    it('feeds the stored carry-forward into the balance functions end to end', async () => {
      await seedCarryForward(USER_A, { poolAmount: 2000.5, goalAmounts: { [GOAL_ID]: 700.25 }, prunedMonths: ['2024-01'] });
      await seedSavings(USER_A, [
        { month: '2026-10', savings_list: [{ savings_type: 'เที่ยว', savings_amount: 1000 }] },
        { month: '2026-11', savings_list: [{ savings_type: 'ทั่วไป', savings_amount: 500 }] },
      ]);
      await seedGoal(USER_A);
      const ctx = await store.loadLedgerContext(USER_A, { includeGoals: true, includeSavings: true });
      expect(store.computeLedgerSummary(ctx).poolSavingsTotal).toBe(3500.5);
      expect(store.computeAvailableBalance(ctx, { type: 'pool' })).toBe(3500.5);
      expect(store.computeAvailableBalance(ctx, { type: 'goal', goalId: GOAL_ID })).toBe(1700.25);
    });
  });

  describe('balances with ctx.carryForward', () => {
    async function loadCtx(): Promise<LedgerContext> {
      await seedSavings(USER_A, [
        { month: '2026-10', savings_list: [{ savings_type: 'เที่ยว', savings_amount: 1000 }] },
        { month: '2026-11', savings_list: [{ savings_type: 'ทั่วไป', savings_amount: 500 }] },
      ]);
      await seedGoal(USER_A);
      return store.loadLedgerContext(USER_A, { includeGoals: true, includeSavings: true });
    }

    it('is unchanged when the context has no carryForward', async () => {
      const ctx = await loadCtx();
      delete ctx.carryForward;
      expect(store.computeLedgerSummary(ctx)).toEqual({
        poolSavingsTotal: 1500,
        poolOutstanding: 0,
        poolWithdrawn: 0,
        poolBalance: 1500,
        poolCarriedForward: 0,
        totalOutstanding: 0,
        openLoanCount: 0,
      });
      expect(store.computeAvailableBalance(ctx, { type: 'goal', goalId: GOAL_ID })).toBe(1000);
    });

    it('adds carryForward.poolAmount to the pool and goalAmounts to the goal (no-overdraw basis)', async () => {
      const ctx = await loadCtx();
      ctx.carryForward = { poolAmount: 2000.5, goalAmounts: { [GOAL_ID]: 700.25 }, prunedMonths: ['2024-01'] };

      const summary = store.computeLedgerSummary(ctx);
      expect(summary.poolSavingsTotal).toBe(3500.5);
      expect(summary.poolBalance).toBe(3500.5);
      expect(store.computeAvailableBalance(ctx, { type: 'pool' })).toBe(3500.5);
      expect(store.computeAvailableBalance(ctx, { type: 'goal', goalId: GOAL_ID })).toBe(1700.25);
    });

    it('surfaces carryForward.poolAmount as summary.poolCarriedForward, and 0 when absent or zero', async () => {
      const ctx = await loadCtx();
      ctx.carryForward = { poolAmount: 2000.5, goalAmounts: { [GOAL_ID]: 700.25 }, prunedMonths: ['2024-01'] };
      expect(store.computeLedgerSummary(ctx).poolCarriedForward).toBe(2000.5);

      ctx.carryForward = { poolAmount: 0, goalAmounts: {}, prunedMonths: [] };
      expect(store.computeLedgerSummary(ctx).poolCarriedForward).toBe(0);

      delete ctx.carryForward;
      expect(store.computeLedgerSummary(ctx).poolCarriedForward).toBe(0);
    });

    it('a zero carryForward changes nothing', async () => {
      const ctx = await loadCtx();
      const before = {
        summary: store.computeLedgerSummary(ctx),
        goal: store.computeAvailableBalance(ctx, { type: 'goal', goalId: GOAL_ID }),
      };
      ctx.carryForward = { poolAmount: 0, goalAmounts: {}, prunedMonths: [] };
      expect(store.computeLedgerSummary(ctx)).toEqual(before.summary);
      expect(store.computeAvailableBalance(ctx, { type: 'goal', goalId: GOAL_ID })).toBe(before.goal);
    });
  });
});
