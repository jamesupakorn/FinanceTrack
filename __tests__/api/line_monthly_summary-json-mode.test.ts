/** @jest-environment node */
// JSON-mode coverage for /api/line_monthly_summary: recipients come from users.json via
// lib/userStore.loadUsers. Mongo mode lives in line_monthly_summary.test.ts.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createMocks } from 'node-mocks-http';
import type { NextApiHandler } from 'next';

const CRON = 'test-cron-secret';
let dir: string;
let handler: NextApiHandler;
let fetchMock: jest.SpyInstance;

beforeAll(() => {
  process.env.DATA_MODE = 'json';
  delete process.env.MONGODB_URI;
  process.env.CRON_SECRET = CRON;
  process.env.LINE_CHANNEL_ACCESS_TOKEN = 'test-line-token';
  process.env.LINE_CHANNEL_USER_ID = '';
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'line-summary-json-'));
  process.env.AUDIT_DATA_DIR = dir;
  jest.resetModules();
  fetchMock = jest.spyOn(global, 'fetch').mockImplementation(() =>
    Promise.resolve({ ok: true, status: 200, json: async () => ({}) } as Response));
  handler = require('../../pages/api/line_monthly_summary').default;
});

afterAll(() => {
  fetchMock.mockRestore();
  delete process.env.AUDIT_DATA_DIR;
  fs.rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  fetchMock.mockClear();
  fs.writeFileSync(path.join(dir, 'users.json'), JSON.stringify([
    { id: 'user-a', displayName: 'A', passwordHash: 'h', LineId: 'line-a', monthlySummaryEnabled: true },
    { id: 'user-b', displayName: 'B', passwordHash: 'h', LineId: 'line-b', monthlySummaryEnabled: true },
    { id: 'user-c', displayName: 'C', passwordHash: 'h' }
  ]));
});

async function run(body: Record<string, unknown>) {
  const { req, res } = createMocks({ method: 'POST', body, headers: { authorization: `Bearer ${CRON}` } });
  await handler(req, res);
  return res;
}

describe('/api/line_monthly_summary (JSON mode)', () => {
  it('sends only to users that have a LineId', async () => {
    const res = await run({ date: '2024-01-31' });
    expect(res._getStatusCode()).toBe(200);
    const { results } = JSON.parse(res._getData());
    expect(results.map((r: { userId: string }) => r.userId).sort()).toEqual(['user-a', 'user-b']);
    expect(fetchMock).toHaveBeenCalled();
  });

  it('targets a single user and marks the month as sent in users.json', async () => {
    const res = await run({ date: '2024-01-31', userId: 'user-a' });
    const { results } = JSON.parse(res._getData());
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ userId: 'user-a', sent: true });
    const users = JSON.parse(fs.readFileSync(path.join(dir, 'users.json'), 'utf8'));
    expect(users.find((u: { id: string }) => u.id === 'user-a').lastMonthlySummarySent).toBe('2024-01');
  });
});
