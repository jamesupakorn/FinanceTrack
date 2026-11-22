/**
 * upcomingLinks — ตัวช่วยสร้าง/แยกวิเคราะห์ "focus key" ของการ์ดเดชบอร์ด "รายการที่จะมาถึง" (`UpcomingItem`)
 *
 * S2 (credits receiver) สร้างเฉพาะส่วนนี้: `CreditFocusTarget`, `revolvingFocusKey`, `parseCreditFocusKey`
 * ตัว builder ของลิงก์ปลายทาง (`upcomingItemHref`/`upcomingCardHref`) เป็นงานของ S3 — จะมาเพิ่มในไฟล์นี้
 * แบบ additive เท่านั้น (ห้ามสร้างไฟล์นี้ใหม่/overwrite)
 */

/** ปลายทางที่ `?focus=` บน /credits ชี้ถึง — แผนผ่อนชำระ หรือ รอบยอดหมุนเวียน */
export type CreditFocusTarget =
  | { kind: 'plan'; planId: string }
  | { kind: 'revolving'; month: string };

/** Composite focus key ของรอบยอดหมุนเวียนที่ต้องชำระ: `${cardId}_${cycleMonth}` (cycleMonth = 'YYYY-MM') */
export function revolvingFocusKey(cardId: string, cycleMonth: string): string {
  return `${cardId}_${cycleMonth}`;
}

const REVOLVING_MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * แยกวิเคราะห์ `?focus=` สำหรับบัตรที่กำลังแสดงบน /credits
 * - ตรงรูปแบบ `${cardId}_${M}` ที่ M เป็นเดือนที่ถูกต้อง → `{ kind: 'revolving', month: M }`
 * - string อื่นที่ไม่ว่าง → `{ kind: 'plan', planId: focusKey }` (plan id เป็นของที่ server สร้างให้ ไม่มีวันตรงรูปแบบ
 *   `<cardId>_YYYY-MM` จึงไม่ชนกับกรณีแรก)
 * - ว่าง/null/undefined → null
 */
export function parseCreditFocusKey(focusKey: string | null | undefined, cardId: string): CreditFocusTarget | null {
  if (!focusKey) return null;
  const revolvingPrefix = `${cardId}_`;
  if (focusKey.startsWith(revolvingPrefix)) {
    const month = focusKey.slice(revolvingPrefix.length);
    if (REVOLVING_MONTH_RE.test(month)) return { kind: 'revolving', month };
  }
  return { kind: 'plan', planId: focusKey };
}
