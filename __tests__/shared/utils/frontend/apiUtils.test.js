/**
 * TD-C02 Increment B3 — จุดรวมเดียวของฝั่ง client (jsonFetch ใน apiUtils.js)
 * ทดสอบผ่าน public API (incomeAPI/savingsGoalsAPI) เพราะ jsonFetch ไม่ได้ export ออกมา
 *
 * ครอบคลุม:
 * 1. แนบ X-CSRF-Token จาก cookie ft_csrf เฉพาะ method ที่เปลี่ยนข้อมูล
 * 2. 401/403 → เรียก session-invalid handler ที่ลงทะเบียนไว้ แล้วยัง throw ให้ .catch() เดิมทำงาน
 * 3. สถานะ error อื่น ๆ (เช่น 500) ต้องไม่เด้งผู้ใช้ออกจากระบบ
 */
import {
  incomeAPI,
  savingsGoalsAPI,
  setSessionInvalidHandler,
  withCsrfHeaders
} from '../../../../src/shared/utils/frontend/apiUtils';
import { setActiveUserId } from '../../../../src/shared/utils/frontend/sessionClient';

const CSRF_VALUE = 'csrf-token-value_123';

function mockFetchOnce({ status = 200, body = {} } = {}) {
  const fetchMock = jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body
  });
  global.fetch = fetchMock;
  return fetchMock;
}

const headersOf = fetchMock => fetchMock.mock.calls[0][1].headers;

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

  it.each([
    ['PUT', () => savingsGoalsAPI.saveAllocations([])],
    ['DELETE', () => savingsGoalsAPI.delete('g1')]
  ])('แนบ X-CSRF-Token บน %s', async (_method, call) => {
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

  // TD-C02 follow-up: static Bearer token ถูกถอดออกทั้งระบบ — jsonFetch ต้องไม่แนบ Authorization
  // อีกต่อไป แม้ env ตัวเดิมจะยังค้างอยู่ใน environment ก็ตาม
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
    const original = { 'Content-Type': 'application/json' };
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
  it.each([401, 403])('status %s เรียก handler แล้วยัง throw ต่อ', async (status) => {
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
