/**
 * Focus-trap helpers for modal/dialog components (Esc-to-close + Tab-cycling patterns).
 * Extracted from ExpenseCalendarModal.js — the corrected version after BUG-4 (Tab escaping
 * the modal onto the background page) — so every new modal shares one implementation
 * instead of copy-pasting the selector and re-introducing that bug (TECH_DEBT TD-M06).
 */

// selector กว้างไว้ก่อน แล้วค่อยกรองด้วยความจริงของ element ทีหลัง (ดู getTabbableElements)
export const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'a[href]',
  '[tabindex]'
].join(', ');

/**
 * element ที่ลำดับ Tab ของเบราว์เซอร์ไปถึงได้ "จริง" ตามลำดับ DOM
 *
 * ต้องกรองเอง ไม่ใช้แค่ selector: บาง component ใช้ roving tabindex (tabIndex = -1 ทุกตัวยกเว้น
 * ตัวที่เลือก) selector อย่างเดียวจึงจับ element ที่ Tab ไปไม่ถึงมาด้วย ทำให้ last ของ focus trap
 * ผิดตัว เงื่อนไขวนกลับไม่มีวันเป็นจริง แล้ว Tab เดินหลุดออกไปโดนปุ่มของหน้าเบื้องหลัง (BUG-4)
 * เกณฑ์จึงเป็น "tabIndex >= 0 และมองเห็นอยู่" ซึ่งครอบคลุม element ที่ตั้งใจข้ามจาก trap ทุกแบบ
 */
export function getTabbableElements(root) {
  if (!root) return [];
  return Array.from(root.querySelectorAll(FOCUSABLE_SELECTOR)).filter(element => (
    !element.disabled
    && element.tabIndex >= 0
    // display:none → ไม่มีทั้ง offsetParent และกล่องเรขาคณิต; position:fixed → ไม่มี offsetParent แต่ยังมีกล่อง
    && (element.offsetParent !== null || element.getClientRects().length > 0)
  ));
}
