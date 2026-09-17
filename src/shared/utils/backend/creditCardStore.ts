/**
 * creditCardStore.js  (server-only)
 * ที่เดียวในฟีเจอร์บัตรเครดิตที่แยกโหมด JSON / MongoDB
 * ทุกอย่างที่อยู่เหนือไฟล์นี้เป็น mode-agnostic ทั้งหมด (ADR-001 · R-5)
 *
 * โครงสร้าง: 1 เอกสารต่อ 1 ผู้ใช้
 *   json : credit_cards.json → { "u001": { cards, plans, cycles, updatedAt } }
 *   mongo: collection credit_cards → { userId, cards, plans, cycles, updatedAt }
 *
 * ⚠ เอกสารบัตรเครดิตต้อง **ไม่มี** field `month` ระดับบนสุดเด็ดขาด (BR-CC-002)
 *   enforceMonthLimit() กรองด้วย { month: { $exists: true } } แล้วลบทุกอย่างนอก 15 เดือนล่าสุด
 *   เอกสารที่ไม่มี month จึงมองไม่เห็นโดย pruner  และห้ามเรียก limitUserEntries() กับไฟล์นี้
 *   `cycles[].month` เป็น field ภายใน array element ไม่ใช่ระดับบนสุด pruner จึงยังมองไม่เห็น
 *   ห้ามยก cycles ออกไปเป็นเอกสารแยกราย เดือน และห้ามเพิ่ม month ระดับบนสุด
 *
 * ⚠ normaliseCreditData() และ payload ของ Mongo $set เป็น whitelist ทั้งคู่
 *   field ใหม่ต้องเพิ่ม **ทั้งสองที่** มิฉะนั้นโหมด JSON ทำงานปกติแต่ Mongo กลืนข้อมูลหายเงียบ ๆ (AC-73)
 *
 * userId เป็น argument แรกที่บังคับเสมอ และไม่มีฟังก์ชันอ่านแบบไม่ scope ผู้ใช้ (R-3)
 */

import { isJsonMode, getMongoCollection } from '../../../../lib/dataSource';
import { getUserData, updateUserData } from '../../../backend/data/userUtils.js';
import { assertScopedUserId } from './userRequest';

const COLLECTION_NAME = 'credit_cards';
const JSON_FILENAME = 'credit_cards.json';

/** Module-private shape for this file's own return/parameter needs (no second real .ts consumer yet). */
interface CreditData {
  cards: unknown[];
  plans: unknown[];
  cycles: unknown[];
  updatedAt: string | null;
}

/** โครงสร้างว่างมาตรฐาน — ผู้ใช้ใหม่เริ่มจากค่าว่างจริง ไม่มี default injection (BR-CC-012 / AC-04) */
function emptyCreditData(): CreditData {
  return { cards: [], plans: [], cycles: [], updatedAt: null };
}

function normaliseCreditData(raw: unknown): CreditData {
  if (!raw || typeof raw !== 'object') return emptyCreditData();
  const cards = (raw as { cards?: unknown }).cards;
  const plans = (raw as { plans?: unknown }).plans;
  const cycles = (raw as { cycles?: unknown }).cycles;
  const updatedAt = (raw as { updatedAt?: unknown }).updatedAt;
  return {
    cards: Array.isArray(cards) ? cards : [],
    plans: Array.isArray(plans) ? plans : [],
    cycles: Array.isArray(cycles) ? cycles : [],
    updatedAt: typeof updatedAt === 'string' ? updatedAt : null
  };
}

// F-08: implementation moved to shared src/shared/utils/backend/userRequest.js#assertScopedUserId
// — this file only supplies its own error-message label so its distinct message stays byte-identical.
function assertUserScope(userId: unknown): string {
  return assertScopedUserId(userId, 'creditCardStore');
}

/**
 * อ่านเอกสารบัตรเครดิตของผู้ใช้
 * @param {string} userId - บังคับ
 * @returns {Promise<{cards: array, plans: array, cycles: array, updatedAt: string|null}>}
 */
export async function getUserCreditData(userId: unknown): Promise<CreditData> {
  const scopedUserId = assertUserScope(userId);

  if (isJsonMode()) {
    return normaliseCreditData(getUserData(JSON_FILENAME, scopedUserId));
  }

  const collection = await getMongoCollection(COLLECTION_NAME);
  // scope ด้วย userId เท่านั้น — ห้าม fallback ไป { userId: { $exists: false } } (BR-CC-001)
  const doc = await collection.findOne({ userId: scopedUserId });
  return normaliseCreditData(doc);
}

/**
 * แก้ไขเอกสารบัตรเครดิตของผู้ใช้แบบ transactional
 * @param {string} userId - บังคับ
 * @param {(data: object) => object} updater - รับ snapshot คืนโครงสร้างใหม่
 * @returns {Promise<object>} ข้อมูลหลังบันทึก
 */
export async function updateUserCreditData(
  userId: unknown,
  updater: (data: CreditData) => CreditData
): Promise<CreditData> {
  const scopedUserId = assertUserScope(userId);
  if (typeof updater !== 'function') {
    throw new Error('creditCardStore: updater must be a function');
  }

  if (isJsonMode()) {
    const next = updateUserData(JSON_FILENAME, scopedUserId, (bucket: unknown) => {
      const current = normaliseCreditData(bucket);
      const updated = normaliseCreditData(updater(current));
      return { ...updated, updatedAt: new Date().toISOString() };
    });
    return normaliseCreditData(next);
  }

  const collection = await getMongoCollection(COLLECTION_NAME);
  const doc = await collection.findOne({ userId: scopedUserId });
  const current = normaliseCreditData(doc);
  const updated = normaliseCreditData(updater(current));
  const payload = {
    userId: scopedUserId,
    cards: updated.cards,
    plans: updated.plans,
    // ⚠ ต้องมี cycles ที่นี่ด้วย — ลืมแล้ว JSON ทำงานได้ แต่ production (Mongo) ทิ้ง cycle ทุกใบ (AC-73)
    cycles: updated.cycles,
    updatedAt: new Date().toISOString()
  };
  await collection.updateOne(
    { userId: scopedUserId },
    { $set: payload },
    { upsert: true }
  );
  return normaliseCreditData(payload);
}
