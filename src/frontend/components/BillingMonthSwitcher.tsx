/**
 * คอมโพเนนต์: BillingMonthSwitcher (presentational)
 * แทน <input type="month"> ในหน้ารายละเอียดบัตร (spec-credit-card-detail-redesign §5.2, OQ-4)
 * - ‹ label › เลื่อนทีละ 1 เดือนด้วย addMonths (ไม่มีขอบเขต เหมือน native input เดิม)
 * - ปุ่ม "รอบที่ต้องชำระ" แสดงเฉพาะเมื่อ month !== payableCycle และรีเซ็ตกลับไปที่ payableCycle (ไม่ใช่เดือนปฏิทิน)
 * - ป้าย "ต้องชำระเดือนนี้" แสดงเมื่อ month === payableCycle
 */

import { useRef } from 'react';
import { addMonths } from '../../shared/utils/creditCardUtils';
import { MONTH_KEY_RE } from '../../shared/utils/creditCardBasics';
import { formatMonthKeyTH } from '../../shared/utils/dateUtils';
import { Icons } from './Icons';

const FOCUS_RING = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2';
const BTN_GHOST = `inline-flex min-h-11 items-center justify-center gap-space-2 rounded-sm border border-border-interactive bg-surface-2 px-space-4 text-sm font-medium text-primary transition-colors duration-fast ease-graphite hover:bg-surface-3 ${FOCUS_RING}`;
const ICON_BTN = `flex h-11 w-11 shrink-0 items-center justify-center rounded-sm border border-border-default bg-surface-2 text-secondary transition-colors duration-fast ease-graphite hover:bg-surface-3 ${FOCUS_RING}`;
const BADGE = 'inline-flex w-fit items-center gap-space-1 rounded-full border border-border-default bg-surface-2 px-space-2 py-[2px] text-xs font-medium text-secondary';

export default function BillingMonthSwitcher({ month, payableCycle, onChange, onReset }: {
  month: string;
  payableCycle: string;
  onChange: (month: string) => void;
  /** ถ้าไม่ส่ง ปุ่ม "รอบที่ต้องชำระ" จะเรียก onChange(payableCycle) — ส่งมาเมื่อผู้เรียกต้องแยกการรีเซ็ตออกจากการกดลูกศร (monthTouched) */
  onReset?: () => void;
}) {
  const labelRef = useRef<HTMLParagraphElement | null>(null);
  const prev = addMonths(month, -1);
  const next = addMonths(month, 1);

  const step = (target: string) => {
    if (MONTH_KEY_RE.test(target)) onChange(target);
  };

  return (
    <div role="group" aria-label="เดือนรอบบิล" className="flex flex-col gap-space-2">
      <div className="flex items-center justify-between gap-space-2">
        <button type="button" className={ICON_BTN} aria-label={`เดือนก่อนหน้า (${formatMonthKeyTH(prev)})`} onClick={() => step(prev)}>
          <Icons.ChevronLeft size={16} />
        </button>
        <div className="flex min-w-0 flex-1 flex-col items-center gap-space-1 text-center">
          <p
            ref={labelRef}
            tabIndex={-1}
            aria-live="polite"
            aria-atomic="true"
            data-month={month}
            className="m-0 text-sm font-semibold text-primary outline-none"
          >
            {`รอบบิล ${formatMonthKeyTH(month)}`}
          </p>
          {month === payableCycle && <span className={BADGE}>ต้องชำระเดือนนี้</span>}
        </div>
        <button type="button" className={ICON_BTN} aria-label={`เดือนถัดไป (${formatMonthKeyTH(next)})`} onClick={() => step(next)}>
          <Icons.ChevronRight size={16} />
        </button>
      </div>
      {month !== payableCycle && (
        <button
          type="button"
          className={`${BTN_GHOST} self-center`}
          aria-label={`กลับไปรอบบิลที่ต้องชำระ (${formatMonthKeyTH(payableCycle)})`}
          onClick={() => {
            if (onReset) onReset();
            else onChange(payableCycle);
            // ปุ่มนี้จะหายไปหลังกด → ย้าย focus ไปที่ label เพื่อไม่ให้หลุดไป body
            labelRef.current?.focus();
          }}
        >
          รอบที่ต้องชำระ
        </button>
      )}
    </div>
  );
}
