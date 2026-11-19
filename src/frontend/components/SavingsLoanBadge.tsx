/**
 * SavingsLoanBadge — ป้ายแจ้งยอดเงินยืมออมที่ยังค้างอยู่บนหน้า Dashboard (UX_SPEC-savings-loan-withdrawal.md §9)
 *
 * แสดงเฉพาะเมื่อ summary.totalOutstanding > 0 — ตัวเลขมาจาก savingsLedgerAPI.getLoans()'s summary
 * (computeLedgerSummary, S1) ไม่คำนวณซ้ำฝั่ง client (ARCHITECTURE constraint 19). ไม่ใช่พื้นผิววันครบกำหนด
 * (BR-DASH-011/012, R-SLW-11) — จึงไม่ผ่าน buildMonthEvents/collectUpcomingPayments/notification bell
 * และไม่มี toast/modal ของตัวเอง — ลิงก์ <a> เพียงจุดเดียวคือ integration surface ทั้งหมด.
 */
import { formatCurrency } from '../../shared/utils/frontend/numberUtils';

const FOCUS_RING = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2';

interface SavingsLoanBadgeProps {
  totalOutstanding: number;
  openLoanCount: number;
}

export default function SavingsLoanBadge({ totalOutstanding, openLoanCount }: SavingsLoanBadgeProps) {
  if (!(totalOutstanding > 0)) return null;
  const amountLabel = formatCurrency(totalOutstanding);
  return (
    <a
      href="/workspace/savings#savings-ledger"
      aria-label={`ยืมเงินออมค้างอยู่ ${amountLabel} บาท ${openLoanCount} รายการ ดูรายละเอียด`}
      className={`mb-space-4 flex min-h-11 flex-wrap items-center justify-between gap-space-2 rounded-md border border-border-default bg-surface-1 p-space-4 no-underline ${FOCUS_RING}`}
    >
      <span className="text-sm text-primary">
        ยืมเงินออมค้างอยู่{' '}
        <strong className="font-semibold tabular-nums text-warn">{amountLabel} ฿</strong>
      </span>
      <span className="text-sm text-accent">{`${openLoanCount} รายการ · ดูรายละเอียด →`}</span>
    </a>
  );
}
