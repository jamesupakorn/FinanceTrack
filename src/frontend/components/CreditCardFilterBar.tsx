/**
 * คอมโพเนนต์: CreditCardFilterBar — chip กรองบัตรตามธนาคาร (spec-credit-card-tiles §5.1)
 * - role="group" + ปุ่ม toggle aria-pressed; ไม่เลือกเลย = ทั้งหมด
 * - สถานะเลือกเห็นได้มากกว่าสี: พื้นทึบ + เครื่องหมายถูก + เส้นขอบหนา
 * - มือถือเลื่อนแนวนอน (flex-nowrap overflow-x-auto), >= 768px (md:) ตัดบรรทัด
 * - live region (polite) render เป็น node คงที่เสมอ; ข้อความถูกตั้งเฉพาะเมื่อผู้ใช้เปลี่ยนตัวกรอง (ไม่ประกาศตอน mount)
 */

import { BANK_ISSUERS, type BankIssuerKey } from '../../shared/utils/creditCardBankCatalog';
import { Icons } from './Icons';
import BankIssuerMark from './BankIssuerMark';
import { FOCUS_RING } from './CreditCardDashboard';

export interface CreditCardFilterBarProps {
  counts: Array<{ key: BankIssuerKey; count: number }>;
  total: number;
  selected: readonly BankIssuerKey[];
  onToggle: (key: BankIssuerKey) => void;
  onClear: () => void;
  /** ข้อความประกาศ เช่น "แสดง X จาก N บัตร" — ว่างตอน mount */
  announcement?: string;
}

// ประกอบใน render (ไม่ใช่ระดับ module) เพราะ FOCUS_RING มาจาก CreditCardDashboard ซึ่ง import ไฟล์นี้กลับ (วงจร import)
const chipBase = () => `inline-flex min-h-11 min-w-11 shrink-0 items-center gap-space-2 whitespace-nowrap rounded-full px-space-3 text-sm transition-colors duration-fast ease-graphite motion-reduce:transition-none ${FOCUS_RING}`;
const CHIP_OFF = 'border border-border-default bg-surface-2 font-normal text-secondary hover:bg-surface-3';
const CHIP_ON = 'border-2 border-accent bg-accent font-semibold text-on-accent';

export default function CreditCardFilterBar({ counts, total, selected, onToggle, onClear, announcement = '' }: CreditCardFilterBarProps) {
  const allPressed = selected.length === 0;
  return (
    <div className="flex flex-col gap-space-2">
      <div
        role="group"
        aria-label="กรองตามธนาคาร"
        className="-mx-space-1 flex flex-nowrap gap-space-2 overflow-x-auto px-space-1 pb-space-1 md:flex-wrap md:overflow-visible"
      >
        <button
          type="button"
          aria-pressed={allPressed}
          className={`${chipBase()} ${allPressed ? CHIP_ON : CHIP_OFF}`}
          onClick={onClear}
        >
          {allPressed && <Icons.Check size={14} />}
          {`ทั้งหมด (${total})`}
        </button>
        {counts.map(({ key, count }) => {
          const pressed = selected.includes(key);
          const issuer = BANK_ISSUERS[key];
          return (
            <button
              key={key}
              type="button"
              aria-pressed={pressed}
              data-issuer={key}
              className={`${chipBase()} ${pressed ? CHIP_ON : CHIP_OFF}`}
              onClick={() => onToggle(key)}
            >
              {pressed && <Icons.Check size={14} />}
              <BankIssuerMark card={{ bankIssuer: key, color: issuer.color }} size={20} decorative />
              {`${issuer.label} (${count})`}
            </button>
          );
        })}
      </div>
      <p aria-live="polite" className="sr-only" data-testid="cc-filter-live">{announcement}</p>
    </div>
  );
}
