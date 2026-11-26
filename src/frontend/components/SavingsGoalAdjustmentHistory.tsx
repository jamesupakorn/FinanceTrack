/**
 * คอมโพเนนต์: SavingsGoalAdjustmentHistory — ประวัติการปรับยอดของเป้าหมายเงินออม (อ่าน+แก้ไข/ลบ)
 * (spec-savings-goal-adjustments §4.5, UX_SPEC §5, task-context-savings-goal-adjustments-s3 item 3)
 *
 * แถวลอกแบบ CreditSpendItems.tsx:174-189 (shape) / ลำดับใหม่→เก่า (ตรงข้าม LoanRateHistory ตั้งใจ, UX_SPEC §5.3)
 * ยืนยันลบ = inline strip เหมือนของลบเป้าหมายใน SavingsGoalTracker.tsx — การเปิด/ปิดเป็น state เดียวกันของ
 * tracker (S3-C-1, deleteConfirm tagged union) จึงรับ `deletingId` เป็น prop แทนการมี state ของตัวเอง
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { SavingsGoalAdjustment } from '../../shared/utils/savingsGoalAdjustments';
import { formatCurrency } from '../../shared/utils/frontend/numberUtils';
import { formatThaiDate, getCurrentDateInfo } from '../../shared/utils/dateUtils';
import RowActionMenu from './RowActionMenu';
import { Icons } from './Icons';

const FOCUS_RING = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2';
const BUTTON = `min-h-11 rounded-sm border border-border-interactive bg-surface-2 px-space-3 text-sm text-primary disabled:opacity-60 ${FOCUS_RING}`;
const MINUS_SIGN = '−';

/** โชว์ 5 แถวแรกก่อน แล้วค่อยกด "แสดงทั้งหมด" — เกณฑ์เดียวกับ CreditSpendItems.tsx:25 แต่ใช้ทุก tier (UX_SPEC §5.3) */
const VISIBLE_ROWS = 5;

function formatRecordedDate(iso: string): string {
  const info = getCurrentDateInfo(iso);
  return info ? formatThaiDate(info) : '-';
}

function formatSigned(value: number): string {
  if (value === 0) return `±${formatCurrency(0)}`;
  return `${value > 0 ? '+' : MINUS_SIGN}${formatCurrency(Math.abs(value))}`;
}

interface SavingsGoalAdjustmentHistoryProps {
  goalName: string;
  adjustments: readonly SavingsGoalAdjustment[];
  /** true ขณะมี action ปรับยอดอื่นกำลังทำงาน (เช่น dialog กำลังบันทึก) — ปิดเมนูของทุกแถวไว้ก่อน */
  disableActions?: boolean;
  /** id ของรายการที่ strip ยืนยันลบกำลังเปิดอยู่ (null = ไม่มี) — คุมจาก tracker (S3-C-1) */
  deletingId: string | null;
  onEdit: (adjustment: SavingsGoalAdjustment) => void;
  onRequestDelete: (adjustmentId: string) => void;
  onCancelDelete: () => void;
  onConfirmDelete: (adjustment: SavingsGoalAdjustment) => Promise<void>;
  /** ลบแล้วลิสต์กลายเป็นว่าง — โฟกัสไปปุ่ม "ปรับยอด" ของการ์ด (UX_SPEC §5.4) */
  onEmptyFocusFallback: () => void;
}

export default function SavingsGoalAdjustmentHistory({
  goalName,
  adjustments,
  disableActions = false,
  deletingId,
  onEdit,
  onRequestDelete,
  onCancelDelete,
  onConfirmDelete,
  onEmptyFocusFallback
}: SavingsGoalAdjustmentHistoryProps) {
  const [open, setOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const listRef = useRef<HTMLUListElement | null>(null);
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const confirmRef = useRef<HTMLButtonElement | null>(null);
  const afterDeleteIndexRef = useRef<number | null>(null);

  // ใหม่→เก่า: createdAt descending, index เดิมเป็น tiebreak (UX_SPEC §5.3)
  const sortedList = useMemo(() => {
    return adjustments
      .map((adjustment, index) => ({ adjustment, index }))
      .sort((a, b) => {
        if (a.adjustment.createdAt !== b.adjustment.createdAt) {
          return a.adjustment.createdAt > b.adjustment.createdAt ? -1 : 1;
        }
        return b.index - a.index;
      })
      .map(entry => entry.adjustment);
  }, [adjustments]);

  const collapsible = sortedList.length > VISIBLE_ROWS;
  const visibleList = collapsible && !showAll ? sortedList.slice(0, VISIBLE_ROWS) : sortedList;

  const triggerFor = (id: string) => listRef.current?.querySelector<HTMLElement>(`[data-menu-trigger="${id}"]`) ?? null;

  useEffect(() => {
    if (!deletingId) return undefined;
    cancelRef.current?.focus();
    return undefined;
  }, [deletingId]);

  // หลังลบสำเร็จ: แถวถัดไป → แถวก่อนหน้า → ปุ่ม "ปรับยอด" ของการ์ด (เหมือน CreditSpendItems.tsx:107-116)
  useEffect(() => {
    const index = afterDeleteIndexRef.current;
    if (index === null) return;
    afterDeleteIndexRef.current = null;
    const target = sortedList[index] ?? sortedList[index - 1];
    if (target) {
      triggerFor(target._id)?.focus();
    } else {
      onEmptyFocusFallback();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortedList]);

  const handleCancelDelete = (id: string) => {
    onCancelDelete();
    requestAnimationFrame(() => triggerFor(id)?.focus());
  };

  const handleConfirmDelete = async (adjustment: SavingsGoalAdjustment, index: number) => {
    if (deleteBusy) return;
    setDeleteBusy(true);
    afterDeleteIndexRef.current = index;
    try {
      await onConfirmDelete(adjustment);
    } catch {
      // ลบไม่สำเร็จ (F-S3-2): onConfirmDelete ปฏิเสธเฉพาะกรณี error ที่ไม่ใช่ stale data — strip
      // ยังเปิดอยู่ (tracker ไม่ได้ปิดให้) ต้อง clear index ทิ้ง ไม่ให้ refetch ครั้งต่อไป (ที่ไม่เกี่ยวกับ
      // การลบนี้) พาโฟกัสไปแถวผิดแทน แล้วคืนโฟกัสที่ "ยืนยัน" ของ strip ที่ยังเปิดอยู่
      afterDeleteIndexRef.current = null;
      requestAnimationFrame(() => confirmRef.current?.focus());
    } finally {
      setDeleteBusy(false);
    }
  };

  if (sortedList.length === 0) return null;

  return (
    <details
      className="mt-space-2"
      open={open}
      onToggle={event => setOpen(event.currentTarget.open)}
    >
      <summary className={`flex min-h-11 cursor-pointer select-none items-center gap-space-2 text-sm font-medium text-secondary marker:content-none [&::-webkit-details-marker]:hidden ${FOCUS_RING}`}>
        {open ? '▼' : '▶'} ประวัติการปรับยอด ({sortedList.length})
      </summary>
      <ul ref={listRef} aria-label={`ประวัติการปรับยอด ${goalName}`} className="m-0 flex list-none flex-col p-0">
        {visibleList.map(adjustment => {
          const storedIndex = sortedList.findIndex(entry => entry._id === adjustment._id);
          const edited = adjustment.updatedAt !== adjustment.createdAt;
          const isDeleting = deletingId === adjustment._id;
          return (
            <li key={adjustment._id} className="flex flex-col">
              <div className="flex min-h-14 items-center gap-space-2 border-b border-border-subtle py-space-2">
                <span className="flex min-w-0 grow flex-col break-words">
                  <span className="text-sm text-primary">{adjustment.note}</span>
                  <span className="text-xs text-tertiary">
                    {formatRecordedDate(adjustment.createdAt)}
                    {edited ? ' · แก้ไขแล้ว' : ''}
                  </span>
                </span>
                <span className={`whitespace-nowrap font-[family-name:var(--font-numeric)] tabular-nums font-semibold ${adjustment.amount >= 0 ? 'text-pos' : 'text-neg'}`}>
                  <span className="sr-only">{adjustment.amount >= 0 ? 'เพิ่มยอด ' : 'ลดยอด '}</span>
                  {`${formatSigned(adjustment.amount)} ฿`}
                </span>
                <RowActionMenu
                  triggerLabel={`ตัวเลือกของการปรับยอด ${adjustment.note}`}
                  triggerDataId={adjustment._id}
                  items={[
                    {
                      key: 'edit',
                      label: 'แก้ไข',
                      icon: <Icons.Edit size={16} />,
                      onSelect: () => onEdit(adjustment),
                      disabled: disableActions,
                      disabledReason: disableActions ? 'กำลังบันทึก...' : undefined
                    },
                    {
                      key: 'delete',
                      label: 'ลบ',
                      icon: <Icons.Trash size={16} />,
                      danger: true,
                      onSelect: () => onRequestDelete(adjustment._id),
                      disabled: disableActions,
                      disabledReason: disableActions ? 'กำลังบันทึก...' : undefined
                    }
                  ]}
                />
              </div>
              {isDeleting && (
                <div
                  className="mb-space-2 flex flex-wrap items-center gap-space-2 rounded-sm border border-neg/25 bg-neg/10 p-space-3"
                  onKeyDown={event => {
                    if (event.key === 'Escape') {
                      event.stopPropagation();
                      handleCancelDelete(adjustment._id);
                    }
                  }}
                >
                  <span className="min-w-0 flex-1 text-sm text-secondary">{`ลบการปรับยอด ${formatSigned(adjustment.amount)} ฿ ใช่หรือไม่?`}</span>
                  <button
                    ref={confirmRef}
                    className={`min-h-11 shrink-0 rounded-sm border border-neg px-space-4 text-sm font-semibold text-neg ${FOCUS_RING}`}
                    type="button"
                    disabled={deleteBusy}
                    onClick={() => void handleConfirmDelete(adjustment, storedIndex)}
                  >
                    ยืนยัน
                  </button>
                  <button
                    ref={cancelRef}
                    className={`min-h-11 shrink-0 rounded-sm border border-border-interactive px-space-3 text-sm text-secondary ${FOCUS_RING}`}
                    type="button"
                    disabled={deleteBusy}
                    onClick={() => handleCancelDelete(adjustment._id)}
                  >
                    ยกเลิก
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {collapsible && (
        <button type="button" className={BUTTON} aria-expanded={showAll} onClick={() => setShowAll(value => !value)}>
          {showAll ? 'แสดงน้อยลง' : `แสดงทั้งหมด (${sortedList.length} รายการ)`}
        </button>
      )}
    </details>
  );
}
