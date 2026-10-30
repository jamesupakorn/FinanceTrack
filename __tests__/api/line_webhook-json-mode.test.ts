/** @jest-environment node */
// JSON-mode coverage for /api/line_webhook: the link command writes LineId into users.json via
// lib/userStore (the canonical user-record module). Mongo mode lives in line_webhook.test.ts.
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createMocks } from 'node-mocks-http';
import type { NextApiHandler } from 'next';

const TEST_SECRET = 'test-line-channel-secret';
let dir: string;
let handler: NextApiHandler;

const usersFile = () => path.join(dir, 'users.json');
const readUsers = () => JSON.parse(fs.readFileSync(usersFile(), 'utf8'));

beforeAll(() => {
  process.env.DATA_MODE = 'json';
  delete process.env.MONGODB_URI;
  process.env.LINE_CHANNEL_SECRET = TEST_SECRET;
  process.env.SESSION_SECRET = 'test-secret';
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'line-webhook-json-'));
  process.env.AUDIT_DATA_DIR = dir;
  jest.resetModules();
  handler = require('../../pages/api/line_webhook').default;
});

afterAll(() => {
  delete process.env.AUDIT_DATA_DIR;
  fs.rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  fs.writeFileSync(usersFile(), JSON.stringify([
    { id: 'u001', displayName: 'A', passwordHash: 'h' },
    { id: 'u002', displayName: 'B', passwordHash: 'h' }
  ]));
});

async function send(text: string) {
  const body = JSON.stringify({ events: [{ type: 'message', source: { userId: 'line-xyz' }, message: { type: 'text', text } }] });
  const signature = crypto.createHmac('sha256', TEST_SECRET).update(body).digest('base64');
  const { req, res } = createMocks({ method: 'POST', headers: { 'x-line-signature': signature } });
  const pending = handler(req, res);
  for (let i = 0; i < 500 && req.listenerCount('end') === 0; i++) {
    await new Promise((r) => setTimeout(r, 5));
  }
  req.send(body);
  await pending;
  return res;
}

describe('/api/line_webhook (JSON mode)', () => {
  it('link command stores LineId on the matching user only', async () => {
    const res = await send('link u001');
    expect(res._getStatusCode()).toBe(200);
    const users = readUsers();
    expect(users.find((u: { id: string }) => u.id === 'u001').LineId).toBe('line-xyz');
    expect(users.find((u: { id: string }) => u.id === 'u002').LineId).toBeUndefined();
  });

  it('link command for an unknown user changes nothing and does not create a user', async () => {
    const res = await send('link u999');
    expect(res._getStatusCode()).toBe(200);
    const users = readUsers();
    expect(users).toHaveLength(2);
    expect(users.some((u: { LineId?: string }) => u.LineId)).toBe(false);
  });
});
