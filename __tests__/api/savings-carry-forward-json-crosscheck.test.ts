/** @jest-environment node */
// savings-loan-withdrawal S2c, dispatch 3: the JSON hook's fail-closed cross-check (C-S2c-1, JSON form).
//
// A divergence can't happen with the real code (the credited set is diffed from the bucket that is
// persisted), so this suite injects one: `updateUserData` is wrapped so that, for `savings.json` only,
// one more month disappears from what gets persisted than `enforceUserMonthLimit` pruned. Everything
// else (the JSON store, the audit transaction) is real; only this collaborator is fault-injected, per
// CODING_STANDARD "Testing Patterns". The route must answer 500 and commit nothing.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createMocks } from 'node-mocks-http';
import type { NextApiHandler } from 'next';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';

declare const jest: typeof import('@jest/globals').jest;

const TEST_SECRET = 'test-secret-do-not-use-in-prod';
const USER_A = 'slw-cf-json-xcheck-user';

let dir = '';
let handler: NextApiHandler;
let sessionCookie: typeof import('../../src/shared/utils/backend/sessionCookie');

beforeAll(() => {
  process.env.SESSION_SECRET = TEST_SECRET;
  process.env.DATA_MODE = 'json';
  delete process.env.MONGODB_URI;
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slw-cf-json-xcheck-'));
  process.env.AUDIT_DATA_DIR = dir;

  jest.resetModules();
  jest.doMock('../../src/backend/data/userUtils', () => {
    const actual = jest.requireActual('../../src/backend/data/userUtils') as typeof import('../../src/backend/data/userUtils');
    return {
      ...actual,
      updateUserData: (filename: string, userId: string, updater: unknown) => {
        if (filename !== 'savings.json' || typeof updater !== 'function') {
          return actual.updateUserData(filename, userId, updater as never);
        }
        return actual.updateUserData(filename, userId, (bucket: Record<string, unknown>) => {
          const limited = { ...(updater as (b: Record<string, unknown>) => Record<string, unknown>)(bucket) };
          // Divergence: drop the oldest retained month too.
          const oldest = Object.keys(limited).sort()[0];
          delete limited[oldest];
          return limited;
        });
      }
    };
  });
  handler = require('../../pages/api/savings').default;
  sessionCookie = require('../../src/shared/utils/backend/sessionCookie');
});

afterAll(() => {
  jest.dontMock('../../src/backend/data/userUtils');
  delete process.env.AUDIT_DATA_DIR;
  fs.rmSync(dir, { recursive: true, force: true });
});

function rawFile(name: string): string | null {
  const file = path.join(dir, name);
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
}

describe('POST /api/savings (JSON) — prune/credit cross-check', () => {
  it('throws on a mismatch, so the route answers 500 and nothing is committed', async () => {
    const months = Array.from({ length: 15 }, (_, i) => {
      const d = new Date(Date.UTC(2025, i, 1));
      return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    });
    fs.writeFileSync(path.join(dir, 'savings.json'), JSON.stringify({
      [USER_A]: Object.fromEntries(months.map(m => [m, { month: m, savings_list: [{ savings_type: 'ทั่วไป', savings_amount: 100 }] }]))
    }));
    const before = ['savings.json', 'savings-carry-forward.json', 'audit_journal.json'].map(rawFile);

    const { signSession, createSessionId, signCsrfToken, SESSION_COOKIE_NAME } = sessionCookie;
    const sid = createSessionId();
    const { req, res } = createMocks({
      method: 'POST',
      body: { month: '2026-04', savings_list: [] },
      cookies: { [SESSION_COOKIE_NAME]: signSession(USER_A, sid) },
      headers: { 'x-csrf-token': signCsrfToken(sid) }
    });
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      await handler(req as never, res as never);
    } finally {
      errorSpy.mockRestore();
    }

    expect(res._getStatusCode()).toBe(500);
    expect(JSON.parse(res._getData())).toEqual({ error: 'Internal server error' });
    expect(['savings.json', 'savings-carry-forward.json', 'audit_journal.json'].map(rawFile)).toEqual(before);
  });
});
