/** @jest-environment jsdom */
import {
  ApiValidationError,
  dailyExpenseAPI,
  expenseAPI,
  incomeAPI,
  savingsGoalsAPI,
  setSessionInvalidHandler,
  withCsrfHeaders
} from '../../../../src/shared/utils/frontend/apiUtils';
import { setActiveUserId } from '../../../../src/shared/utils/frontend/sessionClient';

const CSRF_VALUE = 'csrf-token-value_123';
const mutatingCalls: [string, () => Promise<unknown>][] = [
  ['PUT', () => savingsGoalsAPI.saveAllocations([])],
  ['DELETE', () => savingsGoalsAPI.delete('g1')]
];

function mockFetchOnce({ status = 200, body = {} }: { status?: number; body?: unknown } = {}): jest.Mock {
  const fetchMock = jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body
  });
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

const headersOf = (fetchMock: jest.Mock) => fetchMock.mock.calls[0][1].headers as Record<string, string>;

beforeEach(() => {
  setActiveUserId('u001');
  setSessionInvalidHandler(null);
  document.cookie = `ft_csrf=${CSRF_VALUE}`;
});

afterEach(() => {
  document.cookie = 'ft_csrf=; Max-Age=0';
  setActiveUserId(null);
  setSessionInvalidHandler(null);
  jest.restoreAllMocks();
});

describe('jsonFetch — CSRF header', () => {
  it('แนบ X-CSRF-Token จาก cookie บน POST', async () => {
    const fetchMock = mockFetchOnce();
    await incomeAPI.save('2026-01', {});
    expect(headersOf(fetchMock)['X-CSRF-Token']).toBe(CSRF_VALUE);
  });

  it.each(mutatingCalls)('แนบ X-CSRF-Token บน %s', async (_method, call) => {
    const fetchMock = mockFetchOnce();
    await call();
    expect(headersOf(fetchMock)['X-CSRF-Token']).toBe(CSRF_VALUE);
  });

  it('ไม่แนบบน GET (server ยกเว้น GET อยู่แล้ว)', async () => {
    const fetchMock = mockFetchOnce({ body: { '2026-01': {} } });
    await incomeAPI.getByMonth('2026-01');
    expect(headersOf(fetchMock)['X-CSRF-Token']).toBeUndefined();
  });

  it('ไม่มี cookie ft_csrf → ไม่แนบ header ว่าง ๆ (ปล่อยให้ server ตอบ 403 ไปตามจริง)', async () => {
    document.cookie = 'ft_csrf=; Max-Age=0';
    const fetchMock = mockFetchOnce();
    await incomeAPI.save('2026-01', {});
    expect(headersOf(fetchMock)['X-CSRF-Token']).toBeUndefined();
  });

  it('ไม่แนบ Authorization แม้ NEXT_PUBLIC_API_ACCESS_TOKEN_B64 ยังค้างอยู่', async () => {
    process.env.NEXT_PUBLIC_API_ACCESS_TOKEN_B64 = Buffer.from('tok').toString('base64');
    const fetchMock = mockFetchOnce();
    await incomeAPI.save('2026-01', {});
    const headers = headersOf(fetchMock);
    expect(headers['Content-Type']).toBe('application/json');
    expect(headers.Authorization).toBeUndefined();
    delete process.env.NEXT_PUBLIC_API_ACCESS_TOKEN_B64;
  });
});

describe('withCsrfHeaders — สำหรับ call site ที่ยิง fetch() ตรง', () => {
  it('เติม X-CSRF-Token โดยไม่แก้ headers เดิม', () => {
    const original: Record<string, string> = { 'Content-Type': 'application/json' };
    const result = withCsrfHeaders(original);
    expect(result).toEqual({ 'Content-Type': 'application/json', 'X-CSRF-Token': CSRF_VALUE });
    expect(original['X-CSRF-Token']).toBeUndefined();
  });

  it('ไม่มี cookie → คืน headers เดิม (ไม่มี key ว่าง ๆ)', () => {
    document.cookie = 'ft_csrf=; Max-Age=0';
    expect(withCsrfHeaders({ a: '1' })).toEqual({ a: '1' });
    expect(withCsrfHeaders()).toEqual({});
  });
});

describe('jsonFetch — 401/403 → session invalid handler', () => {
  it.each([401, 403])('status %s เรียก handler แล้วยัง throw ต่อ', async (status: number) => {
    mockFetchOnce({ status, body: { error: 'nope' } });
    const handler = jest.fn();
    setSessionInvalidHandler(handler);
    await expect(incomeAPI.getByMonth('2026-01')).rejects.toThrow('nope');
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('status 500 ไม่เรียก handler (ไม่เด้งผู้ใช้ออกเพราะเซิร์ฟเวอร์พัง)', async () => {
    mockFetchOnce({ status: 500, body: { error: 'boom' } });
    const handler = jest.fn();
    setSessionInvalidHandler(handler);
    await expect(incomeAPI.getByMonth('2026-01')).rejects.toThrow('boom');
    expect(handler).not.toHaveBeenCalled();
  });

  it('ไม่ได้ลงทะเบียน handler → ยัง throw ตามปกติ ไม่พัง', async () => {
    mockFetchOnce({ status: 401, body: { error: 'expired' } });
    await expect(incomeAPI.getByMonth('2026-01')).rejects.toThrow('expired');
  });

  it('handler ที่ throw เอง ไม่กลบ error เดิมของ API', async () => {
    mockFetchOnce({ status: 401, body: { error: 'expired' } });
    jest.spyOn(console, 'error').mockImplementation(() => {});
    setSessionInvalidHandler(() => { throw new Error('handler exploded'); });
    await expect(incomeAPI.getByMonth('2026-01')).rejects.toThrow('expired');
  });

  it('setSessionInvalidHandler(null) ยกเลิกการลงทะเบียนได้', async () => {
    const handler = jest.fn();
    setSessionInvalidHandler(handler);
    setSessionInvalidHandler(null);
    mockFetchOnce({ status: 401, body: { error: 'expired' } });
    await expect(incomeAPI.getByMonth('2026-01')).rejects.toThrow('expired');
    expect(handler).not.toHaveBeenCalled();
  });
});
describe('ADR-027 validation error handling', () => {
  const issues = [
    { path: ['items', 0, 'name'], code: 'too_small', message: 'item name is required' },
    { path: ['month'], code: 'invalid_type', message: 'Invalid input' }
  ];

  it('dailyExpenseAPI.save throws ApiValidationError with field path and message', async () => {
    mockFetchOnce({ status: 400, body: { error: 'Validation failed', issues } });
    const err = await dailyExpenseAPI.save('2026-01', []).catch(e => e);
    expect(err).toBeInstanceOf(ApiValidationError);
    expect(err.issues).toEqual(issues);
    expect(err.message).toBe('items[1].name: item name is required\nmonth: Invalid input');
  });

  it('expenseAPI.save also maps validation responses', async () => {
    mockFetchOnce({ status: 400, body: { error: 'Validation failed', issues: [issues[1]] } });
    await expect(expenseAPI.save('2026-01', {})).rejects.toThrow('month: Invalid input');
  });

  it('truncates long issue lists', async () => {
    const many = Array.from({ length: 5 }, (_, i) => ({ path: ['items', i], code: 'x', message: 'bad' }));
    mockFetchOnce({ status: 400, body: { error: 'Validation failed', issues: many } });
    const err = await dailyExpenseAPI.save('2026-01', []).catch(e => e);
    expect(err.message).toContain('และอีก 2 รายการ');
  });

  it('legacy {error: string} 400 responses still throw a plain Error with the message', async () => {
    mockFetchOnce({ status: 400, body: { error: 'month and expense_data required' } });
    const err = await incomeAPI.getByMonth('2026-01').catch(e => e);
    expect(err).not.toBeInstanceOf(ApiValidationError);
    expect(err.message).toBe('month and expense_data required');
  });

  it('malformed issues payload falls back to the legacy error string', async () => {
    mockFetchOnce({ status: 400, body: { error: 'Validation failed', issues: 'nope' } });
    const err = await dailyExpenseAPI.save('2026-01', []).catch(e => e);
    expect(err).not.toBeInstanceOf(ApiValidationError);
    expect(err.message).toBe('Validation failed');
  });
});
