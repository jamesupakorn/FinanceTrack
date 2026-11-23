import { describe, expect, it } from '@jest/globals';
import {
  parseCreditFocusKey,
  revolvingFocusKey,
  upcomingCardHref,
  upcomingItemHref
} from '../../../../src/shared/utils/frontend/upcomingLinks';

describe('upcomingItemHref', () => {
  it('builds a plain href using cycleMonth when it is a valid month (AC-1)', () => {
    const href = upcomingItemHref({
      source: 'plain',
      key: 'exp_1',
      isoDate: '2026-11-10',
      cycleMonth: '2026-10',
      card: null,
      plan: null
    });
    expect(href).toEqual({ pathname: '/workspace/expense', query: { month: '2026-10', focus: 'exp_1' } });
  });

  it('falls back to isoDate month when cycleMonth is missing or invalid (plain)', () => {
    const missing = upcomingItemHref({
      source: 'plain',
      key: 'exp_1',
      isoDate: '2026-11-10',
      card: null,
      plan: null
    });
    expect(missing).toEqual({ pathname: '/workspace/expense', query: { month: '2026-11', focus: 'exp_1' } });

    const invalid = upcomingItemHref({
      source: 'plain',
      key: 'exp_1',
      isoDate: '2026-11-10',
      cycleMonth: 'not-a-month',
      card: null,
      plan: null
    });
    expect(invalid).toEqual({ pathname: '/workspace/expense', query: { month: '2026-11', focus: 'exp_1' } });
  });

  it('returns null for a plain event with an empty key', () => {
    const href = upcomingItemHref({
      source: 'plain',
      key: '',
      isoDate: '2026-11-10',
      cycleMonth: '2026-10',
      card: null,
      plan: null
    });
    expect(href).toBeNull();
  });

  it('builds an installment href from card + plan ids (AC-2)', () => {
    const href = upcomingItemHref({
      source: 'installment',
      key: 'cci_p1_1',
      isoDate: '2026-11-10',
      card: { id: 'c1' },
      plan: { id: 'p1' }
    });
    expect(href).toEqual({ pathname: '/credits', query: { card: 'c1', focus: 'p1' } });
  });

  it('returns null for installment when card or plan is unresolved (E-1)', () => {
    expect(
      upcomingItemHref({ source: 'installment', key: 'cci_p1_1', isoDate: '2026-11-10', card: null, plan: { id: 'p1' } })
    ).toBeNull();
    expect(
      upcomingItemHref({ source: 'installment', key: 'cci_p1_1', isoDate: '2026-11-10', card: { id: 'c1' }, plan: null })
    ).toBeNull();
    expect(
      upcomingItemHref({ source: 'installment', key: 'cci_p1_1', isoDate: '2026-11-10', card: { id: 'c1' } })
    ).toBeNull();
  });

  it('builds a revolving href with focus when cycleMonth is valid (AC-3)', () => {
    const href = upcomingItemHref({
      source: 'revolving',
      key: 'ccr_c1',
      isoDate: '2026-11-10',
      cycleMonth: '2026-10',
      card: { id: 'c1' },
      plan: null
    });
    expect(href).toEqual({ pathname: '/credits', query: { card: 'c1', focus: 'c1_2026-10' } });
  });

  it('builds a revolving href without focus when cycleMonth is missing or invalid (E-2)', () => {
    const missing = upcomingItemHref({
      source: 'revolving',
      key: 'ccr_c1',
      isoDate: '2026-11-10',
      card: { id: 'c1' },
      plan: null
    });
    expect(missing).toEqual({ pathname: '/credits', query: { card: 'c1' } });

    const invalid = upcomingItemHref({
      source: 'revolving',
      key: 'ccr_c1',
      isoDate: '2026-11-10',
      cycleMonth: 'bogus',
      card: { id: 'c1' },
      plan: null
    });
    expect(invalid).toEqual({ pathname: '/credits', query: { card: 'c1' } });
  });

  it('returns null for revolving when card is unresolved', () => {
    expect(
      upcomingItemHref({ source: 'revolving', key: 'ccr_c1', isoDate: '2026-11-10', card: null, plan: null })
    ).toBeNull();
  });

  it('returns null for any other source (e.g. statement)', () => {
    expect(
      upcomingItemHref({ source: 'statement', key: 'x', isoDate: '2026-11-10', card: { id: 'c1' }, plan: null })
    ).toBeNull();
  });
});

describe('upcomingCardHref', () => {
  it('builds a card href with no focus (AC-4)', () => {
    expect(upcomingCardHref({ card: { id: 'c1' } })).toEqual({ pathname: '/credits', query: { card: 'c1' } });
  });
});

describe('revolvingFocusKey / parseCreditFocusKey (S2, re-verified)', () => {
  it('composes a cardId_month key', () => {
    expect(revolvingFocusKey('c1', '2026-10')).toBe('c1_2026-10');
  });

  it('parses a revolving key back into kind/month', () => {
    expect(parseCreditFocusKey('c1_2026-10', 'c1')).toEqual({ kind: 'revolving', month: '2026-10' });
  });

  it('treats a non-revolving-shaped string as a plan id', () => {
    expect(parseCreditFocusKey('plan123', 'c1')).toEqual({ kind: 'plan', planId: 'plan123' });
  });

  it('treats a cardId-prefixed but invalid-month string as a plan id', () => {
    expect(parseCreditFocusKey('c1_bogus', 'c1')).toEqual({ kind: 'plan', planId: 'c1_bogus' });
  });

  it('returns null for empty/null/undefined focus keys', () => {
    expect(parseCreditFocusKey('', 'c1')).toBeNull();
    expect(parseCreditFocusKey(null, 'c1')).toBeNull();
    expect(parseCreditFocusKey(undefined, 'c1')).toBeNull();
  });
});
