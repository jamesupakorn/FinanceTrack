/**
 * upcomingLinks — ตัวช่วยสร้าง/แยกวิเคราะห์ "focus key" ของการ์ดเดชบอร์ด "รายการที่จะมาถึง" (`UpcomingItem`)
 *
 * S2 (credits receiver) สร้างเฉพาะส่วนนี้: `CreditFocusTarget`, `revolvingFocusKey`, `parseCreditFocusKey`
 * S3 (dashboard links) เพิ่ม `upcomingItemHref`/`upcomingCardHref` แบบ additive ต่อจากนี้
 */

import type { UrlObject } from 'url';
import { WORKSPACE_SECTIONS } from './workspaceRoutes';

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

/**
 * สร้างปลายทาง (href) ของการ์ด "รายการที่จะมาถึง" บนหน้า dashboard
 * - `plain`: ไปหน้ารายจ่ายรายเดือน เดือน = cycleMonth ที่ถูกต้อง หรือ fallback เป็นเดือนจาก isoDate
 * - `installment`: ไปหน้า /credits โดย focus = planId (ต้องมีทั้ง card และ plan)
 * - `revolving`: ไปหน้า /credits โดย focus = revolvingFocusKey (ถ้า cycleMonth ถูกต้อง) หรือไม่มี focus
 * - source อื่น: คืน null (ผู้เรียกจะ render การ์ดแบบไม่มีลิงก์เหมือนเดิม)
 */
export function upcomingItemHref(event: {
  source: string;
  key: string;
  isoDate: string;
  cycleMonth?: string;
  card: { id: string } | null;
  plan?: { id: string } | null;
}): UrlObject | null {
  if (event.source === 'plain') {
    const month = event.cycleMonth && REVOLVING_MONTH_RE.test(event.cycleMonth)
      ? event.cycleMonth
      : event.isoDate.slice(0, 7);
    if (!REVOLVING_MONTH_RE.test(month) || !event.key) return null;
    return { pathname: WORKSPACE_SECTIONS.expense.path, query: { month, focus: event.key } };
  }

  if (event.source === 'installment') {
    const cardId = event.card?.id;
    const planId = event.plan?.id;
    if (!cardId || !planId) return null;
    return { pathname: '/credits', query: { card: cardId, focus: planId } };
  }

  if (event.source === 'revolving') {
    const cardId = event.card?.id;
    if (!cardId) return null;
    if (event.cycleMonth && REVOLVING_MONTH_RE.test(event.cycleMonth)) {
      return { pathname: '/credits', query: { card: cardId, focus: revolvingFocusKey(cardId, event.cycleMonth) } };
    }
    return { pathname: '/credits', query: { card: cardId } };
  }

  return null;
}

/** สร้างปลายทาง (href) ของการ์ดบัตรเครดิต (group) บน dashboard — ไม่มี focus */
export function upcomingCardHref(group: { card: { id: string } }): UrlObject {
  return { pathname: '/credits', query: { card: group.card.id } };
}
