#!/usr/bin/env node
/**
 * AC-S14 / spec-credit-card-spend §8. Offline maintenance only: stop application writers first.
 * npx tsx scripts/migrateCreditExpenseToSpendItems.ts [--apply --backup-confirmed]
 *   [--backup <existing-path>] [--map map.json] [--resolve=subtract]
 *
 * Dry-run performs reads only (including no JSON WAL recovery). Expense migration considers the
 * newest 15 stored expense months per user, like the existing retention limit; fallback cycles
 * are converted regardless of age. Nothing is pruned.
 *
 * creditExpenseMigrationReceipts is a script-owned journal in the credit document, committed
 * WITH the credit changes. It permits cleanup after a crash even when subtraction yields zero
 * (and hence no item). An arbitrary pre-existing migration item is NOT proof of a successful
 * expense transfer. Do not remove receipts until all source rows have been cleaned up.
 */
import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';
import { BSON } from 'mongodb';
import {
  MAX_CARDS_PER_USER,
  MAX_REVOLVING_CYCLES_PER_CARD,
  MAX_SPEND_ITEM_AMOUNT,
  MAX_SPEND_ITEM_NAME_LENGTH,
  MAX_SPEND_ITEMS_PER_CARD,
  MAX_SPEND_ITEMS_PER_CYCLE,
  PLAN_STATUS,
  round2,
  toAmount
} from '../src/shared/utils/creditCardBasics';
import type {
  CardLike, PlanLike, StoredRevolvingCycle, StoredSpendItem
} from '../src/shared/utils/creditCardRevolving';

type JsonObject = Record<string, unknown>;
export type MigrationMap = Record<string, Record<string, string>>;
export interface MigrationReceipt {
  month: string;
  key: string;
  cardId: string;
  fingerprint: string;
}
export interface MigrationCreditData extends JsonObject {
  cards: CardLike[];
  plans: PlanLike[];
  cycles: StoredRevolvingCycle[];
  spendItems?: StoredSpendItem[];
  creditExpenseMigrationReceipts?: MigrationReceipt[];
}
export interface MigrationExpense extends JsonObject {
  userId: string;
  month: string;
}
export interface MigrationSnapshot {
  credits: Record<string, MigrationCreditData>;
  expenses: MigrationExpense[];
}
export interface MigrationOptions {
  now: string;
  map?: MigrationMap;
  resolve?: 'subtract';
}
export interface MigrationReportRow {
  userId: string;
  month: string;
  legacyKey: string;
  actual: number | null;
  cardId: string;
  installments: number;
  storedSpend: number;
  action: string;
  conflict: string;
  /** Review-only flag (review F2); never blocks and never causes extra writes. */
  warning: string;
  unpaidInstallments: number;
}
export interface AmbiguousMapping {
  userId: string;
  legacyKey: string;
  candidates: Array<{ id: string; name: string }>;
}
/**
 * Spec §8 "stop and require --map": thrown after planning when any legacy key matches more than
 * one card by issuer. Carries the full report so the CLI can print it before exiting non-zero.
 * Because planMigration throws, runMigration never reaches any write for ANY user.
 */
export class MigrationMappingRequiredError extends Error {
  constructor(public readonly ambiguities: AmbiguousMapping[], public readonly report: MigrationReportRow[]) {
    super(`Ambiguous card mapping; supply --map map.json. ${ambiguities.map(entry => (
      `user ${entry.userId} key ${entry.legacyKey} matches ${entry.candidates.map(card => `${card.id} (${card.name})`).join(', ')}`
    )).join('; ')}`);
    this.name = 'MigrationMappingRequiredError';
  }
}
class AmbiguousMatch extends Error {
  constructor(public readonly candidates: Array<{ id: string; name: string }>) { super('mapping_ambiguous'); }
}
export interface ExpenseRemoval {
  document: MigrationExpense;
  key: string;
  value: unknown;
}
export interface MigrationUserPlan {
  userId: string;
  before: MigrationCreditData;
  after: MigrationCreditData;
  removals: ExpenseRemoval[];
}
export interface MigrationPlan {
  users: MigrationUserPlan[];
  report: MigrationReportRow[];
}
export interface MigrationStore {
  load(): Promise<MigrationSnapshot>;
  /** Must compare the persisted snapshot and fail on concurrent changes; acknowledge durable write. */
  writeCredit(userId: string, before: MigrationCreditData, after: MigrationCreditData): Promise<void>;
  /** Must compare the exact source row and never replace the whole expense document. */
  removeExpense(removal: ExpenseRemoval): Promise<void>;
}
export interface MigrationRunOptions extends Omit<MigrationOptions, 'now'> {
  now?: string;
  apply?: boolean;
  backupConfirmed?: boolean;
  backupPath?: string;
}

const LEGACY_KEY = /^credit_[a-z][a-z0-9_]*$/;
const CARD_ID = /^cc_[0-9a-f]{12}$/;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const RECEIPTS = 'creditExpenseMigrationReceipts';
const CREDIT_FIELDS = ['cards', 'plans', 'cycles', 'spendItems', RECEIPTS, 'updatedAt'] as const;
const MAX_DOCUMENT_BYTES = 16 * 1024 * 1024 - 16 * 1024;
const own = (value: object, key: string): boolean => Object.prototype.hasOwnProperty.call(value, key);
const object = (value: unknown): value is JsonObject => (
  value !== null && typeof value === 'object' && !Array.isArray(value)
);
const pair = (cardId: string, month: string): string => `${cardId}:${month}`;

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (object(value)) {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'undefined';
}
function fingerprint(value: unknown): string {
  return createHash('sha256').update(canonical(value)).digest('hex');
}
function stableId(prefix: string, ...parts: string[]): string {
  return `${prefix}_${fingerprint(parts).slice(0, 12)}`;
}
function amount(value: unknown): number {
  const parsed = toAmount(value as number | string);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error('invalid_amount');
  return round2(parsed);
}
function copyCredit(data: MigrationCreditData): MigrationCreditData {
  return {
    ...data,
    cards: [...data.cards],
    plans: [...data.plans],
    cycles: data.cycles.map(cycle => ({ ...cycle })),
    spendItems: (data.spendItems || []).map(item => ({ ...item })),
    creditExpenseMigrationReceipts: (data.creditExpenseMigrationReceipts || []).map(receipt => ({ ...receipt }))
  };
}
function matchingItems(data: MigrationCreditData, cardId: string, month: string): StoredSpendItem[] {
  return (data.spendItems || []).filter(item => item.cardId === cardId && item.month === month);
}
function matchingCycle(data: MigrationCreditData, cardId: string, month: string): StoredRevolvingCycle | undefined {
  const cycles = data.cycles.filter(cycle => cycle.cardId === cardId && cycle.month === month);
  if (cycles.length > 1) throw new Error('duplicate_cycles');
  return cycles[0];
}
function checkSize(data: MigrationCreditData): void {
  if (BSON.calculateObjectSize(data) > MAX_DOCUMENT_BYTES) throw new Error('document_size_limit');
}
function addItem(
  data: MigrationCreditData, userId: string, cardId: string, month: string,
  name: string, value: number, kind: string, now: string
): void {
  if (data.cards.length > MAX_CARDS_PER_USER) throw new Error('card_limit');
  if (!MONTH.test(month)) throw new Error('invalid_month');
  if (name.length > MAX_SPEND_ITEM_NAME_LENGTH || value > MAX_SPEND_ITEM_AMOUNT) throw new Error('item_validation');
  const items = data.spendItems || [];
  if (matchingItems(data, cardId, month).length >= MAX_SPEND_ITEMS_PER_CYCLE) throw new Error('cycle_item_limit');
  if (items.filter(item => item.cardId === cardId).length >= MAX_SPEND_ITEMS_PER_CARD) throw new Error('card_item_limit');
  const months = new Set([
    ...data.cycles.filter(cycle => cycle.cardId === cardId).map(cycle => cycle.month),
    ...items.filter(item => item.cardId === cardId).map(item => item.month)
  ]);
  if (!months.has(month) && months.size >= MAX_REVOLVING_CYCLES_PER_CARD) throw new Error('cycle_limit');
  const id = stableId('si', userId, cardId, month, kind);
  if (items.some(item => item.id === id)) throw new Error('item_id_collision');
  data.spendItems = [...items, {
    id, cardId, month, name, amount: value, source: 'migration', createdAt: now, updatedAt: now
  }];
  checkSize(data);
}
function mapCard(data: MigrationCreditData, userId: string, key: string, map?: MigrationMap): string {
  const explicit = map && own(map, userId) && own(map[userId], key) ? map[userId][key] : undefined;
  const issuer = key === 'credit_kungsri' ? 'krungsri' : key.slice('credit_'.length);
  const matches = data.cards.filter(card => explicit !== undefined ? card.id === explicit : card.bankIssuer === issuer);
  if (explicit === undefined && matches.length > 1) {
    throw new AmbiguousMatch(matches.map(card => ({ id: String(card.id ?? ''), name: String(card.name ?? '') })));
  }
  if (matches.length !== 1 || typeof matches[0].id !== 'string' || !CARD_ID.test(matches[0].id)) {
    throw new Error(explicit !== undefined ? 'invalid_mapping' : 'mapping_required');
  }
  return matches[0].id;
}
function installmentSum(data: MigrationCreditData, cardId: string, month: string): number {
  return round2(data.plans
    .filter(plan => plan.cardId === cardId && plan.status !== PLAN_STATUS.CANCELLED)
    .flatMap(plan => plan.schedule || [])
    .filter(row => row.dueMonth === month)
    .reduce((sum, row) => sum + amount(row.payment), 0));
}
function unpaidInstallmentCount(data: MigrationCreditData, cardId: string, month: string): number {
  return data.plans
    .filter(plan => plan.cardId === cardId && plan.status !== PLAN_STATUS.CANCELLED)
    .flatMap(plan => plan.schedule || [])
    .filter(row => row.dueMonth === month && row.paid !== true).length;
}
function applyPaid(data: MigrationCreditData, cardId: string, month: string, now: string): void {
  let cycle = matchingCycle(data, cardId, month);
  if (cycle && cycle.paymentAction != null) return; // BR-CC-016: never upgrade minimum/full.
  if (!cycle) {
    if (data.cards.length > MAX_CARDS_PER_USER) throw new Error('card_limit');
    if (data.cycles.filter(row => row.cardId === cardId).length >= MAX_REVOLVING_CYCLES_PER_CARD) {
      throw new Error('cycle_limit');
    }
    const id = stableId('rc', cardId, month, 'expense-paid');
    if (data.cycles.some(row => row.id === id)) throw new Error('cycle_id_collision');
    cycle = { id, cardId, month, createdAt: now };
    data.cycles.push(cycle);
  }
  Object.assign(cycle, { paymentAction: 'full', paidAt: now, paidSource: 'migration', updatedAt: now });
}

/** Pure, deterministic planning. No imports of app stores, environment reads, clock or database I/O. */
export function planMigration(snapshot: MigrationSnapshot, options: MigrationOptions): MigrationPlan {
  if (!Number.isFinite(Date.parse(options.now))) throw new Error('invalid_timestamp');
  const plan: MigrationPlan = { users: [], report: [] };
  const ambiguities: AmbiguousMapping[] = [];
  const userIds = new Set([...Object.keys(snapshot.credits), ...snapshot.expenses.map(doc => doc.userId)]);
  for (const userId of [...userIds].sort()) {
    const before = snapshot.credits[userId] || { cards: [], plans: [], cycles: [] };
    let data = copyCredit(before);
    const removals: ExpenseRemoval[] = [];
    const blockedFallbacks = new Set<string>();
    for (const cycle of before.cycles) {
      const cardId = cycle.cardId || '';
      const month = cycle.month || '';
      if (cycle.newSpend === undefined || cycle.newSpend === null) continue;
      const row: MigrationReportRow = {
        userId, month, legacyKey: '(cycle.newSpend)', actual: null, cardId,
        installments: 0, storedSpend: 0, action: 'skip', conflict: '', warning: '', unpaidInstallments: 0
      };
      try {
        row.storedSpend = amount(cycle.newSpend);
        if (row.storedSpend === 0 || matchingItems(data, cardId, month).length) continue;
        if (!CARD_ID.test(cardId) || data.cards.filter(card => card.id === cardId).length !== 1) {
          throw new Error('unknown_card');
        }
        matchingCycle(data, cardId, month);
        const next = copyCredit(data);
        addItem(next, userId, cardId, month, 'ยอดหมุนเวียนเดิม', row.storedSpend, 'fallback', options.now);
        data = next;
        row.action = 'fallback_item';
      } catch (error) {
        row.conflict = (error as Error).message;
        blockedFallbacks.add(pair(cardId, month));
      }
      plan.report.push(row);
    }

    const documents = snapshot.expenses.filter(doc => doc.userId === userId);
    const months = [...new Set(documents.map(doc => doc.month).filter(month => MONTH.test(month)))]
      .sort().reverse().slice(0, 15);
    for (const document of [...documents].sort((a, b) => a.month.localeCompare(b.month))) {
      for (const key of Object.keys(document).filter(key => LEGACY_KEY.test(key)).sort()) {
        const value = document[key];
        const row: MigrationReportRow = {
          userId, month: document.month, legacyKey: key, actual: null, cardId: '',
          installments: 0, storedSpend: 0, action: 'skip', conflict: '', warning: '', unpaidInstallments: 0
        };
        try {
          if (!object(value)) throw new Error('invalid_expense_row');
          row.actual = amount(value.actual);
          if (row.actual === 0) continue;
          if (!months.includes(document.month)) {
            row.action = 'outside_window';
            plan.report.push(row);
            continue;
          }
          if (documents.filter(doc => doc.month === document.month).length !== 1) throw new Error('duplicate_expense_month');
          const receipts = data.creditExpenseMigrationReceipts || [];
          const previous = receipts.filter(receipt => receipt.month === document.month && receipt.key === key);
          if (previous.length) {
            if (previous.length !== 1 || previous[0].fingerprint !== fingerprint(value)) {
              throw new Error('source_changed_after_credit_write');
            }
            row.cardId = previous[0].cardId; // Receipt wins over a changed/absent --map on retry.
            row.action = 'resume_cleanup';
            removals.push({ document, key, value });
            plan.report.push(row);
            continue;
          }
          row.cardId = mapCard(data, userId, key, options.map);
          const cardId = row.cardId;
          const cycle = matchingCycle(data, cardId, document.month);
          row.storedSpend = cycle?.newSpend == null ? 0 : amount(cycle.newSpend);
          row.installments = installmentSum(data, cardId, document.month);
          if (value.paid === true) {
            // Review F2 (option ก): installment paid flags are NOT changed; flag for operator review.
            row.unpaidInstallments = unpaidInstallmentCount(data, cardId, document.month);
            if (row.unpaidInstallments > 0) row.warning = 'legacy_paid_installments_unpaid';
          }
          if (blockedFallbacks.has(pair(cardId, document.month))) throw new Error('fallback_failed');
          const items = matchingItems(data, cardId, document.month);
          const fallbackId = stableId('si', userId, cardId, document.month, 'fallback');
          const fallback = items.length === 1 && items[0].id === fallbackId
            && items[0].source === 'migration' && amount(items[0].amount) === row.storedSpend;
          if (items.some(item => item.source === 'migration') && !fallback) {
            row.action = 'already_migrated';
            plan.report.push(row);
            continue; // An unrelated migration item cannot authorize source deletion.
          }
          if (items.length && !fallback) throw new Error('existing_spend_items');
          if ((row.installments > 0 || row.storedSpend > 0) && options.resolve !== 'subtract') {
            throw new Error('overlapping_spend_or_installments');
          }
          const migratedAmount = options.resolve === 'subtract'
            ? round2(Math.max(0, row.actual - row.storedSpend - row.installments))
            : row.actual;
          const next = copyCredit(data);
          // A second legacy key mapping to this pair sees the first migration item and is skipped.
          if (migratedAmount > 0) {
            addItem(next, userId, cardId, document.month, 'ยอดเดิม', migratedAmount, `expense:${key}`, options.now);
          }
          if (value.paid === true) applyPaid(next, cardId, document.month, options.now);
          next.creditExpenseMigrationReceipts = [...receipts, {
            month: document.month, key, cardId, fingerprint: fingerprint(value)
          }];
          next.updatedAt = options.now;
          checkSize(next);
          data = next;
          removals.push({ document, key, value });
          row.action = migratedAmount > 0 ? 'expense_item' : 'subtract_zero';
        } catch (error) {
          row.conflict = (error as Error).message;
          if (error instanceof AmbiguousMatch) {
            ambiguities.push({ userId, legacyKey: key, candidates: error.candidates });
          }
        }
        plan.report.push(row);
      }
    }
    if (fingerprint(data) !== fingerprint(copyCredit(before)) || removals.length) {
      data.updatedAt = options.now;
      plan.users.push({ userId, before, after: data, removals });
    }
  }
  // Collect every ambiguity first so the operator sees all of them, then stop the whole run.
  if (ambiguities.length) throw new MigrationMappingRequiredError(ambiguities, plan.report);
  return plan;
}

export async function runMigration(
  store: MigrationStore,
  options: MigrationRunOptions = {},
  backupExists: (name: string) => boolean = fs.existsSync
): Promise<MigrationPlan> {
  if (options.apply && !options.backupConfirmed && !(options.backupPath && backupExists(options.backupPath))) {
    throw new Error('--apply requires --backup-confirmed or an existing --backup path');
  }
  const snapshot = await store.load();
  const plan = planMigration(snapshot, { ...options, now: options.now || new Date().toISOString() });
  if (!options.apply) return plan;
  for (const user of plan.users) {
    // This write includes receipts. Failure/uncertain acknowledgement must never delete a source.
    await store.writeCredit(user.userId, user.before, user.after);
    for (const removal of user.removals) await store.removeExpense(removal);
  }
  return plan;
}

export function parseMigrationArgs(argv: string[]): MigrationRunOptions & { mapPath?: string } {
  const options: MigrationRunOptions & { mapPath?: string } = {};
  let dryRun = false;
  for (let index = 0; index < argv.length; index += 1) {
    const [flag, inline] = argv[index].split(/=(.*)/s);
    if (flag === '--apply' && inline === undefined) options.apply = true;
    else if (flag === '--dry-run' && inline === undefined) dryRun = true;
    else if (flag === '--backup-confirmed' && inline === undefined) options.backupConfirmed = true;
    else if (['--backup', '--map', '--resolve'].includes(flag)) {
      const value = inline ?? argv[++index];
      if (!value || value.startsWith('--')) throw new Error(`Missing value for ${flag}`);
      if (flag === '--backup') options.backupPath = value;
      if (flag === '--map') options.mapPath = value;
      if (flag === '--resolve') {
        if (value !== 'subtract') throw new Error('Only --resolve=subtract is supported');
        options.resolve = value;
      }
    } else throw new Error(`Unknown argument: ${argv[index]}`);
  }
  if (dryRun && options.apply) throw new Error('Use either --dry-run or --apply');
  return options;
}

export function parseMigrationMap(value: unknown): MigrationMap {
  if (!object(value)) throw new Error('Map must be a userId -> legacyKey -> cardId object');
  for (const [userId, entries] of Object.entries(value)) {
    if (!userId || ['__proto__', 'constructor', 'prototype'].includes(userId) || !object(entries)) {
      throw new Error('Invalid map user');
    }
    for (const [key, cardId] of Object.entries(entries)) {
      if (!LEGACY_KEY.test(key) || typeof cardId !== 'string' || !CARD_ID.test(cardId)) throw new Error('Invalid map entry');
    }
  }
  return value as MigrationMap;
}

function decodeCredit(raw: unknown): MigrationCreditData {
  if (!object(raw)) throw new Error('Invalid credit document');
  for (const field of ['cards', 'plans', 'cycles', 'spendItems', RECEIPTS]) {
    if (raw[field] !== undefined && !Array.isArray(raw[field])) throw new Error(`Invalid credit array: ${field}`);
  }
  return { ...raw, cards: raw.cards || [], plans: raw.plans || [], cycles: raw.cycles || [] } as MigrationCreditData;
}

export function decodeJsonSnapshot(creditFile: unknown, expenseFile: unknown): MigrationSnapshot {
  if (!object(creditFile) || !object(expenseFile)) throw new Error('Expected per-user JSON objects');
  const credits: Record<string, MigrationCreditData> = Object.create(null);
  const expenses: MigrationExpense[] = [];
  for (const [userId, data] of Object.entries(creditFile)) credits[userId] = decodeCredit(data);
  for (const [userId, bucket] of Object.entries(expenseFile)) {
    if (!object(bucket)) throw new Error('Expected per-month expense object');
    for (const [month, doc] of Object.entries(bucket)) {
      if (!MONTH.test(month)) continue;
      if (!object(doc)) throw new Error('Invalid expense document');
      expenses.push({ ...doc, userId, month });
    }
  }
  return { credits, expenses };
}

/** JSON I/O is injectable; production implementation below uses the app lock + atomic WAL. */
export interface MigrationJsonIO {
  read(filename: string): unknown;
  write(filename: string, data: unknown): void;
  transaction(body: () => Promise<void>): Promise<void>;
}
export function createJsonMigrationStore(io: MigrationJsonIO): MigrationStore {
  return {
    async load() {
      return decodeJsonSnapshot(io.read('credit_cards.json'), io.read('monthly_expense.json'));
    },
    async writeCredit(userId, before, after) {
      await io.transaction(async () => {
        const all = io.read('credit_cards.json');
        if (!object(all)) throw new Error('Invalid credit file');
        const current = own(all, userId) ? decodeCredit(all[userId]) : { cards: [], plans: [], cycles: [] };
        if (fingerprint(current) !== fingerprint(before)) throw new Error('Credit data changed; rerun dry-run');
        io.write('credit_cards.json', { ...all, [userId]: after });
      });
    },
    async removeExpense({ document, key, value }) {
      await io.transaction(async () => {
        const all = io.read('monthly_expense.json');
        if (!object(all) || !object(all[document.userId])) throw new Error('Expense bucket changed');
        const bucket = all[document.userId] as JsonObject;
        const doc = bucket[document.month];
        if (!object(doc)) throw new Error('Expense month changed');
        if (!own(doc, key)) return;
        if (fingerprint(doc[key]) !== fingerprint(value)) throw new Error('Expense row changed; source retained');
        const next = { ...doc };
        delete next[key];
        io.write('monthly_expense.json', { ...all, [document.userId]: { ...bucket, [document.month]: next } });
      });
    }
  };
}

// Structural driver interface allows fixtures to verify real Mongo filters without connecting.
export interface MigrationMongoCollection {
  find(filter: JsonObject): { toArray(): Promise<JsonObject[]> };
  updateOne(filter: JsonObject, update: JsonObject): Promise<{ matchedCount: number }>;
}
export function createMongoMigrationStore(
  collections: { credit: MigrationMongoCollection; expense: MigrationMongoCollection }
): MigrationStore {
  const originals = new Map<string, JsonObject>();
  return {
    async load() {
      originals.clear();
      const credits: Record<string, MigrationCreditData> = Object.create(null);
      for (const doc of await collections.credit.find({}).toArray()) {
        if (typeof doc.userId !== 'string' || !doc.userId) throw new Error('Credit document missing userId');
        if (own(credits, doc.userId)) throw new Error(`Duplicate credit document for ${doc.userId}`);
        credits[doc.userId] = decodeCredit(doc);
        originals.set(doc.userId, doc);
      }
      const expenses = await collections.expense.find({}).toArray();
      if (expenses.some(doc => typeof doc.userId !== 'string' || typeof doc.month !== 'string')) {
        throw new Error('Expense document missing userId/month');
      }
      return { credits, expenses: expenses as MigrationExpense[] };
    },
    async writeCredit(userId, before, after) {
      const original = originals.get(userId);
      if (!original || fingerprint(decodeCredit(original)) !== fingerprint(before)) {
        throw new Error('Credit snapshot not loaded or changed; rerun dry-run');
      }
      const filter: JsonObject = { userId };
      if (original._id !== undefined) filter._id = original._id;
      // Compare raw absence, not normalized [] defaults, on old documents.
      for (const field of CREDIT_FIELDS) filter[field] = own(original, field) ? original[field] : { $exists: false };
      const payload = Object.fromEntries(CREDIT_FIELDS.filter(field => own(after, field)).map(field => [field, after[field]]));
      const result = await collections.credit.updateOne(filter, { $set: payload });
      if (result.matchedCount !== 1) throw new Error('Credit data changed; rerun dry-run');
    },
    async removeExpense({ document, key, value }) {
      const filter: JsonObject = { userId: document.userId, month: document.month, [key]: value };
      if (document._id !== undefined) filter._id = document._id;
      const result = await collections.expense.updateOne(filter, { $unset: { [key]: '' } });
      if (result.matchedCount !== 1) throw new Error('Expense row changed; source retained');
    }
  };
}

async function main(): Promise<void> {
  const options = parseMigrationArgs(process.argv.slice(2));
  // Gate BEFORE any data read/connection.
  if (options.apply && !options.backupConfirmed && !(options.backupPath && fs.existsSync(options.backupPath))) {
    throw new Error('--apply requires --backup-confirmed or an existing --backup path');
  }
  if (options.mapPath) options.map = parseMigrationMap(JSON.parse(fs.readFileSync(options.mapPath, 'utf8')));
  const mode = (process.env.DATA_MODE || 'json').toLowerCase();
  let store: MigrationStore;
  let close: (() => Promise<void>) | undefined;
  if (mode === 'json') {
    const dir = process.env.AUDIT_DATA_DIR || path.join(process.cwd(), 'src', 'backend', 'data');
    if (fs.existsSync(path.join(dir, 'audit_wal.json'))) {
      throw new Error('Pending JSON WAL: recover through the application before migration, then stop writers');
    }
    const audit = options.apply ? await import('../lib/auditJsonStore') : undefined;
    const read = (filename: string): unknown => {
      const target = path.join(dir, filename);
      const raw = audit ? audit.jsonRead(target) : fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : null;
      return raw === null ? {} : JSON.parse(raw);
    };
    store = createJsonMigrationStore({
      read,
      write(filename, data) {
        if (!audit) throw new Error('Dry-run write prohibited');
        audit.jsonWrite(path.join(dir, filename), JSON.stringify(data, null, 2));
      },
      async transaction(body) {
        if (!audit) throw new Error('Dry-run write prohibited');
        await audit.runJsonTransaction(
          { source: 'migrate_credit_expense', method: 'PUT', sessionUserId: null }, body, () => true
        );
      }
    });
  } else if (mode === 'mongo') {
    if (!process.env.MONGODB_URI) throw new Error('Missing MONGODB_URI');
    const { MongoClient } = await import('mongodb');
    const client = new MongoClient(process.env.MONGODB_URI, { retryWrites: true, writeConcern: { w: 'majority', j: true } });
    close = () => client.close();
    try { await client.connect(); } catch (error) { await client.close(); throw error; }
    const db = client.db(process.env.MONGODB_DB || 'financetrack');
    store = createMongoMigrationStore({
      credit: db.collection('credit_cards'), expense: db.collection('monthly_expense')
    });
  } else throw new Error('DATA_MODE must be json or mongo');
  try {
    let plan: MigrationPlan;
    try {
      plan = await runMigration(store, options);
    } catch (error) {
      if (error instanceof MigrationMappingRequiredError) {
        console.table(error.report);
        console.error('STOPPED - nothing written. Supply --map for the ambiguous keys listed below.');
      }
      throw error; // main().catch sets a non-zero exit code.
    }
    console.table(plan.report);
    console.log(options.apply ? 'Apply completed; review conflicts (source rows retained).' : 'DRY RUN — no writes performed.');
  } finally { await close?.(); }
}

if (require.main === module) {
  main().catch(error => {
    console.error('Migration failed:', error);
    process.exitCode = 1;
  });
}
