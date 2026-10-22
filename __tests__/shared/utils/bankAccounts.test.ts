import {
  assignBankAccountIds,
  deriveLegacyBankAccountId,
  generateBankAccountId,
  isBankAccountId,
  normaliseBankAccountEntry,
  normaliseBankAccounts,
  validateIncomingBankAccounts
} from '../../../src/shared/utils/backend/bankAccountIds';
import { toBankAccountNames } from '../../../src/shared/utils/bankAccountShape';

describe('bank account ids and compatibility helpers', () => {
  it('normalises legacy strings deterministically without mutating the source', () => {
    const source = ['กสิกร', ' ttb '];
    const snapshot = [...source];

    const first = normaliseBankAccounts(source);
    const second = normaliseBankAccounts(source);

    expect(first).toEqual([
      { id: deriveLegacyBankAccountId('กสิกร'), name: 'กสิกร' },
      { id: deriveLegacyBankAccountId('ttb'), name: 'ttb' }
    ]);
    expect(first).toEqual(second);
    expect(first.map(account => account.id)).toEqual([
      expect.stringMatching(/^bal_[0-9a-f]{16}$/),
      expect.stringMatching(/^bal_[0-9a-f]{16}$/)
    ]);
    expect(source).toEqual(snapshot);
  });

  it('keeps only id and name, derives missing/invalid ids, and keeps first duplicate names or ids', () => {
    const records = normaliseBankAccounts([
      'A',
      { id: 'ba_0123456789ab', name: 'B' },
      { name: 'C', balance: 5 },
      { id: 'junk', name: 'D' },
      { name: ' A ' },
      { id: 'ba_0123456789ab', name: 'E' }
    ]);

    expect(records).toEqual([
      { id: deriveLegacyBankAccountId('A'), name: 'A' },
      { id: 'ba_0123456789ab', name: 'B' },
      { id: deriveLegacyBankAccountId('C'), name: 'C' },
      { id: deriveLegacyBankAccountId('D'), name: 'D' }
    ]);
    expect(Object.keys(records[2]).sort()).toEqual(['id', 'name']);
    expect(normaliseBankAccountEntry({ name: '  ' })).toBeNull();
    expect(normaliseBankAccounts(null)).toEqual([]);
  });

  it('drops invalid entries and accepts only the two bank account id formats', () => {
    expect(normaliseBankAccounts(['', '  ', null, 5, [], {}, { name: '' }, { name: 3 }])).toEqual([]);
    expect(isBankAccountId('ba_0123456789ab')).toBe(true);
    expect(isBankAccountId('bal_0123456789abcdef')).toBe(true);
    expect(isBankAccountId('ba_XYZ')).toBe(false);
    expect(isBankAccountId('cc_0123456789ab')).toBe(false);
    expect(isBankAccountId('')).toBe(false);
    expect(isBankAccountId(5)).toBe(false);
  });

  it('mints unique server ids', () => {
    const ids = Array.from({ length: 1000 }, generateBankAccountId);
    expect(ids.every(id => /^ba_[0-9a-f]{12}$/.test(id))).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('validates row shape and duplicate names or ids before writes', () => {
    expect(validateIncomingBankAccounts([
      'A',
      { name: 'B' },
      { id: 'ba_0123456789ab', name: 'C' },
      { name: 'D', balance: 5 }
    ])).toBeNull();

    for (const invalid of ['', '  ', 5, null, [], {}, { name: '' }, { name: 3 }]) {
      expect(validateIncomingBankAccounts(['A', invalid])).toBe(
        'bankAccounts[1] must be a non-empty string or an object with a non-empty name'
      );
    }
    expect(validateIncomingBankAccounts(['A', ' A'])).toBe('bankAccounts contains duplicate names');
    expect(validateIncomingBankAccounts([
      { id: 'ba_0123456789ab', name: 'A' },
      { id: 'ba_0123456789ab', name: 'B' }
    ])).toBe('bankAccounts contains duplicate ids');
    expect(validateIncomingBankAccounts([{ id: 'junk', name: 'A' }])).toBeNull();
  });

  it('assigns explicit ids, reuses a stored id by name, and mints for a new account', () => {
    const stored = [
      { id: 'ba_aaaaaaaaaaaa', name: 'A' },
      { id: 'ba_bbbbbbbbbbbb', name: 'B' }
    ];
    const result = assignBankAccountIds([
      { id: 'ba_bbbbbbbbbbbb', name: 'Renamed B', balance: 1 },
      'A',
      { id: 'junk', name: 'C' }
    ], stored);

    expect(result[0]).toEqual({ id: 'ba_bbbbbbbbbbbb', name: 'Renamed B' });
    expect(result[1]).toEqual({ id: 'ba_aaaaaaaaaaaa', name: 'A' });
    expect(result[2]).toMatchObject({ name: 'C' });
    expect(result[2].id).toMatch(/^ba_[0-9a-f]{12}$/);
    expect(result[2].id).not.toBe('ba_aaaaaaaaaaaa');
    expect(result[2].id).not.toBe('ba_bbbbbbbbbbbb');
  });

  it('does not reuse an id claimed by a different incoming account', () => {
    const result = assignBankAccountIds([
      { id: 'ba_aaaaaaaaaaaa', name: 'Renamed' },
      { name: 'A' }
    ], [{ id: 'ba_aaaaaaaaaaaa', name: 'A' }]);

    expect(result[0].id).toBe('ba_aaaaaaaaaaaa');
    expect(result[1].id).toMatch(/^ba_[0-9a-f]{12}$/);
    expect(result[1].id).not.toBe('ba_aaaaaaaaaaaa');
  });

  it('does not resurrect a deleted id from a stale client even if it is format-valid', () => {
    // Simulates a stale browser tab that still holds a deleted account's id: `stored` (freshly
    // read from the server) no longer has `ba_aaaaaaaaaaaa`, but the stale tab's `incoming`
    // payload still carries it under a new name.
    const result = assignBankAccountIds([
      { id: 'ba_aaaaaaaaaaaa', name: 'ไทยพาณิชย์' }
    ], []);

    expect(result[0].name).toBe('ไทยพาณิชย์');
    expect(result[0].id).toMatch(/^ba_[0-9a-f]{12}$/);
    expect(result[0].id).not.toBe('ba_aaaaaaaaaaaa');
  });

  it('adapts mixed account shapes to unique name strings', () => {
    expect(toBankAccountNames(['A', { id: 'ba_0123456789ab', name: ' B ' }, 'A', 5, { name: '' }]))
      .toEqual(['A', 'B']);
    expect(toBankAccountNames(undefined)).toEqual([]);
  });
});
