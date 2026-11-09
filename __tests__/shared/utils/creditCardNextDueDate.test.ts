// resolveCardNextDueDate — trailing-run rule (BR-CC-014)
// spec: .pipeline/spec-credit-card-stale-overdue-due-date.md (AC-1..AC-12) +
// architecture-review-stale-overdue-due-date.md (N-2 a-d). Local working notes, not in git history.
import {
  buildRevolvingCyclesForData,
  isRevolvingChainTruncated,
  resolveCardNextDueDate,
  summariseCard
} from '../../../src/shared/utils/creditCardRevolving';
import { resolveCardDueDate } from '../../../src/shared/utils/creditCardBasics';

const KB = { id: 'cc_kb', statementDay: 5, dueDay: 20, annualRate: 16, minPaymentPercent: 10 };
const UOB = { id: 'cc_uob', statementDay: 29, dueDay: 21, annualRate: 16, minPaymentPercent: 10 };
const G = { id: 'cc_g', statementDay: 1, dueDay: 5, annualRate: 0, minPaymentPercent: 10 };

type Cycle = { id: string; cardId: string; month: string; newSpend?: number; cashbackAmount?: number; paymentAction?: string | null };

const cyc = (cardId: string, month: string, extra: Partial<Cycle> = {}): Cycle => ({ id: `c_${cardId}_${month}`, cardId, month, ...extra });
const item = (cardId: string, month: string, amount: number) => ({ id: `s_${cardId}_${month}`, cardId, month, purchaseDate: `${month}-02`, name: 'x', amount });
const planOf = (cardId: string, rows: Array<[string, boolean]>, status = 'ongoing') => ({
  id: `p_${cardId}`,
  cardId,
  status,
  schedule: rows.map(([dueMonth, paid], i) => ({ no: i + 1, dueMonth, payment: 100, principal: 90, paid }))
});
const chainOf = (card: any, cycles: Cycle[], throughMonth: string, spendItems: unknown[] = []) =>
  buildRevolvingCyclesForData(card, { cycles, spendItems }, { throughMonth });
const gNext = (cycles: Cycle[], asOfMonth: string, plans: any[] = []) =>
  resolveCardNextDueDate(G, plans, chainOf(G, cycles, asOfMonth));

// OLD implementation, verbatim copy of the pre-change function (oracle)
function oldResolveCardNextDueDate(card: any = {}, plans: any[] = [], derivedCycles: any[] = []): string | null {
  const dueMonths: string[] = [];
  plans.forEach(plan => {
    if (plan?.status !== 'ongoing') return;
    (Array.isArray(plan.schedule) ? plan.schedule : []).forEach((row: any) => {
      if (row?.paid === true) return;
      if (typeof row?.dueMonth === 'string') dueMonths.push(row.dueMonth);
    });
  });
  (Array.isArray(derivedCycles) ? derivedCycles : []).forEach(cycle => {
    if (cycle?.paymentAction !== null) return;
    if (!(Number(cycle?.amountDue) > 0)) return;
    if (typeof cycle?.month === 'string') dueMonths.push(cycle.month);
  });
  if (!dueMonths.length) return null;
  dueMonths.sort();
  return resolveCardDueDate(card, dueMonths[0]);
}

describe('resolveCardNextDueDate trailing-run rule', () => {
  describe('AC-1 / AC-2 / AC-3 real-data chain shapes', () => {
    const kbItems = [item('cc_kb', '2025-11', 4786.56), item('cc_kb', '2025-12', 4786.56)];
    const uobItems = [item('cc_uob', '2025-11', 2817.9), item('cc_uob', '2025-12', 2817.9)];
    const fullDec = (cardId: string) => [cyc(cardId, '2025-12', { paymentAction: 'full' })];
    const kbPlan = planOf('cc_kb', [['2026-10', true], ['2026-11', true], ['2026-12', false], ['2027-01', false]]);
    const summarise = (card: any, plans: any[], items: unknown[]) =>
      summariseCard(card, plans, fullDec(card.id), { asOfMonth: '2026-11', spendItems: items });
    const withoutNext = ({ nextDueDate: _n, ...rest }: Record<string, any>) => rest;

    it('AC-1 derived chain equals the F-4 shape', () => {
      const rows = chainOf(KB, fullDec('cc_kb'), '2026-11', kbItems);
      expect(rows.map(r => [r.month, r.paymentAction, r.carriedBalance, r.totalDue, r.closingBalance, r.stored]))
        .toEqual([['2025-11', null, 0, 4786.56, 4786.56, false], ['2025-12', 'full', 4786.56, 9573.12, 0, true]]);
    });
    it('AC-1 (a) no plans: null (old 2025-11-20)', () => {
      expect(summarise(KB, [], kbItems).nextDueDate).toBeNull();
      expect(oldResolveCardNextDueDate(KB, [], chainOf(KB, fullDec('cc_kb'), '2026-11', kbItems))).toBe('2025-11-20');
    });
    it('AC-1 (b) ongoing plan rows: first unpaid row month', () => {
      expect(summarise(KB, [kbPlan], kbItems).nextDueDate).toBe('2026-12-20');
    });
    it('AC-1 (c) undecided current cycle in addition: 2026-11-20', () => {
      expect(summarise(KB, [kbPlan], [...kbItems, item('cc_kb', '2026-11', 1000)]).nextDueDate).toBe('2026-11-20');
    });
    it('AC-2 derived chain equals the F-4 shape; (a) null (old 2025-12-21); (b) 2026-12-21', () => {
      const rows = chainOf(UOB, fullDec('cc_uob'), '2026-11', uobItems);
      expect(rows.map(r => [r.month, r.paymentAction, r.carriedBalance, r.totalDue, r.closingBalance, r.stored]))
        .toEqual([['2025-11', null, 0, 2817.9, 2817.9, false], ['2025-12', 'full', 2817.9, 5635.8, 0, true]]);
      expect(oldResolveCardNextDueDate(UOB, [], rows)).toBe('2025-12-21');
      expect(summarise(UOB, [], uobItems).nextDueDate).toBeNull();
      expect(summarise(UOB, [planOf('cc_uob', [['2026-11', false]])], uobItems).nextDueDate).toBe('2026-12-21');
    });

    // AC-3: literals captured by running the OLD code before the change (everything except nextDueDate)
    const kbBase = { id: 'cc_kb', statementDay: 5, dueDay: 20, annualRate: 16, minPaymentPercent: 10 };
    const uobBase = { id: 'cc_uob', statementDay: 29, dueDay: 21, annualRate: 16, minPaymentPercent: 10 };
    const zeroRev = {
      revolvingTotalDue: 0, revolvingMinDue: 0, revolvingDue: 0, revolvingDueMonth: null, revolvingOutstanding: 0,
      revolvingCarryForward: 0, revolvingAction: null, revolvingCredit: 0, payableRevolvingDue: 0, payableRevolvingMonth: null,
      availableCredit: 0
    };
    it('AC-3 every summariseCard field except nextDueDate is unchanged', () => {
      expect(withoutNext(summarise(KB, [], kbItems))).toEqual({
        ...kbBase, ...zeroRev, remainingPayable: 0, remainingPrincipal: 0, installmentPayable: 0, installmentPrincipal: 0, ongoingPlanCount: 0
      });
      expect(withoutNext(summarise(KB, [kbPlan], kbItems))).toEqual({
        ...kbBase, ...zeroRev, remainingPayable: 200, remainingPrincipal: 180, installmentPayable: 200, installmentPrincipal: 180, ongoingPlanCount: 1
      });
      expect(withoutNext(summarise(KB, [kbPlan], [...kbItems, item('cc_kb', '2026-11', 1000)]))).toEqual({
        ...kbBase, remainingPayable: 1200, remainingPrincipal: 1180, installmentPayable: 200, installmentPrincipal: 180,
        revolvingTotalDue: 1000, revolvingMinDue: 100, revolvingDue: 1000, revolvingDueMonth: '2026-11', revolvingOutstanding: 1000,
        revolvingCarryForward: 1000, revolvingAction: null, revolvingCredit: 0, payableRevolvingDue: 1000, payableRevolvingMonth: '2026-11',
        availableCredit: 0, ongoingPlanCount: 1
      });
      expect(withoutNext(summarise(UOB, [], uobItems))).toEqual({
        ...uobBase, ...zeroRev, remainingPayable: 0, remainingPrincipal: 0, installmentPayable: 0, installmentPrincipal: 0, ongoingPlanCount: 0
      });
      expect(withoutNext(summarise(UOB, [planOf('cc_uob', [['2026-11', false]])], uobItems))).toEqual({
        ...uobBase, ...zeroRev, remainingPayable: 100, remainingPrincipal: 90, installmentPayable: 100, installmentPrincipal: 90, ongoingPlanCount: 1
      });
    });
  });

  describe('AC-5..AC-9 rule cases (card G)', () => {
    it('AC-5 trailing run: earliest of the run wins', () => {
      const cycles = [
        cyc('cc_g', '2026-07', { newSpend: 100, paymentAction: 'full' }),
        cyc('cc_g', '2026-08', { newSpend: 100 }),
        cyc('cc_g', '2026-09', { newSpend: 50 })
      ];
      expect(gNext(cycles, '2026-09')).toBe('2026-08-05');
    });
    it('AC-6 undecided then full: null (old 2026-07-05)', () => {
      const cycles = [cyc('cc_g', '2026-07', { newSpend: 100 }), cyc('cc_g', '2026-08', { newSpend: 0, paymentAction: 'full' })];
      expect(gNext(cycles, '2026-08')).toBeNull();
      expect(oldResolveCardNextDueDate(G, [], chainOf(G, cycles, '2026-08'))).toBe('2026-07-05');
    });
    it('AC-7 undecided then minimum', () => {
      const cycles = [cyc('cc_g', '2026-07', { newSpend: 100 }), cyc('cc_g', '2026-08', { newSpend: 0, paymentAction: 'minimum' })];
      const at08 = chainOf(G, cycles, '2026-08');
      expect(at08[1]).toMatchObject({ totalDue: 100, minPaymentDue: 10, closingBalance: 90 });
      expect(resolveCardNextDueDate(G, [], at08)).toBeNull();
      expect(oldResolveCardNextDueDate(G, [], at08)).toBe('2026-07-05');
      const at09 = chainOf(G, cycles, '2026-09');
      expect(at09[2]).toMatchObject({ month: '2026-09', carriedBalance: 90, paymentAction: null, isImplicit: true });
      expect(resolveCardNextDueDate(G, [], at09)).toBe('2026-09-05');
      expect(oldResolveCardNextDueDate(G, [], at09)).toBe('2026-07-05');
    });
    it('AC-8 trailing minimum with closingBalance > 0 is unchanged from old', () => {
      const cycles = [cyc('cc_g', '2026-08', { newSpend: 100, paymentAction: 'minimum' })];
      [['2026-08', null], ['2026-09', '2026-09-05']].forEach(([asOf, expected]) => {
        const rows = chainOf(G, cycles, asOf as string);
        expect(resolveCardNextDueDate(G, [], rows)).toBe(expected);
        expect(oldResolveCardNextDueDate(G, [], rows)).toBe(expected);
      });
    });
    it('AC-9 credit and zero cycles', () => {
      const debt = cyc('cc_g', '2026-07', { newSpend: 100 });
      // (a) credit cycle with no action: not a candidate, does not end the run
      const a = [debt, cyc('cc_g', '2026-08', { newSpend: 0, cashbackAmount: 300 })];
      expect(chainOf(G, a, '2026-08')[1]).toMatchObject({ totalDue: -200, amountDue: 0, paymentAction: null });
      expect(gNext(a, '2026-08')).toBe('2026-07-05');
      // (b) same, stored 'full': decided, ends the run
      const b = [debt, cyc('cc_g', '2026-08', { newSpend: 0, cashbackAmount: 300, paymentAction: 'full' })];
      expect(gNext(b, '2026-08')).toBeNull();
      // (c) zero cycle in the run is not a candidate
      const c = [cyc('cc_g', '2026-07', { newSpend: 0 }), cyc('cc_g', '2026-08', { newSpend: 100 })];
      expect(gNext(c, '2026-08')).toBe('2026-08-05');
      // (d) lone zero cycle
      expect(gNext([cyc('cc_g', '2026-07', { newSpend: 0 })], '2026-07')).toBeNull();
    });
  });

  describe('AC-10 capped chains (BR-CC-018)', () => {
    it('(a)(b) truncated chain: unchanged result and the flag is not read', () => {
      const rows = chainOf(G, [cyc('cc_g', '2021-01', { newSpend: 100 })], '2026-12');
      expect(isRevolvingChainTruncated(rows)).toBe(true);
      expect(resolveCardNextDueDate(G, [], rows)).toBe('2021-01-05');
      Object.defineProperty(rows, 'truncated', { value: false });
      expect(resolveCardNextDueDate(G, [], rows)).toBe('2021-01-05');
    });
    it('(c) front-truncated chain never yields the dropped month', () => {
      const cycles = [
        cyc('cc_g', '2019-01', { newSpend: 100 }),
        cyc('cc_g', '2026-05', { newSpend: 50, paymentAction: 'full' }),
        cyc('cc_g', '2026-06', { newSpend: 30 })
      ];
      const rows = chainOf(G, cycles, '2026-06');
      expect(rows.map(r => r.month)).toEqual(['2026-05', '2026-06']);
      expect(resolveCardNextDueDate(G, [], rows)).toBe('2026-06-05');
      expect(oldResolveCardNextDueDate(G, [], rows)).toBe('2026-06-05');
    });
  });

  describe('AC-11 installments mixed with cycles', () => {
    const undecidedThenFull = [cyc('cc_g', '2026-07', { newSpend: 100 }), cyc('cc_g', '2026-08', { newSpend: 0, paymentAction: 'full' })];
    it('(a) earlier unpaid ongoing row wins', () => {
      expect(gNext(undecidedThenFull, '2026-08', [planOf('cc_g', [['2026-06', false]])])).toBe('2026-06-05');
    });
    it('(b) trailing null earlier than the unpaid row wins', () => {
      expect(gNext([cyc('cc_g', '2026-09', { newSpend: 10 })], '2026-09', [planOf('cc_g', [['2026-10', false]])])).toBe('2026-09-05');
    });
    it('(c) all rows paid: null', () => {
      expect(gNext(undecidedThenFull, '2026-08', [planOf('cc_g', [['2026-06', true]])])).toBeNull();
    });
    it('(d) completed or cancelled plans are ignored', () => {
      ['completed', 'cancelled'].forEach(status => {
        expect(gNext(undecidedThenFull, '2026-08', [planOf('cc_g', [['2026-06', false]], status)])).toBeNull();
      });
    });
    it('(e) a row without a string dueMonth is ignored', () => {
      const plan = { id: 'p', cardId: 'cc_g', status: 'ongoing', schedule: [{ no: 1, paid: false }, { no: 2, dueMonth: 202606, paid: false }] };
      expect(gNext(undecidedThenFull, '2026-08', [plan])).toBeNull();
    });
  });

  describe('AC-12 order and purity', () => {
    it('reverse array order gives the same results and inputs are not mutated', () => {
      const ac5 = chainOf(G, [
        cyc('cc_g', '2026-07', { newSpend: 100, paymentAction: 'full' }),
        cyc('cc_g', '2026-08', { newSpend: 100 }),
        cyc('cc_g', '2026-09', { newSpend: 50 })
      ], '2026-09');
      const ac6 = chainOf(G, [cyc('cc_g', '2026-07', { newSpend: 100 }), cyc('cc_g', '2026-08', { paymentAction: 'full' })], '2026-08');
      [[ac5, '2026-08-05'], [ac6, null]].forEach(([rows, expected]) => {
        const arr = rows as typeof ac5;
        const before = JSON.stringify([G, arr]);
        expect(resolveCardNextDueDate(G, [], arr)).toBe(expected);
        expect(resolveCardNextDueDate(G, [], [...arr].reverse())).toBe(expected);
        expect(JSON.stringify([G, arr])).toBe(before);
      });
    });
  });

  describe('N-2 extras', () => {
    it('(b) undecidedThenMinimumThenFull: nextDueDate null, revolvingOutstanding unchanged', () => {
      const card = { id: 'cc_t', statementDay: 1, dueDay: 5, annualRate: 12, minPaymentPercent: 10, creditLimit: 10000 };
      const cycles = [
        cyc('cc_t', '2099-01', { newSpend: 1000, paymentAction: null }),
        cyc('cc_t', '2099-02', { newSpend: 500, paymentAction: 'minimum' }),
        cyc('cc_t', '2099-03', { newSpend: 0, paymentAction: 'full' })
      ];
      const rows = chainOf(card, cycles, '2099-02');
      expect(oldResolveCardNextDueDate(card, [], rows)).toBe('2099-01-05');
      const summary = summariseCard(card, [], cycles, { asOfMonth: '2099-02' });
      expect(summary.nextDueDate).toBeNull();
      expect(summary.revolvingOutstanding).toBe(1363.5);
    });
    it('(c) OQ-2 pinned: a pre-marked later cycle hides the chip while revolvingDue stays > 0', () => {
      const cycles = [cyc('cc_g', '2026-10', { newSpend: 500 }), cyc('cc_g', '2026-12', { newSpend: 200, paymentAction: 'full' })];
      const summary = summariseCard(G, [], cycles, { asOfMonth: '2026-11' });
      expect(oldResolveCardNextDueDate(G, [], chainOf(G, cycles, '2026-11'))).toBe('2026-10-05');
      expect(summary.nextDueDate).toBeNull();
      expect(summary.revolvingDue).toBe(500);
    });
    it('(d) minimum mid-chain at asOfMonth 2026-10 gives 2026-09-05 (old 2026-07-05)', () => {
      const cycles = [cyc('cc_g', '2026-07', { newSpend: 100 }), cyc('cc_g', '2026-08', { newSpend: 0, paymentAction: 'minimum' })];
      const rows = chainOf(G, cycles, '2026-10');
      expect(rows.map(r => r.month)).toEqual(['2026-07', '2026-08', '2026-09', '2026-10']);
      expect(resolveCardNextDueDate(G, [], rows)).toBe('2026-09-05');
      expect(oldResolveCardNextDueDate(G, [], rows)).toBe('2026-07-05');
    });
  });

  describe('AC-4 identity table (old algorithm as oracle)', () => {
    const fixtures: Array<[string, Cycle[], string]> = [
      ['AC-5', [cyc('cc_g', '2026-07', { newSpend: 100, paymentAction: 'full' }), cyc('cc_g', '2026-08', { newSpend: 100 }), cyc('cc_g', '2026-09', { newSpend: 50 })], '2026-09'],
      ['AC-8 at 08', [cyc('cc_g', '2026-08', { newSpend: 100, paymentAction: 'minimum' })], '2026-08'],
      ['AC-8 at 09', [cyc('cc_g', '2026-08', { newSpend: 100, paymentAction: 'minimum' })], '2026-09'],
      ['AC-9c', [cyc('cc_g', '2026-07', { newSpend: 0 }), cyc('cc_g', '2026-08', { newSpend: 100 })], '2026-08'],
      ['AC-9d', [cyc('cc_g', '2026-07', { newSpend: 0 })], '2026-07'],
      ['AC-10a', [cyc('cc_g', '2021-01', { newSpend: 100 })], '2026-12'],
      ['upcoming-groups all null', [cyc('cc_g', '2026-09', { newSpend: 700 })], '2026-11'],
      ['decided only', [cyc('cc_g', '2026-09', { newSpend: 700, paymentAction: 'full' })], '2026-10']
    ];
    it.each(fixtures)('%s: new === old', (_name, cycles, asOf) => {
      const rows = chainOf(G, cycles, asOf);
      expect(resolveCardNextDueDate(G, [], rows)).toBe(oldResolveCardNextDueDate(G, [], rows));
    });
  });

  describe('property test (seeded, old algorithm as oracle)', () => {
    const makeRng = (seed: number) => {
      let s = seed >>> 0;
      return () => {
        s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
        return s / 4294967296;
      };
    };
    const MONTHS = Array.from({ length: 24 }, (_v, i) => `${2025 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`);

    it('holds for 600 random chains', () => {
      const rng = makeRng(20261109);
      const pick = <T,>(xs: T[]): T => xs[Math.floor(rng() * xs.length)];
      let differing = 0;
      for (let n = 0; n < 600; n += 1) {
        const card = pick([G, KB, UOB]);
        const cycles: Cycle[] = [];
        MONTHS.forEach(month => {
          if (rng() > 0.35) return;
          cycles.push(cyc(card.id, month, {
            newSpend: rng() < 0.3 ? 0 : Math.round(rng() * 450) + 50,
            ...(rng() < 0.15 ? { cashbackAmount: Math.round(rng() * 300) } : {}),
            paymentAction: pick([null, null, 'full', 'minimum', 'bogus'])
          }));
        });
        const plans = rng() < 0.4
          ? [planOf(card.id, Array.from({ length: 1 + Math.floor(rng() * 3) }, () => [pick(MONTHS), rng() < 0.5] as [string, boolean]))]
          : [];
        const asOf = pick(MONTHS);
        const rows = chainOf(card, cycles, asOf);

        const oldValue = oldResolveCardNextDueDate(card, plans, rows);
        const newValue = resolveCardNextDueDate(card, plans, rows);

        const decided = rows.filter(r => r.paymentAction === 'full' || r.paymentAction === 'minimum').map(r => r.month);
        const lastDecided = decided.length ? decided.reduce((a, b) => (a > b ? a : b)) : null;
        const undecided = rows.filter(r => r.paymentAction === null && r.amountDue > 0).map(r => r.month);
        const planMonths = plans.flatMap(p => p.schedule.filter(r => !r.paid).map(r => r.dueMonth));

        // 1. identity when no positive undecided cycle sits at or before the latest decided one
        if (lastDecided === null || undecided.every(m => m > lastDecided)) expect(newValue).toBe(oldValue);
        // 2. monotonic: never earlier than old (null counts as later)
        if (oldValue === null) expect(newValue).toBeNull();
        else if (newValue !== null) expect(newValue >= oldValue).toBe(true);
        // 3. result always comes from a real candidate month
        if (newValue !== null) {
          const allowed = [...planMonths, ...undecided.filter(m => lastDecided === null || m > lastDecided)].map(m => resolveCardDueDate(card, m));
          expect(allowed).toContain(newValue);
        }
        if (newValue !== oldValue) differing += 1;
      }
      expect(differing).toBeGreaterThan(0);
    });
  });
});
