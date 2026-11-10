/**
 * คอมโพเนนต์: LoanRateHistory — รายการประวัติการปรับอัตราดอกเบี้ยสินเชื่อ แบบอ่านอย่างเดียว (UX_SPEC loan-installments §6)
 *
 * แสดง rateRevisions ตามลำดับที่ server บันทึก (เก่า → ใหม่, server append ต่อท้ายเสมอ)
 * ไม่คำนวณตัวเลขเงินใดๆ — แค่แสดงค่าที่ server เก็บไว้
 */

import { formatMonthKeyTH, formatThaiDate, getCurrentDateInfo } from '../../shared/utils/dateUtils';

/** รูปแบบ record ที่ pages/api/credit-cards/rate-revisions.ts เขียนลง plan.rateRevisions */
export interface LoanRateRevisionRecord {
  id?: string;
  effectiveMonth?: string;
  fromInstallmentNo?: number;
  previousRate?: number;
  newRate?: number;
  revisedAt?: string;
}

interface LoanRateHistoryProps {
  revisions?: readonly LoanRateRevisionRecord[] | null;
  /** อัตราปัจจุบันของแผน — ใช้ในบรรทัดว่างเมื่อยังไม่เคยปรับ (เท่ากับอัตราตามสัญญา) */
  currentRate: number;
}

function formatRate(rate: unknown): string {
  const value = Number(rate);
  return Number.isFinite(value) ? `${value.toFixed(2)}%` : '-';
}

function formatRecordedDate(iso: unknown): string {
  if (typeof iso !== 'string' || !iso) return '-';
  const info = getCurrentDateInfo(iso);
  return info ? formatThaiDate(info) : '-';
}

export default function LoanRateHistory({ revisions, currentRate }: LoanRateHistoryProps) {
  const list = Array.isArray(revisions) ? revisions : [];

  if (list.length === 0) {
    return (
      <p className="m-0 text-sm text-secondary">
        {`ยังไม่เคยปรับ · อัตราตามสัญญา ${formatRate(currentRate)}`}
      </p>
    );
  }

  return (
    <ul className="m-0 flex list-none flex-col gap-space-3 p-0" aria-label="ประวัติอัตราดอกเบี้ย">
      {list.map((revision, index) => (
        <li key={revision.id ?? `${revision.effectiveMonth ?? ''}-${index}`} className="flex flex-col gap-space-1">
          <span className="text-sm text-primary">
            {`มีผล ${formatMonthKeyTH(revision.effectiveMonth ?? '')} (งวด ${revision.fromInstallmentNo ?? '-'}): `}
            <span className="tabular-nums">{`${formatRate(revision.previousRate)} → ${formatRate(revision.newRate)}`}</span>
          </span>
          <span className="text-xs text-tertiary">{`บันทึกเมื่อ ${formatRecordedDate(revision.revisedAt)}`}</span>
        </li>
      ))}
    </ul>
  );
}
