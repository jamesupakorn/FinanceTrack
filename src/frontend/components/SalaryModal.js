/**
 * คอมโพเนนต์: SalaryModal
 * เชลล์ modal ของ SalaryCalculator — ใช้เมื่อแตะแถว "เงินเดือน" ในตาราง "รายรับ" (IncomeTable)
 * ของ /workspace (Amendment A3 — เดิมเคยวางแผนย้ายไปหน้า /salary แยก, ยกเลิกแผนนั้นแล้ว)
 *
 * Graphite redesign (SalaryModal pass) — Tailwind only, เลิก import CreditCardForm.module.css
 * (task-context-salary-modal-graphite.md "SalaryModal's own chrome"). backdrop/modal/header/body
 * เป็น C9 shell สร้างเองด้วย Tailwind ตามรูปแบบเดียวกับ pages/reports.js's report-month modal
 * (Tailwind C9 ล้วน — ไม่ reuse CreditCardForm.module.css เพราะไฟล์นั้นยังมีผู้ใช้ภายนอกอยู่
 * (ExpenseCalendarModal.js, UnsavedChangesDialog.js) ห้ามลบ — Finding A ของ architecture review)
 * max-width 680px ตาม UX_SPEC §9's SalaryModal entry (ไม่ใช่ .modalWide 900px เดิม)
 *
 * focus trap (getTabbableElements) เปลี่ยนมาใช้ helper กลางจาก focusTrap.js แทนของที่เคยคัดลอกมาเอง
 * จาก ExpenseCalendarModal.js คำต่อคำ (Finding B ของ architecture review, TD-M06 conformance) —
 * ความหมาย Tab/Shift+Tab/Escape/focus-restore เดิมทุกประการ ไม่ใช่การออกแบบ interaction ใหม่
 *
 * SalaryCalculator เองยังคงเป็นเจ้าของ state/การคำนวณ/การบันทึกทั้งหมด — ที่นี่แค่ให้ inModal
 * (ตัด chrome หน้าเต็ม + ซ่อนหัวข้อซ้ำ, ดู SalaryCalculator.js) แล้วส่ง onSalaryUpdate
 * ต่อเป็น onSaved ให้ parent (pages/workspace/income.js) ปิด modal + รีเฟรช salaryUpdateTrigger
 */

import { useEffect, useRef, useState } from 'react';
import SalaryCalculator from './SalaryCalculator';
import { Icons } from './Icons';
import { formatMonthLabelTH } from '../../shared/utils/frontend/monthUtils';
import { getTabbableElements } from '../../shared/utils/frontend/focusTrap';

const FOCUS_RING = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2';

export default function SalaryModal({ open, selectedMonth, onClose, onSaved }) {
  const dialogRef = useRef(null);
  const triggerRef = useRef(null);
  // เก็บ footer <div> ของโมดัลนี้เป็น state (ไม่ใช่ ref เฉยๆ) เพราะ SalaryCalculator ต้อง re-render
  // เมื่อ node นี้ mount เสร็จแล้วถึงจะ portal ปุ่มเข้าไปได้ — callback ref ทำให้รู้ทันทีที่ node
  // ปรากฏใน DOM จริง (R-2: อาจมีเฟรมแรกที่ node ยังไม่มี ซึ่ง benign ตามที่ architecture review ยืนยัน
  // ว่า getTabbableElements อ่าน DOM สดทุกครั้งที่กด Tab ไม่ cache)
  const [footerNode, setFooterNode] = useState(null);

  useEffect(() => {
    if (!open) return undefined;
    triggerRef.current = typeof document !== 'undefined' ? document.activeElement : null;
    const timer = setTimeout(() => {
      dialogRef.current?.querySelector('input, button:not([disabled])')?.focus();
    }, 40);
    // คืน focus ให้ปุ่มที่เปิดตอนปิดจริงๆ (open → false) เท่านั้น — ผูกไว้ที่นี่ซึ่ง dep คือ [open]
    // ล้วนๆ ไม่ใช่ effect ข้างล่างที่ dep มี onClose ด้วย (บทเรียนเดียวกับ ExpenseCalendarModal.js's
    // RevolvingConfirmDialog: "ผูก dep กับ [open] เท่านั้นตามบทเรียน BUG-2") ถ้า onClose เป็น
    // arrow function ใหม่ทุก render ของ parent (เช่น pages/workspace/income.js) effect ที่มี onClose
    // ใน dep จะ teardown/re-run ทุกครั้ง แล้ว cleanup เดิมจะดึง focus ออกจาก dialog ทั้งที่ modal ยังเปิดอยู่
    return () => {
      clearTimeout(timer);
      triggerRef.current?.focus?.();
    };
  }, [open]);

  // Escape ปิด · Tab วนอยู่ในโมดัล (ไม่แตะ focus-restore ที่นี่ — อยู่ใน effect ข้างบนแล้ว)
  // getTabbableElements มาจาก focusTrap.js ตัวกลาง — ไม่เขียน selector เอง (TD-M06)
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
    };
  }, [open, onClose]);

  if (!open) return null;

  const monthLabel = selectedMonth ? formatMonthLabelTH(selectedMonth) : '';

  return (
    <div
      className="fixed inset-0 z-[110] flex items-end justify-center overflow-y-auto bg-[rgba(10,10,11,0.72)] p-0 backdrop-blur-sm md:items-center md:p-space-5"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose?.();
      }}
    >
      <div
        ref={dialogRef}
        className="flex max-h-[95vh] w-full flex-col overflow-hidden rounded-t-lg bg-surface-3 shadow-elev-3 md:max-h-[85vh] md:max-w-[680px] md:rounded-lg"
        role="dialog"
        aria-modal="true"
        aria-labelledby="salary-modal-title"
      >
        <div className="flex shrink-0 items-center justify-between gap-space-3 border-b border-border-subtle px-space-5 py-space-4">
          <h2 id="salary-modal-title" className="m-0 text-lg font-semibold text-primary">
            {`คำนวณเงินเดือน${monthLabel ? ` - ${monthLabel}` : ''}`}
          </h2>
          <button
            type="button"
            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-sm text-secondary hover:bg-surface-2 ${FOCUS_RING}`}
            onClick={onClose}
            aria-label="ปิด"
          >
            <Icons.X size={18} />
          </button>
        </div>

        {/* flex-1 ทำให้ body เป็นตัวที่ยืด/หด, min-h-0 อนุญาตให้หดต่ำกว่าความสูงเนื้อหา —
            ถ้าไม่มี min-h-0 flex item จะใช้ min-height: auto เป็นค่าเริ่มต้น ทำให้ panel ทั้งก้อน
            ถูกดันสูงเกิน max-h แล้ว backdrop (overflow-y-auto) กลายเป็นตัวเลื่อนแทน body เอง
            (R-5 — ห้าม "ปรับให้เรียบง่าย" ด้วยการเอา min-h-0 ออกโดยไม่เข้าใจผลกระทบนี้) */}
        <div className="flex flex-1 min-h-0 flex-col gap-space-4 overflow-y-auto px-space-5 py-space-4">
          <SalaryCalculator
            selectedMonth={selectedMonth}
            onSalaryUpdate={onSaved}
            inModal
            footerTarget={footerNode}
          />
        </div>

        {/* footer ใหม่ของ SalaryModal — เดิมไม่มี footer เลย ปุ่มบันทึก/ล้างข้อมูลอยู่ท้ายสุดของ body
            ที่เลื่อนได้ ทำให้ต้อง scroll ไปสุดถึงจะกดได้ ตอนนี้ปุ่มถูก portal เข้ามาที่นี่จาก
            SalaryCalculator (ดู footerTarget ด้านบน + SalaryCalculator.js's footerTarget prop) —
            state/handler (isSaving/clearAll/saveSalaryData) ยังเป็นของ SalaryCalculator ทั้งหมด (M-3) */}
        <div
          ref={setFooterNode}
          className="shrink-0 border-t border-border-subtle px-space-5 py-space-4"
        />
      </div>
    </div>
  );
}
