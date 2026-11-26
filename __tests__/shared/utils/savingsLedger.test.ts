// Savings loan & withdrawal S1 — pure ledger core contract (spec-savings-loan-withdrawal §3/§4.1, AC-SLW-01,
// E-SLW-12/19/20, D-SLW-13/18/19/20, UX_SPEC §6.3).
import {
  MAX_LEDGER_AMOUNT,
  MAX_LEDGER_NOTE_LENGTH,
  MAX_OPEN_LOANS_PER_USER,
  MAX_REPAYMENTS_PER_LOAN,
  REPAYMENT_ROW_PREFIX,
  buildRepaymentRowKey,
  computePoolBalance,
  formatLoanAge,
  formatSourceLabel,
  isSameSource,
  isSavingsLoanRepaymentRowKey,
  normalizeLedgerNote,
  parseLedgerSource,
  planRepayment,
  readLoans,
  readWithdrawals,
  sourceKey,
  sumLifetimeSavings,
  summarizeLedger,
  toLedgerAmount,
  withBalanceAfter,
  type SavingsLoan,
  type SavingsLoanRepayment,
  type SavingsWithdrawal,
} from '../../../src/shared/utils/savingsLedger';

const NOW = '2026-11-13T10:00:00.000Z';
const EARLIER = '2026-11-01T00:00:00.000Z';
const REPAYMENT_ID = 'a'.repeat(24);

function repayment(overrides: Partial<SavingsLoanRepayment> = {}): SavingsLoanRepayment {
  const _id = overrides._id ?? 'b'.repeat(24);
  return { _id, amount: 100, expenseMonth: '2026-10', expenseRowKey: `slr_${_id}`, createdAt: EARLIER, ...overrides };
}

function loan(overrides: Partial<SavingsLoan> = {}): SavingsLoan {
  return {
    _id: 'loan-1',
    userId: 'u001',
    source: { type: 'pool' },
    principalAmount: 1000,
    outstandingAmount: 1000,
    status: 'open',
    note: null,
    createdAt: EARLIER,
    updatedAt: EARLIER,
    closedAt: null,
    repayments: [],
    ...overrides,
  };
}

function withdrawal(overrides: Partial<SavingsWithdrawal> = {}): SavingsWithdrawal {
  return { _id: 'wd-1', userId: 'u001', source: { type: 'pool' }, amount: 500, note: null, createdAt: EARLIER, ...overrides };
}

describe('constants', () => {
  it('match the spec (D-SLW-13/18/19/20)', () => {
    expect(MAX_LEDGER_NOTE_LENGTH).toBe(120);
    expect(MAX_OPEN_LOANS_PER_USER).toBe(50);
    expect(MAX_REPAYMENTS_PER_LOAN).toBe(360);
    expect(MAX_LEDGER_AMOUNT).toBe(999999999.99);
    expect(REPAYMENT_ROW_PREFIX).toBe('slr_');
  });
});

describe('toLedgerAmount (D-SLW-18, E-SLW-19)', () => {
  it.each([
    ['1,500.50', 1500.5],
    [1500.5, 1500.5],
    ['250', 250],
    [0.005, 0.01],
    [12.346, 12.35],
    [MAX_LEDGER_AMOUNT, MAX_LEDGER_AMOUNT],
    ['999,999,999.99', MAX_LEDGER_AMOUNT],
  ])('accepts %p → %p', (value, expected) => {
    expect(toLedgerAmount(value)).toBe(expected);
  });

  it.each([
    [0],
    ['0.004'],
    [-5],
    [true],
    [[5]],
    [Infinity],
    [1e12],
    [NaN],
    ['abc'],
    [null],
    [undefined],
    [{}],
    [1_000_000_000],
  ])('rejects %p', (value) => {
    expect(toLedgerAmount(value)).toBeNull();
  });
});

describe('normalizeLedgerNote (D-SLW-19)', () => {
  it.each([[undefined], [null], [''], ['   ']])('%p → null', (value) => {
    expect(normalizeLedgerNote(value)).toEqual({ ok: true, note: null });
  });

  it('trims and keeps a valid note', () => {
    expect(normalizeLedgerNote('  ซ่อมรถ  ')).toEqual({ ok: true, note: 'ซ่อมรถ' });
  });

  it('accepts exactly 120 characters and rejects 121', () => {
    expect(normalizeLedgerNote('x'.repeat(120))).toEqual({ ok: true, note: 'x'.repeat(120) });
    expect(normalizeLedgerNote('x'.repeat(121))).toEqual({ ok: false, error: 'note_too_long' });
  });

  it.each([[5], [true], [['note']], [{ $ne: null }]])('rejects non-string %p', (value) => {
    expect(normalizeLedgerNote(value)).toEqual({ ok: false, error: 'invalid_note' });
  });
});

describe('parseLedgerSource', () => {
  it('accepts a pool source', () => {
    expect(parseLedgerSource({ type: 'pool' })).toEqual({ ok: true, source: { type: 'pool' } });
  });

  it('drops goalId from a pool source (E-SLW-20)', () => {
    const result = parseLedgerSource({ type: 'pool', goalId: 'x' });
    expect(result).toEqual({ ok: true, source: { type: 'pool' } });
    expect(result.ok && 'goalId' in result.source).toBe(false);
  });

  it('accepts a goal source with a goalId', () => {
    expect(parseLedgerSource({ type: 'goal', goalId: 'g1' })).toEqual({ ok: true, source: { type: 'goal', goalId: 'g1' } });
  });

  it.each([[undefined], [{}], [''], [{ goalId: 'g1' }], [{ type: 'POOL' }], [{ type: 'other' }], [null], ['pool'], [[{ type: 'pool' }]]])(
    'rejects %p as invalid_source',
    (value) => {
      expect(parseLedgerSource(value)).toEqual({ ok: false, error: 'invalid_source' });
    }
  );

  it.each([[undefined], [''], ['   '], [5], [{ $ne: null }], [['g1']]])('rejects goalId %p as goal_id_required', (goalId) => {
    expect(parseLedgerSource({ type: 'goal', goalId })).toEqual({ ok: false, error: 'goal_id_required' });
  });
});

describe('readLoans / readWithdrawals', () => {
  it('treats a non-array as []', () => {
    expect(readLoans(undefined)).toEqual([]);
    expect(readLoans({})).toEqual([]);
    expect(readWithdrawals('x')).toEqual([]);
  });

  it('skips entries without a string _id, a valid source or finite numbers, and keeps order', () => {
    const raw = [
      loan({ _id: 'keep-1' }),
      { ...loan(), _id: 42 },
      { ...loan({ _id: 'bad-source' }), source: { type: 'nope' } },
      { ...loan({ _id: 'bad-num' }), outstandingAmount: 'x' },
      { ...loan({ _id: 'bad-principal' }), principalAmount: Infinity },
      null,
      loan({ _id: 'keep-2', source: { type: 'goal', goalId: 'g1' } }),
    ];
    expect(readLoans(raw).map(l => l._id)).toEqual(['keep-1', 'keep-2']);
  });

  it('reads a non-array repayments as [] and drops invalid repayment entries', () => {
    const raw = [
      { ...loan({ _id: 'l1' }), repayments: 'nope' },
      { ...loan({ _id: 'l2' }), repayments: [repayment(), { _id: 5, amount: 1 }, { _id: 'r', amount: NaN }] },
    ];
    const [l1, l2] = readLoans(raw);
    expect(l1.repayments).toEqual([]);
    expect(l2.repayments).toEqual([repayment()]);
  });

  it('normalizes a pool source stored with a goalId', () => {
    const [read] = readLoans([{ ...loan(), source: { type: 'pool', goalId: 'g1' } }]);
    expect(read.source).toEqual({ type: 'pool' });
  });

  it('reads withdrawals with the same rules', () => {
    const raw = [withdrawal({ _id: 'w1' }), { ...withdrawal(), _id: '' }, { ...withdrawal({ _id: 'w3' }), amount: '5' }, withdrawal({ _id: 'w4' })];
    expect(readWithdrawals(raw).map(w => w._id)).toEqual(['w1', 'w4']);
  });
});

describe('sourceKey / isSameSource', () => {
  it('keys pool and goal sources', () => {
    expect(sourceKey({ type: 'pool' })).toBe('pool');
    expect(sourceKey({ type: 'goal', goalId: 'g1' })).toBe('goal:g1');
  });

  it('compares sources', () => {
    expect(isSameSource({ type: 'pool' }, { type: 'pool' })).toBe(true);
    expect(isSameSource({ type: 'goal', goalId: 'g1' }, { type: 'goal', goalId: 'g1' })).toBe(true);
    expect(isSameSource({ type: 'goal', goalId: 'g1' }, { type: 'goal', goalId: 'g2' })).toBe(false);
    expect(isSameSource({ type: 'pool' }, { type: 'goal', goalId: 'g1' })).toBe(false);
  });
});

describe('summarizeLedger', () => {
  it('sums per source; closed loans add 0; counts open loans', () => {
    const loans = [
      loan({ _id: 'p1', outstandingAmount: 2000 }),
      loan({ _id: 'p2', outstandingAmount: 0, status: 'closed' }),
      loan({ _id: 'g1a', source: { type: 'goal', goalId: 'g1' }, outstandingAmount: 1200 }),
      loan({ _id: 'g2a', source: { type: 'goal', goalId: 'g2' }, outstandingAmount: 0.1 }),
      loan({ _id: 'g2b', source: { type: 'goal', goalId: 'g2' }, outstandingAmount: 0.2 }),
    ];
    const withdrawals = [
      withdrawal({ _id: 'w1', amount: 500 }),
      withdrawal({ _id: 'w2', source: { type: 'goal', goalId: 'g1' }, amount: 300 }),
      withdrawal({ _id: 'w3', source: { type: 'goal', goalId: 'g3' }, amount: 50 }),
    ];
    const summary = summarizeLedger(loans, withdrawals);
    expect(summary.pool).toEqual({ outstanding: 2000, withdrawn: 500 });
    expect(summary.byGoal.get('g1')).toEqual({ outstanding: 1200, withdrawn: 300 });
    expect(summary.byGoal.get('g2')).toEqual({ outstanding: 0.3, withdrawn: 0 });
    expect(summary.byGoal.get('g3')).toEqual({ outstanding: 0, withdrawn: 50 });
    expect(summary.totalOutstanding).toBe(3200.3);
    expect(summary.openLoanCount).toBe(4);
  });

  it('returns all zeros for no data (E-SLW-30)', () => {
    const summary = summarizeLedger([], []);
    expect(summary.pool).toEqual({ outstanding: 0, withdrawn: 0 });
    expect(summary.byGoal.size).toBe(0);
    expect(summary.totalOutstanding).toBe(0);
    expect(summary.openLoanCount).toBe(0);
  });
});

describe('sumLifetimeSavings', () => {
  const sumList = (list: unknown) => (Array.isArray(list) ? list.reduce((s: number, i: { amount: number }) => s + i.amount, 0) : 0);

  it('sums only docs with a string month, rounded to 2dp', () => {
    const docs = [
      { month: '2026-09', savings_list: [{ amount: 0.1 }, { amount: 0.2 }] },
      { month: '2026-10', savings_list: [{ amount: 1000 }] },
      { savings_list: [{ amount: 99999 }] },
      { month: 202611, savings_list: [{ amount: 99999 }] },
      null,
    ];
    expect(sumLifetimeSavings(docs, sumList)).toBe(1000.3);
  });

  it('passes each doc savings_list to the injected function', () => {
    const fn = jest.fn(() => 1);
    sumLifetimeSavings([{ month: '2026-01', savings_list: 'raw' }], fn);
    expect(fn).toHaveBeenCalledWith('raw');
  });
});

describe('computePoolBalance', () => {
  it('matches the AC-SLW-04 fixture', () => {
    const summary = summarizeLedger(
      [
        loan({ outstandingAmount: 2000, repayments: [repayment({ amount: 1000 })], principalAmount: 3000 }),
        loan({ _id: 'g', source: { type: 'goal', goalId: 'g1' }, outstandingAmount: 400 }),
      ],
      [withdrawal({ amount: 500 })]
    );
    expect(computePoolBalance(10000, summary)).toEqual({
      poolSavingsTotal: 10000,
      poolOutstanding: 2000,
      poolWithdrawn: 500,
      poolBalance: 7500,
      poolCarriedForward: 0,
    });
    expect(summary.totalOutstanding).toBe(2400);
  });

  it('allows a negative balance (E-SLW-12)', () => {
    const summary = summarizeLedger([loan({ outstandingAmount: 3000 })], []);
    expect(computePoolBalance(1000, summary).poolBalance).toBe(-2000);
  });

  it('rounds to 2dp and never returns -0 from float dust', () => {
    const summary = summarizeLedger([loan({ outstandingAmount: 0.1 })], [withdrawal({ amount: 0.2 })]);
    expect(Object.is(computePoolBalance(0.3, summary).poolBalance, 0)).toBe(true);
  });
});

describe('repayment row keys (D-SLW-13)', () => {
  it('builds slr_ keys', () => {
    expect(buildRepaymentRowKey(REPAYMENT_ID)).toBe(`slr_${REPAYMENT_ID}`);
  });

  it.each([[`slr_${'0123456789abcdef01234567'}`]])('accepts %p', (key) => {
    expect(isSavingsLoanRepaymentRowKey(key)).toBe(true);
  });

  it.each([
    [`slr_${'a'.repeat(23)}`],
    [`slr_${'a'.repeat(25)}`],
    [`slr_${'A'.repeat(24)}`],
    [`cci_${'a'.repeat(24)}`],
    [`xslr_${'a'.repeat(24)}`],
    ['slr_'],
    [5],
    [null],
  ])('rejects %p', (key) => {
    expect(isSavingsLoanRepaymentRowKey(key)).toBe(false);
  });
});

describe('planRepayment', () => {
  it('applies a partial repayment and keeps the loan open', () => {
    const result = planRepayment(loan(), 300, NOW, REPAYMENT_ID, '2026-11');
    expect(result).toEqual({
      ok: true,
      applied: 300,
      repayment: { _id: REPAYMENT_ID, amount: 300, expenseMonth: '2026-11', expenseRowKey: `slr_${REPAYMENT_ID}`, createdAt: NOW },
      nextLoan: expect.objectContaining({ outstandingAmount: 700, status: 'open', closedAt: null, updatedAt: NOW }),
    });
    if (result.ok) expect(result.nextLoan.repayments).toHaveLength(1);
  });

  it('clamps to the outstanding balance and closes the loan (E-SLW-6)', () => {
    const result = planRepayment(loan({ principalAmount: 1200, outstandingAmount: 1200 }), 2000, NOW, REPAYMENT_ID, '2026-11');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.applied).toBe(1200);
    expect(result.repayment.amount).toBe(1200);
    expect(result.nextLoan.outstandingAmount).toBe(0);
    expect(result.nextLoan.status).toBe('closed');
    expect(result.nextLoan.closedAt).toBe(NOW);
  });

  it('closes at exactly 0 with float dust', () => {
    const result = planRepayment(loan({ outstandingAmount: 0.3 }), 0.3, NOW, REPAYMENT_ID, '2026-11');
    expect(result.ok && result.nextLoan.outstandingAmount).toBe(0);
    expect(result.ok && result.nextLoan.status).toBe('closed');
  });

  it('refuses a closed loan (E-SLW-7)', () => {
    expect(planRepayment(loan({ status: 'closed', outstandingAmount: 0 }), 100, NOW, REPAYMENT_ID, '2026-11'))
      .toEqual({ ok: false, status: 409, error: 'loan_closed' });
    expect(planRepayment(loan({ status: 'open', outstandingAmount: 0 }), 100, NOW, REPAYMENT_ID, '2026-11'))
      .toEqual({ ok: false, status: 409, error: 'loan_closed' });
  });

  it('refuses the 361st repayment', () => {
    const full = loan({
      principalAmount: 100000,
      outstandingAmount: 99640,
      repayments: Array.from({ length: MAX_REPAYMENTS_PER_LOAN }, (_, i) => repayment({ _id: `r${i}`, amount: 1 })),
    });
    expect(planRepayment(full, 1, NOW, REPAYMENT_ID, '2026-11')).toEqual({ ok: false, status: 409, error: 'repayment_limit' });
    const almost = { ...full, repayments: full.repayments.slice(1) };
    expect(planRepayment(almost, 1, NOW, REPAYMENT_ID, '2026-11').ok).toBe(true);
  });

  it('never mutates its input', () => {
    const input = loan({ outstandingAmount: 500, repayments: [repayment({ amount: 500 })] });
    const snapshot = JSON.parse(JSON.stringify(input));
    const result = planRepayment(input, 500, NOW, REPAYMENT_ID, '2026-11');
    expect(input).toEqual(snapshot);
    expect(result.ok && result.nextLoan.repayments).not.toBe(input.repayments);
    expect(result.ok && result.nextLoan.source).not.toBe(input.source);
  });
});

describe('withBalanceAfter', () => {
  it('adds a running balanceAfter without mutating the loan', () => {
    const input = loan({
      principalAmount: 3000,
      outstandingAmount: 1799.9,
      repayments: [repayment({ _id: 'r1', amount: 1000 }), repayment({ _id: 'r2', amount: 200.1 })],
    });
    const snapshot = JSON.parse(JSON.stringify(input));
    const result = withBalanceAfter(input);
    expect(result.repayments.map(r => r.balanceAfter)).toEqual([2000, 1799.9]);
    expect(result.repayments[0]).toEqual({ ...input.repayments[0], balanceAfter: 2000 });
    expect(input).toEqual(snapshot);
    expect('balanceAfter' in input.repayments[0]).toBe(false);
  });

  it('handles a loan without repayments', () => {
    expect(withBalanceAfter(loan()).repayments).toEqual([]);
  });
});

describe('formatLoanAge (UX_SPEC §6.3, Asia/Bangkok calendar dates)', () => {
  // Bangkok is UTC+7: 2026-11-13T10:00Z is 17:00 on 13 Nov in Bangkok.
  it.each([
    ['same instant', '2026-11-13T10:00:00.000Z', 'เปิดวันนี้'],
    ['earlier the same Bangkok day (00:30 local)', '2026-11-12T17:30:00.000Z', 'เปิดวันนี้'],
    ['previous Bangkok day by 1 minute (23:59 local on 12 Nov)', '2026-11-12T16:59:00.000Z', 'เปิดมา 1 วัน'],
    ['12 days ago', '2026-11-01T00:00:00.000Z', 'เปิดมา 12 วัน'],
    ['30 days, under a full month', '2026-10-14T03:00:00.000Z', 'เปิดมา 30 วัน'],
    ['exactly 1 full month', '2026-10-13T03:00:00.000Z', 'เปิดมา 1 เดือน'],
    ['11 full months', '2025-12-13T03:00:00.000Z', 'เปิดมา 11 เดือน'],
    ['one day short of 12 months', '2025-11-14T03:00:00.000Z', 'เปิดมา 11 เดือน'],
    ['exactly 1 year', '2025-11-13T03:00:00.000Z', 'เปิดมา 1 ปี'],
    ['2 years, remainder 0', '2024-11-13T03:00:00.000Z', 'เปิดมา 2 ปี'],
    ['1 year 2 months', '2025-09-01T03:00:00.000Z', 'เปิดมา 1 ปี 2 เดือน'],
    ['a future createdAt reads as today', '2026-11-20T03:00:00.000Z', 'เปิดวันนี้'],
  ])('%s → %p', (_label, createdAt, expected) => {
    expect(formatLoanAge(createdAt, NOW)).toBe(expected);
  });

  it('uses Bangkok, not UTC, at the day boundary', () => {
    // 2026-11-13T17:30Z is 00:30 on 14 Nov in Bangkok, one calendar day after 13 Nov local.
    expect(formatLoanAge('2026-11-13T03:00:00.000Z', '2026-11-13T17:30:00.000Z')).toBe('เปิดมา 1 วัน');
  });

  it('applies the "d2 < d1" full-month rule across a short month', () => {
    // 31 Jan → 28 Feb (Bangkok): 0 full months, 28 days. 31 Jan → 1 Mar: 1 full month.
    expect(formatLoanAge('2026-01-31T03:00:00.000Z', '2026-02-28T03:00:00.000Z')).toBe('เปิดมา 28 วัน');
    expect(formatLoanAge('2026-01-31T03:00:00.000Z', '2026-03-01T03:00:00.000Z')).toBe('เปิดมา 1 เดือน');
  });

  it('accepts a Date for now', () => {
    expect(formatLoanAge('2026-11-01T00:00:00.000Z', new Date(NOW))).toBe('เปิดมา 12 วัน');
  });

  it.each([[''], ['not-a-date'], [undefined as unknown as string]])('returns "" for unparseable createdAt %p', (createdAt) => {
    expect(formatLoanAge(createdAt, NOW)).toBe('');
  });

  it('returns "" for an unparseable now', () => {
    expect(formatLoanAge(EARLIER, 'garbage')).toBe('');
  });

  it('never uses deadline wording (AC-SLW-28)', () => {
    const samples = ['2026-11-13T10:00:00.000Z', '2026-11-01T00:00:00.000Z', '2025-11-13T03:00:00.000Z', '2025-09-01T03:00:00.000Z']
      .map(createdAt => formatLoanAge(createdAt, NOW));
    for (const text of samples) {
      for (const banned of ['กำหนด', 'ครบกำหนด', 'เกิน', 'ค้างชำระ']) {
        expect(text).not.toContain(banned);
      }
    }
  });
});

describe('formatSourceLabel', () => {
  const names = new Map([['g1', 'เที่ยวญี่ปุ่น']]);

  it('labels the pool, a known goal and a deleted goal', () => {
    expect(formatSourceLabel({ type: 'pool' }, names)).toBe('ยอดกลาง');
    expect(formatSourceLabel({ type: 'goal', goalId: 'g1' }, names)).toBe('เป้าหมาย: เที่ยวญี่ปุ่น');
    expect(formatSourceLabel({ type: 'goal', goalId: 'gone' }, names)).toBe('เป้าหมายที่ลบแล้ว');
  });
});
