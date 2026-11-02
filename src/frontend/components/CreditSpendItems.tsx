/**
 * คอมโพเนนต์: CreditSpendItems — รายการไม่ผ่อน (non-installment) ของรอบบิลที่เลือก
 * หลัง redesign เป็น "รายการอย่างเดียว" (spec-credit-card-detail-redesign §5.7): แถว + เมนู ⋯ + ยืนยันลบ + ยอดรวม
 * ฟอร์มเพิ่ม/แก้ไขย้ายไป AddCardExpenseSheet; "แก้ไขรายการ" เรียก onEdit(item)
 * ยอดรวมมาจาก server (totals[cardId]) ไม่คำนวณฝั่ง client
 */

import { useEffect, useRef, useState } from 'react';
import { creditCardAPI, type CreditSpendItem } from '../../shared/utils/frontend/apiUtils';
import { formatCurrency } from '../../shared/utils/frontend/numberUtils';
import { formatMonthKeyTH } from '../../shared/utils/dateUtils';
import { formatIsoDateTH } from '../../shared/utils/creditCardUtils';
import { getTabbableElements } from '../../shared/utils/frontend/focusTrap';
import { showToast } from '../../shared/utils/frontend/toast';
import { Icons } from './Icons';
import LoadingSkeleton, { SkeletonBlock } from './LoadingSkeleton';
import RowActionMenu from './RowActionMenu';

const FOCUS_RING = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2';
const BUTTON = `min-h-11 rounded-sm border border-border-interactive bg-surface-2 px-space-3 text-sm text-primary disabled:opacity-60 ${FOCUS_RING}`;
const CARD = 'rounded-md border border-border-default bg-surface-1 p-space-4 shadow-elev-1 md:p-space-5';
const LINK_BUTTON = `min-h-11 self-start rounded-sm px-space-2 text-sm font-medium text-accent hover:underline ${FOCUS_RING}`;

/** มือถือแสดงแถวแรกเท่านี้ก่อนกด "แสดงทั้งหมด" (L-3) */
const MOBILE_VISIBLE_ROWS = 5;

export default function CreditSpendItems({
  cardId,
  month,
  refreshKey = 0,
  focusItemId = null,
  isMobileView = false,
  menuBottomInset = 0,
  onEdit,
  onAddSimple,
  onFocusHandled,
  onChanged
}: {
  cardId: string;
  month: string;
  /** เพิ่มค่านี้เพื่อ re-fetch รายการแบบ silent โดยไม่ remount (C-3) */
  refreshKey?: number;
  /** หลังโหลด ถ้ามีแถว id นี้ ให้ focus ปุ่ม ⋯ ของแถวนั้นหนึ่งครั้ง (I-34) */
  focusItemId?: string | null;
  isMobileView?: boolean;
  menuBottomInset?: number;
  onEdit: (item: CreditSpendItem) => void;
  /** ปุ่ม "+ เพิ่มรายจ่ายธรรมดา" ใน empty state */
  onAddSimple?: () => void;
  onFocusHandled?: () => void;
  onChanged: (month: string) => void | Promise<void>;
}) {
  const [items, setItems] = useState<CreditSpendItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [retryTick, setRetryTick] = useState(0);
  const [showAll, setShowAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [deleting, setDeleting] = useState<CreditSpendItem | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  /** index ของแถวที่เพิ่งลบ — ใช้เลือกปุ่มที่จะ focus ต่อ (I-32) */
  const afterDeleteIndexRef = useRef<number | null>(null);
  const focusedItemRef = useRef<string | null>(null);
  const itemsRef = useRef(items);
  itemsRef.current = items;

  const applyResponse = (response: { items: CreditSpendItem[]; totals: Record<string, number> }) => {
    setItems(response.items);
    setTotal(response.totals[cardId] ?? 0);
    setLoadError(false);
  };

  const reload = async () => {
    applyResponse(await creditCardAPI.listSpendItems(month, cardId));
  };

  // โหลดครั้งแรก = skeleton; refreshKey/retry ภายหลังเป็น silent ยกเว้น retry หลัง error (ไม่ unmount แถว/opener)
  useEffect(() => {
    let active = true;
    creditCardAPI.listSpendItems(month, cardId).then(response => {
      if (!active) return;
      applyResponse(response);
    }).catch(() => {
      if (active) {
        setLoadError(true);
        showToast('โหลดรายการไม่ผ่อนไม่สำเร็จ', 'error');
      }
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardId, month, refreshKey, retryTick]);

  useEffect(() => {
    if (!deleting) return undefined;
    const opener = document.activeElement;
    cancelRef.current?.focus();
    return () => { if (opener instanceof HTMLElement && opener.isConnected) opener.focus(); };
  }, [deleting]);

  const triggerFor = (id: string) => sectionRef.current?.querySelector<HTMLElement>(`[data-menu-trigger="${id}"]`) ?? null;

  // หลังลบ: แถวถัดไป → แถวก่อนหน้า → หัวข้อ section (I-32)
  useEffect(() => {
    const index = afterDeleteIndexRef.current;
    if (index === null) return;
    afterDeleteIndexRef.current = null;
    const target = items[index] ?? items[index - 1];
    (target ? triggerFor(target.id) : null)?.focus();
    if (!target) headingRef.current?.focus();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  useEffect(() => {
    if (!focusItemId || loading || focusedItemRef.current === focusItemId) return;
    if (!items.some(item => item.id === focusItemId)) return;
    focusedItemRef.current = focusItemId;
    setShowAll(true);
    // รอให้แถวที่อาจถูกซ่อนไว้ (มือถือ >5 แถว) render ก่อนค่อย focus
    requestAnimationFrame(() => { triggerFor(focusItemId)?.focus(); });
    onFocusHandled?.();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusItemId, items, loading]);

  const confirmDelete = async (target: CreditSpendItem) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      const index = itemsRef.current.findIndex(item => item.id === target.id);
      await creditCardAPI.deleteSpendItem(target.id);
      setDeleting(null);
      afterDeleteIndexRef.current = index;
      await reload();
      await onChanged(month);
      showToast('ลบรายการแล้ว');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'บันทึกรายการไม่สำเร็จ กรุณาโหลดข้อมูลใหม่', 'error');
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const collapsible = isMobileView && items.length > MOBILE_VISIBLE_ROWS;
  const visibleItems = collapsible && !showAll ? items.slice(0, MOBILE_VISIBLE_ROWS) : items;

  return <section ref={sectionRef} aria-labelledby="spend-items-title" className={`${CARD} flex flex-col gap-space-3`}>
    <h3 id="spend-items-title" ref={headingRef} tabIndex={-1} className="m-0 text-lg font-semibold text-primary outline-none">{`รายการไม่ผ่อน · ${formatMonthKeyTH(month)}`}</h3>
    {loading ? (
      <LoadingSkeleton label="กำลังโหลดรายการ..." className="flex flex-col gap-space-2">
        <SkeletonBlock className="h-14 w-full" />
        <SkeletonBlock className="h-14 w-full" />
        <SkeletonBlock className="h-14 w-full" />
      </LoadingSkeleton>
    ) : loadError ? (
      <div className="flex flex-col items-start gap-space-2">
        <p role="alert" className="m-0 text-sm text-neg">โหลดรายการไม่ผ่อนไม่สำเร็จ</p>
        <button type="button" className={BUTTON} onClick={() => { setLoading(true); setLoadError(false); setRetryTick(value => value + 1); }}>ลองใหม่</button>
      </div>
    ) : <>
      {items.length === 0 && (
        <div className="flex flex-col items-start gap-space-1">
          <p className="m-0 text-sm text-tertiary">ยังไม่มีรายการไม่ผ่อนในรอบบิลนี้</p>
          {onAddSimple && <button type="button" className={LINK_BUTTON} onClick={onAddSimple}>+ เพิ่มรายจ่ายธรรมดา</button>}
        </div>
      )}
      {items.length > 0 && (
        <ul className="m-0 flex list-none flex-col p-0">
          {visibleItems.map(item => <li key={item.id} className="flex min-h-14 items-center gap-space-2 border-b border-border-subtle py-space-2">
            <span className="flex min-w-0 grow flex-col break-words text-primary">
              {item.name}
              {item.purchaseDate && <span className="text-xs text-tertiary">{formatIsoDateTH(item.purchaseDate)}</span>}
            </span>
            <span className="whitespace-nowrap font-[family-name:var(--font-numeric)] tabular-nums text-primary">{formatCurrency(item.amount)} ฿</span>
            <RowActionMenu
              triggerLabel={`ตัวเลือกของรายการ ${item.name}`}
              triggerDataId={item.id}
              bottomInset={menuBottomInset}
              items={[
                { key: 'edit', label: 'แก้ไขรายการ', icon: <Icons.Edit size={16} />, onSelect: () => onEdit(item), disabled: busy },
                { key: 'delete', label: 'ลบรายการ', icon: <Icons.Trash size={16} />, danger: true, onSelect: () => setDeleting(item), disabled: busy }
              ]}
            />
          </li>)}
        </ul>
      )}
      {collapsible && (
        <button type="button" className={BUTTON} aria-expanded={showAll} onClick={() => setShowAll(value => !value)}>
          {showAll ? 'แสดงน้อยลง' : `แสดงทั้งหมด (${items.length} รายการ)`}
        </button>
      )}
      <p className="m-0 text-sm font-semibold text-primary">รวมรายการไม่ผ่อน {formatCurrency(total)} ฿</p>
    </>}
    {deleting && <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 p-space-4">
      <div ref={dialogRef} role="alertdialog" aria-modal="true" aria-label="ยืนยันลบรายการไม่ผ่อน" className="w-full max-w-sm rounded-md bg-surface-3 p-space-5" onKeyDown={event => {
        if (event.key === 'Escape' && !busyRef.current) { event.stopPropagation(); setDeleting(null); }
        if (event.key === 'Tab' && dialogRef.current) {
          const elements = getTabbableElements(dialogRef.current);
          const first = elements[0], last = elements[elements.length - 1];
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        }
      }}>
        <p className="mb-space-4 text-primary">ลบรายการ {deleting.name}?</p>
        <div className="flex gap-space-3">
          <button ref={cancelRef} className={BUTTON} type="button" disabled={busy} aria-label="ยกเลิกการลบ" onClick={() => setDeleting(null)}>ยกเลิก</button>
          <button className={BUTTON} type="button" disabled={busy} onClick={() => void confirmDelete(deleting)}>ยืนยันลบ</button>
        </div>
      </div>
    </div>}
  </section>;
}
