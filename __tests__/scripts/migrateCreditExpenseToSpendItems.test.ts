/** @jest-environment node */
import {
  createJsonMigrationStore,
  createMongoMigrationStore,
  decodeJsonSnapshot,
  MigrationMappingRequiredError,
  parseMigrationArgs,
  parseMigrationMap,
  planMigration,
  runMigration,
  type MigrationCreditData,
  type MigrationJsonIO,
  type MigrationMongoCollection,
  type MigrationSnapshot,
  type MigrationStore
} from '../../scripts/migrateCreditExpenseToSpendItems';
import {
  MAX_REVOLVING_CYCLES_PER_CARD,
  MAX_SPEND_ITEM_AMOUNT,
  MAX_SPEND_ITEMS_PER_CARD,
  MAX_SPEND_ITEMS_PER_CYCLE,
  addMonths
} from '../../src/shared/utils/creditCardBasics';

const NOW = '2026-10-29T11:00:00.000Z';
const CARD = 'cc_aaaaaaaaaaaa';
const SECOND = 'cc_bbbbbbbbbbbb';
const MONTH = '2026-10';
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
function credit(extra: Partial<MigrationCreditData> = {}): MigrationCreditData {
  return { cards: [{ id: CARD, bankIssuer: 'kbank' }], plans: [], cycles: [], ...extra };
}
function fixture(data = credit(), value: unknown = { actual: 500, paid: false }): MigrationSnapshot {
  return { credits: { u001: data }, expenses: [{ userId: 'u001', month: MONTH, credit_kbank: value, rent: { actual: 100 } }] };
}
function plan(snapshot = fixture(), resolve?: 'subtract') {
  return planMigration(snapshot, { now: NOW, resolve });
}
function memoryStore(initial = fixture()) {
  const state = clone(initial);
  const store: MigrationStore = {
    load: jest.fn(async () => clone(state)),
    writeCredit: jest.fn(async (userId, before, after) => {
      expect(state.credits[userId]).toEqual(before);
      state.credits[userId] = clone(after);
    }),
    removeExpense: jest.fn(async removal => {
      const doc = state.expenses.find(row => row.userId === removal.document.userId && row.month === removal.document.month)!;
      expect(doc[removal.key]).toEqual(removal.value);
      delete doc[removal.key];
    })
  };
  return { state, store };
}
function jsonStore(initial = fixture()) {
  const files: Record<string, unknown> = {
    'credit_cards.json': clone(initial.credits),
    'monthly_expense.json': Object.fromEntries([...new Set(initial.expenses.map(doc => doc.userId))].map(userId => [
      userId, Object.fromEntries(initial.expenses.filter(doc => doc.userId === userId).map(doc => {
        const { userId: _userId, month, ...rows } = doc;
        return [month, rows];
      }))
    ]))
  };
  const io: MigrationJsonIO = {
    read: jest.fn(filename => clone(files[filename])),
    write: jest.fn((filename, data) => { files[filename] = clone(data); }),
    transaction: jest.fn(async body => body())
  };
  return { files, io, store: createJsonMigrationStore(io) };
}
function mongoStore(initial = fixture()) {
  const docs: Record<'credit' | 'expense', Record<string, unknown>[]> = {
    credit: Object.entries(clone(initial.credits)).map(([userId, doc]) => ({ _id: `credit-${userId}`, userId, ...doc })),
    expense: clone(initial.expenses).map((doc, index) => ({ _id: `expense-${index}`, ...doc }))
  };
  const collections = Object.fromEntries(['credit', 'expense'].map(kind => [kind, {
    find: jest.fn(() => ({ toArray: async () => clone(docs[kind as 'credit' | 'expense']) })),
    updateOne: jest.fn(async (filter, update) => {
      const doc = docs[kind as 'credit' | 'expense'].find(doc => Object.entries(filter).every(([key, value]) => {
        if (value && typeof value === 'object' && '$exists' in value) {
          return Object.prototype.hasOwnProperty.call(doc, key) === value.$exists;
        }
        return JSON.stringify(doc[key]) === JSON.stringify(value);
      }));
      if (!doc) return { matchedCount: 0 };
      Object.assign(doc, clone(update.$set || {}));
      for (const key of Object.keys(update.$unset || {})) delete doc[key];
      return { matchedCount: 1 };
    })
  }])) as unknown as { credit: MigrationMongoCollection; expense: MigrationMongoCollection };
  return { docs, collections, store: createMongoMigrationStore(collections) };
}

describe('migration planning (AC-S14, no live data)', () => {
  it('is pure and deterministic, and migrates a unique issuer with a valid migration item', () => {
    const snapshot = fixture();
    const original = clone(snapshot);
    const result = plan(snapshot);
    expect(snapshot).toEqual(original);
    expect(plan(snapshot)).toEqual(result);
    expect(result.users[0].after.spendItems).toEqual([{
      id: expect.stringMatching(/^si_[0-9a-f]{12}$/), cardId: CARD, month: MONTH,
      name: 'ยอดเดิม', amount: 500, source: 'migration', createdAt: NOW, updatedAt: NOW
    }]);
    expect(result.users[0].removals[0].key).toBe('credit_kbank');
    expect(result.report[0]).toMatchObject({ actual: 500, cardId: CARD, action: 'expense_item', conflict: '' });
  });

  it('converts every positive stored fallback even outside the expense window without removing newSpend', () => {
    const snapshot = fixture(credit({ cycles: [
      { cardId: CARD, month: '2020-01', newSpend: '2,064.125', paymentAction: 'minimum' },
      { cardId: CARD, month: '2020-02', newSpend: 0 }
    ] }), { actual: 0 });
    const result = plan(snapshot).users[0].after;
    expect(result.spendItems).toEqual([expect.objectContaining({ month: '2020-01', name: 'ยอดหมุนเวียนเดิม', amount: 2064.13 })]);
    expect(result.cycles).toEqual(snapshot.credits.u001.cycles);
    expect(result.creditExpenseMigrationReceipts).toEqual([]);
  });

  it('preserves fallback semantics when any user item already exists', () => {
    const data = credit({
      cycles: [{ cardId: CARD, month: MONTH, newSpend: 200 }],
      spendItems: [{ id: 'si_111111111111', cardId: CARD, month: MONTH, amount: 20, source: 'user' }]
    });
    const result = plan(fixture(data), 'subtract');
    expect(result.users).toHaveLength(0);
    expect(result.report).toEqual([expect.objectContaining({ conflict: 'existing_spend_items' })]);
  });

  it('skips an arbitrary existing migration item without authorizing source removal', () => {
    const result = plan(fixture(credit({
      spendItems: [{ id: 'si_111111111111', cardId: CARD, month: MONTH, amount: 20, source: 'migration' }]
    })));
    expect(result.users).toHaveLength(0);
    expect(result.report[0].action).toBe('already_migrated');
  });

  it('does not guess names when no issuer matches (row retained, run continues)', () => {
    const result = plan({
      credits: { u001: credit({ cards: [{ id: CARD, bankIssuer: undefined }] }) },
      expenses: [{ userId: 'u001', month: MONTH, credit_kungsri: { actual: 123 } }]
    });
    expect(result.users).toHaveLength(0);
    expect(result.report[0].conflict).toBe('mapping_required');
  });

  const ambiguous = (): MigrationSnapshot => ({
    credits: {
      u001: credit({ cards: [
        { id: CARD, bankIssuer: 'krungsri', name: 'Platinum' }, { id: SECOND, bankIssuer: 'krungsri', name: 'T1' }
      ] }),
      u002: credit()
    },
    expenses: [
      { userId: 'u001', month: MONTH, credit_kungsri: { actual: 123 } },
      { userId: 'u002', month: MONTH, credit_kbank: { actual: 50 } }
    ]
  });

  it('stops the whole plan on multiple issuer matches, naming user, key and candidates (spec §8)', () => {
    let caught: unknown;
    try { plan(ambiguous()); } catch (error) { caught = error; }
    expect(caught).toBeInstanceOf(MigrationMappingRequiredError);
    const error = caught as MigrationMappingRequiredError;
    expect(error.message).toMatch(/--map/);
    expect(error.message).toContain('u001');
    expect(error.message).toContain('credit_kungsri');
    expect(error.message).toContain(`${CARD} (Platinum)`);
    expect(error.message).toContain(`${SECOND} (T1)`);
    expect(error.ambiguities).toEqual([{ userId: 'u001', legacyKey: 'credit_kungsri', candidates: [
      { id: CARD, name: 'Platinum' }, { id: SECOND, name: 'T1' }
    ] }]);
    // Full table of what was found is still available for the dry-run printout.
    expect(error.report.map(row => [row.userId, row.conflict || row.action])).toEqual([
      ['u001', 'mapping_ambiguous'], ['u002', 'expense_item']
    ]);
  });

  it('ambiguous mapping without --map fails dry-run and apply and writes nothing for any user', async () => {
    for (const apply of [false, true]) {
      const { store, state } = memoryStore(ambiguous());
      const before = clone(state);
      await expect(runMigration(store, { apply, backupConfirmed: true, now: NOW }))
        .rejects.toBeInstanceOf(MigrationMappingRequiredError);
      expect(store.writeCredit).not.toHaveBeenCalled();
      expect(store.removeExpense).not.toHaveBeenCalled();
      expect(state).toEqual(before); // u002's unambiguous row is not partially applied.
    }
  });

  it('the same ambiguous input succeeds with a valid --map', async () => {
    const { store, state } = memoryStore(ambiguous());
    await runMigration(store, { apply: true, backupConfirmed: true, now: NOW, map: { u001: { credit_kungsri: CARD } } });
    expect(state.credits.u001.spendItems).toEqual([expect.objectContaining({ cardId: CARD, amount: 123 })]);
    expect(state.credits.u002.spendItems).toEqual([expect.objectContaining({ cardId: CARD, amount: 50 })]);
    expect(state.expenses.every(doc => !Object.keys(doc).some(key => key.startsWith('credit_')))).toBe(true);
  });

  it('maps the legacy kungsri spelling to the exact krungsri issuer', () => {
    const snapshot = { credits: { u001: credit({ cards: [{ id: CARD, bankIssuer: 'krungsri' }] }) },
      expenses: [{ userId: 'u001', month: MONTH, credit_kungsri: { actual: 123 } }] };
    expect(plan(snapshot).users[0].after.spendItems?.[0].cardId).toBe(CARD);
  });

  it('honors a user-scoped explicit mapping and rejects a different user/card', () => {
    const snapshot = fixture(credit({ cards: [{ id: CARD, bankIssuer: 'kbank' }, { id: SECOND, bankIssuer: 'kbank' }] }));
    const result = planMigration(snapshot, { now: NOW, map: { u001: { credit_kbank: SECOND } } });
    expect(result.users[0].after.spendItems?.[0].cardId).toBe(SECOND);
    // A map for a different user does not resolve u001's ambiguity: the run stops.
    expect(() => planMigration(snapshot, { now: NOW, map: { u002: { credit_kbank: SECOND } } }))
      .toThrow(MigrationMappingRequiredError);
    expect(planMigration(fixture(), { now: NOW, map: { u001: { credit_kbank: SECOND } } }).report[0].conflict).toBe('invalid_mapping');
  });

  it('skips overlap by default, while leaving its converted fallback intact', () => {
    const result = plan(fixture(credit({ cycles: [{ cardId: CARD, month: MONTH, newSpend: 2064 }] })));
    expect(result.report).toEqual([
      expect.objectContaining({ action: 'fallback_item' }),
      expect.objectContaining({ conflict: 'overlapping_spend_or_installments', storedSpend: 2064 })
    ]);
    expect(result.users[0].removals).toEqual([]);
    expect(result.users[0].after.spendItems).toHaveLength(1);
  });

  it('subtracts stored spend and non-cancelled installments, keeping the stored schedule unchanged', () => {
    const data = credit({
      cycles: [{ cardId: CARD, month: MONTH, newSpend: 2064, paymentAction: null }],
      plans: [
        { cardId: CARD, schedule: [{ dueMonth: MONTH, payment: '1,000.25', paid: true }, { dueMonth: '2026-09', payment: 99 }] },
        { cardId: CARD, status: 'cancelled_early', schedule: [{ dueMonth: MONTH, payment: 555 }] },
        { cardId: SECOND, schedule: [{ dueMonth: MONTH, payment: 777 }] }
      ]
    });
    const result = plan(fixture(data, { actual: 5929.33, paid: true }), 'subtract');
    expect(result.users[0].after.spendItems?.map(item => item.amount)).toEqual([2064, 2865.08]);
    expect(result.users[0].after.plans).toEqual(data.plans);
    expect(result.users[0].after.cycles[0]).toMatchObject({ newSpend: 2064, paymentAction: 'full', paidSource: 'migration' });
    expect(result.report[1]).toMatchObject({ installments: 1000.25, storedSpend: 2064, actual: 5929.33 });
    expect(result.users[0].removals).toHaveLength(1);
  });

  describe('legacy paid vs unpaid installments warning (review F2, option ก)', () => {
    const withPlans = (schedule: Array<Record<string, unknown>>, status?: string) => credit({ plans: [
      { cardId: CARD, status, schedule }
    ] });
    it('warns with the unpaid count but still sets the cycle to full', () => {
      const result = plan(fixture(withPlans([
        { dueMonth: MONTH, payment: 100, paid: false }, { dueMonth: MONTH, payment: 50 },
        { dueMonth: MONTH, payment: 20, paid: true }, { dueMonth: '2026-11', payment: 99 }
      ]), { actual: 500, paid: true }), 'subtract');
      expect(result.report[0]).toMatchObject({
        action: 'expense_item', conflict: '', warning: 'legacy_paid_installments_unpaid', unpaidInstallments: 2
      });
      expect(result.users[0].after.cycles[0]).toMatchObject({ paymentAction: 'full', paidSource: 'migration' });
    });
    it.each([
      ['all installments paid', withPlans([{ dueMonth: MONTH, payment: 100, paid: true }])],
      ['only cancelled plans', withPlans([{ dueMonth: MONTH, payment: 100 }], 'cancelled_early')],
      ['no installments', credit()]
    ])('has no warning when %s', (_label, data) => {
      const row = plan(fixture(data, { actual: 500, paid: true }), 'subtract').report[0];
      expect(row).toMatchObject({ warning: '', unpaidInstallments: 0 });
      expect(row.conflict).toBe('');
    });
    it('has no warning when the legacy row is not paid', () => {
      const row = plan(fixture(withPlans([{ dueMonth: MONTH, payment: 100 }]), { actual: 500, paid: false }), 'subtract').report[0];
      expect(row.warning).toBe('');
    });
    it('leaves installment plans untouched after apply', async () => {
      const data = withPlans([{ dueMonth: MONTH, payment: 100, paid: false }, { dueMonth: MONTH, payment: 50 }]);
      const { store, state } = memoryStore(fixture(data, { actual: 500, paid: true }));
      const result = await runMigration(store, { apply: true, backupConfirmed: true, now: NOW, resolve: 'subtract' });
      expect(result.report[0].warning).toBe('legacy_paid_installments_unpaid');
      expect(state.credits.u001.plans).toEqual(data.plans);
      expect(store.writeCredit).toHaveBeenCalledTimes(1);
    });
  });

  it('records a zero subtraction without creating an item or losing paid intent', () => {
    const result = plan(fixture(credit({ plans: [{ cardId: CARD, schedule: [{ dueMonth: MONTH, payment: 600 }] }] }),
      { actual: 500, paid: true }), 'subtract');
    const after = result.users[0].after;
    expect(after.spendItems).toEqual([]);
    expect(after.cycles).toEqual([expect.objectContaining({
      id: expect.stringMatching(/^rc_[0-9a-f]{12}$/), paymentAction: 'full', paidSource: 'migration'
    })]);
    expect(after.cycles[0]).not.toHaveProperty('newSpend');
    expect(after.creditExpenseMigrationReceipts).toHaveLength(1);
    expect(result.report[0].action).toBe('subtract_zero');
  });

  it.each(['minimum', 'full'])('never overwrites existing %s payment metadata', paymentAction => {
    const cycle = { cardId: CARD, month: MONTH, paymentAction, paidAt: 'original', paidSource: 'manual' };
    const after = plan(fixture(credit({ cycles: [cycle] }), { actual: 500, paid: true })).users[0].after;
    expect(after.cycles).toEqual([cycle]);
  });

  it.each([null, undefined])('sets full only on a null/missing payment action (%s)', paymentAction => {
    const cycle = { cardId: CARD, month: MONTH, paymentAction, cashbackAmount: 12 };
    expect(plan(fixture(credit({ cycles: [cycle] }), { actual: 500, paid: true }))
      .users[0].after.cycles[0]).toMatchObject({ paymentAction: 'full', cashbackAmount: 12, paidSource: 'migration' });
  });

  it('does not create a cycle for an unpaid expense or touch unrelated user data', () => {
    const snapshot = fixture(credit({ customMetadata: { keep: true } }));
    snapshot.credits.u002 = credit({ cards: [] });
    const result = plan(snapshot);
    expect(result.users).toHaveLength(1);
    expect(result.users[0].after.cycles).toEqual([]);
    expect(result.users[0].after.customMetadata).toEqual({ keep: true });
    expect(result.users[0].removals[0].document.rent).toEqual({ actual: 100 });
  });

  it('restricts legacy expenses to the newest 15 distinct stored months, not the current calendar', () => {
    const snapshot = fixture();
    snapshot.expenses = Array.from({ length: 16 }, (_, index) => ({
      userId: 'u001', month: addMonths('2023-01', index), credit_kbank: { actual: 1 }
    }));
    const result = plan(snapshot);
    expect(result.users[0].after.spendItems).toHaveLength(15);
    expect(result.users[0].removals.some(removal => removal.document.month === '2023-01')).toBe(false);
    expect(result.report[0].action).toBe('outside_window');
  });

  it('does not process zero values, derived cci_/ccr_ rows, or non-legacy keys', () => {
    const snapshot = fixture(credit(), { actual: 0, paid: true });
    Object.assign(snapshot.expenses[0], { ccr_aaaaaaaaaaaa: { actual: 900 }, cci_aaaa_01: { actual: 1 } });
    expect(plan(snapshot).users).toEqual([]);
  });

  it.each([NaN, Infinity, -1, 'abc', '', null])('retains invalid actual amounts: %s', actual => {
    const result = plan(fixture(credit(), { actual, paid: true }));
    expect(result.users).toEqual([]);
    expect(result.report[0].conflict).toBe('invalid_amount');
  });

  it('retains malformed expense rows and duplicate month documents', () => {
    expect(plan(fixture(credit(), 'invalid')).report[0].conflict).toBe('invalid_expense_row');
    const snapshot = fixture();
    snapshot.expenses.push({ ...snapshot.expenses[0] });
    expect(plan(snapshot).users).toEqual([]);
    expect(plan(snapshot).report.every(row => row.conflict === 'duplicate_expense_month')).toBe(true);
  });

  it('rejects duplicate stored cycles instead of guessing a spend/payment value', () => {
    const snapshot = fixture(credit({ cycles: [
      { cardId: CARD, month: MONTH, newSpend: 200 }, { cardId: CARD, month: MONTH, newSpend: 300 }
    ] }));
    expect(plan(snapshot, 'subtract').users).toEqual([]);
    expect(plan(snapshot, 'subtract').report.every(row => row.conflict === 'duplicate_cycles')).toBe(true);
  });

  it('skips sources beyond the item amount cap, including failed fallback conversion', () => {
    expect(plan(fixture(credit(), { actual: MAX_SPEND_ITEM_AMOUNT + 1 })).users).toEqual([]);
    const result = plan(fixture(credit({ cycles: [{ cardId: CARD, month: MONTH, newSpend: MAX_SPEND_ITEM_AMOUNT + 1 }] }),
      { actual: MAX_SPEND_ITEM_AMOUNT + 2 }), 'subtract');
    expect(result.users).toEqual([]);
    expect(result.report.map(row => row.conflict)).toEqual(['item_validation', 'fallback_failed']);
  });

  it('accepts the declared amount ceiling and rounds monetary input using shared rules', () => {
    expect(plan(fixture(credit(), { actual: MAX_SPEND_ITEM_AMOUNT })).users[0].after.spendItems?.[0].amount)
      .toBe(MAX_SPEND_ITEM_AMOUNT);
    expect(plan(fixture(credit(), { actual: '1,234.125' })).users[0].after.spendItems?.[0].amount).toBe(1234.13);
  });

  it('never grows past the per-card cap, including the boundary within one planning batch', () => {
    const items = Array.from({ length: MAX_SPEND_ITEMS_PER_CARD - 1 }, (_, index) => ({
      id: `si_${index.toString(16).padStart(12, '0')}`, cardId: CARD,
      month: addMonths('2024-01', index % 20), amount: 1, source: 'user'
    }));
    const snapshot = fixture(credit({ spendItems: items }));
    snapshot.expenses.push({ userId: 'u001', month: '2026-11', credit_kbank: { actual: 3 } });
    const result = plan(snapshot);
    expect(result.users[0].after.spendItems).toHaveLength(MAX_SPEND_ITEMS_PER_CARD);
    expect(result.users[0].removals).toHaveLength(1);
    expect(result.report[1].conflict).toBe('card_item_limit');
  });

  it('does not grow a full per-cycle array or override its existing user items', () => {
    const items = Array.from({ length: MAX_SPEND_ITEMS_PER_CYCLE }, (_, index) => ({
      id: `si_${index.toString(16).padStart(12, '0')}`, cardId: CARD, month: MONTH, amount: 1
    }));
    expect(plan(fixture(credit({ spendItems: items })), 'subtract').users).toEqual([]);
  });

  it('does not grow past the cycle cap or partially apply paid changes', () => {
    const cycles = Array.from({ length: MAX_REVOLVING_CYCLES_PER_CARD }, (_, index) => ({
      cardId: CARD, month: addMonths('2020-01', index), paymentAction: null
    }));
    const result = plan(fixture(credit({ cycles }), { actual: 500, paid: true }));
    expect(result.users).toEqual([]);
    expect(result.report[0].conflict).toBe('cycle_limit');
  });

  it('rolls back an item if paid cycle creation fails after subtraction planning', () => {
    const cycles = Array.from({ length: MAX_REVOLVING_CYCLES_PER_CARD }, (_, index) => ({
      cardId: CARD, month: addMonths('2020-01', index), paymentAction: null
    }));
    const data = credit({
      cycles, plans: [{ cardId: CARD, schedule: [{ dueMonth: MONTH, payment: 1000 }] }]
    });
    const result = plan(fixture(data, { actual: 500, paid: true }), 'subtract');
    expect(result.users).toEqual([]);
    expect(data.cycles).toEqual(cycles);
    expect(result.report[0].conflict).toBe('cycle_limit');
  });

  it('does not grow a document past Mongo BSON limits', () => {
    const result = plan(fixture(credit({ metadata: 'x'.repeat(16 * 1024 * 1024) })));
    expect(result.users).toEqual([]);
    expect(result.report[0].conflict).toBe('document_size_limit');
  });
});

describe('runner safety and restart recovery', () => {
  it('defaults to dry-run and performs no write, transaction or source deletion', async () => {
    const { store } = memoryStore();
    const result = await runMigration(store, { now: NOW });
    expect(result.users).toHaveLength(1);
    expect(store.writeCredit).not.toHaveBeenCalled();
    expect(store.removeExpense).not.toHaveBeenCalled();
    const json = jsonStore();
    await runMigration(json.store, { now: NOW });
    expect(json.io.transaction).not.toHaveBeenCalled();
    expect(json.io.write).not.toHaveBeenCalled();
  });

  it('blocks apply before even loading data unless a backup is confirmed or exists', async () => {
    const { store } = memoryStore();
    await expect(runMigration(store, { apply: true })).rejects.toThrow('backup');
    await expect(runMigration(store, { apply: true, backupPath: 'missing' }, () => false)).rejects.toThrow('backup');
    expect(store.load).not.toHaveBeenCalled();
    await runMigration(store, { apply: true, backupPath: 'backup', now: NOW }, name => name === 'backup');
    expect(store.writeCredit).toHaveBeenCalledTimes(1);
  });

  it('applies idempotently and preserves all non-credit expense fields', async () => {
    const { store, state } = memoryStore();
    await runMigration(store, { apply: true, backupConfirmed: true, now: NOW });
    const once = clone(state);
    const again = await runMigration(store, { apply: true, backupConfirmed: true, now: NOW });
    expect(again.users).toEqual([]);
    expect(state).toEqual(once);
    expect(store.writeCredit).toHaveBeenCalledTimes(1);
    expect(state.expenses[0]).toEqual({ userId: 'u001', month: MONTH, rent: { actual: 100 } });
  });

  it('never removes source expense data after a failed credit write', async () => {
    const { store, state } = memoryStore();
    jest.mocked(store.writeCredit).mockRejectedValueOnce(new Error('credit failure'));
    await expect(runMigration(store, { apply: true, backupConfirmed: true, now: NOW })).rejects.toThrow('credit failure');
    expect(store.removeExpense).not.toHaveBeenCalled();
    expect(state.expenses[0]).toHaveProperty('credit_kbank');
  });

  it.each([false, true])('resumes after acknowledged/uncertain credit commit before cleanup (zero=%s)', async zero => {
    const initial = zero ? fixture(credit({ plans: [{ cardId: CARD, schedule: [{ dueMonth: MONTH, payment: 1000 }] }] })) : fixture();
    const { store, state } = memoryStore(initial);
    const realWrite = store.writeCredit;
    store.writeCredit = jest.fn(async (...args) => {
      await realWrite(...args);
      throw new Error('lost acknowledgement');
    });
    const options = { apply: true, backupConfirmed: true, now: NOW, resolve: 'subtract' as const };
    await expect(runMigration(store, options)).rejects.toThrow('lost acknowledgement');
    expect(store.removeExpense).not.toHaveBeenCalled();
    const itemsAfterCommit = clone(state.credits.u001.spendItems);
    store.writeCredit = realWrite;
    const retry = await runMigration(store, options);
    expect(retry.report[0].action).toBe('resume_cleanup');
    expect(state.credits.u001.spendItems).toEqual(itemsAfterCommit);
    expect(state.expenses[0]).not.toHaveProperty('credit_kbank');
  });

  it('resumes after a cleanup crash with the original mapping, without requiring the map again', async () => {
    const { store, state } = memoryStore(fixture(credit({
      cards: [{ id: CARD, bankIssuer: 'kbank' }, { id: SECOND, bankIssuer: 'kbank' }]
    })));
    jest.mocked(store.removeExpense).mockRejectedValueOnce(new Error('cleanup crash'));
    await expect(runMigration(store, {
      apply: true, backupConfirmed: true, now: NOW, map: { u001: { credit_kbank: SECOND } }
    })).rejects.toThrow('cleanup crash');
    await runMigration(store, { apply: true, backupConfirmed: true, now: NOW });
    expect(state.credits.u001.spendItems).toHaveLength(1);
    expect(state.credits.u001.spendItems?.[0].cardId).toBe(SECOND);
    expect(state.expenses[0]).not.toHaveProperty('credit_kbank');
  });

  it('resumes only pending source removals after a partially completed user cleanup', async () => {
    const snapshot = fixture();
    snapshot.expenses.push({ userId: 'u001', month: '2026-11', credit_kbank: { actual: 200 } });
    const { store, state } = memoryStore(snapshot);
    const remove = store.removeExpense;
    store.removeExpense = jest.fn(async removal => {
      if (removal.document.month === '2026-11') throw new Error('partial cleanup crash');
      await remove(removal);
    });
    const options = { apply: true, backupConfirmed: true, now: NOW };
    await expect(runMigration(store, options)).rejects.toThrow('partial cleanup crash');
    expect(state.expenses[0]).not.toHaveProperty('credit_kbank');
    expect(state.expenses[1]).toHaveProperty('credit_kbank');
    store.removeExpense = remove;
    const retry = await runMigration(store, options);
    expect(retry.users[0].removals).toHaveLength(1);
    expect(state.credits.u001.spendItems).toHaveLength(2);
    expect(state.expenses.every(doc => !Object.prototype.hasOwnProperty.call(doc, 'credit_kbank'))).toBe(true);
    expect((await runMigration(store, options)).users).toEqual([]);
  });

  it('refuses cleanup when the source changes after the credit commit', async () => {
    const { store, state } = memoryStore();
    jest.mocked(store.removeExpense).mockRejectedValueOnce(new Error('crash'));
    await expect(runMigration(store, { apply: true, backupConfirmed: true, now: NOW })).rejects.toThrow('crash');
    state.expenses[0].credit_kbank = { actual: 999, paid: true };
    const result = await runMigration(store, { apply: true, backupConfirmed: true, now: NOW });
    expect(result.report[0].conflict).toBe('source_changed_after_credit_write');
    expect(state.credits.u001.spendItems).toHaveLength(1);
    expect(state.expenses[0]).toHaveProperty('credit_kbank');
  });

  it('can resolve a previously skipped fallback conflict without duplicating fallback spend', async () => {
    const { store, state } = memoryStore(fixture(credit({ cycles: [{ cardId: CARD, month: MONTH, newSpend: 200 }] })));
    await runMigration(store, { apply: true, backupConfirmed: true, now: NOW });
    expect(state.credits.u001.spendItems).toHaveLength(1);
    expect(state.expenses[0]).toHaveProperty('credit_kbank');
    await runMigration(store, { apply: true, backupConfirmed: true, now: NOW, resolve: 'subtract' });
    expect(state.credits.u001.spendItems?.map(item => item.amount)).toEqual([200, 300]);
    expect(state.expenses[0]).not.toHaveProperty('credit_kbank');
  });
});

describe.each(['json', 'mongo'] as const)('%s adapter fixtures (no filesystem or DB)', mode => {
  it('round-trips spendItems, payment metadata and receipts before removing only the source key', async () => {
    const initial = fixture(credit({ customMetadata: { retained: true } }), { actual: 50, paid: true });
    const store = mode === 'json' ? jsonStore(initial).store : mongoStore(initial).store;
    await runMigration(store, { apply: true, backupConfirmed: true, now: NOW });
    const after = await store.load();
    expect(after.credits.u001.spendItems).toEqual([expect.objectContaining({ amount: 50, source: 'migration' })]);
    expect(after.credits.u001.creditExpenseMigrationReceipts).toHaveLength(1);
    expect(after.credits.u001.cycles[0]).toMatchObject({ paymentAction: 'full', paidSource: 'migration' });
    expect(after.credits.u001.customMetadata).toEqual({ retained: true });
    expect(after.expenses[0]).not.toHaveProperty('credit_kbank');
    expect(after.expenses[0].rent).toEqual({ actual: 100 });
    expect((await runMigration(store, { now: NOW })).users).toEqual([]);
  });

  it('detects changed credit snapshots before writing', async () => {
    const state = mode === 'json' ? jsonStore() : mongoStore();
    const before = (await state.store.load()).credits.u001;
    const changed = { ...before, updatedAt: 'changed-by-other-writer' };
    await state.store.writeCredit('u001', before, changed);
    await expect(state.store.writeCredit('u001', before, { ...before, updatedAt: NOW })).rejects.toThrow('Credit data changed');
  });

  it('retains an expense row changed between planning and cleanup', async () => {
    const state = mode === 'json' ? jsonStore() : mongoStore();
    const snapshot = await state.store.load();
    const removal = plan(snapshot).users[0].removals[0];
    const stale = { ...removal, value: { actual: 999 } };
    await expect(state.store.removeExpense(stale)).rejects.toThrow('Expense row changed');
    expect((await state.store.load()).expenses[0]).toHaveProperty('credit_kbank');
  });
});

describe('storage and argument validation', () => {
  it('uses Mongo $set whitelist including spendItems and durable receipts, with targeted $unset', async () => {
    const { store, collections } = mongoStore();
    await runMigration(store, { apply: true, backupConfirmed: true, now: NOW });
    expect(collections.credit.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u001', _id: 'credit-u001', spendItems: { $exists: false } }),
      { $set: expect.objectContaining({ spendItems: expect.any(Array), creditExpenseMigrationReceipts: expect.any(Array) }) }
    );
    expect(collections.expense.updateOne).toHaveBeenCalledWith(
      { userId: 'u001', month: MONTH, _id: 'expense-0', credit_kbank: { actual: 500, paid: false } },
      { $unset: { credit_kbank: '' } }
    );
    expect((jest.mocked(collections.credit.updateOne).mock.calls[0][1].$set as object)).not.toHaveProperty('_id');
  });

  it('rejects duplicate Mongo credit documents instead of writing to an arbitrary one', async () => {
    const { store, docs } = mongoStore();
    docs.credit.push({ ...docs.credit[0], _id: 'duplicate' });
    await expect(store.load()).rejects.toThrow('Duplicate credit document');
  });

  it('uses $exists for absent legacy arrays rather than comparing normalized empty arrays', async () => {
    const { store, docs, collections } = mongoStore();
    delete docs.credit[0].cycles;
    delete docs.credit[0].plans;
    await runMigration(store, { apply: true, backupConfirmed: true, now: NOW });
    expect(collections.credit.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ plans: { $exists: false }, cycles: { $exists: false } }),
      expect.objectContaining({ $set: expect.objectContaining({ plans: [], cycles: [] }) })
    );
    expect((await store.load()).credits.u001.spendItems).toHaveLength(1);
  });

  it('decodes legacy JSON without spendItems but rejects malformed storage instead of dropping data', () => {
    expect(decodeJsonSnapshot({ u001: { cards: [], plans: [], cycles: [] } }, {}).credits.u001.spendItems).toBeUndefined();
    expect(() => decodeJsonSnapshot([], {})).toThrow('per-user');
    expect(() => decodeJsonSnapshot({ u001: { spendItems: {} } }, {})).toThrow('credit array');
    expect(() => decodeJsonSnapshot({}, { u001: [] })).toThrow('per-month');
  });

  it('parses safe defaults, dry-run, backup and map syntax', () => {
    expect(parseMigrationArgs([])).toEqual({});
    expect(parseMigrationArgs(['--dry-run'])).toEqual({});
    expect(parseMigrationArgs(['--apply', '--backup-confirmed', '--map', 'map.json', '--resolve=subtract']))
      .toEqual({ apply: true, backupConfirmed: true, mapPath: 'map.json', resolve: 'subtract' });
    expect(parseMigrationArgs(['--apply', '--backup=backup.json'])).toEqual({ apply: true, backupPath: 'backup.json' });
  });

  it.each([
    ['--apply', '--dry-run'], ['--map'], ['--map', '--apply'],
    ['--resolve=guess'], ['--unknown'], ['--apply=true']
  ])('rejects unsafe/unknown arguments: %j', (...args) => {
    expect(() => parseMigrationArgs(args)).toThrow();
  });

  it('validates map structure and rejects reserved/path-injection keys', () => {
    expect(parseMigrationMap({ u001: { credit_kbank: CARD } })).toEqual({ u001: { credit_kbank: CARD } });
    for (const value of [
      [], { u001: [] }, { u001: { 'credit_kbank.$set': CARD } }, { u001: { credit_kbank: 'other-user-card' } },
      JSON.parse('{"__proto__":{"credit_kbank":"cc_aaaaaaaaaaaa"}}')
    ]) expect(() => parseMigrationMap(value)).toThrow();
  });
});
