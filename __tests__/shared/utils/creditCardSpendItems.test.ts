/** @jest-environment node */
// spec-credit-card-spend: SPEND-2 in buildRevolvingCycles, the month-set fix (§3.1), the
// buildRevolvingCyclesForData wrapper (§5.2), validateSpendItemInput (§4.1 / AC-S5) and the
// regression invariants 1-8 of spec §2 (AC-S15). Pure functions only — no I/O anywhere.
import fs from 'fs';
import path from 'path';
import {
  buildRevolvingCycles,
  buildRevolvingCyclesForData,
  isRevolvingChainTruncated,
  summariseCard,
  validateSpendItemInput,
  type StoredSpendItem,
  type StoredRevolvingCycle
} from '../../../src/shared/utils/creditCardRevolving';
import {
  MAX_REVOLVING_CYCLES_PER_CARD,
  addMonths
} from '../../../src/shared/utils/creditCardBasics';

const CARD = { id: 'cc_aaaaaaaaaaaa', annualRate: 12, minPaymentPercent: 10 };
const OTHER = { id: 'cc_bbbbbbbbbbbb', annualRate: 12, minPaymentPercent: 10 };

let seq = 0;
function item(month: string, amount: number | string, cardId = CARD.id): StoredSpendItem {
  seq += 1;
  return { id: `si_${String(seq).padStart(12, '0')}`, cardId, month, name: `item ${seq}`, amount, source: 'user' };
}

describe('invariant 7: no spendItems -> output identical to today', () => {
  const stored: StoredRevolvingCycle[] = [
    { id: 'rc_1', cardId: CARD.id, month: '2026-01', newSpend: 1000, paymentAction: 'minimum', paidAt: 'p1', paidSource: 'credit_card' },
    { id: 'rc_2', cardId: CARD.id, month: '2026-02', newSpend: 500, paymentAction: null, paidAt: null, paidSource: null }
  ];

  // Literal hand-computed from the pre-change formula (annualRate 12 -> 1%/month, min 10%)
  const EXPECTED = [
    {
      id: 'rc_1', cardId: CARD.id, month: '2026-01', newSpend: 1000, cashbackAmount: 0, carriedBalance: 0,
      totalDue: 1000, minPaymentDue: 100, paymentAction: 'minimum', amountDue: 100, paidAmount: 100,
      interest: 9, closingBalance: 909, creditBalance: 0, paidAt: 'p1', paidSource: 'credit_card',
      minimumPreview: { remaining: 900, interest: 9, closingBalance: 909 }, stored: true, isImplicit: false
    },
    {
      id: 'rc_2', cardId: CARD.id, month: '2026-02', newSpend: 500, cashbackAmount: 0, carriedBalance: 909,
      totalDue: 1409, minPaymentDue: 140.9, paymentAction: null, amountDue: 1409, paidAmount: 0,
      interest: 0, closingBalance: 1409, creditBalance: 0, paidAt: null, paidSource: null,
      minimumPreview: { remaining: 1268.1, interest: 12.68, closingBalance: 1280.78 }, stored: true, isImplicit: false
    }
  ];

  it('matches the hand-computed literal', () => {
    const chain = buildRevolvingCycles(CARD, stored, { throughMonth: '2026-02' });
    expect(chain).toEqual(EXPECTED);
    expect(isRevolvingChainTruncated(chain)).toBe(false);
  });

  it.each([
    ['no option', {}],
    ['spendItems undefined', { spendItems: undefined }],
    ['spendItems []', { spendItems: [] }],
    ['spendItems of another card only', { spendItems: [item('2026-01', 999, OTHER.id), item('2026-03', 5, OTHER.id)] }],
    ['spendItems not an array', { spendItems: 'garbage' }]
  ])('is byte-identical with %s', (_label, extra) => {
    const base = buildRevolvingCycles(CARD, stored, { throughMonth: '2026-02' });
    const variant = buildRevolvingCycles(CARD, stored, { throughMonth: '2026-02', ...extra });
    expect(JSON.stringify(variant)).toBe(JSON.stringify(base));
    expect(isRevolvingChainTruncated(variant)).toBe(isRevolvingChainTruncated(base));
  });

  it('a card with no cycles and no items still yields []', () => {
    const chain = buildRevolvingCycles(CARD, [], { throughMonth: '2026-02', spendItems: [] });
    expect(chain).toEqual([]);
    expect(isRevolvingChainTruncated(chain)).toBe(false);
  });
});

describe('SPEND-2 / §3.1 month set', () => {
  it('AC-S2: an item month with no stored cycle appears in the chain as a virtual cycle', () => {
    const chain = buildRevolvingCycles(CARD, [], {
      throughMonth: '2026-03',
      spendItems: [item('2026-03', 300), item('2026-03', '200.50')]
    });
    expect(chain).toHaveLength(1);
    expect(chain[0]).toMatchObject({
      id: null, month: '2026-03', newSpend: 500.5, cashbackAmount: 0, carriedBalance: 0, totalDue: 500.5,
      paymentAction: null, amountDue: 500.5, stored: false, isImplicit: false
    });
  });

  it('items override the stored legacy newSpend for that month only', () => {
    const stored = [
      { id: 'rc_1', cardId: CARD.id, month: '2026-01', newSpend: 2064, paymentAction: 'full' },
      { id: 'rc_2', cardId: CARD.id, month: '2026-02', newSpend: 777, paymentAction: null }
    ];
    const chain = buildRevolvingCycles(CARD, stored, { throughMonth: '2026-02', spendItems: [item('2026-01', 100)] });
    expect(chain.map(c => [c.month, c.newSpend, c.stored])).toEqual([['2026-01', 100, true], ['2026-02', 777, true]]);
  });

  it('AC-S3: a legacy cycle with newSpend and no items yields the same numbers as without the option', () => {
    const stored = [{ id: 'rc_1', cardId: CARD.id, month: '2026-01', newSpend: 777, paymentAction: null }];
    const a = buildRevolvingCycles(CARD, stored, { throughMonth: '2026-01' });
    const b = buildRevolvingCycles(CARD, stored, { throughMonth: '2026-01', spendItems: [item('2026-05', 1, OTHER.id)] });
    expect(b).toEqual(a);
    expect(b[0].newSpend).toBe(777);
  });

  it('zero-sum items still override (items exist -> sum, not fallback)', () => {
    const stored = [{ id: 'rc_1', cardId: CARD.id, month: '2026-01', newSpend: 500, paymentAction: null }];
    const chain = buildRevolvingCycles(CARD, stored, { throughMonth: '2026-01', spendItems: [item('2026-01', 0)] });
    expect(chain[0].newSpend).toBe(0);
  });

  it('defensive: negative / non-numeric / malformed-month items count as 0 or are ignored', () => {
    const chain = buildRevolvingCycles(CARD, [], {
      throughMonth: '2026-01',
      spendItems: [item('2026-01', 100), item('2026-01', -50), item('2026-01', 'abc'), item('bad', 999), null as never]
    });
    expect(chain).toHaveLength(1);
    expect(chain[0].newSpend).toBe(100);
  });

  it('round2 on the sum (0.1 + 0.2)', () => {
    const chain = buildRevolvingCycles(CARD, [], { throughMonth: '2026-01', spendItems: [item('2026-01', 0.1), item('2026-01', 0.2)] });
    expect(chain[0].newSpend).toBe(0.3);
  });
});

describe('invariants 1-6', () => {
  it('1/2: totalDue goes negative (no Math.max), credit cycle stays credit regardless of paymentAction', () => {
    const stored = [{ id: 'rc_1', cardId: CARD.id, month: '2026-01', cashbackAmount: 300, paymentAction: 'full' }];
    const chain = buildRevolvingCycles(CARD, stored, { throughMonth: '2026-02', spendItems: [item('2026-01', 100), item('2026-02', 50)] });
    expect(chain[0]).toMatchObject({
      totalDue: -200, amountDue: 0, interest: 0, paidAmount: 0, closingBalance: -200, creditBalance: 200, minPaymentDue: 0, paymentAction: 'full'
    });
    expect(chain[1]).toMatchObject({ carriedBalance: -200, newSpend: 50, totalDue: -150, amountDue: 0, closingBalance: -150, creditBalance: 150 });
  });

  it('3: minPaymentDue = min(totalDue, round2(totalDue * minPct / 100)), 0 when totalDue <= 0', () => {
    const spendItems = [item('2026-01', 1000), item('2026-01', 234.56)];
    expect(buildRevolvingCycles(CARD, [], { throughMonth: '2026-01', spendItems })[0].minPaymentDue).toBe(123.46);
    const full = { ...CARD, minPaymentPercent: 100 };
    expect(buildRevolvingCycles(full, [], { throughMonth: '2026-01', spendItems })[0].minPaymentDue).toBe(1234.56);
  });

  it('4: minimum path closingBalance = round2(remaining + round2(max(0, remaining) * annualRate/100/12))', () => {
    const card = { ...CARD, annualRate: 18 };
    const stored = [{ id: 'rc_1', cardId: CARD.id, month: '2026-01', paymentAction: 'minimum' }];
    const chain = buildRevolvingCycles(card, stored, { throughMonth: '2026-02', spendItems: [item('2026-01', 1000)] });
    expect(chain[0]).toMatchObject({ totalDue: 1000, minPaymentDue: 100, amountDue: 100, interest: 13.5, closingBalance: 913.5 });
    expect(chain[1]).toMatchObject({ month: '2026-02', carriedBalance: 913.5, totalDue: 913.5, stored: false, isImplicit: true });
  });

  it('5: chain capped at MAX_REVOLVING_CYCLES_PER_CARD, truncated flag readable via isRevolvingChainTruncated', () => {
    const months = Array.from({ length: 70 }, (_, i) => addMonths('2020-01', i));
    const chain = buildRevolvingCycles(CARD, [], {
      throughMonth: months[months.length - 1],
      spendItems: months.map(m => item(m, 10))
    });
    expect(chain.length).toBe(MAX_REVOLVING_CYCLES_PER_CARD);
    expect(isRevolvingChainTruncated(chain)).toBe(true);
    expect(chain[chain.length - 1].month).toBe('2025-10');
  });

  it('6: empty months with zero carry are skipped, not break', () => {
    const stored = [{ id: 'rc_1', cardId: CARD.id, month: '2026-01', newSpend: 100, paymentAction: 'full' }];
    const chain = buildRevolvingCycles(CARD, stored, { throughMonth: '2026-05', spendItems: [item('2026-05', 40)] });
    expect(chain.map(c => c.month)).toEqual(['2026-01', '2026-05']);
    expect(chain[1]).toMatchObject({ carriedBalance: 0, newSpend: 40, totalDue: 40 });
  });
});

describe('invariant 8: buildRevolvingCycles stays pure', () => {
  function deepFreeze<T>(value: T): T {
    if (value && typeof value === 'object') {
      Object.values(value as Record<string, unknown>).forEach(deepFreeze);
      Object.freeze(value);
    }
    return value;
  }

  it('does not mutate its inputs and is deterministic', () => {
    const card = deepFreeze({ ...CARD });
    const stored = deepFreeze([{ id: 'rc_1', cardId: CARD.id, month: '2026-01', newSpend: 10, paymentAction: null }]);
    const spendItems = deepFreeze([item('2026-02', 20)]);
    const before = JSON.stringify({ card, stored, spendItems });
    const a = buildRevolvingCycles(card, stored, { throughMonth: '2026-02', spendItems });
    const b = buildRevolvingCycles(card, stored, { throughMonth: '2026-02', spendItems });
    expect(JSON.stringify({ card, stored, spendItems })).toBe(before);
    expect(a).toEqual(b);
  });

  it('creditCardRevolving.ts imports no I/O module', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'src/shared/utils/creditCardRevolving.ts'), 'utf8');
    const imports = source.match(/from\s+'[^']+'/g) || [];
    expect(imports.filter(spec => /fs|path|mongo|dataSource|userUtils|creditCardStore/.test(spec))).toEqual([]);
  });
});

describe('buildRevolvingCyclesForData wrapper and call sites (§5.2)', () => {
  it('passes data.spendItems through', () => {
    const data = { cycles: [], spendItems: [item('2026-01', 42)] };
    expect(buildRevolvingCyclesForData(CARD, data, { throughMonth: '2026-01' })[0].newSpend).toBe(42);
  });

  it('summariseCard uses options.spendItems', () => {
    const summary = summariseCard(CARD, [], [], { asOfMonth: '2026-01', spendItems: [item('2026-01', 250)] });
    expect(summary.revolvingTotalDue).toBe(250);
    expect(summary.revolvingDue).toBe(250);
  });

  function listSources(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return listSources(full);
      return /\.(ts|tsx)$/.test(entry.name) ? [full] : [];
    });
  }
  const roots = ['pages', 'src', 'lib'].map(root => path.join(process.cwd(), root));
  const files = roots.flatMap(listSources);

  it('no production call site invokes buildRevolvingCycles directly (only via the wrapper)', () => {
    const offenders = files
      .filter(file => !file.endsWith(path.join('utils', 'creditCardRevolving.ts')))
      .filter(file => /\bbuildRevolvingCycles\(\s*[A-Za-z]/.test(fs.readFileSync(file, 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('every summariseCard call in pages/ passes spendItems', () => {
    const calls = files
      .filter(file => file.includes(`${path.sep}pages${path.sep}`))
      .flatMap(file => fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(line => /\bsummariseCard\(/.test(line)));
    expect(calls.length).toBeGreaterThan(0);
    calls.forEach(line => expect(line).toMatch(/spendItems/));
  });
});

describe('validateSpendItemInput (AC-S5 / SPEND-3)', () => {
  const valid = { cardId: CARD.id, month: '2026-03', name: '  กาแฟ  ', amount: '1,234.567' };

  it('accepts and normalises a valid create input, ignoring every other field', () => {
    const result = validateSpendItemInput({ ...valid, newSpend: 999, source: 'migration', totalDue: 5 });
    expect(result.valid).toBe(true);
    expect(result.value).toEqual({ id: '', cardId: CARD.id, month: '2026-03', name: 'กาแฟ', amount: 1234.57 });
  });

  it('name of 61 chars -> error; 60 chars ok', () => {
    expect(validateSpendItemInput({ ...valid, name: 'a'.repeat(61) }).errors.name).toBeDefined();
    expect(validateSpendItemInput({ ...valid, name: 'a'.repeat(60) }).valid).toBe(true);
  });

  it.each([[-1], ['abc'], [''], [null], [true], [{}], [10000000]])('amount %p -> error', amount => {
    const result = validateSpendItemInput({ ...valid, amount });
    expect(result.valid).toBe(false);
    expect(result.errors.amount).toBeDefined();
  });

  it('amount 0 is allowed', () => {
    expect(validateSpendItemInput({ ...valid, amount: 0 }).valid).toBe(true);
  });

  it('missing card / bad month / empty name -> errors', () => {
    const result = validateSpendItemInput({ month: '2026-13x', name: '   ', amount: 1 });
    expect(Object.keys(result.errors).sort()).toEqual(['cardId', 'month', 'name']);
  });

  it('update mode needs a valid id and at least one of name/amount; cardId/month are ignored', () => {
    expect(validateSpendItemInput({ id: 'nope', name: 'x' }, { mode: 'update' }).errors.id).toBeDefined();
    expect(validateSpendItemInput({ id: 'si_0123456789ab' }, { mode: 'update' }).errors.item).toBeDefined();
    const result = validateSpendItemInput({ id: 'si_0123456789ab', amount: 5, cardId: 'cc_other', month: '2020-01' }, { mode: 'update' });
    expect(result.valid).toBe(true);
    expect(result.value).toEqual({ id: 'si_0123456789ab', cardId: '', month: '', amount: 5 });
  });
});
