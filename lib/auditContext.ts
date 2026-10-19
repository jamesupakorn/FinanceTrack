import { AsyncLocalStorage } from 'async_hooks';
import type { ClientSession, Collection, Document } from 'mongodb';

export interface MongoAuditContext {
  session: ClientSession;
  /** Per collection: the user scopes whose "before" state was captured, and that state. */
  before: Map<string, Map<string, Map<string, Document>>>;
  collections: Map<string, Collection<Document>>;
  subjectUserId: string | null;
  method: string;
  retention: boolean;
  retentionMonths: Map<string, Set<string>>;
  sessionUserId: string | null;
}

export const mongoAuditStore = new AsyncLocalStorage<MongoAuditContext>();

const OPTS_AT_1 = new Set([
  'findOne', 'find', 'insertOne', 'insertMany', 'deleteOne', 'deleteMany',
  'countDocuments', 'bulkWrite', 'aggregate'
]);
const OPTS_AT_2 = new Set(['updateOne', 'updateMany', 'replaceOne', 'findOneAndUpdate', 'findOneAndDelete', 'findOneAndReplace', 'distinct']);
const WRITES = new Set([
  'insertOne', 'insertMany', 'deleteOne', 'deleteMany', 'bulkWrite', 'updateOne', 'updateMany',
  'replaceOne', 'findOneAndUpdate', 'findOneAndDelete', 'findOneAndReplace'
]);

export const SCOPE_ALL = '*';

function userScopeOf(ctx: MongoAuditContext, name: string, filter: unknown): string[] {
  if (name === 'users') return [SCOPE_ALL];
  const scopes = new Set<string>();
  if (ctx.subjectUserId) scopes.add(ctx.subjectUserId);
  const uid = filter && typeof filter === 'object' ? (filter as { userId?: unknown }).userId : undefined;
  if (typeof uid === 'string') scopes.add(uid);
  return Array.from(scopes);
}

export async function snapshotScope(ctx: MongoAuditContext, col: Collection<Document>, name: string, scope: string) {
  const byCollection = ctx.before.get(name) || new Map();
  ctx.before.set(name, byCollection);
  if (byCollection.has(scope)) return;
  const filter = scope === SCOPE_ALL ? {} : { userId: scope };
  const docs = await col.find(filter, { session: ctx.session }).toArray();
  byCollection.set(scope, new Map(docs.map(d => [String(d._id), d])));
}

/** Route a collection through the active Mongo audit transaction (no-op outside one). */
export function wrapCollection<T extends Document>(col: Collection<T>, name: string): Collection<T> {
  const ctx = mongoAuditStore.getStore();
  if (!ctx) return col;
  const plain = col as unknown as Collection<Document>;
  ctx.collections.set(name, plain);
  return new Proxy(col, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof prop !== 'string' || typeof value !== 'function') return value;
      const isRead = OPTS_AT_1.has(prop) || OPTS_AT_2.has(prop);
      if (!isRead) return value.bind(target);
      const call = (args: unknown[]) => {
        const position = OPTS_AT_2.has(prop) ? 2 : 1;
        const withSession = [...args];
        while (withSession.length < position) withSession.push(undefined);
        const existing = (withSession[position] || {}) as Record<string, unknown>;
        withSession[position] = { ...existing, session: ctx.session };
        const result = (target as unknown as Record<string, (...a: unknown[]) => unknown>)[prop](...withSession);
        return result;
      };
      if (!WRITES.has(prop)) return (...args: unknown[]) => call(args);
      return async (...args: unknown[]) => {
        const filter = args[0];
        for (const scope of userScopeOf(ctx, name, filter)) await snapshotScope(ctx, plain, name, scope);
        if (ctx.retention && prop === 'deleteMany' && filter && typeof filter === 'object') {
          const doomed = await plain.find(filter as Document, { session: ctx.session, projection: { month: 1, userId: 1 } }).toArray();
          const set = ctx.retentionMonths.get(name) || new Set<string>();
          doomed.forEach(d => set.add(String(d._id)));
          ctx.retentionMonths.set(name, set);
        }
        return call(args);
      };
    }
  });
}

/** Mark Mongo deletes performed by fn as automatic retention pruning. */
export async function withRetention<T>(fn: () => Promise<T>): Promise<T> {
  const ctx = mongoAuditStore.getStore();
  if (!ctx) return fn();
  const prev = ctx.retention;
  ctx.retention = true;
  try {
    return await fn();
  } finally {
    ctx.retention = prev;
  }
}
