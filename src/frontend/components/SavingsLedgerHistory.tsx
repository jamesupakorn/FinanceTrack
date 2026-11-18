/**
 * คอมโพเนนต์: SavingsLedgerHistory — ประวัติเงินยืม/ถอนของ SavingsLedgerPanel
 * (UX_SPEC-savings-loan-withdrawal.md §6)
 *
 * §6.1 "เงินยืมที่ยังไม่คืน (N)": เปิดไว้เสมอเมื่อ N > 0, ไม่มี cap (user-confirmed 2026-11-18 — ไม่ตาม
 * UX_SPEC เดิมที่เสนอ cap นี้ด้วย เพราะผู้ใช้ยืนยันว่าให้ขยายครบทุกรายการ). §6.2 "ประวัติการยืม/ถอน (N)":
 * ปิดไว้ก่อน, 5 แถวแรก + "แสดงทั้งหมด (N รายการ)" ตาม CreditSpendItems.tsx. "⋯ → ลบ (บันทึกผิด)" ใช้
 * RowActionMenu เดิม (C-S4-7) + แถบยืนยันแบบเดียวกับ SavingsGoalTracker.tsx — เปิดได้ทีละแถบเดียว (C-S4-8).
 *
 * โฟกัสของแถบยืนยันลบตาม UX_SPEC §6.4 (รูปแบบเดียวกับ CreditSpendItems.tsx's cancelRef/afterDeleteIndexRef):
 * เปิด → โฟกัส "ยกเลิก"; Escape/ยกเลิก → คืนโฟกัสให้ ⋯ ของแถวนั้น ([data-menu-trigger="<id>"]); ลบสำเร็จ →
 * โฟกัส ⋯ ของแถวถัดไป มิฉะนั้นแถวก่อนหน้า มิฉะนั้นปุ่ม "ยืมเงิน"/"ถอนเงินออม" ของแผง (F-S4-4).
 */

import { useEffect, useRef, useState } from 'react';
import { savingsLedgerAPI } from '../../shared/utils/frontend/apiUtils';
import { formatCurrency } from '../../shared/utils/frontend/numberUtils';
import { formatMonthKeyTH, formatThaiDate, getCurrentDateInfo } from '../../shared/utils/dateUtils';
import { showToast } from '../../shared/utils/frontend/toast';
import {
  formatLoanAge,
  formatSourceLabel,
  type SavingsLoanWithBalance,
  type SavingsWithdrawal,
} from '../../shared/utils/savingsLedger';
import RowActionMenu from './RowActionMenu';

const FOCUS_RING = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2';
const BUTTON = `min-h-11 rounded-sm border border-border-interactive bg-surface-2 px-space-3 text-sm text-primary disabled:opacity-60 ${FOCUS_RING}`;
const MOBILE_VISIBLE_ROWS = 5;

type ConfirmTarget = { kind: 'loan' | 'withdrawal'; id: string; amount: number } | null;

type HistoryRow =
  | { kind: 'loan'; sortKey: string; loan: SavingsLoanWithBalance }
  | { kind: 'withdrawal'; sortKey: string; withdrawal: SavingsWithdrawal };

/** "15 ม.ค. 2567" หรือ '-' เมื่อ parse ไม่ได้ (UX_SPEC §2 "Dates"). */
function formatDateTH(iso: string | null | undefined): string {
  const info = iso ? getCurrentDateInfo(iso) : null;
  return info ? formatThaiDate(info) : '-';
}

export interface SavingsLedgerHistoryProps {
  loans: readonly SavingsLoanWithBalance[];
  withdrawals: readonly SavingsWithdrawal[];
  goalNameById: ReadonlyMap<string, string>;
  /** เรียกหลังลบสำเร็จ — ให้แผงรีเฟรชยอด/รายการ */
  onChanged: () => Promise<void> | void;
  /** โฟกัสปุ่ม "ยืมเงิน" ของแผง — fallback สุดท้ายเมื่อลบแถวยืมแถวสุดท้ายในลิสต์ที่ยังไม่คืน (§6.4) */
  focusLoanButton: () => void;
  /** โฟกัสปุ่ม "ถอนเงินออม" ของแผง — fallback สุดท้ายเมื่อลบแถวถอนแถวสุดท้ายในลิสต์ประวัติ (§6.4) */
  focusWithdrawalButton: () => void;
}

export default function SavingsLedgerHistory({ loans, withdrawals, goalNameById, onChanged, focusLoanButton, focusWithdrawalButton }: SavingsLedgerHistoryProps) {
  const [showAllHistory, setShowAllHistory] = useState(false);
  const [confirming, setConfirming] = useState<ConfirmTarget>(null);
  const [busy, setBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const sectionRef = useRef<HTMLDivElement | null>(null);
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  /** index ของแถวที่เพิ่งลบ ในลิสต์ที่มันอยู่ — ใช้เลือก ⋯ ที่จะโฟกัสต่อหลังรีเฟรช (§6.4) */
  const afterDeleteRef = useRef<{ listKind: 'open' | 'history'; index: number } | null>(null);

  const openLoans = loans
    .filter(loan => loan.status === 'open')
    .slice()
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0)); // oldest first

  const closedLoans = loans.filter(loan => loan.status === 'closed');

  const historyRows: HistoryRow[] = [
    ...closedLoans.map(loan => ({ kind: 'loan' as const, sortKey: loan.closedAt || loan.createdAt, loan })),
    ...withdrawals.map(withdrawal => ({ kind: 'withdrawal' as const, sortKey: withdrawal.createdAt, withdrawal })),
  ].sort((a, b) => (a.sortKey > b.sortKey ? -1 : a.sortKey < b.sortKey ? 1 : 0)); // newest first

  const collapsible = historyRows.length > MOBILE_VISIBLE_ROWS;
  const visibleHistoryRows = collapsible && !showAllHistory ? historyRows.slice(0, MOBILE_VISIBLE_ROWS) : historyRows;

  const sourceLabel = (source: SavingsLoanWithBalance['source']) => formatSourceLabel(source, goalNameById);

  /** หา ⋯ ของ id นี้ภายในแผง — ใช้คืนโฟกัสหลังปิดแถบยืนยัน/ลบสำเร็จ (§6.4) */
  const triggerFor = (id: string) => sectionRef.current?.querySelector<HTMLElement>(`[data-menu-trigger="${id}"]`) ?? null;

  /**
   * หา ⋯ ที่ "มีจริง" ใกล้ index มากที่สุด (F-S4-6): แถวที่ไม่มีเมนู (เช่น เงินยืมที่มีการคืนเงินแล้ว
   * ในลิสต์ที่ยังไม่คืน, หรือเงินยืมที่คืนครบแล้วในลิสต์ประวัติ) ไม่มี ⋯ ให้โฟกัส — ไล่หาแถวถัดไปก่อน
   * (ตาม index ใหม่หลังรีเฟรช) แล้วไล่ถอยหลัง ใช้ triggerFor เช็คว่า ⋯ นั้นมีอยู่จริงใน DOM ไม่ใช่แค่ว่าแถวมีอยู่
   */
  const nearestTrigger = (ids: readonly string[], index: number): HTMLElement | null => {
    for (let i = index; i < ids.length; i++) {
      const el = triggerFor(ids[i]);
      if (el) return el;
    }
    for (let i = index - 1; i >= 0; i--) {
      const el = triggerFor(ids[i]);
      if (el) return el;
    }
    return null;
  };

  /** ปิดแถบยืนยัน (ยกเลิก/Escape) แล้วคืนโฟกัสให้ ⋯ ของแถวนั้น */
  const closeConfirm = (target: NonNullable<ConfirmTarget>) => {
    setConfirming(null);
    setDeleteError(null);
    triggerFor(target.id)?.focus();
  };

  // เปิดแถบยืนยัน → โฟกัส "ยกเลิก" (§6.4 "Focus: on open → ยกเลิก")
  useEffect(() => {
    if (confirming) cancelRef.current?.focus();
  }, [confirming]);

  // ลบสำเร็จ (หรือ not-found, F-S4-7): ⋯ ของแถวถัดไปที่มีจริง → แถวก่อนหน้าที่มีจริง → ปุ่มของแผง (§6.4, F-S4-6)
  useEffect(() => {
    const pending = afterDeleteRef.current;
    if (!pending) return;
    afterDeleteRef.current = null;
    if (pending.listKind === 'open') {
      const target = nearestTrigger(openLoans.map(loan => loan._id), pending.index);
      if (target) target.focus();
      else focusLoanButton();
      return;
    }
    const target = nearestTrigger(visibleHistoryRows.map(row => (row.kind === 'loan' ? row.loan._id : row.withdrawal._id)), pending.index);
    if (target) target.focus();
    else focusWithdrawalButton();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loans, withdrawals]);

  const confirmDelete = async (target: NonNullable<ConfirmTarget>) => {
    if (busy) return;
    setBusy(true);
    setDeleteError(null);
    // บันทึก index ของแถวที่กำลังจะลบ ในลิสต์ที่มันอยู่ตอนนี้ (ก่อนรีเฟรช) ไว้เลือกแถวที่จะโฟกัสต่อ (§6.4)
    const pendingTarget: { listKind: 'open' | 'history'; index: number } = target.kind === 'loan'
      ? { listKind: 'open', index: openLoans.findIndex(loan => loan._id === target.id) }
      : { listKind: 'history', index: visibleHistoryRows.findIndex(row => row.kind === 'withdrawal' && row.withdrawal._id === target.id) };
    try {
      if (target.kind === 'loan') await savingsLedgerAPI.deleteLoan(target.id);
      else await savingsLedgerAPI.deleteWithdrawal(target.id);
      setConfirming(null);
      afterDeleteRef.current = pendingTarget;
      await onChanged();
      showToast('ลบรายการแล้ว');
    } catch (error) {
      const code = (error as Error & { code?: string })?.code;
      if (code === 'loan_has_repayments') setDeleteError('รายการนี้มีการคืนเงินแล้ว ลบไม่ได้');
      else if (code === 'loan_not_found' || code === 'withdrawal_not_found') {
        // "ไม่พบรายการแล้ว" ถือเหมือนลบสำเร็จสำหรับโฟกัส/แถบยืนยัน (F-S4-7): รีเฟรชจะทำให้แถวนี้หายไป
        // ปิดแถบยืนยันก่อนแถวหาย แล้วแจ้งด้วย toast เพราะ alert ในแถบจะหายไปพร้อมแถว
        setConfirming(null);
        afterDeleteRef.current = pendingTarget;
        await onChanged();
        showToast('ไม่พบรายการนี้แล้ว', 'error');
      } else setDeleteError('ลบไม่สำเร็จ ลองอีกครั้ง');
    } finally {
      setBusy(false);
    }
  };

  const repaymentList = (loan: SavingsLoanWithBalance) => (
    loan.repayments.length > 0 && (
      <details className="mt-space-2">
        <summary className={`cursor-pointer select-none text-xs text-tertiary marker:content-none [&::-webkit-details-marker]:hidden ${FOCUS_RING}`}>
          ▶ การคืนเงิน ({loan.repayments.length})
        </summary>
        <ul className="m-0 mt-space-1 flex list-none flex-col gap-space-1 p-0 pl-space-3 text-xs text-tertiary">
          {loan.repayments.map(repayment => (
            <li key={repayment._id}>
              {`คืน ${formatCurrency(repayment.amount)} ฿ · ${formatMonthKeyTH(repayment.expenseMonth)} · เหลือ ${formatCurrency(repayment.balanceAfter)} ฿`}
            </li>
          ))}
        </ul>
      </details>
    )
  );

  const confirmStrip = (target: NonNullable<ConfirmTarget>) => (
    <div
      className="mt-space-2 flex flex-wrap items-center gap-space-2 rounded-sm border border-neg/25 bg-neg/10 p-space-3"
      onKeyDown={event => {
        // Escape ปิดแถบเหมือนกด "ยกเลิก" — คืนโฟกัสให้ ⋯ ของแถวนั้น (§6.4)
        if (event.key === 'Escape') { event.stopPropagation(); closeConfirm(target); }
      }}
    >
      <span className="min-w-0 flex-1 text-sm text-secondary">
        {`ลบรายการ${target.kind === 'loan' ? 'ยืม' : 'ถอน'} ${formatCurrency(target.amount)} ฿ นี้? ใช้เมื่อบันทึกผิดเท่านั้น`}
      </span>
      <button className={`min-h-11 shrink-0 rounded-sm border border-neg px-space-4 text-sm font-semibold text-neg ${FOCUS_RING}`} type="button" disabled={busy} onClick={() => void confirmDelete(target)}>ยืนยัน</button>
      <button ref={cancelRef} className={`min-h-11 shrink-0 rounded-sm border border-border-interactive px-space-3 text-sm text-secondary ${FOCUS_RING}`} type="button" disabled={busy} onClick={() => closeConfirm(target)}>ยกเลิก</button>
      {deleteError && <p role="alert" className="m-0 w-full text-sm text-neg">{deleteError}</p>}
    </div>
  );

  return (
    <div ref={sectionRef} className="flex flex-col gap-space-3">
      {openLoans.length > 0 && (
        <details open>
          <summary className={`cursor-pointer select-none py-space-2 text-sm font-medium text-primary marker:content-none [&::-webkit-details-marker]:hidden ${FOCUS_RING}`}>
            {`▼ เงินยืมที่ยังไม่คืน (${openLoans.length})`}
          </summary>
          <ul className="m-0 mt-space-2 flex list-none flex-col gap-space-3 p-0">
            {openLoans.map(loan => (
              <li key={loan._id} className="rounded-sm border border-border-subtle bg-surface-2 p-space-3">
                <div className="flex items-start justify-between gap-space-2">
                  <span className="text-sm font-medium text-primary">{`ยืมจาก${sourceLabel(loan.source)}`}</span>
                  <span className="flex items-center gap-space-2">
                    <span className="font-semibold tabular-nums text-primary">{`ค้าง ${formatCurrency(loan.outstandingAmount)} ฿`}</span>
                    {loan.repayments.length === 0 && (
                      <RowActionMenu
                        triggerLabel={`ตัวเลือกของรายการยืม ${formatCurrency(loan.principalAmount)} บาท`}
                        triggerDataId={loan._id}
                        items={[{ key: 'delete', label: 'ลบ (บันทึกผิด)', danger: true, disabled: busy, onSelect: () => { setConfirming({ kind: 'loan', id: loan._id, amount: loan.principalAmount }); setDeleteError(null); } }]}
                      />
                    )}
                  </span>
                </div>
                <p className="m-0 mt-space-1 text-xs text-tertiary">
                  {`ยืม ${formatCurrency(loan.principalAmount)} ฿ · ${formatDateTH(loan.createdAt)}${formatLoanAge(loan.createdAt, Date.now()) ? ` · ${formatLoanAge(loan.createdAt, Date.now())}` : ''}`}
                </p>
                {loan.note && <p className="m-0 mt-space-1 text-xs text-secondary">{loan.note}</p>}
                {confirming?.kind === 'loan' && confirming.id === loan._id && confirmStrip(confirming)}
                {repaymentList(loan)}
              </li>
            ))}
          </ul>
        </details>
      )}

      {historyRows.length > 0 && (
        <details>
          <summary className={`cursor-pointer select-none py-space-2 text-sm font-medium text-secondary marker:content-none [&::-webkit-details-marker]:hidden ${FOCUS_RING}`}>
            {`▶ ประวัติการยืม/ถอน (${historyRows.length})`}
          </summary>
          <ul className="m-0 mt-space-2 flex list-none flex-col gap-space-3 p-0">
            {visibleHistoryRows.map(row => {
              if (row.kind === 'loan') {
                const loan = row.loan;
                return (
                  <li key={`loan-${loan._id}`} className="rounded-sm border border-border-subtle bg-surface-2 p-space-3">
                    <div className="flex items-start justify-between gap-space-2">
                      <span className="text-sm font-medium text-primary">{`ยืมจาก${sourceLabel(loan.source)} · คืนครบแล้ว ✓`}</span>
                    </div>
                    <p className="m-0 mt-space-1 text-xs text-tertiary">
                      {`ยืม ${formatCurrency(loan.principalAmount)} ฿ · ${formatDateTH(loan.createdAt)} – ${formatDateTH(loan.closedAt)}`}
                    </p>
                    {loan.note && <p className="m-0 mt-space-1 text-xs text-secondary">{loan.note}</p>}
                    {repaymentList(loan)}
                  </li>
                );
              }
              const withdrawal = row.withdrawal;
              return (
                <li key={`withdrawal-${withdrawal._id}`} className="rounded-sm border border-border-subtle bg-surface-2 p-space-3">
                  <div className="flex items-start justify-between gap-space-2">
                    <span className="text-sm font-medium text-primary">{`ถอนจาก${sourceLabel(withdrawal.source)}`}</span>
                    <span className="flex items-center gap-space-2">
                      <span className="font-semibold tabular-nums text-neg"><span className="sr-only">ถอน </span>{`−${formatCurrency(withdrawal.amount)} ฿`}</span>
                      <RowActionMenu
                        triggerLabel={`ตัวเลือกของรายการถอน ${formatCurrency(withdrawal.amount)} บาท`}
                        triggerDataId={withdrawal._id}
                        items={[{ key: 'delete', label: 'ลบ (บันทึกผิด)', danger: true, disabled: busy, onSelect: () => { setConfirming({ kind: 'withdrawal', id: withdrawal._id, amount: withdrawal.amount }); setDeleteError(null); } }]}
                      />
                    </span>
                  </div>
                  <p className="m-0 mt-space-1 text-xs text-tertiary">{formatDateTH(withdrawal.createdAt)}</p>
                  {withdrawal.note && <p className="m-0 mt-space-1 text-xs text-secondary">{withdrawal.note}</p>}
                  {confirming?.kind === 'withdrawal' && confirming.id === withdrawal._id && confirmStrip(confirming)}
                </li>
              );
            })}
          </ul>
          {collapsible && (
            <button type="button" className={`${BUTTON} mt-space-2`} aria-expanded={showAllHistory} onClick={() => setShowAllHistory(value => !value)}>
              {showAllHistory ? 'แสดงน้อยลง' : `แสดงทั้งหมด (${historyRows.length} รายการ)`}
            </button>
          )}
        </details>
      )}
    </div>
  );
}
