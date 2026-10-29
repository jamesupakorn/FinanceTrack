/**
 * sharedMonthWindow.ts
 * รวมการบังคับ "หน้าต่าง 15 เดือนล่าสุด" ให้เป็นชุดเดียวกันข้าม 4 collection ที่เกี่ยวข้องกับ
 * dropdown เลือกเดือน (expense, income, salary, investment) แทนที่การจำกัด 15 เดือนแบบแยกอิสระ
 * ต่อ collection แบบเดิม ซึ่งเป็นสาเหตุที่ collection ที่ถูกเขียนน้อย (เช่น investment) ไม่เคยถึง
 * เพดาน 15 รายการ และไม่เคยตัดเดือนเก่าทิ้ง ทำให้เดือนเก่ามาก ๆ โผล่ใน union ของ dropdown ได้
 *
 * หลักการ: ไม่แก้ primitive เดิม (`limitUserEntries` ใน userUtils.js, `enforceMonthLimit` ใน
 * apiUtils.js) เพราะทั้งคู่ยังถูกใช้อยู่โดย savings.js/daily_expenses.js (นอกขอบเขตงานนี้)
 * ไฟล์นี้แค่ "ประกอบ" primitive ทั้งสองเข้าด้วยกันให้มองเห็น 4 collection พร้อมกัน
 *
 * ขอบเขต: expense, income, salary, investment เท่านั้น — savings/daily_expenses ไม่แตะ
 *
 * Far-future guard (.pipeline/spec.md §3.4): เดือนที่ > เดือนปัจจุบัน+1 และ "ว่าง" ในทั้ง 4
 * collection (skipped) ไม่ถูกนับเข้าหน้าต่าง 15 เดือน — ทำผ่าน limit = 15 + k (k = จำนวน skipped)
 * โดยไม่แก้ signature ของ enforceMonthLimit. เพราะ skipped ทุกเดือน > current+1 จึงอยู่บนสุดของ
 * การเรียง desc: top (15 + k) = skipped ทั้งหมด + 15 เดือนจริงล่าสุด (ยกเว้นกรณีมีเดือนจริง > 15
 * เดือนอยู่เหนือ skipped — เดือนว่างนั้นหลุดหน้าต่างได้ ซึ่งไม่มีข้อมูลหาย)
 * เดือนปัจจุบันอิงนาฬิกาเซิร์ฟเวอร์ (server-local เหมือน getCurrentMonthKey ใน creditCardBasics.ts —
 * OQ-2 ผู้ใช้ยืนยันแล้ว). ความเสี่ยงที่ผู้ใช้ยอมรับ (OQ-1): เมื่อข้ามเดือน เดือนว่างที่เคยเป็น
 * current+2 จะกลายเป็น current+1 และถูกนับเข้าหน้าต่างตามปกติ
 */

import { enforceMonthLimit } from './apiUtils';
import { getMongoCollection } from '../../../../lib/dataSource';
import { getUserData, setUserData } from '../../../backend/data/userUtils';

const SHARED_WINDOW_LIMIT = 15;
const JSON_FILES = ['monthly_expense.json', 'monthly_income.json', 'salary.json', 'investment.json'];
const MONGO_COLLECTIONS = ['monthly_expense', 'monthly_income', 'salary', 'investment'];

export type WindowCollection = 'expense' | 'income' | 'salary' | 'investment';
const COLLECTION_KINDS: WindowCollection[] = ['expense', 'income', 'salary', 'investment'];

// ฟิลด์ metadata ที่ไม่ถือเป็นข้อมูลจริง
const METADATA_KEYS = new Set(['_id', 'userId', 'month', 'saved_at', 'createdAt', 'updatedAt']);
// ฟิลด์ระดับบนสุดที่รู้จักของ collection ที่มีโครงสร้างตายตัว — ฟิลด์อื่น = ข้อมูลจริง (fail-safe)
const KNOWN_TOP_LEVEL_KEYS: Partial<Record<WindowCollection, Set<string>>> = {
  salary: new Set(['income', 'deduct', 'overtime', 'note', 'summary']),
  investment: new Set(['investments']),
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * true เมื่อค่าเป็น "ว่าง" แบบที่รู้จักเท่านั้น: null/undefined, '', 0, false, {}, [] และการซ้อนกัน.
 * ชนิดอื่น (Date, ObjectId, NaN/Infinity, function ฯลฯ) = ไม่ว่าง (fail-safe: นับเป็นข้อมูลจริง)
 */
function isDeepEmptyValue(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim().length === 0;
  if (typeof value === 'number') return value === 0;
  if (typeof value === 'boolean') return value === false;
  if (Array.isArray(value)) return value.every(isDeepEmptyValue);
  if (isPlainObject(value)) return Object.values(value).every(isDeepEmptyValue);
  return false;
}

/**
 * Server emptiness predicate (spec §3.4.2): true เมื่อเอกสารเดือนหนึ่งของ collection หนึ่งไม่มีหรือว่าง.
 * ฟิลด์/ชนิดที่ไม่รู้จัก = ข้อมูลจริง เพื่อให้ guard ลดการลบได้อย่างเดียว ไม่เพิ่ม
 */
export function isWindowDocEmpty(kind: WindowCollection, doc: unknown): boolean {
  if (doc === null || doc === undefined) return true;
  if (kind === 'investment' && Array.isArray(doc)) return doc.every(isDeepEmptyValue); // JSON bucket shape
  if (!isPlainObject(doc)) return false;
  const known = KNOWN_TOP_LEVEL_KEYS[kind];
  return Object.entries(doc).every(([key, value]) => {
    if (METADATA_KEYS.has(key)) return true;
    if (known && !known.has(key)) return false;
    return isDeepEmptyValue(value);
  });
}

function toMonthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

/** current / next month (server-local clock), computed once per enforce call. */
export function getWindowMonthBasis(now: Date = new Date()): { current: string; next: string } {
  return {
    current: toMonthKey(now),
    next: toMonthKey(new Date(now.getFullYear(), now.getMonth() + 1, 1)),
  };
}

/** months > next ที่ว่างในทุก collection ของทั้ง 4 (docsByCollection[i]: เดือน -> เอกสารของ collection i) */
function computeSkippedMonths(
  union: string[],
  next: string,
  docsByCollection: Array<Map<string, unknown[]>>
): string[] {
  return union.filter(month => month > next && COLLECTION_KINDS.every((kind, index) => (
    (docsByCollection[index].get(month) || []).every(doc => isWindowDocEmpty(kind, doc))
  )));
}

/** Same cut enforceMonthLimit applies: newest (15 + k) of the shared union, sorted desc. */
function computeAllowedMonths(union: string[], skippedCount: number): string[] {
  return Array.from(new Set(union))
    .sort((a, b) => b.localeCompare(a))
    .slice(0, SHARED_WINDOW_LIMIT + skippedCount);
}

/**
 * JSON mode: prune all 4 "range-relevant" collections' buckets for one user down to a single
 * shared window. Call AFTER the calling handler's own updateUserData() has already persisted its
 * write, so this pass sees its own new month on disk.
 * @param userId
 * @param opts - extraMonth: belt-and-suspenders (Set dedups). now: injectable clock (default `new Date()`).
 * @returns allowedMonths (insertion order desc): <= 15 real months plus any skipped empty far-future months.
 */
export function enforceSharedMonthWindowJson(
  userId: string,
  opts: { extraMonth?: string; now?: Date } = {}
): { allowedMonths: Set<string> } {
  const { extraMonth, now = new Date() } = opts;
  const { next } = getWindowMonthBasis(now);

  // อ่านทั้ง 4 ไฟล์ของผู้ใช้คนนี้ แล้วรวม key เดือนทั้งหมดเป็น union เดียว
  const buckets = JSON_FILES.map(file => getUserData(file, userId));
  const allMonthsSet = new Set<string>();
  buckets.forEach(bucket => {
    Object.keys(bucket).forEach(month => allMonthsSet.add(month));
  });
  if (typeof extraMonth === 'string' && extraMonth.length > 0) {
    allMonthsSet.add(extraMonth);
  }
  const union = Array.from(allMonthsSet);

  const docsByCollection = buckets.map(bucket => {
    const map = new Map<string, unknown[]>();
    Object.entries(bucket).forEach(([month, value]) => map.set(month, [value]));
    return map;
  });
  const skipped = computeSkippedMonths(union, next, docsByCollection);
  const allowedMonths = new Set(computeAllowedMonths(union, skipped.length));

  // ตัดแต่ละไฟล์ให้เหลือเฉพาะเดือนที่อยู่ใน allowedMonths แล้วเขียนกลับ
  JSON_FILES.forEach((file, index) => {
    const bucket = buckets[index];
    const prunedBucket: Record<string, unknown> = {};
    Object.entries(bucket).forEach(([month, value]) => {
      if (allowedMonths.has(month)) {
        prunedBucket[month] = value;
      }
    });
    setUserData(file, userId, prunedBucket);
  });

  return { allowedMonths };
}

/**
 * Mongo mode: prune all 4 collections for one user down to a single shared window, by calling the
 * existing, unmodified enforceMonthLimit() once per collection with the SAME additionalMonths array
 * (the full cross-collection union) and the SAME limit (15 + k), so all 4 independently compute
 * and apply the identical cut.
 * @param userId
 * @param opts - extraMonth; now: injectable clock (default `new Date()`).
 * @returns allowedMonths, sorted desc: <= 15 real months plus any skipped empty far-future months;
 *   consumed by monthly_income.ts's legacy `obj: 'months'` sub-doc handling.
 */
export async function enforceSharedMonthWindowMongo(
  userId: string,
  opts: { extraMonth?: string; now?: Date } = {}
): Promise<{ allowedMonths: string[] }> {
  const { extraMonth, now = new Date() } = opts;
  const { next } = getWindowMonthBasis(now);

  const collections = await Promise.all(
    MONGO_COLLECTIONS.map(name => getMongoCollection(name))
  );

  // รวม key เดือนจากทั้ง 4 collection (เฉพาะของ userId นี้) เป็น union เดียว
  const monthSet = new Set<string>();
  await Promise.all(
    collections.map(async (collection) => {
      const docs = await collection
        .find({ userId, month: { $exists: true } }, { projection: { month: 1 } })
        .toArray();
      docs.forEach((doc: Record<string, unknown>) => {
        if (doc && typeof doc.month === 'string' && doc.month.length > 0) {
          monthSet.add(doc.month);
        }
      });
    })
  );
  if (typeof extraMonth === 'string' && extraMonth.length > 0) {
    monthSet.add(extraMonth);
  }
  const additionalMonths = Array.from(monthSet);

  // อ่านเอกสารเต็มเฉพาะเดือน > next (bounded) เพื่อตัดสินว่าว่างหรือไม่
  const docsByCollection = await Promise.all(
    collections.map(async (collection) => {
      const map = new Map<string, unknown[]>();
      const docs = await collection.find({ userId, month: { $gt: next } }).toArray();
      docs.forEach((doc: Record<string, unknown>) => {
        if (!doc || typeof doc.month !== 'string') return;
        map.set(doc.month, [...(map.get(doc.month) || []), doc]);
      });
      return map;
    })
  );
  const skipped = computeSkippedMonths(additionalMonths, next, docsByCollection);

  // เรียก enforceMonthLimit เดิม (ไม่แก้ไข) ทีละ collection ด้วย additionalMonths และ limit ชุดเดียวกัน
  await Promise.all(
    collections.map(collection =>
      enforceMonthLimit(collection, SHARED_WINDOW_LIMIT + skipped.length, {
        filter: { userId },
        additionalMonths,
      })
    )
  );

  return { allowedMonths: computeAllowedMonths(additionalMonths, skipped.length) };
}
