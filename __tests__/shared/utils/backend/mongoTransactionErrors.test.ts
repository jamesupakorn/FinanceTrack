/** @jest-environment node */
// loan-installments-td-cleanup D6 / I7 — the shared transient-rethrow helper (AC-TDC-30, AC-TDC-35).
import { MongoServerError } from 'mongodb';
import {
  TRANSIENT_TRANSACTION_ERROR_LABEL,
  isTransientTransactionError,
  relabelDuplicateKeyAsTransient,
  rethrowIfTransientTransactionError
} from '../../../../src/shared/utils/backend/mongoTransactionErrors';

const INDEX_NAME = 'uniq_userId_month';

const serverError = (fields: Record<string, unknown>) =>
  new MongoServerError({ message: String(fields.errmsg ?? 'server error'), ...fields });

const labelled = () => {
  const error = serverError({ code: 112, errmsg: 'WriteConflict' });
  error.addErrorLabel(TRANSIENT_TRANSACTION_ERROR_LABEL);
  return error;
};

describe('relabelDuplicateKeyAsTransient (AC-TDC-30)', () => {
  it('labels a duplicate key on exactly {userId:1, month:1}', () => {
    const error = serverError({ code: 11000, keyPattern: { userId: 1, month: 1 }, errmsg: 'E11000 duplicate key' });

    relabelDuplicateKeyAsTransient(error, INDEX_NAME);

    expect(error.hasErrorLabel(TRANSIENT_TRANSACTION_ERROR_LABEL)).toBe(true);
  });

  it('labels a duplicate key whose errmsg names the index', () => {
    const error = serverError({
      code: 11000,
      errmsg: `E11000 duplicate key error collection: test.monthly_expense index: ${INDEX_NAME} dup key`
    });

    relabelDuplicateKeyAsTransient(error, INDEX_NAME);

    expect(error.hasErrorLabel(TRANSIENT_TRANSACTION_ERROR_LABEL)).toBe(true);
  });

  it.each([
    ['another key pattern', { keyPattern: { userId: 1 } }],
    ['a superset key pattern', { keyPattern: { userId: 1, month: 1, extra: 1 } }],
    ['the _id index', { keyPattern: { _id: 1 }, errmsg: 'E11000 duplicate key error index: _id_' }]
  ])('leaves a code 11000 on %s untouched', (_label, fields) => {
    const error = serverError({ code: 11000, ...fields });

    expect(() => relabelDuplicateKeyAsTransient(error, INDEX_NAME)).not.toThrow();
    expect(error.hasErrorLabel(TRANSIENT_TRANSACTION_ERROR_LABEL)).toBe(false);
  });

  it('leaves a non-duplicate server error on the same key pattern untouched', () => {
    const error = serverError({ code: 2, keyPattern: { userId: 1, month: 1 }, errmsg: INDEX_NAME });

    relabelDuplicateKeyAsTransient(error, INDEX_NAME);

    expect(error.hasErrorLabel(TRANSIENT_TRANSACTION_ERROR_LABEL)).toBe(false);
  });

  it('leaves a plain Error untouched and does not throw', () => {
    const error = Object.assign(new Error(`E11000 ${INDEX_NAME}`), { code: 11000, keyPattern: { userId: 1, month: 1 } });

    expect(() => relabelDuplicateKeyAsTransient(error, INDEX_NAME)).not.toThrow();
    expect(isTransientTransactionError(error)).toBe(false);
  });

  it.each([null, undefined, 'E11000', 11000])('does not throw for %p', value => {
    expect(() => relabelDuplicateKeyAsTransient(value, INDEX_NAME)).not.toThrow();
  });
});

describe('rethrowIfTransientTransactionError / isTransientTransactionError (AC-TDC-35)', () => {
  it('rethrows the very same labelled object', () => {
    const error = labelled();
    let thrown: unknown;

    try {
      rethrowIfTransientTransactionError(error);
    } catch (caught) {
      thrown = caught;
    }

    expect(thrown).toBe(error);
    expect(isTransientTransactionError(error)).toBe(true);
  });

  it('rethrows a duplicate key once it has been relabelled', () => {
    const error = serverError({ code: 11000, keyPattern: { userId: 1, month: 1 } });
    relabelDuplicateKeyAsTransient(error, INDEX_NAME);

    expect(() => rethrowIfTransientTransactionError(error)).toThrow(error);
  });

  it.each([
    ['an unlabelled MongoServerError', serverError({ code: 112, errmsg: 'WriteConflict' })],
    ['a plain Error', new Error('boom')],
    ['null', null],
    ['undefined', undefined],
    ['a string', 'TransientTransactionError']
  ])('returns undefined for %s', (_label, value) => {
    expect(rethrowIfTransientTransactionError(value)).toBeUndefined();
    expect(isTransientTransactionError(value)).toBe(false);
  });

  it('does not depend on instanceof (duck-typed hasErrorLabel)', () => {
    const foreign = { hasErrorLabel: (label: string) => label === TRANSIENT_TRANSACTION_ERROR_LABEL, addErrorLabel: () => {} };

    expect(isTransientTransactionError(foreign)).toBe(true);
    expect(() => rethrowIfTransientTransactionError(foreign)).toThrow();
  });
});
