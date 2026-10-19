import type { NextApiRequest, NextApiResponse } from 'next';
import type { Db, Document } from 'mongodb';
import { getDbPromise } from './mongodb';
import { isJsonMode } from './dataSource';
import { mongoAuditStore, SCOPE_ALL, type MongoAuditContext } from './auditContext';
import { runJsonTransaction } from './auditJsonStore';
import {
  AuditDraft,
  AuditEvent,
  AUDIT_RETENTION_DAYS,
  diffMongoDoc,
  diffUserRecord,
  finalizeEvents
} from './auditDiff';
import { SESSION_COOKIE_NAME, verifySession } from '../src/shared/utils/backend/sessionCookie';

type Handler = (req: NextApiRequest, res: NextApiResponse) => unknown | Promise<unknown>;

export const AUDIT_COLLECTION = 'audit_logs';
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export const auditTestHooks: { beforeAuditWrite?: () => void | Promise<void> } = {};

class AbortMutation extends Error {}

interface Buffered {
  status: number;
  replay: () => void;
}

function sessionUserOf(req: NextApiRequest): string | null {
  const cookie = (req.cookies || {})[SESSION_COOKIE_NAME];
  return verifySession(cookie)?.userId || null;
}

let indexesReady: Promise<void> | null = null;
function ensureAuditIndexes(db: Db): Promise<void> {
  if (!indexesReady) {
    indexesReady = (async () => {
      const col = db.collection(AUDIT_COLLECTION);
      await col.createIndex({ subjectUserId: 1, occurredAtDate: -1, eventId: -1 });
      await col.createIndex({ occurredAtDate: 1 }, { expireAfterSeconds: AUDIT_RETENTION_DAYS * 86400 });
    })().catch(error => {
      indexesReady = null;
      throw error;
    });
  }
  return indexesReady;
}
export const resetAuditIndexCache = () => { indexesReady = null; };

async function diffMongo(ctx: MongoAuditContext): Promise<AuditDraft[]> {
  const drafts: AuditDraft[] = [];
  for (const [name, scopes] of ctx.before) {
    const col = ctx.collections.get(name);
    if (!col) continue;
    for (const [scope, beforeDocs] of scopes) {
      const filter = scope === SCOPE_ALL ? {} : { userId: scope };
      const after = new Map<string, Document>(
        (await col.find(filter, { session: ctx.session }).toArray()).map(d => [String(d._id), d])
      );
      const retained = ctx.retentionMonths.get(name) || new Set<string>();
      new Set([...beforeDocs.keys(), ...after.keys()]).forEach(id => {
        const b = beforeDocs.get(id);
        const a = after.get(id);
        if (name === 'users') {
          const userId = String((a || b)?.id || '');
          if (userId) drafts.push(...diffUserRecord(userId, b, a));
        } else {
          drafts.push(...diffMongoDoc(name, b, a, () => retained.has(id)));
        }
      });
    }
  }
  return drafts;
}

async function runMongo(
  handler: Handler,
  req: NextApiRequest,
  res: NextApiResponse,
  capture: { reset: () => void; get: () => Buffered | null },
  source: string,
  sessionUserId: string | null
): Promise<boolean> {
  const db = await getDbPromise();
  await ensureAuditIndexes(db);
  const session = db.client.startSession();
  try {
    await session.withTransaction(async () => {
      capture.reset();
      const ctx: MongoAuditContext = {
        session,
        before: new Map(),
        collections: new Map(),
        subjectUserId: sessionUserId,
        method: req.method || '',
        retention: false,
        retentionMonths: new Map(),
        sessionUserId
      };
      await mongoAuditStore.run(ctx, async () => { await handler(req, res); });
      const sent = capture.get();
      if (!sent || sent.status >= 400) throw new AbortMutation();
      const events = finalizeEvents(await diffMongo(ctx), source, sessionUserId);
      await auditTestHooks.beforeAuditWrite?.();
      if (events.length) {
        await db.collection(AUDIT_COLLECTION).insertMany(
          events.map(e => ({ ...e, occurredAtDate: new Date(e.occurredAt) })),
          { session }
        );
      }
    });
    return true;
  } catch (error) {
    if (error instanceof AbortMutation) return false;
    throw error;
  } finally {
    await session.endSession();
  }
}

/**
 * Wrap a mutating API handler so its domain writes and audit events commit atomically.
 * Non-mutating methods pass straight through.
 */
export function withAudit(handler: Handler, options: { source: string }): Handler {
  const { source } = options;
  return async function auditedHandler(req: NextApiRequest, res: NextApiResponse) {
    if (!MUTATING.has(req.method || '')) return handler(req, res);

    const original = { json: res.json, send: res.send, end: res.end, status: res.statusCode };
    let buffered: Buffered | null = null;
    const record = (replay: (...a: never[]) => unknown) => (...args: unknown[]) => {
      if (!buffered) {
        buffered = { status: res.statusCode, replay: () => { (replay as (...a: unknown[]) => unknown)(...args); } };
      }
      return res;
    };
    const restore = () => {
      res.json = original.json;
      res.send = original.send;
      res.end = original.end;
    };
    res.json = record(original.json.bind(res)) as typeof res.json;
    res.send = record(original.send.bind(res)) as typeof res.send;
    res.end = record(original.end.bind(res)) as typeof res.end;
    const capture = {
      reset: () => { buffered = null; res.statusCode = original.status; },
      get: () => buffered
    };

    const sessionUserId = sessionUserOf(req);
    try {
      if (isJsonMode()) {
        await runJsonTransaction(
          { source, method: req.method || '', sessionUserId },
          async () => { await handler(req, res); },
          () => {
            const sent = buffered as Buffered | null;
            return !!sent && sent.status < 400;
          }
        );
      } else {
        await runMongo(handler, req, res, capture, source, sessionUserId);
      }
    } catch (error) {
      console.error('Audited mutation failed; changes were not committed', (error as Error)?.message);
      restore();
      res.statusCode = 500;
      res.setHeader?.('Content-Type', 'application/json');
      return res.json({ error: 'Internal server error' });
    }
    restore();
    const sent = buffered as Buffered | null;
    if (!sent) return undefined;
    res.statusCode = sent.status;
    sent.replay();
    return undefined;
  };
}

export type { AuditEvent };
