/** @jest-environment node */
// spec-credit-card-tiles §4 (AC-T9/T10/T13/T19) + review REV-7, T13b, T19b. Pure helpers only.
import {
  getLocalTodayIso,
  normaliseDueDate,
  sortCardsByDue,
  filterCardsByIssuers,
  countCardsByIssuer,
  loadIssuerFilter,
  saveIssuerFilter,
  ISSUER_FILTER_STORAGE_KEY,
  countOverdueInstallments,
  contrastRatio,
  pickTileTextColor,
  TILE_TEXT_LIGHT,
  TILE_TEXT_DARK
} from '../../../../src/shared/utils/frontend/creditCardTileUtils';
import { BANK_ISSUERS } from '../../../../src/shared/utils/creditCardBankCatalog';
import { diffDaysFromToday } from '../../../../src/shared/utils/creditCardUtils';

const TODAY = '2026-10-29';

describe('getLocalTodayIso (REV-7: same local-date source as diffDaysFromToday)', () => {
  it('formats local date parts', () => {
    expect(getLocalTodayIso(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
  });
  it('agrees with diffDaysFromToday: today is 0 days away', () => {
    expect(diffDaysFromToday(getLocalTodayIso())).toBe(0);
  });
});

describe('normaliseDueDate', () => {
  it.each([
    ['2026-11-05', '2026-11-05'],
    ['2026-11-05T10:00:00.000Z', '2026-11-05'],
    ['2026-02-30', null],
    ['garbage', null],
    ['', null],
    [null, null],
    [123, null]
  ])('%p -> %p', (input, expected) => {
    expect(normaliseDueDate(input)).toBe(expected);
  });
});

describe('sortCardsByDue (AC-T13, T13b)', () => {
  it('overdue (most overdue first), then upcoming ascending, then null; tie-break name then id', () => {
    const cards = [
      { id: 'n1', name: 'ข', nextDueDate: null },
      { id: 'u2', name: 'a', nextDueDate: '2026-11-20' },
      { id: 'o1', name: 'a', nextDueDate: '2026-10-20' },
      { id: 'u1', name: 'a', nextDueDate: '2026-11-01' },
      { id: 'o2', name: 'a', nextDueDate: '2026-10-01' },
      { id: 'n0', name: 'ก', nextDueDate: undefined },
      { id: 't2', name: 'z', nextDueDate: '2026-10-29' },
      { id: 't1', name: 'b', nextDueDate: '2026-10-29' },
      { id: 't0', name: 'b', nextDueDate: '2026-10-29' }
    ];
    const before = cards.map(c => c.id);
    expect(sortCardsByDue(cards, TODAY).map(c => c.id)).toEqual(['o2', 'o1', 't0', 't1', 't2', 'u1', 'u2', 'n0', 'n1']);
    expect(cards.map(c => c.id)).toEqual(before); // not mutated
  });

  it('T13b: timestamped nextDueDate is compared by its date part; invalid sorts as null', () => {
    const cards = [
      { id: 'bad', name: 'a', nextDueDate: 'not-a-date' },
      { id: 'ts', name: 'b', nextDueDate: '2026-10-30T23:00:00Z' },
      { id: 'plain', name: 'c', nextDueDate: '2026-10-30' },
      { id: 'early', name: 'z', nextDueDate: '2026-10-28' },
      { id: 'impossible', name: 'a', nextDueDate: '2026-02-30' }
    ];
    expect(sortCardsByDue(cards, TODAY).map(c => c.id)).toEqual(['early', 'ts', 'plain', 'bad', 'impossible']);
  });
});

describe('filterCardsByIssuers + countCardsByIssuer (AC-T9)', () => {
  const cards = [
    { id: '1', bankIssuer: 'kbank' },
    { id: '2', bankIssuer: 'scb' },
    { id: '3', bankIssuer: 'kbank' },
    { id: '4', bankIssuer: 'unknown-bank' },
    { id: '5' }
  ];
  it('empty selection == all', () => {
    expect(filterCardsByIssuers(cards, []).map(c => c.id)).toEqual(['1', '2', '3', '4', '5']);
  });
  it('multi-select returns exactly the selected banks; unknown issuer counts as other', () => {
    expect(filterCardsByIssuers(cards, ['kbank', 'scb']).map(c => c.id)).toEqual(['1', '2', '3']);
    expect(filterCardsByIssuers(cards, ['other']).map(c => c.id)).toEqual(['4', '5']);
  });
  it('counts per bank in catalog order, count > 0 only', () => {
    expect(countCardsByIssuer(cards)).toEqual([
      { key: 'kbank', count: 2 },
      { key: 'scb', count: 1 },
      { key: 'other', count: 2 }
    ]);
    expect(countCardsByIssuer([])).toEqual([]);
  });
});

describe('loadIssuerFilter / saveIssuerFilter (AC-T10)', () => {
  function memoryStorage(initial: Record<string, string> = {}) {
    const data = { ...initial };
    return {
      data,
      getItem: (key: string) => (key in data ? data[key] : null),
      setItem: (key: string, value: string) => { data[key] = value; }
    };
  }

  it('round-trips known keys under the versioned key', () => {
    const storage = memoryStorage();
    expect(saveIssuerFilter(['kbank', 'scb', 'kbank', 'bogus'], storage)).toBe(true);
    expect(JSON.parse(storage.data[ISSUER_FILTER_STORAGE_KEY])).toEqual(['kbank', 'scb']);
    expect(loadIssuerFilter(storage)).toEqual(['kbank', 'scb']);
  });

  it('drops unknown keys and ignores corrupt / non-array JSON', () => {
    expect(loadIssuerFilter(memoryStorage({ [ISSUER_FILTER_STORAGE_KEY]: '["ktb","constructor",5,"ktb"]' }))).toEqual(['ktb']);
    expect(loadIssuerFilter(memoryStorage({ [ISSUER_FILTER_STORAGE_KEY]: '{not json' }))).toEqual([]);
    expect(loadIssuerFilter(memoryStorage({ [ISSUER_FILTER_STORAGE_KEY]: '{"a":1}' }))).toEqual([]);
    expect(loadIssuerFilter(memoryStorage())).toEqual([]);
  });

  it('storage that throws never escapes', () => {
    const throwing = {
      getItem: () => { throw new Error('SecurityError'); },
      setItem: () => { throw new Error('QuotaExceeded'); }
    };
    expect(loadIssuerFilter(throwing)).toEqual([]);
    expect(saveIssuerFilter(['kbank'], throwing)).toBe(false);
  });

  it('no window (SSR) -> [] / false', () => {
    expect(loadIssuerFilter()).toEqual([]);
    expect(saveIssuerFilter(['kbank'])).toBe(false);
  });
});

describe('countOverdueInstallments', () => {
  const card = { id: 'cc_1', dueDay: 15 };
  const plans = [
    { cardId: 'cc_1', status: 'ongoing', schedule: [
      { no: 1, dueMonth: '2026-08', paid: true },
      { no: 2, dueMonth: '2026-09', paid: false },
      { no: 3, dueMonth: '2026-10', paid: false }, // 2026-10-15 < today
      { no: 4, dueMonth: '2026-11', paid: false }
    ] },
    { cardId: 'cc_1', status: 'cancelled', schedule: [{ no: 1, dueMonth: '2026-01', paid: false }] },
    { cardId: 'cc_2', status: 'ongoing', schedule: [{ no: 1, dueMonth: '2026-01', paid: false }] }
  ];
  it('counts unpaid rows of ongoing plans of this card due before today', () => {
    expect(countOverdueInstallments(card, plans, TODAY)).toBe(2);
    expect(countOverdueInstallments(card, plans, '2026-10-15')).toBe(1); // due today is not overdue
  });
  it('is defensive', () => {
    expect(countOverdueInstallments(card, null, TODAY)).toBe(0);
    expect(countOverdueInstallments({ dueDay: 1 }, plans, TODAY)).toBe(0);
  });
});

describe('contrast (AC-T19, T19b)', () => {
  it('computes WCAG ratios', () => {
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 5);
    expect(contrastRatio('#777777', '#777777')).toBeCloseTo(1, 5);
  });

  const samples = [
    ...Object.values(BANK_ISSUERS).map(issuer => issuer.color),
    '#F5A623', '#138f2d', '#fec43b', '#f26522', '#ffff00', '#ff8000', '#808080', '#767676',
    '#ffffff', '#000000', '#f0f0f0', '#1a1a1a', '#abc'
  ];
  it.each(samples)('%s gets a text colour with >= 4.5:1', color => {
    const { color: text, ratio } = pickTileTextColor(color);
    expect([TILE_TEXT_LIGHT, TILE_TEXT_DARK]).toContain(text);
    expect(ratio).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(color, text)).toBeCloseTo(ratio, 10);
  });

  it('exhaustive grey sweep never drops below 4.5:1 (worst case mid-luminance)', () => {
    for (let v = 0; v <= 255; v += 1) {
      const hex = `#${v.toString(16).padStart(2, '0').repeat(3)}`;
      expect(pickTileTextColor(hex).ratio).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('invalid colour falls back without throwing', () => {
    expect(pickTileTextColor('nope').ratio).toBeGreaterThanOrEqual(4.5);
  });
});
