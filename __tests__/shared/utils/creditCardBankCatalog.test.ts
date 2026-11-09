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

  it('has no duplicates and has 22 entries with the current hexes (AC-BI-04)', () => {
    const unique = new Set(CARD_COLORS);
    expect(unique.size).toBe(CARD_COLORS.length);
    expect(CARD_COLORS.length).toBe(22);
  });
});

describe('creditCardBankCatalog — frozen legacy issuer colours (credit-card-issuer-color-fix)', () => {
  it('ktc/aeon/firstchoice carry the corrected, logo-accurate hex (AC-1)', () => {
    expect(BANK_ISSUERS.ktc.color).toBe('#cf3339');
    expect(BANK_ISSUERS.aeon.color).toBe('#533a98');
    expect(BANK_ISSUERS.firstchoice.color).toBe('#25447e');
  });

  it('the other 8 issuers keep their byte-identical colours', () => {
    expect(BANK_ISSUERS.kbank.color).toBe('#138f2d');
    expect(BANK_ISSUERS.scb.color).toBe('#4e2a84');
    expect(BANK_ISSUERS.ktb.color).toBe('#1ba5e1');
    expect(BANK_ISSUERS.bbl.color).toBe('#1e4598');
    expect(BANK_ISSUERS.krungsri.color).toBe('#fec43b');
    expect(BANK_ISSUERS.ttb.color).toBe('#004b93');
    expect(BANK_ISSUERS.uob.color).toBe('#0b3979');
    expect(BANK_ISSUERS.shopee.color).toBe('#ee4d2d');
  });

  it('CARD_COLORS still includes the 3 old, superseded hexes (AC-2, frozen legacy, append-only)', () => {
    expect(CARD_COLORS.includes('#00338e')).toBe(true);
    expect(CARD_COLORS.includes('#e4002b')).toBe(true);
    expect(CARD_COLORS.includes('#f26522')).toBe(true);
  });

  it('CARD_COLORS includes the 3 new, corrected hexes (AC-3)', () => {
    expect(CARD_COLORS.includes('#cf3339')).toBe(true);
    expect(CARD_COLORS.includes('#533a98')).toBe(true);
    expect(CARD_COLORS.includes('#25447e')).toBe(true);
  });

  it('CARD_COLORS has no duplicate entries (AC-5)', () => {
    expect(new Set(CARD_COLORS).size).toBe(CARD_COLORS.length);
  });

  it('a card already stored with an old, superseded hex still passes validateCardInput unchanged (AC-6)', () => {
    const { validateCardInput } = require('../../../src/shared/utils/creditCardRevolving');
    const legacyHexes = ['#00338e', '#e4002b', '#f26522'];
    legacyHexes.forEach((legacyColor) => {
      const result = validateCardInput({
        name: 'บัตรทดสอบ',
        color: legacyColor,
        creditLimit: 0,
        statementDay: 1,
        dueDay: 1,
      });
      expect(result.value.color).toBe(legacyColor);
    });
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