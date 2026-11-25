/**
 * คอมโพเนนต์: UnsavedChangesDialog
 * กล่องยืนยัน "ยังไม่ได้บันทึก" ที่คุมทุกช่องทางออกจากหน้าที่มีข้อมูลยังไม่ได้บันทึกใน /workspace/*
 * (Amendment A5) — เจ้าของเดียวคือ WorkspaceShell.js ซึ่งเรียกผ่าน guard()/registerPopGuard (overlayHistory.ts)/
 * onBeforeNavigate — ตัวมันเองก็เป็น overlay (useBackToClose) ดังนั้น Back บนไดอะล็อกนี้ = onStay (D-SBC-5)
 *
 * chrome (backdrop/modal/modalNarrow/modalHeader/modalTitle/closeButton/modalBody/confirmText/
 * modalFooter/secondaryButton/primaryButton) ใช้คลาสร่วมจาก CreditCardForm.module.css เหมือนที่
 * RevolvingConfirmDialog (ExpenseCalendarModal.js:70-140) ทำอยู่แล้ว — ไม่สร้าง stylesheet โมดัลใหม่
 * focus trap ใช้ getTabbableElements จาก src/shared/utils/frontend/focusTrap.js (shared helper)
 * เหมือนที่ CreditCardForm.js/ExpenseCalendarModal.js ใช้ — ไม่มี local copy ของ selector/ฟังก์ชันแล้ว
 *
 * ปุ่มที่ปลอดภัย ("กลับไปบันทึก") เป็นปุ่มเด่น (.primaryButton) ได้ focus แรกและอยู่ท้ายสุด — สลับกับ
 * RevolvingConfirmDialog ที่ปุ่มยืนยัน (ทำลาย/สร้างหนี้) เป็นปุ่มเด่น เพราะที่นี่ปุ่มทำลาย
 * ("ออกโดยไม่บันทึก") แค่ทิ้งค่าที่พิมพ์ซ้ำได้ ไม่ใช่การกระทำที่ย้อนกลับไม่ได้แบบสร้างหนี้จริง
 * (Amendment A5, unsaved-changes dialog)
 */

import { useEffect, useRef } from 'react';
import { Icons } from './Icons';
import { getTabbableElements } from '../../shared/utils/frontend/focusTrap';
import { useBackToClose } from '../../shared/utils/frontend/useBackToClose';
import formStyles from '../styles/CreditCardForm.module.css';

interface UnsavedChangesDialogProps {
  open: boolean;
  message: string;
  onStay: () => void;
  onLeave: () => void;
}

export default function UnsavedChangesDialog({ open, message, onStay, onLeave }: UnsavedChangesDialogProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const stayButtonRef = useRef<HTMLButtonElement | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);

  const leavingRef = useRef(false);
  useEffect(() => { if (open) leavingRef.current = false; }, [open]);
  // ทุกทาง "stay" (Back บนไดอะล็อก, Escape, backdrop, ✕, "กลับไปบันทึก") ต้องเงียบขณะที่ "ออกโดยไม่บันทึก"
  // คิวไว้แล้วรอ self-pop settle — ถ้าไม่เช็ค leavingRef ผู้ใช้กด "กลับไปบันทึก" ในหน้าต่างนั้นจะเห็นไดอะล็อก
  // ปิดเหมือน stay สำเร็จ แต่ onLeave ที่คิวไว้ยังยิงอยู่ดี (เด้งออกทั้งที่เลือก stay แล้ว)
  const handleStay = () => {
    if (leavingRef.current) return;
    onStay();
  };

  // Back on this dialog = Escape = backdrop = ✕ = "กลับไปบันทึก" (D-SBC-5). Called above the early
  // `return null` below — hooks can't be conditional.
  const back = useBackToClose(open, handleStay);
  // "ออกโดยไม่บันทึก": release this dialog's own overlay entry first, and defer onLeave (the real
  // navigation) until that self-pop settles (F-SBC-7) — never run onLeave inline with release, or the
  // bypassed history.back() in WorkspaceShell's guard could race the dialog's own go(-1) (INV-4).
  const handleLeave = () => {
    if (leavingRef.current) return;
    leavingRef.current = true;
    back.release(onLeave);
  };

  // คืน focus ให้ element ที่เปิด dialog ตอนปิดจริง ๆ (open → false) เท่านั้น — ผูก dep กับ [open]
  // ล้วน ๆ ไม่ผสมกับ effect ข้างล่างที่ dep มี onStay ด้วย (บทเรียนเดียวกับ SalaryModal.tsx:49-64)
  // ดีเลย์ 40ms เพื่อชนะ race กับ "เพิ่มเติม" bottom sheet ของ Layout ที่คืน focus ให้ปุ่มเปิดของมันเอง
  // ระหว่าง cleanup ของ effect (Layout.js:268) — ใช้ดีเลย์เดียวกับ SalaryModal.tsx:52 (AC-A5-12)
  useEffect(() => {
    if (!open) return undefined;
    triggerRef.current = typeof document !== 'undefined' ? document.activeElement as HTMLElement | null : null;
    const timer = setTimeout(() => stayButtonRef.current?.focus(), 40);
    return () => {
      clearTimeout(timer);
      triggerRef.current?.focus?.();
    };
  }, [open]);

  // Esc / backdrop / ✕ ทั้งหมดลงเอยที่ onStay (ทางเลือกที่ปลอดภัย) — ไม่มีทางไหนที่กดพลาดแล้วข้อมูลหาย
  useEffect(() => {
    if (!open) return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        handleStay();
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
        if (event.target === event.currentTarget) handleStay();
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
          <button type="button" className={formStyles.closeButton} onClick={handleStay} aria-label="ปิด" tabIndex={0}>
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
          <button type="button" className={formStyles.secondaryButton} onClick={handleLeave} tabIndex={0}>
            ออกโดยไม่บันทึก
          </button>
          <button ref={stayButtonRef} type="button" className={formStyles.primaryButton} onClick={handleStay} tabIndex={0}>
            กลับไปบันทึก
          </button>
        </div>
      </div>
    </div>
  );
}