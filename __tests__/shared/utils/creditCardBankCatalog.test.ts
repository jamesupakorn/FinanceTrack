export {};

const fs: typeof import('node:fs') = require('node:fs');
const path: typeof import('node:path') = require('node:path');
const {
  BANK_ISSUERS,
  BANK_ISSUER_KEYS,
  isBankIssuerKey,
  getBankIssuer,
} = require('../../../src/shared/utils/creditCardBankCatalog');
const {
  CARD_COLORS,
  BASE_CARD_COLORS,
} = require('../../../src/shared/utils/creditCardBasics');

// Feature: credit-card-bank-issuer-logo. This suite covers the catalog module and its color derivation.

describe('creditCardBankCatalog — BANK_ISSUER_KEYS order (AC-BI-01)', () => {
  it('equals exactly the 11 named issuers followed by other, in declaration order', () => {
    expect(BANK_ISSUER_KEYS).toEqual([
      'kbank', 'scb', 'ktb', 'bbl', 'krungsri', 'ttb', 'uob',
      'ktc', 'aeon', 'firstchoice', 'shopee', 'other',
    ]);
  });
});

describe('creditCardBankCatalog — hex format (part of AC-BI-05)', () => {
  it('every catalog hex is a lowercase 6-digit hex', () => {
    const hexPattern = /^#[0-9a-f]{6}$/;
    BANK_ISSUER_KEYS.forEach((key: keyof typeof BANK_ISSUERS) => {
      expect(BANK_ISSUERS[key].color).toMatch(hexPattern);
    });
  });
});

describe('creditCardBankCatalog — logo assets', () => {
  it('maps each configured logo to an existing local asset', () => {
    BANK_ISSUER_KEYS.filter((key: keyof typeof BANK_ISSUERS) => BANK_ISSUERS[key].logo !== null).forEach((key: keyof typeof BANK_ISSUERS) => {
      const logo = BANK_ISSUERS[key].logo;
      expect(logo).toMatch(/^\/bank-logos\/[^/]+\.(svg|png)$/);
      expect(fs.existsSync(path.join(__dirname, '../../../public', logo.slice(1)))).toBe(true);
    });
  });

  it('"other" remains the only issuer on the colour-dot fallback', () => {
    expect(BANK_ISSUER_KEYS.filter((key: keyof typeof BANK_ISSUERS) => BANK_ISSUERS[key].logo === null)).toEqual(['other']);
  });

  it('"other" has no logo and keeps the colour-dot fallback', () => {
    expect(BANK_ISSUERS.other.logo).toBeNull();
  });
});

describe('creditCardBankCatalog — isBankIssuerKey (own-property check, V-2)', () => {
  it('returns true only for actual catalog keys', () => {
    expect(isBankIssuerKey('kbank')).toBe(true);
    expect(isBankIssuerKey('scb')).toBe(true);
    expect(isBankIssuerKey('other')).toBe(true);
  });

  it('returns false for unknown, malformed or non-string input', () => {
    expect(isBankIssuerKey('KBANK')).toBe(false);
    expect(isBankIssuerKey('citi')).toBe(false);
    expect(isBankIssuerKey('')).toBe(false);
    expect(isBankIssuerKey(null)).toBe(false);
    expect(isBankIssuerKey(undefined)).toBe(false);
    expect(isBankIssuerKey(42)).toBe(false);
    expect(isBankIssuerKey({})).toBe(false);
  });

  it('rejects prototype-chain keys that `in` would wrongly accept (edge case 3)', () => {
    expect(isBankIssuerKey('constructor')).toBe(false);
    expect(isBankIssuerKey('toString')).toBe(false);
    expect(isBankIssuerKey('__proto__')).toBe(false);
    expect('constructor' in BANK_ISSUERS).toBe(true);
  });
});

describe('creditCardBankCatalog — CARD_COLORS derivation (AC-BI-02/03/04)', () => {
  it('includes every bank issuer color in CARD_COLORS (AC-BI-02)', () => {
    BANK_ISSUER_KEYS.forEach((key: keyof typeof BANK_ISSUERS) => {
      expect(CARD_COLORS.includes(BANK_ISSUERS[key].color)).toBe(true);
    });
  });

  it('keeps the original 8 base colours first, in order, with index 0 unchanged (AC-BI-03)', () => {
    expect(CARD_COLORS.slice(0, 8)).toEqual([
      '#5d5bff', '#22c1a4', '#f2994a', '#eb5757',
      '#9b51e0', '#2f80ed', '#f2c94c', '#6b7280',
    ]);
    expect(CARD_COLORS[0]).toBe('#5d5bff');
    expect(BASE_CARD_COLORS).toEqual(CARD_COLORS.slice(0, 8));
  });

  it('has no duplicates and has 19 entries with the current hexes (AC-BI-04)', () => {
    const unique = new Set(CARD_COLORS);
    expect(unique.size).toBe(CARD_COLORS.length);
    expect(CARD_COLORS.length).toBe(19);
  });
});

describe('creditCardBankCatalog — getBankIssuer (AC-BI-06)', () => {
  it('falls back to "other" for missing, invalid or prototype-chain input', () => {
    expect(getBankIssuer({})).toBe('other');
    expect(getBankIssuer(null)).toBe('other');
    expect(getBankIssuer({ bankIssuer: 'citi' })).toBe('other');
    expect(getBankIssuer({ bankIssuer: 'constructor' })).toBe('other');
  });

  it('returns the stored key when it is a valid catalog key', () => {
    expect(getBankIssuer({ bankIssuer: 'scb' })).toBe('scb');
  });
});