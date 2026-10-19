/** @jest-environment node */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import type { NextApiRequest, NextApiResponse } from 'next';

let dir: string;
let store: typeof import('../../lib/auditJsonStore');
let audited: typeof import('../../lib/auditedMutation');

const root = path.resolve(__dirname, '../..');
const tsx = path.join(root, 'node_modules', '.bin', 'tsx');
const worker = path.join(root, '__tests__', 'helpers', 'auditJsonWorker.ts');

const read = (name: string) => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));

beforeAll(() => {
  process.env.DATA_MODE = 'json';
  delete process.env.MONGODB_URI;
  process.env.SESSION_SECRET = 'test-secret';
  jest.resetModules();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-lock-'));
  process.env.AUDIT_DATA_DIR = dir;
  store = require('../../lib/auditJsonStore');
  audited = require('../../lib/auditedMutation');
});

afterAll(() => {
  delete process.env.AUDIT_DATA_DIR;
  fs.rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  fs.readdirSync(dir).forEach(f => fs.rmSync(path.join(dir, f), { force: true, recursive: true }));
});

function mockRes() {
  const res: Record<string, unknown> = { statusCode: 200 };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = () => res;
  res.send = res.json;
  res.end = () => res;
  res.setHeader = () => res;
  return res as unknown as NextApiResponse & { statusCode: number };
}

const req = () => ({ method: 'POST', cookies: {}, headers: {}, query: {}, body: {} }) as unknown as NextApiRequest;

const run = () => audited.withAudit(async (_q, res) => {
  store.jsonWrite(path.join(dir, 'salary.json'), JSON.stringify({ u1: { counter: 1 } }));
  res.status(201).json({});
}, { source: 'lock_test' })(req(), mockRes());

function runWorker(iterations: number): Promise<{ ok: number; errors: string[] }> {
  return new Promise((resolve, reject) => {
    const child = spawn(tsx, [worker, String(iterations)], {
      cwd: root,
      env: { ...process.env, AUDIT_DATA_DIR: dir, DATA_MODE: 'json', SESSION_SECRET: 'test-secret', MONGODB_URI: '' }
    });
    let out = '';
    let err = '';
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { err += d; });
    child.on('close', code => {
      if (code !== 0) return reject(new Error(`worker exited ${code}: ${err}`));
      try { resolve(JSON.parse(out)); } catch { reject(new Error(`bad worker output: ${out} ${err}`)); }
    });
  });
}

describe('JSON write lock', () => {
  it('a leaked lock owned by this same pid (crash + pid reuse) is reclaimed instead of blocking forever', async () => {
    fs.mkdirSync(path.join(dir, 'audit_write.lock'));
    fs.writeFileSync(path.join(dir, 'audit_write.lock', 'owner.json'), JSON.stringify({ pid: process.pid, at: 1, token: 'old-run' }));
    const res = mockRes();
    await audited.withAudit(async (_q, r) => { r.status(201).json({}); }, { source: 'lock_test' })(req(), res);
    expect(res.statusCode).toBe(201);
    expect(fs.existsSync(path.join(dir, 'audit_write.lock'))).toBe(false);
  });

  it('a lock left by a dead process is reclaimed', async () => {
    fs.mkdirSync(path.join(dir, 'audit_write.lock'));
    fs.writeFileSync(path.join(dir, 'audit_write.lock', 'owner.json'), JSON.stringify({ pid: 2 ** 30, at: Date.now(), token: 'dead' }));
    const res = mockRes();
    await audited.withAudit(async (_q, r) => { r.status(201).json({}); }, { source: 'lock_test' })(req(), res);
    expect(res.statusCode).toBe(201);
  });

  it('a lock held by a live foreign process is never stolen', async () => {
    fs.mkdirSync(path.join(dir, 'audit_write.lock'));
    const owner = { pid: process.ppid, at: Date.now(), token: 'foreign-live' };
    fs.writeFileSync(path.join(dir, 'audit_write.lock', 'owner.json'), JSON.stringify(owner));
    const pending = run();
    await new Promise(r => setTimeout(r, 300));
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'audit_write.lock', 'owner.json'), 'utf8')).token).toBe('foreign-live');
    expect(fs.existsSync(path.join(dir, 'salary.json'))).toBe(false);
    fs.rmSync(path.join(dir, 'audit_write.lock'), { recursive: true, force: true });
    await pending;
    expect(read('salary.json').u1.counter).toBe(1);
  });

  it('an owner-less lock directory (crash between mkdir and owner write) is reclaimed within seconds', async () => {
    fs.mkdirSync(path.join(dir, 'audit_write.lock'));
    const old = new Date(Date.now() - 5_000);
    fs.utimesSync(path.join(dir, 'audit_write.lock'), old, old);
    const started = Date.now();
    await run();
    expect(Date.now() - started).toBeLessThan(3_000);
    expect(read('salary.json').u1.counter).toBe(1);
  });

  it('a failed owner write does not leave a lock directory behind', async () => {
    const real = fs.writeFileSync;
    const spy = jest.spyOn(fs, 'writeFileSync').mockImplementation(((file: unknown, ...rest: unknown[]) => {
      if (String(file).endsWith('owner.json')) throw Object.assign(new Error('ENOSPC'), { code: 'ENOSPC' });
      return (real as (...a: unknown[]) => unknown)(file, ...rest);
    }) as never);
    const res = mockRes();
    try {
      await audited.withAudit(async (_q, r) => { r.status(201).json({}); }, { source: 'lock_test' })(req(), res);
    } finally {
      spy.mockRestore();
    }
    expect(res.statusCode).toBe(500);
    expect(fs.existsSync(path.join(dir, 'audit_write.lock'))).toBe(false);
  });

  it('a stale reaper mutex left by a crashed process does not block writers', async () => {
    fs.mkdirSync(path.join(dir, 'audit_write.lock.reap'));
    const old = new Date(Date.now() - 60_000);
    fs.utimesSync(path.join(dir, 'audit_write.lock.reap'), old, old);
    fs.mkdirSync(path.join(dir, 'audit_write.lock'));
    fs.writeFileSync(path.join(dir, 'audit_write.lock', 'owner.json'), JSON.stringify({ pid: 2 ** 30, at: Date.now(), token: 'dead' }));
    await run();
    expect(read('salary.json').u1.counter).toBe(1);
    expect(fs.existsSync(path.join(dir, 'audit_write.lock.reap'))).toBe(false);
  });

  it('many processes racing to reap the same dead lock never break exclusion', async () => {
    fs.mkdirSync(path.join(dir, 'audit_write.lock'));
    fs.writeFileSync(path.join(dir, 'audit_write.lock', 'owner.json'), JSON.stringify({ pid: 2 ** 30, at: Date.now(), token: 'dead' }));
    const workers = 6;
    const iterations = 10;
    const results = await Promise.all(Array.from({ length: workers }, () => runWorker(iterations)));
    results.forEach(r => expect(r.errors).toEqual([]));
    expect(read('salary.json').u1.counter).toBe(workers * iterations);
    expect(store.readJournal()).toHaveLength(workers * iterations);
  }, 120_000);

  it('a reader recovers an interrupted WAL under the lock', async () => {
    fs.writeFileSync(path.join(dir, 'audit_wal.json'), JSON.stringify({ files: { 'salary.json': '{"u1":{"counter":9}}' } }));
    expect(store.jsonRead(path.join(dir, 'salary.json'))).toBe('{"u1":{"counter":9}}');
    expect(fs.existsSync(path.join(dir, 'audit_wal.json'))).toBe(false);
    expect(fs.existsSync(path.join(dir, 'audit_write.lock'))).toBe(false);
  });

  it('several OS processes writing concurrently lose no update and no audit event', async () => {
    const workers = 4;
    const iterations = 8;
    const results = await Promise.all(Array.from({ length: workers }, () => runWorker(iterations)));
    results.forEach(r => expect(r.errors).toEqual([]));
    expect(results.reduce((sum, r) => sum + r.ok, 0)).toBe(workers * iterations);
    expect(read('salary.json').u1.counter).toBe(workers * iterations);
    expect(store.readJournal()).toHaveLength(workers * iterations);
    expect(fs.existsSync(path.join(dir, 'audit_wal.json'))).toBe(false);
    expect(fs.existsSync(path.join(dir, 'audit_write.lock'))).toBe(false);
  }, 120_000);
});
