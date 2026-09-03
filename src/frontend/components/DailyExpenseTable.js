/**
 * คอมโพเนนต์: DailyExpenseTable
 * จัดการค่าใช้จ่ายรายวัน — สองรายการอิสระในหน้าเดียว: รายจ่ายประจำ (ต่อวัน/ต่อสัปดาห์) และ
 * รายจ่ายหยิบหย่อย (ยอดรวมต่อเดือนตรง ๆ)
 * @param {object} props
 * @param {string} props.selectedMonth - เดือนที่เลือก (YYYY-MM)
 * @param {function} props.markDirty - (Graphite, K17) เรียกเป็นคำสั่งแรกใน handleDelete/addFixed/addMisc
 *   — ปุ่มเหล่านี้เป็น onClick ไม่ใช่ input/change จึงไม่โดน bubbled listener ของ WorkspaceShell.js จับเอง
 *   (spec.md §Files "The C11 dirty signal", UX_SPEC §7 K17)
 *
 * Graphite redesign (daily-savings-tax-graphite pass) — Tailwind only (UX_SPEC §5.1 C11 / §6.5 base /
 * §6.6 lg). C11 conformance fix ในพาสนี้: default ชื่อรายการใหม่ไม่ว่างอีกต่อไป (K12 — เดิม name: ''
 * ทำให้แถวใหม่ถูกกรองทิ้งตอนบันทึกเหมือนไม่มีอะไรเกิดขึ้น) แถวยัง key ด้วย item.id เดิม (K13 conform
 * อยู่แล้ว) โครงสร้าง ItemRow เดิมที่ไม่มี table/card breakpoint split ถูกแยกเป็นสองพาธ์
 * (ItemRowTable สำหรับ md+ / ItemRowCard สำหรับ base) ใช้ state และ handler ชุดเดียวกันทั้งคู่
 * (C5 — ห้ามให้ตารางข้อมูล scroll แนวนอนบนมือถือ)
 */

import { useState, useEffect, useCallback } from 'react';
import { dailyExpenseAPI } from '../../shared/utils/frontend/apiUtils';
import { formatCurrency, parseToNumber } from '../../shared/utils/frontend/numberUtils';
import { showToast } from '../../shared/utils/frontend/toast';
import { Icons } from './Icons';

function genId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

const FIXED_NAME_FALLBACK = 'รายวันใหม่';
const MISC_NAME_FALLBACK = 'รายจ่ายหยิบหย่อยใหม่';

const FOCUS_RING = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2';
const INPUT = `h-11 w-full rounded-sm border border-border-interactive bg-surface-2 px-space-3 text-base text-primary outline-none ${FOCUS_RING}`;
const SELECT = `h-11 w-full rounded-sm border border-border-interactive bg-surface-2 px-space-3 text-sm text-primary outline-none ${FOCUS_RING}`;
const REMOVE_BTN = `flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-border-interactive bg-surface-2 text-neg ${FOCUS_RING}`;
const CARD = 'rounded-md border border-border-default bg-surface-1 p-space-4 shadow-elev-1';

function getMonthlyAmount(item) {
  const amount = parseToNumber(item.amount);
  if (item.category === 'fixed') {
    if (item.frequency === 'daily') return amount * 30;
    if (item.frequency === 'weekly') return amount * 4.33;
    return 0;
  }
  if (item.category === 'misc') return amount;
  return 0;
}

function calcTotals(items) {
  let fixedMonthly = 0;
  let miscMonthly = 0;
  items.forEach(item => {
    const m = getMonthlyAmount(item);
    if (item.category === 'fixed') fixedMonthly += m;
    else if (item.category === 'misc') miscMonthly += m;
  });
  return { fixedMonthly, miscMonthly, totalMonthly: fixedMonthly + miscMonthly };
}

// md+: C5 table row. รับ item/onChange/onDelete ชุดเดียวกับ ItemRowCard — ไม่มี state ของตัวเอง
function ItemRowTable({ item, onChange, onDelete }) {
  const monthlyAmt = getMonthlyAmount(item);
  const isFixed = item.category === 'fixed';
  return (
    <tr className="border-b border-border-subtle last:border-b-0" data-daily-key={item.id}>
      <td className="p-space-3 align-middle">
        <input
          type="text"
          value={item.name}
          onChange={e => onChange(item.id, 'name', e.target.value)}
          className={INPUT}
          placeholder="ชื่อรายการ"
        />
      </td>
      <td className="p-space-3 align-middle">
        <input
          type="text"
          inputMode="numeric"
          value={item.amount}
          onChange={e => onChange(item.id, 'amount', e.target.value)}
          className={`${INPUT} text-right font-[family-name:var(--font-numeric)] tabular-nums`}
          placeholder="0"
        />
      </td>
      {isFixed && (
        <>
          <td className="p-space-3 align-middle">
            <select
              value={item.frequency || 'daily'}
              onChange={e => onChange(item.id, 'frequency', e.target.value)}
              className={SELECT}
            >
              <option value="daily">ต่อวัน</option>
              <option value="weekly">ต่อสัปดาห์</option>
            </select>
          </td>
          <td className="p-space-3 text-right align-middle font-[family-name:var(--font-numeric)] tabular-nums text-secondary">
            {monthlyAmt > 0 ? formatCurrency(Math.round(monthlyAmt)) : '—'}
          </td>
        </>
      )}
      <td className="p-space-3 text-center align-middle">
        <button
          type="button"
          className={REMOVE_BTN}
          onClick={() => onDelete(item.id)}
          aria-label={`ลบ ${item.name || (isFixed ? FIXED_NAME_FALLBACK : MISC_NAME_FALLBACK)}`}
        >
          <Icons.X size={16} />
        </button>
      </td>
    </tr>
  );
}

// base tier: C4/C11 card. handler ชุดเดียวกับ ItemRowTable ทุกประการ (ไม่มี state แยก, ไม่ remount
// เวลาสลับ breakpoint เพราะ parent map ด้วย key={item.id} เดียวกันทั้งสองพาธ์)
function ItemRowCard({ item, onChange, onDelete }) {
  const monthlyAmt = getMonthlyAmount(item);
  const isFixed = item.category === 'fixed';
  return (
    <div className={`min-h-14 rounded-md border border-border-default bg-surface-2 p-space-4`} data-daily-key={item.id}>
      <div className="flex items-center gap-space-2">
        <input
          type="text"
          value={item.name}
          onChange={e => onChange(item.id, 'name', e.target.value)}
          className={`${INPUT} flex-1 font-medium`}
          placeholder="ชื่อรายการ"
        />
        <button
          type="button"
          className={REMOVE_BTN}
          onClick={() => onDelete(item.id)}
          aria-label={`ลบ ${item.name || (isFixed ? FIXED_NAME_FALLBACK : MISC_NAME_FALLBACK)}`}
        >
          <Icons.X size={16} />
        </button>
      </div>
      <input
        type="text"
        inputMode="numeric"
        value={item.amount}
        onChange={e => onChange(item.id, 'amount', e.target.value)}
        className={`${INPUT} mt-space-3 text-right font-[family-name:var(--font-numeric)] text-lg font-semibold tabular-nums`}
        placeholder="0"
      />
      {isFixed && (
        <div className="mt-space-3 flex items-center gap-space-2">
          <select
            value={item.frequency || 'daily'}
            onChange={e => onChange(item.id, 'frequency', e.target.value)}
            className={`${SELECT} flex-1`}
          >
            <option value="daily">ต่อวัน</option>
            <option value="weekly">ต่อสัปดาห์</option>
          </select>
          <span className="shrink-0 whitespace-nowrap text-xs text-tertiary">
            /เดือน {monthlyAmt > 0 ? formatCurrency(Math.round(monthlyAmt)) : '—'}
          </span>
        </div>
      )}
    </div>
  );
}

export default function DailyExpenseTable({ selectedMonth, onRegisterSave, onSaved, markDirty }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);

  const loadData = useCallback(async (isCancelled) => {
    if (!selectedMonth) return;
    setLoading(true);
    try {
      const data = await dailyExpenseAPI.getByMonth(selectedMonth);
      if (isCancelled()) return;
      const loaded = (data?.items || []).map(item => ({
        ...item,
        id: item.id || genId(),
      }));
      setItems(loaded);
    } catch {
      if (isCancelled()) return;
      setItems([]);
    } finally {
      if (!isCancelled()) setLoading(false);
    }
  }, [selectedMonth]);

  useEffect(() => {
    let cancelled = false;
    loadData(() => cancelled);
    return () => { cancelled = true; };
  }, [loadData]);

  // เดิมเป็น IIFE ข้างใน effect ที่ฟังตัวนับ Save All — ดึงออกมาเป็นฟังก์ชันชื่อ handleSave เพราะ
  // ตอนนี้ WorkspaceShell ต้องเรียกมันได้ตรง ๆ ผ่าน onRegisterSave (Amendment A5)
  const handleSave = useCallback(async () => {
    try {
      await dailyExpenseAPI.save(selectedMonth, items);
      showToast('บันทึกค่าใช้จ่ายรายวันเรียบร้อยแล้ว', 'success');
      onSaved?.();
    } catch (err) {
      showToast(err?.message || 'บันทึกค่าใช้จ่ายรายวันไม่สำเร็จ', 'error');
    }
  }, [selectedMonth, items, onSaved]);

  useEffect(() => {
    if (!onRegisterSave) return undefined;
    onRegisterSave(handleSave);
    return () => onRegisterSave(null);
  }, [onRegisterSave, handleSave]);

  const handleChange = (id, field, value) => {
    setItems(prev => prev.map(item => item.id === id ? { ...item, [field]: value } : item));
  };

  const handleDelete = (id) => {
    markDirty?.(); // K17 — คำสั่งแรกเสมอ: ปุ่มนี้เป็น onClick ไม่ใช่ input/change (spec.md §Files
                    // "The C11 dirty signal")
    setItems(prev => prev.filter(item => item.id !== id));
  };

  const addFixed = () => {
    markDirty?.(); // K17 — เดียวกับข้างบน
    setItems(prev => [
      ...prev,
      { id: genId(), category: 'fixed', name: FIXED_NAME_FALLBACK, amount: '', frequency: 'daily' },
    ]);
  };

  const addMisc = () => {
    markDirty?.(); // K17 — เดียวกับข้างบน
    setItems(prev => [
      ...prev,
      { id: genId(), category: 'misc', name: MISC_NAME_FALLBACK, amount: '', frequency: null },
    ]);
  };

  const fixedItems = items.filter(i => i.category === 'fixed');
  const miscItems = items.filter(i => i.category === 'misc');
  const { fixedMonthly, miscMonthly, totalMonthly } = calcTotals(items);

  if (loading) {
    return (
      <div role="status" aria-live="polite" className="rounded-md border border-dashed border-border-default bg-sunken p-space-4 text-sm text-secondary">
        กำลังโหลด...
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-space-6">

      {/* ส่วนที่ 1: รายจ่ายประจำ */}
      <section>
        <div className="mb-space-4 flex flex-wrap items-start justify-between gap-space-3">
          <div>
            <h3 className="text-lg font-medium text-primary">รายจ่ายประจำ</h3>
            <p className="mt-space-1 text-sm text-secondary">กรอกยอดต่อวัน หรือต่อสัปดาห์</p>
          </div>
          <button
            type="button"
            className="min-h-11 shrink-0 rounded-sm bg-accent px-space-4 text-sm font-medium text-on-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2"
            onClick={addFixed}
          >
            + เพิ่มรายการประจำ
          </button>
        </div>

        {fixedItems.length === 0 ? (
          <div className="rounded-md border border-dashed border-border-default bg-sunken p-space-4 text-sm text-secondary">
            ยังไม่มีรายการ
          </div>
        ) : (
          <>
            {/* md+: C5 table */}
            <div className="hidden overflow-x-auto rounded-md border border-border-default md:block">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="border-b border-border-subtle bg-surface-2">
                    <th className="p-space-3 text-left text-xs font-medium text-secondary">รายการ</th>
                    <th className="p-space-3 text-left text-xs font-medium text-secondary">ยอด</th>
                    <th className="p-space-3 text-left text-xs font-medium text-secondary">ความถี่</th>
                    <th className="p-space-3 text-right text-xs font-medium text-secondary">/เดือน</th>
                    <th className="p-space-3 text-center text-xs font-medium text-secondary">ลบ</th>
                  </tr>
                </thead>
                <tbody>
                  {fixedItems.map(item => (
                    <ItemRowTable key={item.id} item={item} onChange={handleChange} onDelete={handleDelete} />
                  ))}
                </tbody>
              </table>
            </div>

            {/* base tier: C4/C11 cards */}
            <div className="flex flex-col gap-space-3 md:hidden">
              {fixedItems.map(item => (
                <ItemRowCard key={item.id} item={item} onChange={handleChange} onDelete={handleDelete} />
              ))}
            </div>
          </>
        )}

        <div className={`${CARD} mt-space-3 flex items-center justify-between`}>
          <span className="text-sm text-secondary">รวมประจำ/เดือน</span>
          <span className="font-[family-name:var(--font-numeric)] text-lg font-semibold tabular-nums text-primary">
            {formatCurrency(Math.round(fixedMonthly))}
          </span>
        </div>
      </section>

      {/* ส่วนที่ 2: รายจ่ายหยิบหย่อย */}
      <section>
        <div className="mb-space-4 flex flex-wrap items-start justify-between gap-space-3">
          <div>
            <h3 className="text-lg font-medium text-primary">รายจ่ายหยิบหย่อย</h3>
            <p className="mt-space-1 text-sm text-secondary">กรอกยอดรวม/เดือน</p>
          </div>
          <button
            type="button"
            className="min-h-11 shrink-0 rounded-sm bg-accent px-space-4 text-sm font-medium text-on-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2"
            onClick={addMisc}
          >
            + เพิ่มรายจ่ายหยิบหย่อย
          </button>
        </div>

        {miscItems.length === 0 ? (
          <div className="rounded-md border border-dashed border-border-default bg-sunken p-space-4 text-sm text-secondary">
            ยังไม่มีรายการ
          </div>
        ) : (
          <>
            {/* md+: C5 table */}
            <div className="hidden overflow-x-auto rounded-md border border-border-default md:block">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="border-b border-border-subtle bg-surface-2">
                    <th className="p-space-3 text-left text-xs font-medium text-secondary">รายการ</th>
                    <th className="p-space-3 text-right text-xs font-medium text-secondary">ยอด/เดือน</th>
                    <th className="p-space-3 text-center text-xs font-medium text-secondary">ลบ</th>
                  </tr>
                </thead>
                <tbody>
                  {miscItems.map(item => (
                    <ItemRowTable key={item.id} item={item} onChange={handleChange} onDelete={handleDelete} />
                  ))}
                </tbody>
              </table>
            </div>

            {/* base tier: C4/C11 cards */}
            <div className="flex flex-col gap-space-3 md:hidden">
              {miscItems.map(item => (
                <ItemRowCard key={item.id} item={item} onChange={handleChange} onDelete={handleDelete} />
              ))}
            </div>
          </>
        )}

        <div className={`${CARD} mt-space-3 flex items-center justify-between`}>
          <span className="text-sm text-secondary">รวมหยิบหย่อย/เดือน</span>
          <span className="font-[family-name:var(--font-numeric)] text-lg font-semibold tabular-nums text-primary">
            {formatCurrency(Math.round(miscMonthly))}
          </span>
        </div>
      </section>

      {/* ยอดรวม — K16 live total, คำนวณจาก items state ตรง ๆ ไม่ต้องรอ save */}
      <div className="flex items-center justify-between rounded-md border border-accent/40 bg-accent-muted p-space-4">
        <span className="text-sm font-semibold text-primary">ยอดรวมค่าใช้จ่ายรายวัน/เดือน</span>
        <span className="font-[family-name:var(--font-numeric)] text-xl font-semibold tabular-nums text-primary">
          {formatCurrency(Math.round(totalMonthly))}
        </span>
      </div>
    </div>
  );
}
