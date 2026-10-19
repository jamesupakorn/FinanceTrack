import type { NextApiRequest, NextApiResponse } from 'next';
import { assertUserId } from '../../src/shared/utils/backend/userRequest';
import { isJsonMode } from '../../lib/dataSource';
import { getDbPromise } from '../../lib/mongodb';
import { readJournal } from '../../lib/auditJsonStore';
import { AUDIT_COLLECTION } from '../../lib/auditedMutation';
import { AUDIT_RETENTION_DAYS, type AuditEvent } from '../../lib/auditDiff';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

function encodeCursor(e: Pick<AuditEvent, 'occurredAt' | 'eventId'>): string {
  return Buffer.from(JSON.stringify([e.occurredAt, e.eventId])).toString('base64url');
}

function decodeCursor(raw: unknown): [string, string] | null | undefined {
  if (raw === undefined || raw === '') return undefined;
  if (typeof raw !== 'string') return null;
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (Array.isArray(parsed) && typeof parsed[0] === 'string' && typeof parsed[1] === 'string'
      && !Number.isNaN(Date.parse(parsed[0]))) return [parsed[0], parsed[1]];
  } catch { /* fallthrough */ }
  return null;
}

function parseLimit(raw: unknown): number | null {
  if (raw === undefined || raw === '') return DEFAULT_LIMIT;
  if (typeof raw !== 'string' || !/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  if (n < 1) return null;
  return Math.min(n, MAX_LIMIT);
}

function toPublic(e: AuditEvent) {
  return {
    eventId: e.eventId,
    actorType: e.actorType,
    source: e.source,
    resource: e.resource,
    action: e.action,
    resourceKey: e.resourceKey,
    changedFields: e.changedFields,
    occurredAt: e.occurredAt,
  };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const userId = assertUserId(req, res);
  if (!userId) return;

  const limit = parseLimit(req.query.limit);
  const cursor = decodeCursor(req.query.cursor);
  if (limit === null || cursor === null) {
    return res.status(400).json({ error: 'Invalid pagination parameters' });
  }

  const cutoff = new Date(Date.now() - AUDIT_RETENTION_DAYS * 86400000);
  try {
    let rows: AuditEvent[];
    if (isJsonMode()) {
      rows = readJournal()
        .filter(e => e.subjectUserId === userId && Date.parse(e.occurredAt) >= cutoff.getTime())
        .filter(e => !cursor || e.occurredAt < cursor[0] || (e.occurredAt === cursor[0] && e.eventId < cursor[1]))
        .sort((a, b) => (a.occurredAt === b.occurredAt ? (a.eventId < b.eventId ? 1 : -1) : a.occurredAt < b.occurredAt ? 1 : -1))
        .slice(0, limit + 1);
    } else {
      const db = await getDbPromise();
      const filter: Record<string, unknown> = {
        subjectUserId: userId,
        occurredAtDate: { $gte: cutoff },
      };
      if (cursor) {
        const d = new Date(cursor[0]);
        filter.$or = [
          { occurredAtDate: { $lt: d } },
          { occurredAtDate: d, eventId: { $lt: cursor[1] } },
        ];
      }
      rows = (await db.collection(AUDIT_COLLECTION)
        .find(filter)
        .sort({ occurredAtDate: -1, eventId: -1 })
        .limit(limit + 1)
        .toArray()) as unknown as AuditEvent[];
    }
    const page = rows.slice(0, limit);
    const nextCursor = rows.length > limit ? encodeCursor(page[page.length - 1]) : null;
    return res.status(200).json({ items: page.map(toPublic), nextCursor });
  } catch (error) {
    console.error('[audit-logs] failed', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
