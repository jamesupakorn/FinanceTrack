/**
 * คอมโพเนนต์: SalaryModal
 * เชลล์ modal ของ SalaryCalculator — ใช้เมื่อแตะแถว "เงินเดือน" ในตาราง "รายรับ" (IncomeTable)
 * ของ /workspace (Amendment A3 — เดิมเคยวางแผนย้ายไปหน้า /salary แยก, ยกเลิกแผนนั้นแล้ว)
 *
 * backdrop/modal/header/body ใช้คลาสร่วมจาก CreditCardForm.module.css (.modalWide สำหรับฟอร์ม
 * 2 คอลัมน์) เหมือนที่ ExpenseCalendarModal.js ทำอยู่แล้ว — ไม่สร้าง stylesheet โมดัลใหม่
 * Esc / คืน focus ให้ปุ่มที่เปิด คัดลอกรูปแบบมาจาก CreditCardForm.js (ไม่ได้คิดใหม่) แต่ focus trap
 * (FOCUSABLE_SELECTOR + getTabbableElements) คัดลอกจาก ExpenseCalendarModal.js:37-63 แทน — ไม่ใช้
 * raw selector ของ CreditCardForm.js:87-89 เพราะเป็นต้นตอของ BUG-4 (ไม่กรอง element ที่ Tab จริงๆ
 * ไปไม่ถึง เช่น display:none/tabIndex ติดลบ ทำให้ trap วนไปจบที่ element ที่ Tab ไม่มีทางไปถึง)
 *
 * SalaryCalculator เองยังคงเป็นเจ้าของ state/การคำนวณ/การบันทึกทั้งหมด — ที่นี่แค่ให้ inModal
 * (ตัด chrome หน้าเต็ม + ซ่อนหัวข้อซ้ำ, ดู SalaryCalculator.module.css/.js) แล้วส่ง onSalaryUpdate
 * ต่อเป็น onSaved ให้ parent (pages/workspace.js) ปิด modal + รีเฟรช salaryUpdateTrigger
 */

import { useEffect, useRef } from 'react';
import SalaryCalculator from './SalaryCalculator';
import { Icons } from './Icons';
import { formatMonthLabelTH } from '../../shared/utils/frontend/monthUtils';
import formStyles from '../styles/CreditCardForm.module.css';

// selector กว้างไว้ก่อน แล้วค่อยกรองด้วยความจริงของ element ทีหลัง (ดู getTabbableElements) —
// คัดลอกมาจาก ExpenseCalendarModal.js:37-45 คำต่อคำ
const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'a[href]',
  '[tabindex]'
].join(', ');

// element ที่ลำดับ Tab ของเบราว์เซอร์ไปถึงได้ "จริง" ตามลำดับ DOM — คัดลอกมาจาก
// ExpenseCalendarModal.js:52-63 คำต่อคำ
function getTabbableElements(root) {
  return Array.from(root.querySelectorAll(FOCUSABLE_SELECTOR)).filter(element => (
    !element.disabled
    && element.tabIndex >= 0
    && (element.offsetParent !== null || element.getClientRects().length > 0)
  ));
}

export default function SalaryModal({ open, selectedMonth, onClose, onSaved }) {
  const dialogRef = useRef(null);
  const triggerRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    triggerRef.current = typeof document !== 'undefined' ? document.activeElement : null;
    const timer = setTimeout(() => {
      dialogRef.current?.querySelector('input, button:not([disabled])')?.focus();
    }, 40);
    return () => clearTimeout(timer);
  }, [open]);

  // Escape ปิด · Tab วนอยู่ในโมดัล · คืน focus ให้ปุ่มที่เปิดเมื่อปิด (รูปแบบเดียวกับ CreditCardForm.js)
  useEffect(() => {
    if (!open) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose?.();
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
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      triggerRef.current?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  const monthLabel = selectedMonth ? formatMonthLabelTH(selectedMonth) : '';

  return (
    <div
      className={formStyles.backdrop}
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose?.();
      }}
    >
      <div
        ref={dialogRef}
        className={`${formStyles.modal} ${formStyles.modalWide}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="salary-modal-title"
      >
        <div className={formStyles.modalHeader}>
          <h2 id="salary-modal-title" className={formStyles.modalTitle}>
            {`คำนวณเงินเดือน${monthLabel ? ` - ${monthLabel}` : ''}`}
          </h2>
          <button type="button" className={formStyles.closeButton} onClick={onClose} aria-label="ปิด">
            <Icons.X size={18} />
          </button>
        </div>

        <div className={formStyles.modalBody}>
          <SalaryCalculator selectedMonth={selectedMonth} onSalaryUpdate={onSaved} inModal />
        </div>
      </div>
    </div>
  );
}
