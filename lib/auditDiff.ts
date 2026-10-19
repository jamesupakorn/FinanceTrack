import { isDeepStrictEqual } from 'util';
import crypto from 'crypto';

export type AuditAction = 'created' | 'updated' | 'deleted' | 'retention_pruned' | 'password_changed';

export interface AuditEvent {
  eventId: string;
  subjectUserId: string;
  actorType: 'user' | 'system';
  actorUserId?: string;
  source: string;
  resource: string;
  action: AuditAction;
  resourceKey?: string;
  changedFields: string[];
  occurredAt: string;
}

export interface AuditDraft {
  subjectUserId: string;
  resource: string;
  action: AuditAction;
  resourceKey?: string;
  changedFields: string[];
}

type Doc = Record<string, unknown>;

export const AUDIT_RETENTION_DAYS = 365;
export const AUDIT_JOURNAL_FILE = 'audit_journal.json';
export const RETENTION_SOURCE = 'shared_month_window';

const IGNORED_FIELDS = new Set(['_id', 'updatedAt', 'createdAt', 'lastMonthlySummarySent', 'saved_at']);
const FIELD_RENAMES: Record<string, string> = { passwordHash: 'password', LineId: 'lineId' };
const FIELD_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const KEY_PATTERN = /^\d{4}(-\d{2})?$/;
const MAX_FIELDS = 30;

const isPlainObject = (value: unknown): value is Doc =>
  !!value && typeof value === 'object' && !Array.isArray(value);

/** Remove housekeeping keys at every depth so nested timestamp bumps never count as a change. */
function stripHousekeeping(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripHousekeeping);
  if (isPlainObject(value)) {
    const out: Doc = {};
    Object.keys(value).forEach(key => {
      if (!IGNORED_FIELDS.has(key)) out[key] = stripHousekeeping(value[key]);
    });
    return out;
  }
  return value;
}

const sameData = (x: unknown, y: unknown) => isDeepStrictEqual(stripHousekeeping(x), stripHousekeeping(y));

export function safeFieldNames(names: string[]): string[] {
  const out = new Set<string>();
  names.forEach(name => {
    if (IGNORED_FIELDS.has(name)) return;
    const renamed = FIELD_RENAMES[name] || (name.startsWith('custom_') ? 'custom' : name);
    if (FIELD_PATTERN.test(renamed)) out.add(renamed);
  });
  return Array.from(out).sort().slice(0, MAX_FIELDS);
}

export function safeResourceKey(value: unknown): string | undefined {
  return typeof value === 'string' && KEY_PATTERN.test(value) ? value : undefined;
}

export function changedFieldNames(before: unknown, after: unknown): string[] {
  const b = isPlainObject(before) ? before : {};
  const a = isPlainObject(after) ? after : {};
  const keys = new Set([...Object.keys(b), ...Object.keys(a)]);
  const changed: string[] = [];
  keys.forEach(key => {
    if (IGNORED_FIELDS.has(key)) return;
    if (!sameData(b[key], a[key])) changed.push(key);
  });
  return changed;
}

function resourceKeyOf(doc: Doc | undefined): string | undefined {
  if (!doc) return undefined;
  return safeResourceKey(doc.month) || safeResourceKey(doc.year !== undefined ? String(doc.year) : undefined);
}

/** Classify a users-collection change into audit drafts. */
export function diffUserRecord(userId: string, before: Doc | undefined, after: Doc | undefined): AuditDraft[] {
  if (!before && !after) return [];
  if (!after) return [{ subjectUserId: userId, resource: 'user_profile', action: 'deleted', changedFields: [] }];
  if (!before) {
    return [{
      subjectUserId: userId,
      resource: 'user_profile',
      action: 'created',
      changedFields: safeFieldNames(Object.keys(after).filter(k => k !== 'passwordHash' && k !== 'LineId'))
    }];
  }
  const fields = changedFieldNames(before, after);
  const drafts: AuditDraft[] = [];
  if (fields.includes('passwordHash')) {
    drafts.push({ subjectUserId: userId, resource: 'account', action: 'password_changed', changedFields: ['password'] });
  }
  if (fields.includes('LineId')) {
    drafts.push({ subjectUserId: userId, resource: 'line_link', action: 'updated', changedFields: ['lineId'] });
  }
  const rest = fields.filter(f => f !== 'passwordHash' && f !== 'LineId');
  if (rest.length) {
    drafts.push({ subjectUserId: userId, resource: 'user_profile', action: 'updated', changedFields: safeFieldNames(rest) });
  }
  return drafts;
}

/**
 * Diff one user's JSON bucket. Object-valued entries are treated as documents keyed by their
 * entry key (month); non-object entries are folded into one event listing the changed fields.
 */
export function diffUserBucket(
  resource: string,
  userId: string,
  before: unknown,
  after: unknown,
  retentionKeys: Set<string>
): AuditDraft[] {
  const b = isPlainObject(before) ? before : {};
  const a = isPlainObject(after) ? after : {};
  const drafts: AuditDraft[] = [];
  const scalarChanged: string[] = [];
  const keys = new Set([...Object.keys(b), ...Object.keys(a)]);
  keys.forEach(key => {
    const x = b[key];
    const y = a[key];
    if (sameData(x, y)) return;
    const docLike = (isPlainObject(x) || x === undefined) && (isPlainObject(y) || y === undefined);
    if (!docLike) {
      scalarChanged.push(key);
      return;
    }
    const resourceKey = safeResourceKey(key) || resourceKeyOf(isPlainObject(y) ? y : isPlainObject(x) ? x : undefined);
    if (x === undefined) {
      drafts.push({ subjectUserId: userId, resource, action: 'created', resourceKey, changedFields: safeFieldNames(Object.keys(y as Doc)) });
    } else if (y === undefined) {
      const retained = retentionKeys.has(key);
      drafts.push({ subjectUserId: userId, resource, action: retained ? 'retention_pruned' : 'deleted', resourceKey, changedFields: [] });
    } else {
      const fields = safeFieldNames(changedFieldNames(x, y));
      if (fields.length) drafts.push({ subjectUserId: userId, resource, action: 'updated', resourceKey, changedFields: fields });
    }
  });
  if (scalarChanged.length) {
    const fields = safeFieldNames(scalarChanged);
    if (fields.length) drafts.push({ subjectUserId: userId, resource, action: 'updated', changedFields: fields });
  }
  return drafts;
}

/** Diff a Mongo document of a non-users collection. */
export function diffMongoDoc(
  resource: string,
  before: Doc | undefined,
  after: Doc | undefined,
  retained: (month: string) => boolean
): AuditDraft[] {
  const ref = after || before;
  const userId = ref && typeof ref.userId === 'string' ? ref.userId : undefined;
  if (!userId) return [];
  const resourceKey = resourceKeyOf(ref);
  if (!before && after) {
    return [{ subjectUserId: userId, resource, action: 'created', resourceKey, changedFields: safeFieldNames(Object.keys(after)) }];
  }
  if (before && !after) {
    const month = typeof before.month === 'string' ? before.month : '';
    return [{
      subjectUserId: userId,
      resource,
      action: month && retained(month) ? 'retention_pruned' : 'deleted',
      resourceKey,
      changedFields: []
    }];
  }
  const fields = safeFieldNames(changedFieldNames(before, after));
  return fields.length ? [{ subjectUserId: userId, resource, action: 'updated', resourceKey, changedFields: fields }] : [];
}

export function finalizeEvents(
  drafts: AuditDraft[],
  source: string,
  sessionUserId: string | null,
  now: Date = new Date()
): AuditEvent[] {
  const seen = new Set<string>();
  const events: AuditEvent[] = [];
  drafts.forEach(draft => {
    const system = draft.action === 'retention_pruned' || source === 'line_webhook';
    const eventSource = draft.action === 'retention_pruned' ? RETENTION_SOURCE : source;
    const dedupe = [draft.subjectUserId, draft.resource, draft.action, draft.resourceKey || '', draft.changedFields.join(',')].join('|');
    if (seen.has(dedupe)) return;
    seen.add(dedupe);
    const event: AuditEvent = {
      eventId: crypto.randomUUID(),
      subjectUserId: draft.subjectUserId,
      actorType: system ? 'system' : 'user',
      source: eventSource,
      resource: draft.resource,
      action: draft.action,
      changedFields: draft.changedFields,
      occurredAt: now.toISOString()
    };
    if (!system) event.actorUserId = sessionUserId || draft.subjectUserId;
    if (draft.resourceKey) event.resourceKey = draft.resourceKey;
    events.push(event);
  });
  return events;
}
