import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { AsyncLocalStorage } from 'async_hooks';
import {
  AUDIT_JOURNAL_FILE,
  AUDIT_RETENTION_DAYS,
  AuditDraft,
  AuditEvent,
  diffUserBucket,
  diffUserRecord,
  finalizeEvents
} from './auditDiff';

/**
 * Serialized, atomic JSON persistence for the JSON data mode.
 * A transaction stages every file write in memory, then commits domain files and the audit
 * journal together through a write-ahead file whose rename is the single commit point.
 * Readers outside a transaction first finish any interrupted commit, so a partial commit is
 * never visible.
 */

const WAL_FILE = 'audit_wal.json';
const LOCK_FILE = 'audit_write.lock';
const LOCK_STALE_MS = 30_000;
const LOCK_WAIT_MS = 15_000;
const OWNERLESS_STALE_MS = 2_000;
const REAP_STALE_MS = 5_000;
const RELEASE_REAP_WAIT_MS = 6_000;
const WAL_WAIT_MS = 5_000;

export class AuditCommitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuditCommitError';
  }
}

export const jsonTestHooks: {
  afterWalWritten?: () => void;
  afterFileApplied?: (index: number) => void;
  beforeAuditAppend?: () => void;
} = {};

export function dataDir(): string {
  return process.env.AUDIT_DATA_DIR || path.join(process.cwd(), 'src', 'backend', 'data');
}

const walPath = () => path.join(dataDir(), WAL_FILE);
const lockPath = () => path.join(dataDir(), LOCK_FILE);
const journalPath = () => path.join(dataDir(), AUDIT_JOURNAL_FILE);

interface JsonTxn {
  staged: Map<string, string>;
  originals: Map<string, string | null>;
  method: string;
}

// Shared on globalThis so duplicated module instances (dev bundlers) still use one mutex and one lock identity.
interface JsonStoreState {
  als: AsyncLocalStorage<JsonTxn>;
  mutexTail: Promise<void>;
  committing: boolean;
  heldToken: string | null;
}
const globalState = globalThis as typeof globalThis & { __financeTrackAuditJson?: JsonStoreState };
const S: JsonStoreState = (globalState.__financeTrackAuditJson ??= {
  als: new AsyncLocalStorage<JsonTxn>(),
  mutexTail: Promise.resolve(),
  committing: false,
  heldToken: null
});
const als = S.als;

export function currentJsonTxn(): JsonTxn | undefined {
  return als.getStore();
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function readDisk(abs: string): string | null {
  try {
    return fs.readFileSync(abs, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

function atomicReplace(abs: string, text: string): void {
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  const tmp = `${abs}.${process.pid}.${Date.now()}.tmp`;
  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeSync(fd, text);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, abs);
  // Persist the rename itself so a power loss cannot keep the WAL rename but lose a data rename.
  try {
    const dirFd = fs.openSync(path.dirname(abs), 'r');
    try { fs.fsyncSync(dirFd); } finally { fs.closeSync(dirFd); }
  } catch { /* directory fsync is unsupported on some platforms */ }
}

interface LockOwner {
  pid: number;
  at: number;
  token: string;
}

// The lock is a directory so that creation is atomic and a non-owner cannot unlink a live lock
// by racing a "does it exist" check. Ownership is proven by a per-acquisition random token.

const ownerPath = () => path.join(lockPath(), 'owner.json');

function lockHolder(): LockOwner | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(ownerPath(), 'utf8'));
    return { pid: Number(parsed.pid), at: Number(parsed.at), token: String(parsed.token) };
  } catch {
    return null;
  }
}

function pidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

const reapPath = () => `${lockPath()}.reap`;

/**
 * Reapers and releasers take this short-lived mutex so that "judge the lock, then move it" cannot
 * interleave with another reaper, a release, or a new holder replacing the lock in between.
 */
function withReapMutex(fn: () => void, waitMs: number): boolean {
  const deadline = Date.now() + waitMs;
  for (;;) {
    try {
      fs.mkdirSync(reapPath());
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      try {
        // The mutex is held for microseconds; one this old belongs to a crashed process.
        if (Date.now() - fs.statSync(reapPath()).mtimeMs >= REAP_STALE_MS) {
          const dead = `${reapPath()}.dead.${process.pid}.${crypto.randomUUID()}`;
          fs.renameSync(reapPath(), dead);
          fs.rmSync(dead, { recursive: true, force: true });
          continue;
        }
      } catch { /* raced with its owner; retry */ }
      if (Date.now() >= deadline) return false;
      sleepSync(2);
    }
  }
  try {
    fn();
  } finally {
    try { fs.rmdirSync(reapPath()); } catch { /* already gone */ }
  }
  return true;
}

function reapIfStale(): void {
  withReapMutex(() => {
    let mtimeMs: number;
    try {
      mtimeMs = fs.statSync(lockPath()).mtimeMs;
    } catch {
      return;
    }
    const owner = lockHolder();
    const now = Date.now();
    // In-process writers are serialized by the shared mutex, so a same-pid lock that is not the
    // one we hold was leaked by a previous run (pid reuse / container pid 1) and is stale.
    const stale = owner
      ? owner.token !== S.heldToken && (owner.pid === process.pid || !pidAlive(owner.pid) || now - owner.at >= LOCK_STALE_MS)
      : now - mtimeMs >= OWNERLESS_STALE_MS;
    if (!stale) return;
    const graveyard = `${lockPath()}.stale.${process.pid}.${crypto.randomUUID()}`;
    try {
      fs.renameSync(lockPath(), graveyard);
    } catch {
      return;
    }
    fs.rmSync(graveyard, { recursive: true, force: true });
  }, 0);
}

function tryAcquire(): boolean {
  fs.mkdirSync(dataDir(), { recursive: true });
  try {
    fs.mkdirSync(lockPath());
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    reapIfStale();
    return false;
  }
  const token = crypto.randomUUID();
  try {
    fs.writeFileSync(ownerPath(), JSON.stringify({ pid: process.pid, at: Date.now(), token }));
  } catch (error) {
    // An owner-less lock directory would stall every writer until it ages out. Never remove a
    // directory that already has an owner: after a long stall it may belong to another process.
    if (lockHolder() === null) fs.rmSync(lockPath(), { recursive: true, force: true });
    throw error;
  }
  S.heldToken = token;
  return true;
}

async function acquireFileLock(): Promise<void> {
  const deadline = Date.now() + LOCK_WAIT_MS;
  while (!tryAcquire()) {
    if (Date.now() > deadline) throw new AuditCommitError('Timed out waiting for the data lock');
    await new Promise(resolve => setTimeout(resolve, 15));
  }
}

function assertLockOwned(): void {
  if (!S.heldToken || lockHolder()?.token !== S.heldToken) {
    throw new AuditCommitError('Data lock was lost before commit');
  }
}

function releaseFileLock(): void {
  const token = S.heldToken;
  S.heldToken = null;
  if (!token) return;
  // If the mutex cannot be had, the lock is left behind: it carries this pid with no held token, so
  // the next acquirer reclaims it as leaked instead of this release risking a live lock.
  withReapMutex(() => {
    if (lockHolder()?.token !== token) return;
    const graveyard = `${lockPath()}.released.${process.pid}.${crypto.randomUUID()}`;
    try {
      fs.renameSync(lockPath(), graveyard);
    } catch {
      return;
    }
    fs.rmSync(graveyard, { recursive: true, force: true });
  }, RELEASE_REAP_WAIT_MS);
}

function replayWal(): void {
  const raw = readDisk(walPath());
  if (raw === null) return;
  let files: Record<string, string>;
  try {
    files = JSON.parse(raw).files;
  } catch {
    // WAL rename is atomic, so an unparsable WAL was never committed.
    try { fs.unlinkSync(walPath()); } catch { /* ignore */ }
    return;
  }
  Object.entries(files).forEach(([name, text]) => atomicReplace(path.join(dataDir(), name), text));
  try { fs.unlinkSync(walPath()); } catch { /* ignore */ }
}

/** Finish an interrupted commit before any non-transactional access. */
export function recoverJsonStore(): void {
  if (S.committing || !fs.existsSync(walPath())) return;
  if (S.heldToken) {
    replayWal();
    return;
  }
  const deadline = Date.now() + WAL_WAIT_MS;
  while (fs.existsSync(walPath())) {
    // Replay only while holding the lock, so a stale reader can never re-apply an old WAL
    // over a newer committed transaction.
    if (tryAcquire()) {
      try {
        replayWal();
      } finally {
        releaseFileLock();
      }
      return;
    }
    if (Date.now() > deadline) throw new AuditCommitError('Interrupted commit could not be recovered');
    sleepSync(15);
  }
}

export function jsonRead(abs: string): string | null {
  const txn = als.getStore();
  if (txn) {
    const staged = txn.staged.get(abs);
    if (staged !== undefined) return staged;
    const disk = readDisk(abs);
    if (!txn.originals.has(abs)) txn.originals.set(abs, disk);
    return disk;
  }
  recoverJsonStore();
  return readDisk(abs);
}

export function jsonWrite(abs: string, text: string): void {
  const txn = als.getStore();
  if (txn) {
    if (!txn.originals.has(abs)) txn.originals.set(abs, readDisk(abs));
    txn.staged.set(abs, text);
    return;
  }
  recoverJsonStore();
  atomicReplace(abs, text);
}

function parse(text: string | null): unknown {
  if (text === null) return undefined;
  try { return JSON.parse(text); } catch { return undefined; }
}

function collectDrafts(txn: JsonTxn): AuditDraft[] {
  const drafts: AuditDraft[] = [];
  txn.staged.forEach((after, abs) => {
    const name = path.basename(abs);
    if (name === AUDIT_JOURNAL_FILE || !name.endsWith('.json')) return;
    const before = parse(txn.originals.get(abs) ?? null);
    const next = parse(after);
    const resource = name.replace(/\.json$/, '');
    if (resource === 'users') {
      const idOf = (list: unknown) => {
        const map = new Map<string, Record<string, unknown>>();
        if (Array.isArray(list)) list.forEach(u => { if (u && typeof u.id === 'string') map.set(u.id, u); });
        return map;
      };
      const b = idOf(before);
      const a = idOf(next);
      new Set([...b.keys(), ...a.keys()]).forEach(id => drafts.push(...diffUserRecord(id, b.get(id), a.get(id))));
      return;
    }
    const b = (before && typeof before === 'object' ? before : {}) as Record<string, unknown>;
    const a = (next && typeof next === 'object' ? next : {}) as Record<string, unknown>;
    new Set([...Object.keys(b), ...Object.keys(a)]).forEach(userId => {
      const removedMonths = new Set<string>();
      if (txn.method !== 'DELETE') {
        const bb = b[userId] as Record<string, unknown> | undefined;
        const aa = (a[userId] || {}) as Record<string, unknown>;
        Object.keys(bb || {}).forEach(k => { if (!(k in aa) && /^\d{4}-\d{2}$/.test(k)) removedMonths.add(k); });
      }
      drafts.push(...diffUserBucket(resource, userId, b[userId], a[userId], removedMonths));
    });
  });
  return drafts;
}

function appendJournal(events: AuditEvent[]): string {
  const raw = readDisk(journalPath());
  let existing: AuditEvent[] = [];
  if (raw) {
    try { existing = JSON.parse(raw).events || []; } catch { existing = []; }
  }
  const cutoff = Date.now() - AUDIT_RETENTION_DAYS * 86_400_000;
  const kept = existing.filter(e => Date.parse(e.occurredAt) >= cutoff);
  return JSON.stringify({ events: [...kept, ...events] }, null, 2);
}

function commit(txn: JsonTxn, source: string, sessionUserId: string | null): void {
  if (txn.staged.size === 0) return;
  const events = finalizeEvents(collectDrafts(txn), source, sessionUserId);
  const files: Record<string, string> = {};
  txn.staged.forEach((text, abs) => { files[path.relative(dataDir(), abs)] = text; });
  if (events.length) {
    jsonTestHooks.beforeAuditAppend?.();
    files[AUDIT_JOURNAL_FILE] = appendJournal(events);
  }
  assertLockOwned();
  S.committing = true;
  try {
    atomicReplace(walPath(), JSON.stringify({ files }));
    jsonTestHooks.afterWalWritten?.();
    Object.entries(files).forEach(([name, text], index) => {
      atomicReplace(path.join(dataDir(), name), text);
      jsonTestHooks.afterFileApplied?.(index);
    });
    try { fs.unlinkSync(walPath()); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  } finally {
    S.committing = false;
  }
}

export async function runJsonTransaction<T>(
  options: { source: string; method: string; sessionUserId: string | null },
  body: () => Promise<T>,
  shouldCommit: () => boolean
): Promise<T> {
  const previous = S.mutexTail;
  let release!: () => void;
  S.mutexTail = new Promise<void>(resolve => { release = resolve; });
  await previous;
  let locked = false;
  try {
    await acquireFileLock();
    locked = true;
    recoverJsonStore();
    const txn: JsonTxn = { staged: new Map(), originals: new Map(), method: options.method };
    const result = await als.run(txn, body);
    if (shouldCommit()) commit(txn, options.source, options.sessionUserId);
    return result;
  } finally {
    if (locked) releaseFileLock();
    release();
  }
}

/**
 * Run an unaudited JSON read-modify-write (delivery bookkeeping) under the same lock and WAL
 * commit path so it cannot race an audited transaction. Only housekeeping-ignored fields may be
 * changed here; anything else would emit an audit event attributed to no actor.
 */
export function runJsonBookkeeping<T>(body: () => Promise<T>): Promise<T> {
  if (als.getStore()) return body();
  return runJsonTransaction({ source: 'bookkeeping', method: 'PUT', sessionUserId: null }, body, () => true);
}

export function readJournal(): AuditEvent[] {
  const raw = jsonRead(journalPath());
  if (!raw) return [];
  try { return JSON.parse(raw).events || []; } catch { return []; }
}
