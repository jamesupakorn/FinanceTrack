/**
 * Regression guard for saveRevolvingCashback serialization: always include cashbackAmount and omit paymentAction.
 */
import { creditCardAPI, setSessionInvalidHandler } from '../../../../src/shared/utils/frontend/apiUtils';
import { setActiveUserId } from '../../../../src/shared/utils/frontend/sessionClient';

function mockFetchOnce(): jest.Mock {
  const fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ success: true }) });
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

beforeEach(() => {
  setActiveUserId('u001');
  setSessionInvalidHandler(null);
});

afterEach(() => {
  setActiveUserId(null);
  jest.restoreAllMocks();
});

describe('creditCardAPI.saveRevolvingCashback (C-9)', () => {
  it.each([
    ['a formatted string', '100.00', '100.00'],
    ['a number', 50, 50],
    ['zero', 0, 0],
    ['undefined', undefined, null],
    ['null', null, null]
  ])('sends PATCH with cashbackAmount key present for %s, and no paymentAction key', async (_label: string, input: string | number | null | undefined, expected: string | number | null) => {
    const fetchMock = mockFetchOnce();
    await creditCardAPI.saveRevolvingCashback('cc_a', '2099-01', input);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toContain('/api/credit-cards/revolving');
    expect(options.method).toBe('PATCH');
    const body = JSON.parse(options.body);
    expect(Object.prototype.hasOwnProperty.call(body, 'cashbackAmount')).toBe(true);
    expect(body.cashbackAmount).toBe(expected);
    expect(Object.prototype.hasOwnProperty.call(body, 'paymentAction')).toBe(false);
    expect(Object.keys(body).sort()).toEqual(['cardId', 'cashbackAmount', 'month']);
  });
});