/**
 * คอมโพเนนต์: SavingsTable
 * จัดการรายการเงินออมรายเดือน และแสดงตารางรายการเงินออม
 *
 * Graphite redesign (daily-savings-tax-graphite pass) — Tailwind only (UX_SPEC §5.1 C11 / §6.5 base /
 * §6.6 lg), ไม่มี SavingsTable.module.css อีกต่อไป. C11 conformance fix สองจุด: (1) แถวใหม่มีชื่อ
 * default ไม่ว่างแล้ว (K12 — savings_type เดิมเป็น '' คือค่าว่างที่ไม่ตรง goal name ไหนเลย ยังบันทึก
 * ได้ปกติ ไม่ถูก API filter ทิ้ง แต่ K12 กำหนดว่าแถวใหม่ต้องมี placeholder ไม่ว่างเสมอ)
 * (2) key เปลี่ยนจาก index เป็น id คงที่ต่อแถว (K13 — เดิม key={index} ทำให้แถวสลับ/remount เวลา
 * เพิ่ม-ลบ จนโฟกัสหลุดกลางคัน)
 */

import { useState, useEffect, useCallback, useMemo, useRef, type FocusEvent } from 'react';
import { formatCurrency, parseAndFormat, parseToNumber } from '../../shared/utils/frontend/numberUtils';
import { mapSavingsApiToList } from '../../shared/utils/savingsUtils';
import { savingsAPI, savingsGoalsAPI } from '../../shared/utils/frontend/apiUtils';
import { compareListValues, matchesListQuery } from '../../shared/utils/frontend/listView';
import { useListProjection } from '../../shared/utils/frontend/useListProjection';
import { showToast } from '../../shared/utils/frontend/toast';
import { Icons } from './Icons';
import LoadingNotice from './LoadingNotice';
import ListToolbar from './ListToolbar';
import { useListCriteria } from '../contexts/ListViewContext';

interface SavingsRow extends Record<string, unknown> {
  id: string;
  savings_type: string;
  รายการ: string;
  savings_amount: string;
  จำนวนเงิน: string;
}

interface SavingsData extends Record<string, unknown> {
  รวมเงินเก็บ?: number;
}

interface SavingsTableProps {
  selectedMonth: string | null | undefined;
  onRegisterSave?: (handler: (() => Promise<void>) | null) => void;
  onSaved?: () => void;
  markDirty?: () => void;
}

type SavingsNameField = 'savings_type' | 'รายการ';

function genId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

const NAME_FALLBACK = 'เงินออมใหม่';

const FOCUS_RING = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2';
const INPUT = `h-11 w-full rounded-sm border border-border-interactive bg-surface-2 px-space-3 text-base text-primary outline-none ${FOCUS_RING}`;
const SELECT = `h-11 w-full rounded-sm border border-border-interactive bg-surface-2 px-space-3 text-sm text-primary outline-none ${FOCUS_RING}`;
const REMOVE_BTN = `flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-border-interactive bg-surface-2 text-neg ${FOCUS_RING}`;
const CARD = 'rounded-md border border-border-default bg-surface-1 p-space-4 shadow-elev-1';

/**
 * ตารางเงินออมรายเดือน
 */
export default function SavingsTable({ selectedMonth, onRegisterSave, onSaved, markDirty }: SavingsTableProps) {
  const [savingsData, setSavingsData] = useState<SavingsData | null>(null);
  const [รายการเงินออม, setรายการเงินออม] = useState<SavingsRow[]>([]);
  const [pendingScrollId, setPendingScrollId] = useState<string | null>(null);
  const [goalOptions, setGoalOptions] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadRevision, setLoadRevision] = useState(0);
  const [criteria, setCriteria] = useListCriteria('savings-entries');

  const loadGoalOptions = useCallback(async () => {
    try {
      const data = await savingsGoalsAPI.getAll();
      const names = Array.isArray(data?.goals)
        ? data.goals
          .map((goal: { goalName?: string }) => (goal?.goalName || '').trim())
          .filter(Boolean)
        : [];
      setGoalOptions(Array.from(new Set<string>(names)));
    } catch (error) {
      console.error('Error loading savings goals for dropdown:', error);
      setGoalOptions([]);
    }
  }, []);

  const loadSavingsData = useCallback(async (month: string) => {
    if (!month) return;
    setLoading(true);
    try {
      const data = await savingsAPI.getByMonth(month);
      setSavingsData(data);
      const formattedList: SavingsRow[] = mapSavingsApiToList(data).map(item => {
        const amountValue = item?.savings_amount ?? item?.จำนวนเงิน ?? 0;
        const formattedAmount = parseAndFormat(parseToNumber(amountValue));
        const nameValue = (item?.savings_type ?? item?.รายการ ?? '') as string;
        return {
          ...item,
          id: (item.id || genId()) as string,
          savings_type: nameValue,
          รายการ: nameValue,
          savings_amount: formattedAmount,
          จำนวนเงิน: formattedAmount
        };
      });
      setรายการเงินออม(formattedList);
    } catch (error) {
      console.error('Error loading savings data:', error);
    } finally {
      setLoadRevision(revision => revision + 1);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedMonth) {
      setSavingsData(null);
      setรายการเงินออม([]);
      loadSavingsData(selectedMonth);
    } else {
      setSavingsData(null);
      setรายการเงินออม([]);
      setLoading(false);
    }
  }, [selectedMonth, loadSavingsData]);

  const nameOptions = useMemo(() => {
    const names = Array.from(new Set(รายการเงินออม.map(item => (item.savings_type || item.รายการ || '').trim()).filter(Boolean)));
    return [
      { value: '__unassigned', label: 'ไม่ระบุ' },
      ...names.map(name => ({ value: name, label: name }))
    ];
  }, [รายการเงินออม]);
  const orders = useMemo(() => [
    { value: 'name-asc', label: 'ชื่อ: ก–ฮ / A–Z' },
    { value: 'name-desc', label: 'ชื่อ: ฮ–ก / Z–A' },
    { value: 'amount-asc', label: 'จำนวนเงิน: น้อยไปมาก' },
    { value: 'amount-desc', label: 'จำนวนเงิน: มากไปน้อย' },
  ], []);
  const projection = useListProjection({
    rows: รายการเงินออม,
    getId: item => item.id,
    matches: item => {
      const name = (item.savings_type || item.รายการ || '').trim();
      if (!matchesListQuery(name, criteria.query)) return false;
      if (criteria.filters.name && (criteria.filters.name === '__unassigned' ? Boolean(name) : name !== criteria.filters.name)) return false;
      return true;
    },
    compare: (a, b) => {
      if (criteria.order.startsWith('name-')) {
        return compareListValues(a.savings_type || a.รายการ, b.savings_type || b.รายการ, criteria.order === 'name-desc');
      }
      if (criteria.order.startsWith('amount-')) {
        const amount = (item: SavingsRow) => {
          const value = item.savings_amount ?? item.จำนวนเงิน;
          return value == null || value === '' ? null : parseToNumber(value);
        };
        return compareListValues(amount(a), amount(b), criteria.order === 'amount-desc');
      }
      return 0;
    },
    criteriaKey: JSON.stringify(criteria),
    datasetKey: `${selectedMonth ?? ''}:${loading ? 'loading' : 'ready'}:${loadRevision}`,
    editable: true,
  });
  const refreshProjection = useRef(projection.refresh);
  refreshProjection.current = projection.refresh;

  // เดิมรีเฟรช dropdown ตัวเลือกเป้าหมายตอนตัวนับ Save All ยิง (เพราะ SavingsGoalTracker เคยอยู่แท็บ
  // เดียวกัน สร้างเป้าหมายใหม่แล้ว Save All จะรีเฟรชให้ที่นี่ด้วย) ตอนนี้แยกคนละ route แล้ว
  // (/workspace/savings vs /workspace/savings/goals) จึงรีเฟรชตอน mount แทน — ผลลัพธ์เท่ากันหรือดีกว่า
  // เพราะสลับไปมาระหว่างสอง route นี้คือ mount ใหม่ทุกครั้งอยู่แล้ว (Amendment A5)
  useEffect(() => {
    loadGoalOptions();
  }, [loadGoalOptions, selectedMonth]);

  useEffect(() => {
    if (pendingScrollId === null) return;
    const tryScroll = () => {
      if (typeof document === 'undefined') return false;
      const targets = Array.from(document.querySelectorAll<HTMLElement>(`[data-savings-id="${pendingScrollId}"]`));
      const target = targets.find((node) => node.offsetParent !== null) || targets[0];
      if (!target) return false;
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      const firstInput = target.querySelector<HTMLElement>('input[type="text"]');
      if (firstInput && typeof firstInput.focus === 'function') {
        firstInput.focus({ preventScroll: true });
      }
      return true;
    };

    let timer: ReturnType<typeof setTimeout> | null = null;
    const done = tryScroll();
    if (!done) {
      timer = setTimeout(() => {
        if (tryScroll()) {
          setPendingScrollId(null);
        }
      }, 80);
      return () => clearTimeout(timer!);
    }
    setPendingScrollId(null);
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [pendingScrollId, รายการเงินออม]);

  const handleAddSavingsItem = () => {
    markDirty?.(); // K17 — คำสั่งแรกเสมอ: ปุ่มนี้เป็น onClick ไม่ใช่ input/change (spec.md §Files
                    // "The C11 dirty signal")
    const defaultAmount = parseAndFormat(0);
    const newId = genId();
    setรายการเงินออม(prev => [
      ...prev,
      {
        id: newId,
        savings_type: NAME_FALLBACK,
        รายการ: NAME_FALLBACK,
        savings_amount: defaultAmount,
        จำนวนเงิน: defaultAmount
      }
    ]);
    setPendingScrollId(newId);
  };

  // ใช้ shared numberUtils สำหรับ input logic
  const handleSavingsItemChange = (id: string, field: SavingsNameField, value: string) => {
    setรายการเงินออม(prev => prev.map(item => {
      if (item.id !== id) return item;
      const next = { ...item, [field]: value };
      if (field === 'savings_type' || field === 'รายการ') {
        next.savings_type = value;
        next.รายการ = value;
      }
      return next;
    }));
  };

  const handleSavingsAmountInput = (value: string, id: string) => {
    setรายการเงินออม(prev => prev.map(item => (
      item.id === id ? { ...item, savings_amount: value, จำนวนเงิน: value } : item
    )));
  };

  const handleSavingsAmountBlur = (value: string, id: string) => {
    const formatted = parseAndFormat(value);
    setรายการเงินออม(prev => prev.map(item => (
      item.id === id ? { ...item, savings_amount: formatted, จำนวนเงิน: formatted } : item
    )));
  };

  const handleAmountInputFocus = (event: FocusEvent<HTMLInputElement>) => {
    event.target.select();
  };

  const handleDeleteSavingsItem = (id: string) => {
    markDirty?.(); // K17 — เดียวกับข้างบน
    setรายการเงินออม(prev => prev.filter(item => item.id !== id));
  };

  const handleSavingsSave = async (): Promise<void> => {
    if (!selectedMonth) return;
    try {
      // แปลงเป็น number ก่อนบันทึก
      const numericSavings = รายการเงินออม.map(item => {
        const amountSource = item?.savings_amount ?? item?.จำนวนเงิน ?? 0;
        const nameValue = item?.savings_type ?? item?.รายการ ?? '';
        const numericAmount = parseToNumber(amountSource);
        return {
          ...item,
          savings_type: nameValue,
          รายการ: nameValue,
          savings_amount: numericAmount,
          จำนวนเงิน: numericAmount
        };
      });
      await savingsAPI.saveList(selectedMonth, numericSavings);
      await loadSavingsData(selectedMonth);
      refreshProjection.current();
      showToast('บันทึกรายการเงินออมสำเร็จ');
      onSaved?.();
    } catch (error) {
      console.error('Error saving savings list:', error);
      showToast('บันทึกไม่สำเร็จ กรุณาลองใหม่', 'error');
    }
  };

  // ลงทะเบียนฟังก์ชันบันทึกกับ ref ของ WorkspaceShell แทนตัวนับ Save All เดิม (Amendment A5 —
  // ดูคำอธิบายเต็มใน IncomeTable.js ที่จุดเดียวกัน)
  useEffect(() => {
    if (!onRegisterSave) return undefined;
    onRegisterSave(handleSavingsSave);
    return () => onRegisterSave(null);
  }, [onRegisterSave, handleSavingsSave]);

  // ยอดรวมเงินเก็บคำนวณจากสถานะปัจจุบัน เพื่อสะท้อนผลการแก้ไขทันที (K16)
  const displayedTotalSavings = useMemo(() => {
    if (!Array.isArray(รายการเงินออม)) return 0;
    return รายการเงินออม.reduce((sum, item) => {
      const amount = item?.savings_amount ?? item?.จำนวนเงิน ?? 0;
      return sum + parseToNumber(amount);
    }, 0);
  }, [รายการเงินออม]);

  const hasEditableRows = Array.isArray(รายการเงินออม) && รายการเงินออม.length > 0;
  const รวมเงินเก็บ = hasEditableRows
    ? displayedTotalSavings
    : (typeof savingsData?.รวมเงินเก็บ === 'number' ? savingsData.รวมเงินเก็บ : 0);
  const isLoading = loading || !savingsData;

  const getRowGoalOptions = (currentValue?: string | null) => {
    const value = (currentValue || '').trim();
    if (!value || goalOptions.includes(value)) return goalOptions;
    return [...goalOptions, value];
  };

  return (
    <div>
      {isLoading && (
        <LoadingNotice className="mb-space-4" />
      )}

      <div className="mb-space-4 flex flex-wrap items-start justify-between gap-space-3">
        <h3 className="flex items-center gap-space-2 text-lg font-medium text-primary">
          <Icons.Edit size={20} />
          รายการเงินออม
        </h3>
        <button
          type="button"
          className="min-h-11 shrink-0 rounded-sm bg-accent px-space-4 text-sm font-medium text-on-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2"
          onClick={handleAddSavingsItem}
        >
          + เพิ่มรายการ
        </button>
      </div>

      {!isLoading && (
        <ListToolbar
          label="รายการเงินออม"
          criteria={criteria}
          onChange={setCriteria}
          orders={orders}
          filters={[{ key: 'name', label: 'ประเภท / เป้าหมาย', options: nameOptions }]}
          visible={projection.items.length}
          total={รายการเงินออม.length}
          changed={projection.changed}
          onRefresh={projection.refresh}
          pinned={projection.pinnedIds.size}
        />
      )}

      {hasEditableRows && projection.items.length > 0 ? (
        <>
          {/* md+: C5 table */}
          <div className="hidden overflow-x-auto rounded-md border border-border-default md:block">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-border-subtle bg-surface-2">
                  <th className="p-space-3 text-left text-xs font-medium text-secondary">รายการออม</th>
                  <th className="p-space-3 text-right text-xs font-medium text-secondary">จำนวนเงินออม</th>
                  <th className="p-space-3 text-center text-xs font-medium text-secondary">การจัดการ</th>
                </tr>
              </thead>
              <tbody>
                {projection.items.map((item) => (
                  <tr key={item.id} className="border-b border-border-subtle last:border-b-0" data-savings-id={item.id}>
                    <td className="p-space-3 align-middle">
                      <select
                        value={item.savings_type || ''}
                        onChange={(event) => handleSavingsItemChange(item.id, 'savings_type', event.target.value)}
                        className={SELECT}
                      >
                        <option value="">ไม่ระบุ</option>
                        {getRowGoalOptions(item.savings_type).map((goalName) => (
                          <option key={goalName} value={goalName}>{goalName}</option>
                        ))}
                      </select>
                    </td>
                    <td className="p-space-3 align-middle">
                      <input
                        type="text"
                        inputMode="decimal"
                        value={item.savings_amount || ''}
                        onChange={event => handleSavingsAmountInput(event.target.value, item.id)}
                        onBlur={event => handleSavingsAmountBlur(event.target.value, item.id)}
                        onFocus={handleAmountInputFocus}
                        placeholder="จำนวนเงินออม"
                        className={`${INPUT} text-right font-[family-name:var(--font-numeric)] tabular-nums`}
                      />
                    </td>
                    <td className="p-space-3 text-center align-middle">
                      <button
                        type="button"
                        className={`mx-auto ${REMOVE_BTN}`}
                        onClick={() => handleDeleteSavingsItem(item.id)}
                        aria-label={`ลบ ${item.savings_type || NAME_FALLBACK}`}
                      >
                        <Icons.X size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
                <tr className="bg-surface-2">
                  <td className="p-space-3 text-sm font-semibold text-primary">รวมเงินออมเดือนนี้</td>
                  <td className="p-space-3 text-right font-[family-name:var(--font-numeric)] text-lg font-semibold tabular-nums text-primary">
                    {formatCurrency(รวมเงินเก็บ)}
                  </td>
                  <td className="p-space-3" />
                </tr>
              </tbody>
            </table>
          </div>

          {/* base tier: C4/C11 cards */}
          <div className="flex flex-col gap-space-3 md:hidden">
            {projection.items.map((item) => (
              <div className="min-h-14 rounded-md border border-border-default bg-surface-2 p-space-4" key={item.id} data-savings-id={item.id}>
                <div className="flex items-center gap-space-2">
                  <select
                    value={item.savings_type || ''}
                    onChange={event => handleSavingsItemChange(item.id, 'savings_type', event.target.value)}
                    className={`${SELECT} flex-1`}
                  >
                    <option value="">ไม่ระบุ</option>
                    {getRowGoalOptions(item.savings_type).map((goalName) => (
                      <option key={goalName} value={goalName}>{goalName}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className={REMOVE_BTN}
                    onClick={() => handleDeleteSavingsItem(item.id)}
                    aria-label={`ลบ ${item.savings_type || NAME_FALLBACK}`}
                  >
                    <Icons.X size={16} />
                  </button>
                </div>
                <input
                  type="text"
                  inputMode="decimal"
                  value={item.savings_amount || ''}
                  onChange={event => handleSavingsAmountInput(event.target.value, item.id)}
                  onBlur={event => handleSavingsAmountBlur(event.target.value, item.id)}
                  onFocus={handleAmountInputFocus}
                  placeholder="จำนวนเงินออม"
                  className={`${INPUT} mt-space-3 text-right font-[family-name:var(--font-numeric)] text-lg font-semibold tabular-nums`}
                />
              </div>
            ))}
            <div className={`${CARD} border-accent/40 bg-accent-muted flex items-center justify-between`}>
              <span className="text-sm font-semibold text-primary">รวมเงินออมเดือนนี้</span>
              <span className="font-[family-name:var(--font-numeric)] text-lg font-semibold tabular-nums text-primary">
                {formatCurrency(รวมเงินเก็บ)}
              </span>
            </div>
          </div>
        </>
      ) : (
        !isLoading && (
          <div className="rounded-md border border-dashed border-border-default bg-sunken p-space-4 text-sm text-secondary">
            ยังไม่มีรายการเงินออมในเดือนนี้ กด &quot;เพิ่มรายการ&quot; เพื่อเริ่มต้น
          </div>
        )
      )}
    </div>
  );
}