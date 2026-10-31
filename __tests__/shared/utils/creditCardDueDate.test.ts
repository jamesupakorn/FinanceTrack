/** @jest-environment node */
// AC-1, AC-2 (E1–E14 + getPayableCycleMonth), AC-11 (grep).
import fs from 'fs';
import path from 'path';
import {
  getCardDueMonthOffset,
  resolveCardDueDate,
  getPayableCycleMonth
} from '../../../src/shared/utils/creditCardBasics';
import * as barrel from '../../../src/shared/utils/creditCardUtils';

type Day = number | string | null | undefined;

describe('resolveCardDueDate — spec edge cases E1–E14 (AC-2)', () => {
  const cases: Array<[string, Day, Day, string, 0 | 1 | null, string | null]> = [
    ['E1 Shopee EOM/10', 'EOM', 10, '2026-10', 1, '2026-11-10'],
    ['E2 5/25 same month', 5, 25, '2026-10', 0, '2026-10-25'],
    ['E3 equal 15/15 → cross-month', 15, 15, '2026-10', 1, '2026-11-15'],
    ['E4 EOM/EOM Jan → Feb end', 'EOM', 'EOM', '2026-01', 1, '2026-02-28'],
    ['E5 EOM/EOM Dec → Jan next year', 'EOM', 'EOM', '2027-12', 1, '2028-01-31'],
    ['E6 10/EOM Feb', 10, 'EOM', '2026-02', 0, '2026-02-28'],
    ['E7 25/31 April clamp same month', 25, 31, '2026-04', 0, '2026-04-30'],
    ['E8 31(numeric)/30 Jan → clamp in Feb', 31, 30, '2026-01', 1, '2026-02-28'],
    ['E9a EOM/29 2027-01 → non-leap Feb', 'EOM', 29, '2027-01', 1, '2027-02-28'],
    ['E9b EOM/29 2028-01 → leap Feb', 'EOM', 29, '2028-01', 1, '2028-02-29'],
    ['E10 30/31 Feb both clamp, offset from configured values', 30, 31, '2026-02', 0, '2026-02-28'],
    ['E11 EOM/10 Dec → year rollover', 'EOM', 10, '2026-12', 1, '2027-01-10'],
    ['E12 missing statementDay = EOM', undefined, 10, '2026-10', 1, '2026-11-10'],
    ['E13 junk dueDay → offset 0, today\'s fallback', 20, 'abc', '2026-10', 0, '2026-10-31'],
    ['E14 invalid cycle month', 'EOM', 10, 'bad', null, null]
  ];

  it.each(cases)('%s', (_label, statementDay, dueDay, cycle, offset, expected) => {
    if (offset !== null) expect(getCardDueMonthOffset(statementDay, dueDay)).toBe(offset);
    expect(resolveCardDueDate({ statementDay, dueDay }, cycle)).toBe(expected);
  });

  it('E14 holds for any card config (invalid / non-string cycle month → null)', () => {
    for (const card of [{ statementDay: 5, dueDay: 25 }, { statementDay: 'EOM', dueDay: 'EOM' }, {}]) {
      expect(resolveCardDueDate(card, 'bad')).toBeNull();
      expect(resolveCardDueDate(card, '')).toBeNull();
      expect(resolveCardDueDate(card, undefined as unknown as string)).toBeNull();
    }
  });

  it('AC-1: Shopee SPayLater cycle 2026-10 is due 2026-11-10', () => {
    expect(resolveCardDueDate({ statementDay: 'EOM', dueDay: 10 }, '2026-10')).toBe('2026-11-10');
  });

  it('XM-3: offset is constant per card in every month including February', () => {
    const card = { statementDay: 30, dueDay: 31 };
    const months = ['2026-01', '2026-02', '2026-03', '2026-04', '2028-02'];
    expect(months.map(month => resolveCardDueDate(card, month)))
      .toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30', '2028-02-29']);
  });

  it('offset: string numerics, lowercase eom, missing both, other junk values', () => {
    expect(getCardDueMonthOffset('5', '25')).toBe(0);
    expect(getCardDueMonthOffset('25', '5')).toBe(1);
    expect(getCardDueMonthOffset('eom', 10)).toBe(1);
    expect(getCardDueMonthOffset(undefined, undefined)).toBe(1); // both missing = EOM/EOM
    expect(getCardDueMonthOffset(null, '')).toBe(1);
    expect(getCardDueMonthOffset(0, 10)).toBe(0);
    expect(getCardDueMonthOffset(45, 10)).toBe(0);
    expect(getCardDueMonthOffset(20, 0)).toBe(0);
    expect(getCardDueMonthOffset(20, 45)).toBe(0);
    expect(getCardDueMonthOffset('abc', 10)).toBe(0);
  });

  it('junk dueDay keeps the last-day-of-month fallback (E13 family)', () => {
    expect(resolveCardDueDate({ statementDay: 20, dueDay: 0 }, '2026-02')).toBe('2026-02-28');
    expect(resolveCardDueDate({ statementDay: 20, dueDay: 45 }, '2026-04')).toBe('2026-04-30');
  });

  it('tolerates a null/undefined card object without throwing', () => {
    expect(resolveCardDueDate(undefined as unknown as { dueDay?: Day }, '2026-10')).toBe('2026-11-30');
    expect(getPayableCycleMonth(null as unknown as { dueDay?: Day }, '2026-10')).toBe('2026-09');
  });
});

describe('getPayableCycleMonth (XM-6, AC-2)', () => {
  const shopee = { statementDay: 'EOM', dueDay: 10 };
  const sameMonth = { statementDay: 5, dueDay: 25 };

  it('spec examples', () => {
    expect(getPayableCycleMonth(shopee, '2026-11')).toBe('2026-10');
    expect(getPayableCycleMonth(shopee, '2027-01')).toBe('2026-12');
    expect(getPayableCycleMonth(sameMonth, '2026-11')).toBe('2026-11');
  });

  it('invalid calendar month is returned unchanged', () => {
    expect(getPayableCycleMonth(shopee, 'bad')).toBe('bad');
    expect(getPayableCycleMonth(shopee, '')).toBe('');
  });

  it('round-trips with resolveCardDueDate: the payable cycle is always due inside the calendar month', () => {
    const cards = [shopee, sameMonth, { statementDay: 15, dueDay: 15 }, { statementDay: 'EOM', dueDay: 'EOM' }, { statementDay: 31, dueDay: 30 }, {}];
    const months = ['2026-01', '2026-02', '2026-03', '2026-12', '2027-01', '2028-02'];
    for (const card of cards) {
      for (const month of months) {
        const cycle = getPayableCycleMonth(card, month);
        expect((resolveCardDueDate(card, cycle) || '').slice(0, 7)).toBe(month);
      }
    }
  });
});

describe('barrel re-exports (creditCardUtils)', () => {
  it('re-exports the three functions from creditCardBasics', () => {
    expect(barrel.getCardDueMonthOffset).toBe(getCardDueMonthOffset);
    expect(barrel.resolveCardDueDate).toBe(resolveCardDueDate);
    expect(barrel.getPayableCycleMonth).toBe(getPayableCycleMonth);
  });
});

describe('AC-11: resolveInstallmentDueDate( is called only inside creditCardBasics.ts', () => {
  const ROOT = path.resolve(__dirname, '../../..');
  const SCAN_DIRS = ['src', 'pages', 'lib', 'scripts'];
  const SKIP_DIRS = new Set(['node_modules', '.next', '.git', 'coverage']);
  const EXTENSIONS = /\.(ts|tsx)$/;

  function walk(dir: string, out: string[]): void {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (SKIP_DIRS.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full, out);
      else if (EXTENSIONS.test(entry.name)) out.push(full);
    }
  }

  it('no source file outside creditCardBasics.ts contains the call form', () => {
    const files: string[] = [];
    SCAN_DIRS.forEach(dir => walk(path.join(ROOT, dir), files));
    expect(files.length).toBeGreaterThan(50);
    const offenders = files
      .filter(file => path.basename(file) !== 'creditCardBasics.ts')
      .filter(file => /\bresolveInstallmentDueDate\s*\(/.test(fs.readFileSync(file, 'utf8')))
      .map(file => path.relative(ROOT, file));
    expect(offenders).toEqual([]);
  });

  it('the barrel re-export is a non-call reference and does not trip the check', () => {
    const barrelSource = fs.readFileSync(path.join(ROOT, 'src/shared/utils/creditCardUtils.ts'), 'utf8');
    expect(/\bresolveInstallmentDueDate\s*\(/.test(barrelSource)).toBe(false);
  });
});
