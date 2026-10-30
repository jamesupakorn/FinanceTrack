/** @jest-environment node */
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { NextApiRequest, NextApiResponse } from 'next';

let dir: string;
let store: typeof import('../../lib/auditJsonStore');
let audited: typeof import('../../lib/auditedMutation');
let userUtils: typeof import('../../src/backend/data/userUtils');
let userStore: typeof import('../../lib/userStore');

const read = (name: string) => (fs.existsSync(path.join(dir, name)) ? JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')) : undefined);

beforeAll(() => {
  process.env.DATA_MODE = 'json';
  delete process.env.MONGODB_URI;
  process.env.SESSION_SECRET = 'test-secret';
  jest.resetModules();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-json-'));
  process.env.AUDIT_DATA_DIR = dir;
  store = require('../../lib/auditJsonStore');
  audited = require('../../lib/auditedMutation');
  userUtils = require('../../src/backend/data/userUtils');
  userStore = require('../../lib/userStore');
});

afterAll(() => {
  delete process.env.AUDIT_DATA_DIR;
  fs.rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  fs.readdirSync(dir).forEach(f => fs.rmSync(path.join(dir, f), { force: true, recursive: true }));
  Object.keys(store.jsonTestHooks).forEach(k => delete (store.jsonTestHooks as Record<string, unknown>)[k]);
});

function mockRes() {
  const res: Record<string, unknown> = { statusCode: 200, body: undefined };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (b: unknown) => { res.body = b; return res; };
  res.send = res.json;
  res.end = () => res;
  res.setHeader = () => res;
  return res as unknown as NextApiResponse & { body: unknown; statusCode: number };
}

const req = (method = 'POST') => ({ method, cookies: {}, headers: {}, query: {}, body: {} }) as unknown as NextApiRequest;

// A route that touches several files, like shared-month pruning does.
const multiFile = (q: NextApiRequest, r: NextApiResponse) => audited.withAudit(async (_q, res) => {
  userUtils.updateUserData('salary.json', 'u1', (b: Record<string, unknown>) => ({ ...b, '2025-01': { amount: 100 } }));
  userUtils.updateUserData('savings.json', 'u1', (b: Record<string, unknown>) => ({ ...b, '2025-01': { amount: 5 } }));
  userUtils.updateUserData('investment.json', 'u1', (b: Record<string, unknown>) => ({ ...b, '2025-01': { amount: 7 } }));
  res.status(201).json({ ok: true });
}, { source: 'test_multi' })(q, r);

describe('JSON atomic data + audit commit', () => {
  it('commits every file and its audit events together', async () => {
    const res = mockRes();
    await multiFile(req(), res);
    expect(res.statusCode).toBe(201);
    expect(read('salary.json').u1['2025-01']).toEqual({ amount: 100 });
    expect(read('savings.json')).toBeDefined();
    const events = store.readJournal();
    expect(events.map(e => e.resource).sort()).toEqual(['investment', 'salary', 'savings']);
    expect(fs.existsSync(path.join(dir, 'audit_wal.json'))).toBe(false);
  });

  it('audit failure rolls back the domain change (fail-mutation)', async () => {
    store.jsonTestHooks.beforeAuditAppend = () => { throw new Error('boom'); };
    const res = mockRes();
    await multiFile(req(), res);
    expect(res.statusCode).toBe(500);
    expect(read('salary.json')).toBeUndefined();
    expect(read('savings.json')).toBeUndefined();
    expect(store.readJournal()).toEqual([]);
  });

  it('a 4xx response commits nothing', async () => {
    const reject = audited.withAudit(async (_q, res) => {
      userUtils.updateUserData('salary.json', 'u1', () => ({ '2025-01': { amount: 1 } }));
      res.status(404).json({ error: 'nope' });
    }, { source: 'test_reject' });
    const res = mockRes();
    await reject(req(), res);
    expect(res.statusCode).toBe(404);
    expect(read('salary.json')).toBeUndefined();
    expect(store.readJournal()).toEqual([]);
  });

  it('a no-op write produces no audit event', async () => {
    const seed = audited.withAudit(async (_q, res) => {
      userUtils.updateUserData('salary.json', 'u1', () => ({ '2025-01': { amount: 1 } }));
      res.status(201).json({});
    }, { source: 'seed' });
    await seed(req(), mockRes());
    const before = store.readJournal().length;
    await seed(req(), mockRes());
    expect(store.readJournal().length).toBe(before);
  });

  it('reads do not open a transaction or write', async () => {
    const getter = audited.withAudit(async (_q, res) => { res.status(200).json({ ok: 1 }); }, { source: 'read' });
    await getter(req('GET'), mockRes());
    expect(fs.readdirSync(dir)).toEqual([]);
  });

  it('interrupted after the WAL is written: recovery completes ALL files + audit', async () => {
    store.jsonTestHooks.afterFileApplied = (i: number) => { if (i === 0) throw new Error('crash mid-apply'); };
    const res = mockRes();
    await multiFile(req(), res);
    expect(res.statusCode).toBe(500);
    // Simulated crash left the WAL behind with only part of the files applied.
    expect(fs.existsSync(path.join(dir, 'audit_wal.json'))).toBe(true);
    store.jsonTestHooks.afterFileApplied = undefined;
    // Any reader first finishes the interrupted commit, so it never sees a partial state.
    const journal = store.readJournal();
    expect(journal.map(e => e.resource).sort()).toEqual(['investment', 'salary', 'savings']);
    expect(read('salary.json')).toBeDefined();
    expect(read('savings.json')).toBeDefined();
    expect(read('investment.json')).toBeDefined();
    expect(fs.existsSync(path.join(dir, 'audit_wal.json'))).toBe(false);
  });

  it('crash before the WAL is complete leaves neither side applied', async () => {
    store.jsonTestHooks.beforeAuditAppend = () => { throw new Error('before wal'); };
    await multiFile(req(), mockRes());
    expect(fs.existsSync(path.join(dir, 'audit_wal.json'))).toBe(false);
    expect(fs.readdirSync(dir).filter(f => f.endsWith('.json'))).toEqual([]);
  });

  it('concurrent mutations are serialized and none are lost', async () => {
    const make = (n: number) => audited.withAudit(async (_q, res) => {
      await new Promise(r => setTimeout(r, 5));
      userUtils.updateUserData('savings.json', 'u1', (b: Record<string, unknown>) => ({ ...b, [`2025-${String(n).padStart(2, '0')}`]: { amount: n } }));
      res.status(201).json({});
    }, { source: 'concurrent' });
    await Promise.all([1, 2, 3, 4, 5, 6].map(n => make(n)(req(), mockRes())));
    expect(Object.keys(read('savings.json').u1).sort()).toHaveLength(6);
    expect(store.readJournal()).toHaveLength(6);
  });

  it('password changes and LINE links are audited without secrets', async () => {
    userStore.saveUsers([{ id: 'u1', name: 'n', passwordHash: 'h1' } as never]);
    // saveUsers outside a transaction writes directly; seed the journal baseline from it.
    const change = audited.withAudit(async (_q, res) => {
      const users = userStore.loadUsersJson() as Array<Record<string, unknown>>;
      users[0].passwordHash = 'h2';
      users[0].LineId = 'Usecret';
      userStore.saveUsers(users as never);
      res.status(200).json({});
    }, { source: 'change_password' });
    await change(req(), mockRes());
    const events = store.readJournal();
    expect(events.map(e => e.action).sort()).toEqual(['password_changed', 'updated']);
    const text = JSON.stringify(events);
    expect(text).not.toMatch(/h1|h2|Usecret/);
  });

  it('prunes old months as system retention events inside the same commit', async () => {
    const seed: Record<string, unknown> = {};
    for (let m = 1; m <= 12; m++) seed[`2023-${String(m).padStart(2, '0')}`] = { amount: m };
    store.jsonWrite(path.join(dir, 'salary.json'), JSON.stringify({ u1: seed }));
    const prune = audited.withAudit(async (_q, res) => {
      userUtils.updateUserData('salary.json', 'u1', (b: Record<string, unknown>) => {
        const next = { ...b, '2025-01': { amount: 1 } };
        delete (next as Record<string, unknown>)['2023-01'];
        return next;
      });
      res.status(201).json({});
    }, { source: 'salary' });
    await prune(req(), mockRes());
    const events = store.readJournal();
    expect(events.find(e => e.resourceKey === '2023-01')).toMatchObject({ action: 'retention_pruned', actorType: 'system' });
    expect(events.find(e => e.resourceKey === '2025-01')).toMatchObject({ action: 'created', actorType: 'user' });
  });
});
