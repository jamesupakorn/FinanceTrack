import { useEffect, useRef, useState } from 'react';
import { creditCardAPI, type CreditSpendItem } from '../../shared/utils/frontend/apiUtils';
import { formatCurrency } from '../../shared/utils/frontend/numberUtils';
import { formatMonthKeyTH, getCurrentDateInfo } from '../../shared/utils/dateUtils';
import { computeStartMonthFromPurchase, formatIsoDateTH, isValidPurchaseDate, resolveCardDueDate } from '../../shared/utils/creditCardUtils';
import { getTabbableElements } from '../../shared/utils/frontend/focusTrap';
import { showToast } from '../../shared/utils/frontend/toast';

const BUTTON = 'min-h-11 rounded-sm border border-border-interactive bg-surface-2 px-space-3 text-sm text-primary disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent';
const INPUT = 'min-h-11 w-full rounded-sm border border-border-interactive bg-surface-2 px-space-3 text-primary';

function localToday(): string {
  return getCurrentDateInfo()?.dateKey ?? '';
}

export default function CreditSpendItems({ cardId, month, statementDay, dueDay, onChanged }: {
  cardId: string;
  month: string;
  statementDay?: number | string | null;
  dueDay?: number | string | null;
  onChanged: (month: string) => void | Promise<void>;
}) {
  const [items, setItems] = useState<CreditSpendItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [purchaseDate, setPurchaseDate] = useState(localToday);
  const [deleting, setDeleting] = useState<CreditSpendItem | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const editingItem = items.find(item => item.id === editing);
  const billingMonth = isValidPurchaseDate(purchaseDate)
    ? computeStartMonthFromPurchase(purchaseDate, statementDay)
    : '';
  const dueDate = billingMonth
    ? resolveCardDueDate({ statementDay, dueDay: dueDay ?? 'EOM' }, billingMonth)
    : null;

  const reload = async () => {
    const response = await creditCardAPI.listSpendItems(month, cardId);
    setItems(response.items);
    setTotal(response.totals[cardId] ?? 0);
    setLoadError(false);
  };

  useEffect(() => {
    let active = true;
    creditCardAPI.listSpendItems(month, cardId).then(response => {
      if (!active) return;
      setItems(response.items);
      setTotal(response.totals[cardId] ?? 0);
    }).catch(() => {
      if (active) {
        setLoadError(true);
        showToast('โหลดรายการไม่ผ่อนไม่สำเร็จ', 'error');
      }
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [cardId, month]);

  useEffect(() => {
    if (!deleting) return;
    const opener = document.activeElement;
    cancelRef.current?.focus();
    return () => { if (opener instanceof HTMLElement && opener.isConnected) opener.focus(); };
  }, [deleting]);

  const mutate = async (action: () => Promise<{ item?: CreditSpendItem; deletedId?: string }>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      const result = await action();
      const changedMonth = result.item?.month ?? month;
      setDeleting(null);
      setEditing(null);
      setName('');
      setAmount('');
      setPurchaseDate(localToday());
      if (changedMonth === month) await reload();
      await onChanged(changedMonth);
      showToast('บันทึกรายการไม่ผ่อนแล้ว');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'บันทึกรายการไม่สำเร็จ กรุณาโหลดข้อมูลใหม่', 'error');
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  return <section aria-label="รายการไม่ผ่อน" className="flex flex-col gap-space-3">
    <h3 className="text-base font-semibold text-primary">รายการไม่ผ่อน</h3>
    {loading ? <p role="status">กำลังโหลดรายการ...</p> : loadError ? <p role="alert">โหลดรายการไม่สำเร็จ กรุณาเปิดหน้านี้ใหม่</p> : <>
      {items.length === 0 && <p className="text-sm text-tertiary">ยังไม่มีรายการไม่ผ่อนในเดือนนี้</p>}
      <ul className="flex flex-col gap-space-2">
        {items.map(item => <li key={item.id} className="flex flex-wrap items-center gap-space-2">
          <span className="grow text-primary">
            {item.name}
            {item.purchaseDate && <span className="ml-space-2 text-xs text-tertiary">{formatIsoDateTH(item.purchaseDate)}</span>}
          </span>
          <span className="text-primary">{formatCurrency(item.amount)} ฿</span>
          <button type="button" className={BUTTON} disabled={busy} aria-label={`แก้ไข ${item.name}`} onClick={() => {
            setEditing(item.id); setName(item.name); setAmount(String(item.amount)); setPurchaseDate(item.purchaseDate ?? '');
          }}>แก้ไข</button>
          <button type="button" className={BUTTON} disabled={busy} aria-label={`ลบ ${item.name}`} onClick={() => setDeleting(item)}>ลบ</button>
        </li>)}
      </ul>
      <p className="text-sm font-semibold text-primary">รวมรายการไม่ผ่อน {formatCurrency(total)} ฿</p>
    </>}
    <form className="flex flex-col gap-space-2" onSubmit={event => {
      event.preventDefault();
      void mutate(() => editing
        ? creditCardAPI.updateSpendItem({
          id: editing,
          name,
          amount,
          ...(purchaseDate && purchaseDate !== editingItem?.purchaseDate ? { purchaseDate } : {})
        })
        : creditCardAPI.createSpendItem({ cardId, purchaseDate, name, amount }));
    }}>
      <label className="text-sm text-secondary">ชื่อรายการไม่ผ่อน
        <input className={INPUT} required maxLength={60} value={name} onChange={event => setName(event.target.value)} disabled={busy || loading || loadError} />
      </label>
      <label className="text-sm text-secondary">จำนวนเงินรายการไม่ผ่อน
        <input className={INPUT} required type="text" inputMode="decimal" value={amount} onChange={event => setAmount(event.target.value)} disabled={busy || loading || loadError} />
      </label>
      <label className="text-sm text-secondary">วันที่ซื้อรายการไม่ผ่อน
        <input
          className={INPUT}
          aria-label="วันที่ซื้อรายการไม่ผ่อน"
          type="date"
          required={!editing || Boolean(editingItem?.purchaseDate)}
          value={purchaseDate}
          onChange={event => setPurchaseDate(event.target.value)}
          disabled={busy || loading || loadError}
        />
      </label>
      {billingMonth && dueDate && (
        <p role="status" className="text-sm text-secondary">
          รอบบิล {formatMonthKeyTH(billingMonth)} · ครบกำหนด {formatIsoDateTH(dueDate)}
        </p>
      )}
      <div className="flex gap-space-2">
        <button type="submit" className={BUTTON} disabled={busy || loading || loadError}>{editing ? 'บันทึกรายการ' : 'เพิ่มรายการ'}</button>
        {editing && <button type="button" className={BUTTON} disabled={busy} onClick={() => { setEditing(null); setName(''); setAmount(''); setPurchaseDate(localToday()); }}>ยกเลิกแก้ไข</button>}
      </div>
    </form>
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
          <button className={BUTTON} type="button" disabled={busy} onClick={() => void mutate(() => creditCardAPI.deleteSpendItem(deleting.id))}>ยืนยันลบ</button>
        </div>
      </div>
    </div>}
  </section>;
}
