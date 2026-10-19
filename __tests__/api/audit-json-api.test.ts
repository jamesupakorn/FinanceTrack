/** @jest-environment node */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createMocks } from 'node-mocks-http';

let dir: string;
let audit: (req: never, res: never) => Promise<unknown>;
let sessionCookie: typeof import('../../src/shared/utils/backend/sessionCookie');

beforeAll(() => {
  process.env.DATA_MODE = 'json';
  delete process.env.MONGODB_URI;
  process.env.SESSION_SECRET = 'test-secret';
  jest.resetModules();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-json-api-'));
  process.env.AUDIT_DATA_DIR = dir;
  sessionCookie = require('../../src/shared/utils/backend/sessionCookie');
  audit = require('../../pages/api/audit-logs').default;
});
afterAll(() => {
  delete process.env.AUDIT_DATA_DIR;
  fs.rmSync(dir, { recursive: true, force: true });
});

const ev = (n: number, user: string, ageDays = 0) => ({
  eventId: `e${String(n).padStart(4, '0')}`,
  occurredAt: new Date(Date.now() - ageDays * 86400000 - (1000 - n) * 1000).toISOString(),
  subjectUserId: user, actorUserId: user, actorType: 'user', source: 'salary',
  resource: 'salary', action: 'updated', changedFields: ['amount'],
});

function get(userId: string | null, query: Record<string, string> = {}) {
  const sid = sessionCookie.createSessionId();
  const { req, res } = createMocks({
    method: 'GET', query,
    cookies: userId ? { [sessionCookie.SESSION_COOKIE_NAME]: sessionCookie.signSession(userId, sid) } : {},
  });
  return audit(req as never, res as never).then(() => ({ status: res._getStatusCode(), data: res._getData() ? JSON.parse(res._getData()) : undefined }));
}

describe('GET /api/audit-logs (JSON mode)', () => {
  beforeAll(() => {
    const events = [
      ...Array.from({ length: 120 }, (_, i) => ev(i, 'ua')),
      ev(500, 'ub'),
      ev(600, 'ua', 400),
    ];
    fs.writeFileSync(path.join(dir, 'audit_journal.json'), JSON.stringify({ events }));
  });

  it('requires a session', async () => {
    expect((await get(null)).status).toBe(401);
  });

  it('isolates users and hides internal ids', async () => {
    const r = await get('ub');
    expect(r.data.items).toHaveLength(1);
    expect(JSON.stringify(r.data)).not.toMatch(/subjectUserId|actorUserId/);
  });

  it('paginates newest first, 50 default, excluding events older than 365 days', async () => {
    const p1 = await get('ua');
    expect(p1.data.items).toHaveLength(50);
    expect(p1.data.items[0].eventId).toBe('e0119');
    const p2 = await get('ua', { cursor: p1.data.nextCursor });
    const p3 = await get('ua', { cursor: p2.data.nextCursor });
    expect(p3.data.items).toHaveLength(20);
    expect(p3.data.nextCursor).toBeNull();
    const ids = [...p1.data.items, ...p2.data.items, ...p3.data.items].map((i: { eventId: string }) => i.eventId);
    expect(new Set(ids).size).toBe(120);
    expect(ids).not.toContain('e0600');
  });

  it('clamps limit to 100 and rejects invalid', async () => {
    expect((await get('ua', { limit: '100' })).data.items).toHaveLength(100);
    expect((await get('ua', { limit: '500' })).data.items).toHaveLength(100);
    expect((await get('ua', { limit: '0' })).status).toBe(400);
  });
});
