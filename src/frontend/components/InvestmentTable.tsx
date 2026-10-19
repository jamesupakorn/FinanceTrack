/**
 * คอมโพเนนต์: InvestmentTable
 * จัดการรายการลงทุนรายเดือน (สัดส่วน/จำนวนเงิน)
 *
 * Graphite redesign (daily-savings-tax-graphite pass) — Tailwind only (UX_SPEC §5.1 C11 / §6.5 base /
 * §6.6 lg), ไม่มี InvestmentTable.module.css อีกต่อไป. C11 conformance fix สองจุด: (1) แถวใหม่มีชื่อ
 * default ไม่ว่างแล้ว (K12 — เดิม name: '' ทำให้แถวใหม่ดูเหมือนกดไม่ติด) (2) key เปลี่ยนจาก index
 * เป็น id คงที่ต่อแถว (K13 — เดิม key={idx} ทำให้แถวสลับ/remount เวลาเพิ่ม-ลบ จนโฟกัสหลุดกลางคัน)
 */

import { useState, useEffect, useMemo, useRef, type FocusEvent } from 'react';
import { investmentAPI } from '../../shared/utils/frontend/apiUtils';
import { parseToNumber, formatCurrency } from '../../shared/utils/frontend/numberUtils';
import { averagePercent } from '../../shared/utils/investmentUtils';
import { compareListValues, matchesListQuery } from '../../shared/utils/frontend/listView';
import { useListProjection } from '../../shared/utils/frontend/useListProjection';
import { showToast } from '../../shared/utils/frontend/toast';
import { Icons } from './Icons';
import LoadingNotice from './LoadingNotice';
import ListToolbar from './ListToolbar';
import { useListCriteria } from '../contexts/ListViewContext';

interface InvestmentItem {
  id: string;
  name: string;
  percent: string;
  amount: string;
}

interface InvestmentTableProps {
  selectedMonth: string | null | undefined;
  onDataChange?: () => void;
  onRegisterSave?: (handler: (() => Promise<void>) | null) => void;
  onSaved?: () => void;
  markDirty?: () => void;
}

type InvestmentField = 'name' | 'percent';

function genId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

const NAME_FALLBACK = 'การลงทุนใหม่';

const FOCUS_RING = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2';
const INPUT = `h-11 w-full rounded-sm border border-border-interactive bg-surface-2 px-space-3 text-base text-primary outline-none ${FOCUS_RING}`;
const REMOVE_BTN = `flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-border-interactive bg-surface-2 text-neg ${FOCUS_RING}`;
const CARD = 'rounded-md border border-border-default bg-surface-1 p-space-4 shadow-elev-1';
const BTN_SECONDARY = `min-h-11 rounded-sm border border-border-interactive bg-surface-2 px-space-4 text-sm font-medium text-secondary ${FOCUS_RING} disabled:opacity-50`;

// InvestmentTable: แสดงและแก้ไขรายการลงทุนในแต่ละเดือน
export default function InvestmentTable({ selectedMonth, onDataChange, onRegisterSave, onSaved, markDirty }: InvestmentTableProps) {
  const [baseAmount, setBaseAmount] = useState('');
  const [investments, setInvestments] = useState<InvestmentItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadRevision, setLoadRevision] = useState(0);
  const [pendingFocusId, setPendingFocusId] = useState<string | null>(null);
  const [criteria, setCriteria] = useListCriteria('investment-entries');

  const handleAmountInputFocus = (event: FocusEvent<HTMLInputElement>) => {
    event.target.select();
  };

  // ฟังก์ชันคำนวณ amount ตามเปอร์เซ็นต์
  const recalcAmounts = (amount: string, invList: InvestmentItem[]): InvestmentItem[] => {
    const base = parseToNumber(amount);
    return invList.map(item => ({
      ...item,
      amount: base && item.percent ? ((parseFloat(item.percent) / 100) * base).toFixed(2) : ''
    }));
  };

  const orders = useMemo(() => [
    { value: 'name-asc', label: 'ชื่อ: ก–ฮ / A–Z' },
    { value: 'name-desc', label: 'ชื่อ: ฮ–ก / Z–A' },
    { value: 'amount-asc', label: 'จำนวนเงิน: น้อยไปมาก' },
    { value: 'amount-desc', label: 'จำนวนเงิน: มากไปน้อย' },
    { value: 'percent-asc', label: 'เปอร์เซ็นต์: น้อยไปมาก' },
    { value: 'percent-desc', label: 'เปอร์เซ็นต์: มากไปน้อย' },
  ], []);
  const projection = useListProjection({
    rows: investments,
    getId: item => item.id,
    matches: item => matchesListQuery(item.name, criteria.query),
    compare: (a, b) => {
      if (criteria.order.startsWith('name-')) {
        return compareListValues(a.name, b.name, criteria.order === 'name-desc');
      }
      const number = (value: string) => value.trim() === '' ? null : parseToNumber(value);
      if (criteria.order.startsWith('amount-')) {
        return compareListValues(number(a.amount), number(b.amount), criteria.order === 'amount-desc');
      }
      if (criteria.order.startsWith('percent-')) {
        return compareListValues(number(a.percent), number(b.percent), criteria.order === 'percent-desc');
      }
      return 0;
    },
    criteriaKey: JSON.stringify(criteria),
    datasetKey: `${selectedMonth ?? ''}:${loading ? 'loading' : 'ready'}:${loadRevision}`,
    editable: true,
  });
  const refreshProjection = useRef(projection.refresh);
  refreshProjection.current = projection.refresh;

  useEffect(() => {
    if (!pendingFocusId) return;
    const targets = Array.from(document.querySelectorAll<HTMLElement>(`[data-investment-id="${pendingFocusId}"]`));
    const target = targets.find(node => node.offsetParent !== null) || targets[0];
    const input = target?.querySelector<HTMLInputElement>('input[type="text"]');
    if (input) {
      target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      input.focus({ preventScroll: true });
      setPendingFocusId(null);
    }
  }, [investments, pendingFocusId]);

  // เพิ่มฟังก์ชันเพิ่มรายการลงทุนใหม่
  const addInvestment = () => {
    markDirty?.(); // K17 — คำสั่งแรกเสมอ: ปุ่มนี้เป็น onClick ไม่ใช่ input/change (spec.md §Files
                    // "The C11 dirty signal")
    const id = genId();
    setInvestments(prev => recalcAmounts(baseAmount, [...prev, { id, name: NAME_FALLBACK, percent: '', amount: '' }]));
    setPendingFocusId(id);
  };

  // ฟังก์ชันบันทึกข้อมูลการลงทุน
  const handleSave = async (): Promise<void> => {
    if (!selectedMonth) return;
    try {
      const result = await investmentAPI.saveList(selectedMonth, investments);
      if (result) {
        if (typeof onDataChange === 'function') onDataChange();
        showToast('บันทึกสำเร็จ');
        refreshProjection.current();
        onSaved?.();
        return;
      }
      showToast('บันทึกไม่สำเร็จ', 'error');
    } catch (error) {
      console.error('Error saving investment data:', error);
      showToast('บันทึกไม่สำเร็จ', 'error');
    }
  };

  // ลงทะเบียนฟังก์ชันบันทึกกับ ref ของ WorkspaceShell แทนตัวนับ Save All เดิม (Amendment A5 —
  // ดูคำอธิบายเต็มใน IncomeTable.js ที่จุดเดียวกัน)
  useEffect(() => {
    if (!onRegisterSave) return undefined;
    onRegisterSave(handleSave);
    return () => onRegisterSave(null);
  }, [onRegisterSave, handleSave]);

  // โหลดข้อมูลจาก backend เมื่อ selectedMonth เปลี่ยน
  useEffect(() => {
    if (!selectedMonth) {
      setInvestments([]);
      setLoading(false);
      return undefined;
    }
    let cancelled = false;
    setLoading(true);
    setInvestments([]);
    const load = async () => {
      try {
        const data = await investmentAPI.getByMonth(selectedMonth);
        if (cancelled) return;
        if (Array.isArray(data) && data.length > 0) {
          setInvestments(data.map((item: InvestmentItem) => ({ ...item, id: item.id || genId() })));
        } else {
          const allData = await investmentAPI.getAll();
          if (cancelled) return;
          const months = Object.keys(allData).filter(month => month !== selectedMonth).sort();
          let previousMonth: string | null = null;
          for (let index = months.length - 1; index >= 0; index--) {
            if (months[index] < selectedMonth) {
              previousMonth = months[index];
              break;
            }
          }
          setInvestments(previousMonth && Array.isArray(allData[previousMonth])
            ? allData[previousMonth].map((item: Partial<InvestmentItem>) => ({
              id: genId(), name: item.name || '', percent: item.percent || '', amount: ''
            }))
            : []);
        }
      } catch (error) {
        console.error('Error loading investment data:', error);
        if (!cancelled) setInvestments([]);
      } finally {
        if (!cancelled) {
          setLoadRevision(revision => revision + 1);
          setLoading(false);
        }
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [selectedMonth]);

  // เพิ่มฟังก์ชันแก้ไขฟิลด์ในแต่ละรายการ
  const updateField = (id: string, field: InvestmentField, value: string) => {
    setInvestments(prev => {
      const updated = prev.map((item) =>
        item.id === id ? { ...item, [field]: value } : item
      );
      // ถ้าแก้ percent ให้คำนวณ amount ใหม่
      if (field === 'percent') {
        return recalcAmounts(baseAmount, updated);
      }
      return updated;
    });
  };

  // เพิ่มฟังก์ชันลบรายการลงทุน
  const removeInvestment = (id: string) => {
    markDirty?.(); // K17 — เดียวกับข้างบน
    setInvestments(prev => prev.filter((item) => item.id !== id));
  };

  // คำนวณเปอร์เซ็นรวมของรายการลงทุน
  const totalPercent = investments.reduce((sum, item) => sum + (parseFloat(item.percent) || 0), 0);
  const hasRows = investments.length > 0;
  const visibleInvestments = projection.items;

  return (
    <div>
      <div className="mb-space-4">
        <h3 className="text-lg font-medium text-primary">การลงทุนประจำเดือน {selectedMonth || ''}</h3>
      </div>

      <div className="mb-space-4">
        <label className="block text-sm text-secondary">
          จำนวนเงินลงทุนรวม (บาท)
          <input
            type="text"
            inputMode="decimal"
            value={baseAmount}
            onChange={event => {
              setBaseAmount(event.target.value);
              setInvestments(prev => recalcAmounts(event.target.value, prev));
            }}
            onFocus={handleAmountInputFocus}
            className={`${INPUT} mt-space-2 max-w-xs text-right font-[family-name:var(--font-numeric)] tabular-nums`}
          />
        </label>
      </div>

      {loading && <LoadingNotice className="mb-space-4" />}
      {!loading && (
        <ListToolbar
          label="รายการลงทุน"
          criteria={criteria}
          onChange={setCriteria}
          orders={orders}
          visible={visibleInvestments.length}
          total={investments.length}
          changed={projection.changed}
          onRefresh={projection.refresh}
          pinned={projection.pinnedIds.size}
        />
      )}

      {hasRows && visibleInvestments.length > 0 ? (
        <>
          {/* md+: C5 table */}
          <div className="hidden overflow-x-auto rounded-md border border-border-default md:block">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-border-subtle bg-surface-2">
                  <th className="p-space-3 text-left text-xs font-medium text-secondary">ชื่อหุ้น/กองทุน</th>
                  <th className="p-space-3 text-right text-xs font-medium text-secondary">เปอร์เซ็นการลงทุน (%)</th>
                  <th className="p-space-3 text-right text-xs font-medium text-secondary">จำนวนเงิน (บาท)</th>
                  <th className="p-space-3 text-center text-xs font-medium text-secondary">ลบ</th>
                </tr>
              </thead>
              <tbody>
                {visibleInvestments.map((item) => (
                  <tr key={item.id} data-investment-id={item.id} className="border-b border-border-subtle last:border-b-0">
                    <td className="p-space-3 align-middle">
                      <input
                        type="text"
                        value={item.name}
                        onChange={event => updateField(item.id, 'name', event.target.value)}
                        className={INPUT}
                      />
                    </td>
                    <td className="p-space-3 align-middle">
                      <input
                        type="text"
                        inputMode="decimal"
                        value={item.percent}
                        onChange={event => updateField(item.id, 'percent', event.target.value)}
                        onFocus={handleAmountInputFocus}
                        className={`${INPUT} text-right font-[family-name:var(--font-numeric)] tabular-nums`}
                      />
                    </td>
                    <td className="p-space-3 text-right align-middle font-[family-name:var(--font-numeric)] tabular-nums text-primary">
                      {formatCurrency(item.amount)}
                    </td>
                    <td className="p-space-3 text-center align-middle">
                      <button
                        type="button"
                        onClick={() => removeInvestment(item.id)}
                        className={`mx-auto ${REMOVE_BTN}`}
                        aria-label={`ลบ ${item.name || NAME_FALLBACK}`}
                      >
                        <Icons.X size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* base tier: C4/C11 cards */}
          <div className="flex flex-col gap-space-3 md:hidden">
            {visibleInvestments.map((item) => (
              <div className="min-h-14 rounded-md border border-border-default bg-surface-2 p-space-4" key={item.id} data-investment-id={item.id}>
                <div className="flex items-center gap-space-2">
                  <input
                    type="text"
                    value={item.name}
                    onChange={event => updateField(item.id, 'name', event.target.value)}
                    className={`${INPUT} flex-1 font-medium`}
                    placeholder="ชื่อหุ้น/กองทุน"
                  />
                  <button
                    type="button"
                    onClick={() => removeInvestment(item.id)}
                    className={REMOVE_BTN}
                    aria-label={`ลบ ${item.name || NAME_FALLBACK}`}
                  >
                    <Icons.X size={16} />
                  </button>
                </div>
                <div className="mt-space-3 flex items-center gap-space-3">
                  <input
                    type="text"
                    inputMode="decimal"
                    value={item.percent}
                    onChange={event => updateField(item.id, 'percent', event.target.value)}
                    onFocus={handleAmountInputFocus}
                    className={`${INPUT} flex-1 text-right font-[family-name:var(--font-numeric)] tabular-nums`}
                    placeholder="0%"
                  />
                  <span className="shrink-0 whitespace-nowrap font-[family-name:var(--font-numeric)] text-lg font-semibold tabular-nums text-primary">
                    {formatCurrency(item.amount)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </>
      ) : (
        !loading && !hasRows && <div className="rounded-md border border-dashed border-border-default bg-sunken p-space-4 text-sm text-secondary">
          ไม่มีรายการลงทุน
        </div>
      )}

      <div className="mt-space-4 flex flex-wrap items-center gap-space-3">
        <button type="button" onClick={addInvestment} className="min-h-11 shrink-0 rounded-sm bg-accent px-space-4 text-sm font-medium text-on-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2">
          + เพิ่มรายการลงทุน
        </button>
        <button
          type="button"
          onClick={() => {
            if (investments.length === 0) return;
            markDirty?.(); // K17 — เดียวกับ addInvestment/removeInvestment ด้านบน
            const avgPercents = averagePercent(investments.length);
            setInvestments(prev => recalcAmounts(baseAmount, prev.map((item, index) => ({
              ...item,
              percent: avgPercents[index]
            }))));
          }}
          className={BTN_SECONDARY}
          disabled={investments.length === 0}
        >
          เฉลี่ยเปอร์เซ็น
        </button>
      </div>

      <div className={`${CARD} mt-space-4 flex items-center justify-between ${totalPercent !== 100 ? 'border-warn/40' : 'border-pos/40'}`}>
        <span className="text-sm text-secondary">รวมเปอร์เซ็น</span>
        <span className={`font-[family-name:var(--font-numeric)] text-lg font-semibold tabular-nums ${totalPercent !== 100 ? 'text-warn' : 'text-pos'}`}>
          {totalPercent}% {totalPercent > 100 && '(เกิน 100%)'}{totalPercent < 100 && '(ต้องครบ 100%)'}
        </span>
      </div>
    </div>
  );
}