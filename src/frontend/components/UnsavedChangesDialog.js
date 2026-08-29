/**
 * คอมโพเนนต์: UnsavedChangesDialog
 * กล่องยืนยัน "ยังไม่ได้บันทึก" ที่คุมทุกช่องทางออกจากหน้าที่มีข้อมูลยังไม่ได้บันทึกใน /workspace/*
 * (Amendment A5) — เจ้าของเดียวคือ WorkspaceShell.js ซึ่งเรียกผ่าน guard()/beforePopState/onBeforeNavigate
 *
 * chrome (backdrop/modal/modalNarrow/modalHeader/modalTitle/closeButton/modalBody/confirmText/
 * modalFooter/secondaryButton/primaryButton) ใช้คลาสร่วมจาก CreditCardForm.module.css เหมือนที่
 * RevolvingConfirmDialog (ExpenseCalendarModal.js:70-140) ทำอยู่แล้ว — ไม่สร้าง stylesheet โมดัลใหม่
 * focus trap (FOCUSABLE_SELECTOR + getTabbableElements) คัดลอกจาก ExpenseCalendarModal.js:37-63
 * คำต่อคำ — ห้ามใช้ raw selector ของ CreditCardForm.js:87-89 (ต้นตอ BUG-4)
 *
 * ปุ่มที่ปลอดภัย ("กลับไปบันทึก") เป็นปุ่มเด่น (.primaryButton) ได้ focus แรกและอยู่ท้ายสุด — สลับกับ
 * RevolvingConfirmDialog ที่ปุ่มยืนยัน (ทำลาย/สร้างหนี้) เป็นปุ่มเด่น เพราะที่นี่ปุ่มทำลาย
 * ("ออกโดยไม่บันทึก") แค่ทิ้งค่าที่พิมพ์ซ้ำได้ ไม่ใช่การกระทำที่ย้อนกลับไม่ได้แบบสร้างหนี้จริง
 * (spec-monthly-workspace.md §Amendment A5 §The unsaved-changes dialog)
 */

import { useEffect, useRef } from 'react';
import { Icons } from './Icons';
import formStyles from '../styles/CreditCardForm.module.css';

const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'a[href]',
  '[tabindex]'
].join(', ');

function getTabbableElements(root) {
  return Array.from(root.querySelectorAll(FOCUSABLE_SELECTOR)).filter(element => (
    !element.disabled
    && element.tabIndex >= 0
    && (element.offsetParent !== null || element.getClientRects().length > 0)
  ));
}

export default function UnsavedChangesDialog({ open, message, onStay, onLeave }) {
  const dialogRef = useRef(null);
  const stayButtonRef = useRef(null);
  const triggerRef = useRef(null);

  // คืน focus ให้ element ที่เปิด dialog ตอนปิดจริง ๆ (open → false) เท่านั้น — ผูก dep กับ [open]
  // ล้วน ๆ ไม่ผสมกับ effect ข้างล่างที่ dep มี onStay ด้วย (บทเรียนเดียวกับ SalaryModal.js:49-64)
  // ดีเลย์ 40ms เพื่อชนะ race กับ "เพิ่มเติม" bottom sheet ของ Layout ที่คืน focus ให้ปุ่มเปิดของมันเอง
  // ระหว่าง cleanup ของ effect (Layout.js:268) — ใช้ดีเลย์เดียวกับ SalaryModal.js:52 (AC-A5-12)
  useEffect(() => {
    if (!open) return undefined;
    triggerRef.current = typeof document !== 'undefined' ? document.activeElement : null;
    const timer = setTimeout(() => stayButtonRef.current?.focus(), 40);
    return () => {
      clearTimeout(timer);
      triggerRef.current?.focus?.();
    };
  }, [open]);

  // Esc / backdrop / ✕ ทั้งหมดลงเอยที่ onStay (ทางเลือกที่ปลอดภัย) — ไม่มีทางไหนที่กดพลาดแล้วข้อมูลหาย
  useEffect(() => {
    if (!open) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onStay?.();
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = getTabbableElements(dialogRef.current);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, onStay]);

  if (!open) return null;

  return (
    <div
      className={formStyles.backdrop}
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onStay?.();
      }}
    >
      <div
        ref={dialogRef}
        className={`${formStyles.modal} ${formStyles.modalNarrow}`}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="unsaved-changes-dialog-title"
      >
        <div className={formStyles.modalHeader}>
          <h2 id="unsaved-changes-dialog-title" className={formStyles.modalTitle}>ยังไม่ได้บันทึก</h2>
          <button type="button" className={formStyles.closeButton} onClick={onStay} aria-label="ปิด" tabIndex={0}>
            <Icons.X size={18} />
          </button>
        </div>
        <div className={formStyles.modalBody}>
          <p className={formStyles.confirmText}>{message}</p>
        </div>
        <div className={formStyles.modalFooter}>
          {/* tabIndex={0} ชัดเจน (เหมือน MonthManager.js's modal) — Safari ไม่ใส่ <button> เข้า native
              keyboard-Tab order ให้เองถ้า "Full Keyboard Access" ปิดอยู่ (ค่าเริ่มต้นของ macOS/iOS) ทำให้
              Shift+Tab จากปุ่มสุดท้ายกระโดดข้าม secondaryButton ไปยัง element ถัดไปนอก dialog แทนที่จะ
              วนกลับมาในนี้ — ตรงกับ root cause เดียวกับที่พบใน focus-return WebKit divergence (AC-A5-12
              §Gaps): Safari ต้องมี tabindex ชัดเจนถึงจะนับ element นั้นเข้า keyboard focus flow */}
          <button type="button" className={formStyles.secondaryButton} onClick={onLeave} tabIndex={0}>
            ออกโดยไม่บันทึก
          </button>
          <button ref={stayButtonRef} type="button" className={formStyles.primaryButton} onClick={onStay} tabIndex={0}>
            กลับไปบันทึก
          </button>
        </div>
      </div>
    </div>
  );
}
