/** @jest-environment node */
// sharedMonthWindow far-future guard (spec §3.4, §6 i-viii + predicate parity).
// Fully mocked: an in-memory fake Mongo collection (no real/ephemeral Mongo) and an in-memory
// JSON bucket store standing in for userUtils.getUserData/setUserData (no disk writes).

type Doc = Record<string, unknown>;

const mongoStore: Record<string, Doc[]> = {};
const jsonStore: Record<string, Record<string, Record<string, unknown>>> = {};

function matches(doc: Doc, filter: Doc): boolean {
  return Object.entries(filter).every(([key, cond]) => {
    const value = doc[key];
    if (cond && typeof cond === 'object' && !Array.isArray(cond)) {
      const c = cond as Record<string, unknown>;
      if ('$exists' in c) return (value !== undefined) === Boolean(c.$exists);
      if ('$gt' in c) return typeof value === 'string' && value > String(c.$gt);
      if ('$in' in c) return (c.$in as unknown[]).includes(value);
      return false;
    }
    return value === cond;
  });
}

function fakeCollection(name: string) {
  return {
    find(filter: Doc) {
      return { toArray: async () => (mongoStore[name] || []).filter(doc => matches(doc, filter)).map(doc => ({ ...doc })) };
    },
    async deleteMany(filter: Doc) {
      mongoStore[name] = (mongoStore[name] || []).filter(doc => !matches(doc, filter));
      return {};
    },
  };
}

jest.mock('../../../../lib/dataSource', () => ({
  getMongoCollection: async (name: string) => fakeCollection(name),
}));
jest.mock('../../../../lib/auditContext', () => ({
  withRetention: (fn: () => unknown) => fn(),
}));
jest.mock('../../../../src/backend/data/userUtils', () => ({
  getUserData: (file: string, userId: string) => ({ ...((jsonStore[file] || {})[userId] || {}) }),
  setUserData: (file: string, userId: string, data: Record<string, unknown>) => {
    jsonStore[file] = { ...(jsonStore[file] || {}), [userId]: data };
  },
}));

import {
  enforceSharedMonthWindowJson,
  enforceSharedMonthWindowMongo,
  isWindowDocEmpty,
  getWindowMonthBasis,
  type WindowCollection,
} from '../../../../src/shared/utils/backend/sharedMonthWindow';
import { getMeaningfulMonthKeys } from '../../../../src/shared/utils/frontend/monthUtils';

const USER = 'u-test';
const NOW = new Date(2026, 9, 29, 12, 0, 0); // 2026-10-29 local -> current 2026-10, next 2026-11
const KINDS: WindowCollection[] = ['expense', 'income', 'salary', 'investment'];
const MONGO_NAMES: Record<WindowCollection, string> = {
  expense: 'monthly_expense', income: 'monthly_income', salary: 'salary', investment: 'investment',
};
const JSON_NAMES: Record<WindowCollection, string> = {
  expense: 'monthly_expense.json', income: 'monthly_income.json', salary: 'salary.json', investment: 'investment.json',
};

/** Bodies (without month/userId) matching what MonthManager.createEmptyMonth persists. */
const EMPTY_BODY: Record<WindowCollection, Doc> = {
  expense: {},
  income: {},
  salary: { income: {}, deduct: {}, overtime: [], note: '', saved_at: '2026-10-29T00:00:00.000Z', summary: { total_income: 0, total_deduct: 0, net_income: 0 } },
  investment: { investments: [] },
};
const REAL_BODY: Record<WindowCollection, Doc> = {
  expense: { rent: { value: 8000, paid: false } },
  income: { salary: 30000 },
  salary: { income: { salary: 30000 }, deduct: {}, overtime: [], note: '', saved_at: '2026-10-29T00:00:00.000Z', summary: { total_income: 30000, total_deduct: 0, net_income: 30000 } },
  investment: { investments: [{ name: 'fund', amount: 1000 }] },
};

type Fixture = Partial<Record<WindowCollection, Record<string, Doc>>>;

function monthRange(from: string, to: string): string[] {
  const out: string[] = [];
  let [y, m] = from.split('-').map(Number);
  for (;;) {
    const key = `${y}-${String(m).padStart(2, '0')}`;
    out.push(key);
    if (key === to) return out;
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
}

function realAll(months: string[]): Fixture {
  const fx: Fixture = {};
  KINDS.forEach(kind => {
    fx[kind] = Object.fromEntries(months.map(m => [m, REAL_BODY[kind]]));
  });
  return fx;
}

function merge(...fixtures: Fixture[]): Fixture {
  const out: Fixture = {};
  fixtures.forEach(fx => KINDS.forEach(kind => {
    out[kind] = { ...(out[kind] || {}), ...(fx[kind] || {}) };
  }));
  return out;
}

function seed(fx: Fixture) {
  KINDS.forEach(kind => {
    const entries = Object.entries(fx[kind] || {});
    mongoStore[MONGO_NAMES[kind]] = entries.map(([month, body]) => ({ _id: `${kind}-${month}`, ...body, month, userId: USER }));
    const bucket: Record<string, unknown> = {};
    entries.forEach(([month, body]) => {
      // JSON investment bucket entries are { _id, month, investments }, the rest { _id, ...fields, month }
      bucket[month] = { _id: `${kind}-${month}`, ...body, month };
    });
    jsonStore[JSON_NAMES[kind]] = { [USER]: bucket };
  });
}

function mongoMonths(kind: WindowCollection): string[] {
  return (mongoStore[MONGO_NAMES[kind]] || []).map(doc => String(doc.month)).sort();
}
function jsonMonths(kind: WindowCollection): string[] {
  return Object.keys(jsonStore[JSON_NAMES[kind]]?.[USER] || {}).sort();
}

async function runBoth(fx: Fixture, now: Date = NOW) {
  seed(fx);
  const mongo = await enforceSharedMonthWindowMongo(USER, { now });
  const mongoKept = Object.fromEntries(KINDS.map(kind => [kind, mongoMonths(kind)]));
  seed(fx);
  const json = enforceSharedMonthWindowJson(USER, { now });
  const jsonKept = Object.fromEntries(KINDS.map(kind => [kind, jsonMonths(kind)]));
  return { mongoAllowed: mongo.allowedMonths, jsonAllowed: Array.from(json.allowedMonths), mongoKept, jsonKept };
}

beforeEach(() => {
  Object.keys(mongoStore).forEach(key => delete mongoStore[key]);
  Object.keys(jsonStore).forEach(key => delete jsonStore[key]);
});

const FIFTEEN_REAL = monthRange('2025-09', '2026-11'); // 15 months, oldest 2025-09

describe('getWindowMonthBasis', () => {
  it('derives current and next from the injected clock, across a year boundary', () => {
    expect(getWindowMonthBasis(NOW)).toEqual({ current: '2026-10', next: '2026-11' });
    expect(getWindowMonthBasis(new Date(2026, 11, 31, 23, 0))).toEqual({ current: '2026-12', next: '2027-01' });
  });
});

describe('enforceSharedMonthWindow* far-future guard', () => {
  it('(i)+(iii) an empty far-future month (doc only in salary) does not prune the oldest month in any collection', async () => {
    const fx = merge(realAll(FIFTEEN_REAL), { salary: { '2027-03': EMPTY_BODY.salary } });
    const r = await runBoth(fx);
    KINDS.forEach(kind => {
      expect(r.mongoKept[kind]).toContain('2025-09');
      expect(r.jsonKept[kind]).toContain('2025-09');
    });
    // F-1: the collection that itself holds the empty far-future doc keeps its oldest month AND the empty doc
    expect(r.mongoKept.salary).toEqual([...FIFTEEN_REAL, '2027-03']);
    expect(r.jsonKept.salary).toEqual([...FIFTEEN_REAL, '2027-03']);
  });

  it('(i) empty far-future month created in all 4 collections (createEmptyMonth shape) is retained without evicting anything', async () => {
    const emptyEverywhere: Fixture = Object.fromEntries(KINDS.map(kind => [kind, { '2027-03': EMPTY_BODY[kind] }]));
    const r = await runBoth(merge(realAll(FIFTEEN_REAL), emptyEverywhere));
    KINDS.forEach(kind => {
      expect(r.mongoKept[kind]).toEqual([...FIFTEEN_REAL, '2027-03']);
      expect(r.jsonKept[kind]).toEqual([...FIFTEEN_REAL, '2027-03']);
    });
  });

  it('(ii) a far-future month WITH data is ranked normally and evicts the oldest month', async () => {
    const r = await runBoth(merge(realAll(FIFTEEN_REAL), { investment: { '2027-03': REAL_BODY.investment } }));
    KINDS.forEach(kind => {
      expect(r.mongoKept[kind]).not.toContain('2025-09');
      expect(r.jsonKept[kind]).not.toContain('2025-09');
    });
    expect(r.mongoAllowed).toHaveLength(15);
    expect(r.mongoAllowed[0]).toBe('2027-03');
  });

  it('(iv) returned allowedMonths (used for the monthly_income legacy obj:months doc) keeps skipped months', async () => {
    const r = await runBoth(merge(realAll(FIFTEEN_REAL), { expense: { '2027-03': {}, '2028-01': {} } }));
    expect(r.mongoAllowed).toEqual(['2028-01', '2027-03', ...[...FIFTEEN_REAL].reverse()]);
    expect(r.jsonAllowed).toEqual(r.mongoAllowed);
  });

  it('(v) with > 15 real months above a skipped month, the newest 15 real months are kept and no real month is lost beyond the window', async () => {
    const farReal = monthRange('2027-04', '2028-07'); // 16 real months, all above the skipped 2027-03
    const fx = merge(realAll(FIFTEEN_REAL), realAll(farReal), { income: { '2027-03': {} } });
    const r = await runBoth(fx);
    const newest15 = [...farReal].reverse().slice(0, 15);
    newest15.forEach(month => expect(r.mongoAllowed).toContain(month));
    // limit 15 + k(1) = 16 -> the 16 far real months are all kept; the empty 2027-03 may drop
    expect(r.mongoAllowed).toEqual([...farReal].reverse());
    expect(r.mongoKept.income).toEqual(farReal);
    expect(r.jsonKept.income).toEqual(farReal);
  });

  it('(vi) Mongo and JSON produce identical kept sets and allowedMonths for the same fixture', async () => {
    const fx = merge(
      realAll(monthRange('2025-05', '2026-09')),
      { salary: { '2026-11': EMPTY_BODY.salary, '2027-02': EMPTY_BODY.salary }, investment: { '2027-06': REAL_BODY.investment, '2027-08': EMPTY_BODY.investment } }
    );
    const r = await runBoth(fx);
    expect(r.jsonKept).toEqual(r.mongoKept);
    expect(r.jsonAllowed).toEqual(r.mongoAllowed);
  });

  it('(vii) month boundary: last day vs first day shifts which month is current+1 vs skipped', async () => {
    const fx = merge(realAll(FIFTEEN_REAL.slice(0, 14)), Object.fromEntries(KINDS.map(kind => [kind, { '2026-12': EMPTY_BODY[kind] }])));
    // 14 real (2025-09..2026-10) + empty 2026-12 + an empty 2026-11 => 16 months in the union
    const withNext = merge(fx, { expense: { '2026-11': {} } });

    // 2026-10-31: next = 2026-11, so empty 2026-12 is skipped -> 2025-09 survives
    const lastDay = await runBoth(withNext, new Date(2026, 9, 31, 23, 59));
    expect(lastDay.mongoKept.expense).toContain('2025-09');
    expect(lastDay.jsonKept.expense).toContain('2025-09');

    // 2026-11-01: next = 2026-12, so 2026-12 now counts -> 2025-09 is evicted (accepted OQ-1 rollover risk)
    const firstDay = await runBoth(withNext, new Date(2026, 10, 1, 0, 1));
    expect(firstDay.mongoKept.expense).not.toContain('2025-09');
    expect(firstDay.jsonKept.expense).not.toContain('2025-09');
  });

  it('(viii) fail-safe: a far-future doc with an unrecognised field counts as real', async () => {
    const r = await runBoth(merge(realAll(FIFTEEN_REAL), { salary: { '2027-03': { ...EMPTY_BODY.salary, mystery: '' } } }));
    expect(r.mongoKept.salary).not.toContain('2025-09');
    expect(r.jsonKept.salary).not.toContain('2025-09');
    expect(isWindowDocEmpty('expense', { row: new Date() })).toBe(false);
    expect(isWindowDocEmpty('expense', { row: Number.NaN })).toBe(false);
  });

  it('(viii) a savings-only far-future month (empty in all 4 window collections) is skipped', async () => {
    jsonStore['savings.json'] = { [USER]: { '2027-03': { savings_list: [{ savings_amount: 5000 }] } } };
    const emptyEverywhere: Fixture = Object.fromEntries(KINDS.map(kind => [kind, { '2027-03': EMPTY_BODY[kind] }]));
    const r = await runBoth(merge(realAll(FIFTEEN_REAL), emptyEverywhere));
    expect(r.mongoAllowed).toContain('2025-09');
    expect(r.mongoAllowed).toContain('2027-03');
  });

  it('does not change behaviour when there is no far-future month (plain newest-15 window)', async () => {
    const r = await runBoth(realAll(monthRange('2025-01', '2026-10')));
    expect(r.mongoAllowed).toEqual([...monthRange('2025-08', '2026-10')].reverse());
    expect(r.jsonKept).toEqual(r.mongoKept);
  });
});

describe('server predicate vs client getMeaningfulMonthKeys parity (4 window collections)', () => {
  it('agrees on every month of a shared fixture', () => {
    const fixture: Record<string, Partial<Record<WindowCollection, Doc>>> = {
      '2027-01': { expense: {}, income: {}, salary: EMPTY_BODY.salary, investment: EMPTY_BODY.investment },
      '2027-02': { expense: { rent: { value: 0, paid: false } }, income: { bonus: 0 } },
      '2027-03': { expense: REAL_BODY.expense },
      '2027-04': { income: REAL_BODY.income },
      '2027-05': { salary: REAL_BODY.salary },
      '2027-06': { salary: { ...EMPTY_BODY.salary, note: 'plan' } },
      '2027-07': { investment: REAL_BODY.investment },
      '2027-08': { investment: { investments: [{ name: '', amount: 0 }] } },
      '2027-09': { expense: { rent: { value: 0, paid: true } } },
    };

    // Client sees GET-all responses (server-added derived fields included)
    const expenseMonths: Doc = {};
    const incomeMonths: Doc = {};
    const salaryMonths: Doc = {};
    const investmentMap: Doc = {};
    Object.entries(fixture).forEach(([month, docs]) => {
      if (docs.expense) expenseMonths[month] = { ...docs.expense, totalActualPaid: 0, accountSummary: {} };
      if (docs.income) incomeMonths[month] = { month, ...docs.income, รวม: 0 };
      if (docs.salary) salaryMonths[month] = { month, ...docs.salary, overtimeLegacy: [] };
      if (docs.investment) investmentMap[month] = (docs.investment.investments as unknown[]) || [];
    });
    const client = getMeaningfulMonthKeys({
      expense: { months: expenseMonths },
      income: { months: incomeMonths },
      salary: { months: salaryMonths },
      investment: investmentMap,
    });

    Object.entries(fixture).forEach(([month, docs]) => {
      const serverReal = KINDS.some(kind => !isWindowDocEmpty(kind, docs[kind] ? { ...docs[kind], month, userId: USER } : undefined));
      expect({ month, real: client.has(month) }).toEqual({ month, real: serverReal });
    });
  });
});
