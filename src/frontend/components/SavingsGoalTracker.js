/**
 * SavingsGoalTracker - แสดงและจัดการเป้าหมายเงินออม
 * - แสดง progress bar แต่ละเป้าหมาย
 * - currentAmount คำนวณจาก savings_type ที่ตรงชื่อ goal เท่านั้น
 *
 * Graphite redesign (daily-savings-tax-graphite pass) — Tailwind restyle only, ไม่มี
 * SavingsGoalTracker.module.css อีกต่อไป. ไม่เพิ่ม markDirty ในไฟล์นี้โดยตั้งใจ (AC-30/E20) —
 * openCreate เปิดแค่ฟอร์ม ยังไม่เขียนอะไรจนกว่า handleSubmit จะ POST เอง และ
 * handleDeleteConfirmed ลบผ่าน API ทันทีไม่รอ save ของหน้า ถ้าเพิ่ม markDirty ที่นี่จะทำให้ FAB
 * ค้างโดยไม่มีอะไรให้บันทึก และเด้ง K11 หลอก — ดู spec.md §Files "Explicitly NOT scoped in"
 * และ UX_SPEC §5.1 "Dirty-state coupling".
 */
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { savingsGoalsAPI, salaryAPI, incomeAPI, expenseAPI, dailyExpenseAPI } from '../../shared/utils/frontend/apiUtils';
import { getSummaryData } from '../../shared/utils/frontend/summaryUtils';
import { formatCurrency } from '../../shared/utils/frontend/numberUtils';
import { showToast } from '../../shared/utils/frontend/toast';
import { Icons } from './Icons';

const CATEGORY_OPTIONS = [
  { value: 'emergency', label: '🛡️ ฉุกเฉิน' },
  { value: 'investment', label: '📈 ลงทุน' },
  { value: 'life_event', label: '🎊 เหตุการณ์สำคัญ' },
  { value: 'travel', label: '✈️ การเดินทาง' },
  { value: 'education', label: '📚 การศึกษา' },
  { value: 'property', label: '🏠 ทรัพย์สิน' },
  { value: 'vehicle', label: '🚗 ยานพาหนะ' },
  { value: 'health', label: '💊 สุขภาพ' },
  { value: 'other', label: '🎯 อื่นๆ' },
];

// Backward-compat map: old stored values → new canonical values (display + edit form only; no DB write)
const CATEGORY_LEGACY_MAP = {
  wedding: 'life_event',
  vacation: 'travel',
  home: 'property',
  car: 'vehicle',
};

// tone = Tailwind border/text pair จากโทเค็นความหมาย (K9 — ห้าม hex ตรง ๆ) แทน color hex เดิม
const PRIORITY_OPTIONS = [
  { value: 'high', label: 'สูง', tone: 'border-neg/40 text-neg' },
  { value: 'medium', label: 'กลาง', tone: 'border-warn/40 text-warn' },
  { value: 'low', label: 'ต่ำ', tone: 'border-pos/40 text-pos' },
];

const THAI_SHORT_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

const FOCUS_RING = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2';
const INPUT = `h-11 w-full rounded-sm border border-border-interactive bg-surface-2 px-space-3 text-base text-primary outline-none ${FOCUS_RING}`;
const ICON_BTN = `flex h-11 w-11 shrink-0 items-center justify-center rounded-sm text-secondary ${FOCUS_RING}`;

// "ครบใน N เดือน (MMM YYYY)" — Buddhist-era year to match the rest of the UI.
function formatCompletion(monthsLeft, completionDate) {
  if (monthsLeft == null) return 'เดือนนี้ยังไม่ได้รับการจัดสรร';
  if (monthsLeft === 0) return 'ครบแล้ว';
  const label = completionDate
    ? ` (${THAI_SHORT_MONTHS[completionDate.getMonth()]} ${completionDate.getFullYear() + 543})`
    : '';
  return `ครบใน ${monthsLeft} เดือน${label}`;
}

const EMPTY_FORM = {
  goalName: '',
  description: '',
  targetAmount: '',
  category: 'other',
  priority: 'medium',
  notes: '',
};

function parseAllocationPercent(value) {
  const parsed = Number.parseFloat(String(value ?? '').replace(/,/g, ''));
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.min(100, parsed);
}

function normalizeAllocationMap(map = {}, goals = []) {
  const normalized = {};
  goals.forEach((goal) => {
    normalized[goal._id] = parseAllocationPercent(map[goal._id]);
  });
  return normalized;
}

// K16: ทุก total/hero figure ที่มาจากรายการ C11 ต้องคำนวณสดจากค่าปัจจุบัน — แถบนี้ไม่ใช่ C11 (goal ไม่ใช่
// name+amount row) แต่ยังต้องสะท้อนเปอร์เซ็นต์ปัจจุบันแบบไม่รอ save เหมือนกัน
function ProgressBar({ percent, status }) {
  const capped = Math.min(100, Math.max(0, percent || 0));
  const isComplete = capped >= 100 || status === 'completed';
  return (
    <div className="my-space-2 flex items-center gap-space-2">
      <div className="h-3 flex-1 overflow-hidden rounded-full bg-surface-3">
        <div
          className={`h-full rounded-full transition-[width] duration-slow ease-graphite ${isComplete ? 'bg-pos' : 'bg-accent'}`}
          style={{ width: `${capped}%` }}
        />
      </div>
      <span className="w-12 shrink-0 text-right font-[family-name:var(--font-numeric)] text-xs font-semibold tabular-nums text-secondary">
        {capped.toFixed(1)}%
      </span>
    </div>
  );
}

export default function SavingsGoalTracker({ refreshTrigger, selectedMonth, onAllocatableChange, onRegisterSave, onSaved }) {
  const formRef = useRef(null);
  const [goals, setGoals] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [plannerOpen, setPlannerOpen] = useState(false);
  const [completedOpen, setCompletedOpen] = useState(false);
  const [dailyExpenseTotal, setDailyExpenseTotal] = useState(0);
  const [plannerNetIncome, setPlannerNetIncome] = useState(null); // number|null
  const [plannerLoading, setPlannerLoading] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(null); // goalId pending deletion | null
  const [allocationInputs, setAllocationInputs] = useState({});
  const [lastSavedAllocationInputs, setLastSavedAllocationInputs] = useState({});
  const [savingAllocation, setSavingAllocation] = useState(false);

  const loadGoals = useCallback(async () => {
    setLoading(true);
    try {
      const data = await savingsGoalsAPI.getAll();
      setGoals(data?.goals || []);
    } catch (err) {
      console.error('SavingsGoalTracker load error:', err);
    } finally {
      setLoading(false);
      setDeleteConfirm(null);
    }
  }, []);

  useEffect(() => {
    loadGoals();
  }, [loadGoals, refreshTrigger]);

  // Lazy-fetch the post-expense remaining balance (= income − paid expenses) for the
  // planner, only when the panel is expanded. Uses the same three APIs as getSummaryData
  // so the number matches the ยอดเงินคงเหลือ shown in SummaryReport.
  useEffect(() => {
    if (!plannerOpen || !selectedMonth) return;
    let cancelled = false;
    setPlannerNetIncome(null);
    setPlannerLoading(true);
    (async () => {
      try {
        const year = selectedMonth.split('-')[0];
        const [incomeData, expenseData, salaryData, dailyData] = await Promise.all([
          incomeAPI.getByMonth(selectedMonth),
          expenseAPI.getByMonth(selectedMonth),
          salaryAPI.getByMonth(selectedMonth),
          dailyExpenseAPI.getByMonth(selectedMonth).catch(() => ({ totalMonthly: 0 })),
        ]);
        if (cancelled) return;
        const summary = getSummaryData({
          incomeData,
          expenseData,
          savingsData: {},
          taxData: {},
          salaryData,
          currentMonth: selectedMonth,
          currentYear: year
        });
        setPlannerNetIncome(summary.ยอดเงินคงเหลือ > 0 ? summary.ยอดเงินคงเหลือ : null);
        setDailyExpenseTotal(Number(dailyData?.totalMonthly) || 0);
      } catch {
        if (!cancelled) {
          setPlannerNetIncome(null);
          setDailyExpenseTotal(0);
        }
      } finally {
        if (!cancelled) setPlannerLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [plannerOpen, selectedMonth]);

  // Notify parent of allocatable changes (extracted from useMemo for purity).
  const currentAllocatable = plannerOpen
    ? Math.max(0, (plannerNetIncome ?? 0) - dailyExpenseTotal)
    : 0;

  useEffect(() => {
    if (typeof onAllocatableChange === 'function') {
      onAllocatableChange(currentAllocatable);
    }
  }, [currentAllocatable, onAllocatableChange]);

  const handleFormChange = (field, value) => {
    setForm(prev => ({ ...prev, [field]: value }));
  };

  const openCreate = () => {
    setForm(EMPTY_FORM);
    setEditingId(null);
    setShowForm(true);
    // Scroll to the form so users immediately see the result of clicking the button.
    setTimeout(() => {
      formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 0);
  };

  const openEdit = (goal) => {
    setDeleteConfirm(null);
    setForm({
      goalName: goal.goalName || '',
      description: goal.description || '',
      targetAmount: goal.targetAmount?.toString() || '',
      category: (() => { const r = CATEGORY_LEGACY_MAP[goal.category] || goal.category || 'other'; return CATEGORY_OPTIONS.some(c => c.value === r) ? r : 'other'; })(),
      priority: goal.priority || 'medium',
      notes: goal.notes || '',
    });
    setEditingId(goal._id);
    setShowForm(true);
  };

  const handleCancel = () => {
    setShowForm(false);
    setEditingId(null);
    setForm(EMPTY_FORM);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.goalName.trim() || !form.targetAmount) {
      showToast('กรุณากรอกชื่อเป้าหมายและจำนวนเงิน', 'error');
      return;
    }
    setSubmitting(true);
    try {
      const payload = {
        ...form,
        targetAmount: parseFloat(String(form.targetAmount).replace(/,/g, '')) || 0,
      };
      if (editingId) {
        await savingsGoalsAPI.update(editingId, payload);
        showToast('อัปเดตเป้าหมายสำเร็จ');
      } else {
        await savingsGoalsAPI.create(payload);
        showToast('สร้างเป้าหมายสำเร็จ');
      }
      setShowForm(false);
      setEditingId(null);
      setForm(EMPTY_FORM);
      await loadGoals();
    } catch (err) {
      showToast(err?.message || 'เกิดข้อผิดพลาด', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = (goalId) => {
    setDeleteConfirm(goalId);
  };

  const handleDeleteConfirmed = async (goalId) => {
    setDeleteConfirm(null);
    try {
      await savingsGoalsAPI.delete(goalId);
      showToast('ลบเป้าหมายสำเร็จ');
      await loadGoals();
    } catch (err) {
      showToast('ลบไม่สำเร็จ', 'error');
    }
  };

  const handleMarkComplete = async (goal) => {
    try {
      await savingsGoalsAPI.update(goal._id, { status: 'completed' });
      showToast(`"${goal.goalName}" บรรลุเป้าหมายแล้ว! 🎉`);
      await loadGoals();
    } catch (err) {
      showToast('เกิดข้อผิดพลาด', 'error');
    }
  };

  const activeGoals = goals.filter(g => g.status !== 'completed' && g.status !== 'abandoned');
  const completedGoals = goals.filter(g => g.status === 'completed');

  useEffect(() => {
    const nextInputs = {};
    activeGoals.forEach((goal) => {
      const raw = Number(goal.allocationPercent);
      nextInputs[goal._id] = Number.isFinite(raw) && raw > 0 ? String(raw) : '';
    });
    setAllocationInputs(nextInputs);
    setLastSavedAllocationInputs(normalizeAllocationMap(nextInputs, activeGoals));
  }, [goals]);

  const hasUnsavedAllocationChanges = useMemo(() => {
    const current = normalizeAllocationMap(allocationInputs, activeGoals);
    const saved = normalizeAllocationMap(lastSavedAllocationInputs, activeGoals);
    return activeGoals.some((goal) => current[goal._id] !== saved[goal._id]);
  }, [allocationInputs, lastSavedAllocationInputs, activeGoals]);

  const manualAllocationTotal = useMemo(
    () => activeGoals.reduce((sum, goal) => sum + parseAllocationPercent(allocationInputs[goal._id]), 0),
    [activeGoals, allocationInputs]
  );

  // Compute monthly allocation by user-defined split when available, otherwise fallback to priority waterfall.
  const allocationResults = useMemo(() => {
    if (!plannerOpen) return [];
    const net = plannerNetIncome ?? 0;
    const allocatable = Math.max(0, net - dailyExpenseTotal);

    const remainingOf = (g) =>
      g.metadata?.remainingAmount ?? Math.max(0, (g.targetAmount || 0) - (g.currentAmount || 0));

    const fundableGoals = activeGoals.filter(g => remainingOf(g) > 0);

    if (manualAllocationTotal > 0) {
      const TIER_RANK = { high: 0, medium: 1, low: 2 };
      return [...activeGoals]
        .sort((a, b) => (TIER_RANK[a.priority] ?? 3) - (TIER_RANK[b.priority] ?? 3))
        .map((goal) => {
          const rem = remainingOf(goal);
          const allocationPercent = parseAllocationPercent(allocationInputs[goal._id]);

          if (rem <= 0) {
            return {
              goal,
              monthlyAlloc: 0,
              monthsLeft: 0,
              completionDate: null,
              allocationPercent
            };
          }

          const normalizedShare = allocationPercent > 0 ? (allocationPercent / manualAllocationTotal) : 0;
          const monthlyAlloc = Math.max(0, allocatable * normalizedShare);
          const monthsLeft = monthlyAlloc > 0 ? Math.ceil(rem / monthlyAlloc) : null;
          const completionDate = (monthsLeft != null && monthsLeft > 0)
            ? (() => { const d = new Date(); d.setMonth(d.getMonth() + monthsLeft); return d; })()
            : null;

          return {
            goal,
            monthlyAlloc,
            monthsLeft,
            completionDate,
            allocationPercent
          };
        });
    }

    const TIER_ORDER = ['high', 'medium', 'low'];
    const resultMap = new Map();
    let pool = allocatable;

    for (const tier of TIER_ORDER) {
      const tierGoals = fundableGoals.filter(g => g.priority === tier);
      if (tierGoals.length === 0) continue;
      if (pool <= 0) {
        tierGoals.forEach(g => resultMap.set(g._id, { monthlyAlloc: 0, monthsLeft: null, completionDate: null }));
        continue;
      }
      const slice = pool / tierGoals.length;
      let consumed = 0;
      tierGoals.forEach(g => {
        const rem = remainingOf(g);
        const monthsLeft = slice > 0 ? Math.ceil(rem / slice) : null;
        const completionDate = (monthsLeft != null && monthsLeft > 0)
          ? (() => { const d = new Date(); d.setMonth(d.getMonth() + monthsLeft); return d; })()
          : null;
        resultMap.set(g._id, { monthlyAlloc: slice, monthsLeft, completionDate });
        consumed += Math.min(rem, slice);
      });
      // Surplus from goals funded before the slice runs out flows to the next tier.
      pool = Math.max(0, pool - consumed);
    }

    // Goals already funded (remainingAmount <= 0) but still active.
    activeGoals
      .filter(g => !resultMap.has(g._id))
      .forEach(g => resultMap.set(g._id, { monthlyAlloc: 0, monthsLeft: 0, completionDate: null }));

    // Render in allocation order: high → medium → low, then any leftover.
    const TIER_RANK = { high: 0, medium: 1, low: 2 };
    return [...activeGoals]
      .sort((a, b) => (TIER_RANK[a.priority] ?? 3) - (TIER_RANK[b.priority] ?? 3))
      .map(g => ({
        goal: g,
        ...(resultMap.get(g._id) || {}),
        allocationPercent: parseAllocationPercent(allocationInputs[g._id])
      }));
  }, [plannerOpen, plannerNetIncome, dailyExpenseTotal, activeGoals, allocationInputs, manualAllocationTotal]);

  const allocatable = Math.max(0, (plannerNetIncome ?? 0) - dailyExpenseTotal);

  const handleAllocationInputChange = (goalId, value) => {
    setAllocationInputs(prev => ({ ...prev, [goalId]: value }));
  };

  const handleSaveAllocation = async ({ silent = true } = {}) => {
    if (activeGoals.length === 0) return;
    if (savingAllocation) return;
    if (!hasUnsavedAllocationChanges) {
      if (!silent) showToast('ไม่มีการเปลี่ยนแปลงสัดส่วน');
      return;
    }
    setSavingAllocation(true);
    try {
      const allocations = activeGoals.map((goal) => {
        const percent = parseAllocationPercent(allocationInputs[goal._id]);
        return {
          goalId: goal._id,
          allocationPercent: percent > 0 ? Math.round(percent * 100) / 100 : null
        };
      });
      await savingsGoalsAPI.saveAllocations(allocations);
      setLastSavedAllocationInputs(normalizeAllocationMap(allocationInputs, activeGoals));
      if (!silent) showToast('บันทึกสัดส่วนเงินออมเรียบร้อย');
      onSaved?.();
    } catch (err) {
      if (!silent) showToast(err?.message || 'บันทึกสัดส่วนไม่สำเร็จ', 'error');
    } finally {
      setSavingAllocation(false);
    }
  };

  // ลงทะเบียนฟังก์ชันบันทึกกับ ref ของ WorkspaceShell แทนตัวนับ Save All เดิม (Amendment A5)
  // silent: false (ต่างจาก Save All เดิมที่ silent: true เสมอ) — ปุ่มนี้ตอนนี้เป็นปุ่มบันทึกของหน้า
  // /workspace/savings/goals โดยตรงแล้ว ไม่ใช่ผู้เข้าร่วม batch save ที่ toast แทนใครไม่ได้อีกต่อไป
  // (ADR-018 §2 — "การบันทึกเดียวในแอปที่ไม่มี feedback เลย" ถูกปิดแล้ว, AC-A5-15) ใช้ flag
  // savingAllocation เดิม (:104, guard ที่ :384) ไม่เพิ่ม isSaving ตัวที่สอง — ซ้อนกับ isSaving ของ
  // WorkspaceShell ได้อย่างไม่มีปัญหา (double-guard เฉย ๆ)
  useEffect(() => {
    if (!onRegisterSave) return undefined;
    onRegisterSave(() => handleSaveAllocation({ silent: false }));
    return () => onRegisterSave(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onRegisterSave, handleSaveAllocation]);

  return (
    <div className="rounded-md border border-border-default bg-surface-1 p-space-4 shadow-elev-1 md:p-space-5">
      {/* Header */}
      <div className="mb-space-2 flex flex-wrap items-center justify-between gap-space-2">
        <h3 className="flex items-center gap-space-2 text-lg font-medium text-primary">
          <Icons.Target size={20} />
          เป้าหมายเงินออม
        </h3>
        <button
          type="button"
          className={`min-h-11 shrink-0 rounded-sm bg-accent px-space-4 text-sm font-medium text-on-accent ${FOCUS_RING}`}
          onClick={openCreate}
        >
          + เพิ่มเป้าหมาย
        </button>
      </div>

      {/* Hint */}
      <p className="mb-space-4 text-xs italic text-tertiary">
        ตั้งชื่อรายการออมให้ตรงกับชื่อเป้าหมาย ยอดจะถูกนับเข้า progress อัตโนมัติ
      </p>

      {activeGoals.length > 0 && (
        <>
          <div className="text-sm text-secondary">
            สัดส่วนรวม: <strong className="font-semibold text-primary">{manualAllocationTotal.toFixed(1)}%</strong>
            {manualAllocationTotal > 0 && Math.abs(manualAllocationTotal - 100) > 0.1 && (
              <span className="text-tertiary"> (ระบบจะเฉลี่ยตามสัดส่วนที่ใส่)</span>
            )}
          </div>
          {hasUnsavedAllocationChanges && (
            <div className="-mt-space-1 mb-space-3 text-xs text-tertiary">การเปลี่ยนแปลงสัดส่วนจะถูกบันทึกพร้อมปุ่มบันทึกหลักของหน้าเงินออม</div>
          )}
        </>
      )}

      {/* Allocation Planner */}
      <details
        className="mb-space-5 mt-space-5 overflow-hidden rounded-md border border-border-default bg-surface-2"
        onToggle={(e) => setPlannerOpen(e.target.open)}
      >
        <summary className={`flex cursor-pointer select-none items-center justify-between gap-space-2 p-space-3 text-sm font-semibold text-primary marker:content-none [&::-webkit-details-marker]:hidden ${FOCUS_RING}`}>
          <span>{plannerOpen ? '▼' : '▶'} แผนการจัดสรรเงินออม</span>
        </summary>
        <div className="flex flex-col gap-space-3 border-t border-border-subtle p-space-4">
          {activeGoals.length === 0 ? (
            <div className="text-sm text-secondary">เพิ่มเป้าหมายก่อนเพื่อใช้แผนการจัดสรร</div>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-space-2 text-sm text-secondary">
                <span>ยอดคงเหลือหลังหักค่าใช้จ่าย:</span>
                <span className="font-semibold text-accent">
                  {plannerLoading
                    ? 'กำลังโหลด...'
                    : (plannerNetIncome == null
                        ? 'ไม่พบข้อมูล'
                        : formatCurrency(plannerNetIncome))}
                </span>
              </div>

              {!plannerLoading && (plannerNetIncome == null || plannerNetIncome <= 0) ? (
                <div className="text-sm text-secondary">
                  ไม่พบข้อมูลรายรับ — กรอกยอดรายรับในแท็บ รายรับ ก่อน
                </div>
              ) : (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-space-2 text-sm text-secondary">
                    <span>ค่าใช้จ่ายรายวัน/เดือน:</span>
                    <span className="font-semibold text-accent">
                      {plannerLoading ? 'กำลังโหลด...' : formatCurrency(dailyExpenseTotal)}
                    </span>
                  </div>

                  <div className="text-sm text-secondary">
                    เงินที่จัดสรรได้:{' '}
                    <span className="text-base font-bold text-accent">{formatCurrency(allocatable)}</span>
                  </div>

                  {allocatable <= 0 ? (
                    <div className="rounded-sm border border-warn/25 bg-warn/10 p-space-3 text-sm text-warn">
                      ⚠ รายรับน้อยกว่าค่าใช้จ่าย ไม่สามารถจัดสรรได้
                    </div>
                  ) : (
                    <>
                      <div className="my-space-1 h-px bg-border-subtle" />
                      {allocationResults.map(({ goal, monthlyAlloc, monthsLeft, completionDate }) => {
                        const priorityInfo = PRIORITY_OPTIONS.find(p => p.value === goal.priority) || PRIORITY_OPTIONS[1];
                        const funded = monthsLeft === 0;
                        const noAlloc = !funded && (monthlyAlloc || 0) <= 0;
                        return (
                          <div key={goal._id} className="flex flex-col gap-space-1 rounded-sm border border-border-subtle bg-surface-1 p-space-3">
                            <div className="text-sm font-semibold text-primary">
                              {goal.goalName}{' '}
                              <span className={`rounded-full border px-space-2 py-[2px] text-xs font-medium ${priorityInfo.tone}`}>
                                {priorityInfo.label}
                              </span>
                            </div>
                            {funded ? (
                              <div className="text-sm font-semibold text-pos">ครบแล้ว</div>
                            ) : noAlloc ? (
                              <div className="text-xs text-neg">เดือนนี้ยังไม่ได้รับการจัดสรร</div>
                            ) : (
                              <div className="flex flex-wrap items-center gap-space-3 text-sm text-secondary">
                                <span className="font-semibold text-accent">
                                  ออมเดือนนี้: {formatCurrency(monthlyAlloc)}
                                </span>
                                <span className="text-tertiary">
                                  {formatCompletion(monthsLeft, completionDate)}
                                </span>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </details>

      {/* Form */}
      {showForm && (
        <form ref={formRef} className="mb-space-5 rounded-md border border-border-subtle bg-surface-2 p-space-4" onSubmit={handleSubmit}>
          <div className="mb-space-3 flex flex-wrap gap-space-3">
            <div className="flex min-w-[140px] flex-1 flex-col gap-space-1">
              <label className="text-xs font-medium text-secondary">ชื่อเป้าหมาย *</label>
              <input
                className={INPUT}
                type="text"
                value={form.goalName}
                onChange={e => handleFormChange('goalName', e.target.value)}
                placeholder="เช่น Emergency Fund, Wedding"
                required
              />
            </div>
            <div className="flex min-w-[140px] flex-1 flex-col gap-space-1">
              <label className="text-xs font-medium text-secondary">เป้าหมาย (บาท) *</label>
              <input
                className={`${INPUT} text-right font-[family-name:var(--font-numeric)] tabular-nums`}
                type="text"
                inputMode="decimal"
                value={form.targetAmount}
                onChange={e => handleFormChange('targetAmount', e.target.value)}
                placeholder="เช่น 100000"
                required
              />
            </div>
          </div>
          <div className="mb-space-3 flex flex-wrap gap-space-3">
            <div className="flex min-w-[140px] flex-1 flex-col gap-space-1">
              <label className="text-xs font-medium text-secondary">หมวดหมู่</label>
              <select
                className={INPUT}
                value={form.category}
                onChange={e => handleFormChange('category', e.target.value)}
              >
                {CATEGORY_OPTIONS.map(c => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </div>
            <div className="flex min-w-[140px] flex-1 flex-col gap-space-1">
              <label className="text-xs font-medium text-secondary">ความสำคัญ</label>
              <select
                className={INPUT}
                value={form.priority}
                onChange={e => handleFormChange('priority', e.target.value)}
              >
                {PRIORITY_OPTIONS.map(p => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="mb-space-3 flex flex-col gap-space-1">
            <label className="text-xs font-medium text-secondary">คำอธิบาย</label>
            <input
              className={INPUT}
              type="text"
              value={form.description}
              onChange={e => handleFormChange('description', e.target.value)}
              placeholder="คำอธิบายเพิ่มเติม (ไม่บังคับ)"
            />
          </div>
          <div className="flex gap-space-3">
            <button
              className={`min-h-11 rounded-sm bg-accent px-space-5 text-sm font-semibold text-on-accent disabled:opacity-50 ${FOCUS_RING}`}
              type="submit"
              disabled={submitting}
            >
              {submitting ? 'กำลังบันทึก...' : (editingId ? 'อัปเดต' : 'สร้างเป้าหมาย')}
            </button>
            <button
              className={`min-h-11 rounded-sm border border-border-interactive px-space-4 text-sm text-secondary ${FOCUS_RING}`}
              type="button"
              onClick={handleCancel}
            >
              ยกเลิก
            </button>
          </div>
        </form>
      )}

      {/* Loading */}
      {loading && <div className="py-space-5 text-center text-sm text-secondary">กำลังโหลด...</div>}

      {/* Active Goals */}
      {!loading && activeGoals.length === 0 && !showForm && (
        <div className="rounded-md border border-dashed border-border-default bg-sunken py-space-6 text-center text-secondary">
          <p>ยังไม่มีเป้าหมายเงินออม</p>
          <p className="mt-space-1 text-xs italic text-tertiary">กดปุ่ม &quot;เพิ่มเป้าหมาย&quot; เพื่อเริ่มต้น</p>
        </div>
      )}

      <div className="flex flex-col gap-space-4">
        {activeGoals.map(goal => {
          const pct = goal.metadata?.progressPercentage || 0;
          const current = goal.currentAmount || 0;
          const target = goal.targetAmount || 0;
          const remaining = goal.metadata?.remainingAmount ?? Math.max(0, target - current);
          const priorityInfo = PRIORITY_OPTIONS.find(p => p.value === goal.priority) || PRIORITY_OPTIONS[1];
          const resolvedCategory = CATEGORY_LEGACY_MAP[goal.category] || goal.category;
          const categoryInfo = CATEGORY_OPTIONS.find(c => c.value === resolvedCategory)
            || CATEGORY_OPTIONS.find(c => c.value === 'other');

          return (
            <div key={goal._id} className="rounded-md border border-border-default bg-surface-2 p-space-4">
              <div className="mb-space-2 flex flex-wrap items-center justify-between gap-space-2">
                <div className="flex flex-wrap items-center gap-space-2">
                  <span className="rounded-full border border-border-subtle bg-surface-3 px-space-2 py-[2px] text-xs text-secondary">{categoryInfo.label}</span>
                  <span className={`rounded-full border px-space-2 py-[2px] text-xs font-medium ${priorityInfo.tone}`}>
                    {priorityInfo.label}
                  </span>
                  <div className="inline-flex items-center gap-space-2">
                    <label htmlFor={`card-alloc-${goal._id}`} className="text-xs text-tertiary">สัดส่วน</label>
                    <input
                      id={`card-alloc-${goal._id}`}
                      type="text"
                      inputMode="decimal"
                      className={`h-11 w-20 rounded-sm border border-border-interactive bg-surface-1 px-space-2 text-base text-primary outline-none ${FOCUS_RING}`}
                      value={allocationInputs[goal._id] ?? ''}
                      onChange={(e) => handleAllocationInputChange(goal._id, e.target.value)}
                      placeholder="0"
                    />
                    <span className="text-xs text-secondary">%</span>
                  </div>
                </div>
                <div className="flex items-center gap-space-1">
                  <button
                    className={`${ICON_BTN} hover:bg-surface-3`}
                    onClick={() => openEdit(goal)}
                    aria-label={`แก้ไข ${goal.goalName}`}
                    type="button"
                  >
                    <Icons.Edit size={16} />
                  </button>
                  {pct >= 100 && (
                    <button
                      className={`${ICON_BTN} bg-pos/15 text-pos hover:bg-pos/25`}
                      onClick={() => handleMarkComplete(goal)}
                      aria-label={`ทำเครื่องหมายว่าสำเร็จ ${goal.goalName}`}
                      type="button"
                    >
                      ✓
                    </button>
                  )}
                  <button
                    className={`${ICON_BTN} hover:bg-neg/15 hover:text-neg`}
                    onClick={() => handleDelete(goal._id)}
                    aria-label={`ลบ ${goal.goalName}`}
                    type="button"
                  >
                    <Icons.Trash size={16} />
                  </button>
                </div>
              </div>

              {deleteConfirm === goal._id && (
                <div className="mb-space-2 flex flex-wrap items-center gap-space-2 rounded-sm border border-neg/25 bg-neg/10 p-space-3">
                  <span className="min-w-0 flex-1 text-sm text-secondary">
                    ลบ &ldquo;{goal.goalName}&rdquo; ใช่หรือไม่?
                  </span>
                  <button
                    className={`min-h-11 shrink-0 rounded-sm border border-neg px-space-4 text-sm font-semibold text-neg ${FOCUS_RING}`}
                    type="button"
                    onClick={() => handleDeleteConfirmed(goal._id)}
                  >
                    ยืนยัน
                  </button>
                  <button
                    className={`min-h-11 shrink-0 rounded-sm border border-border-interactive px-space-3 text-sm text-secondary ${FOCUS_RING}`}
                    type="button"
                    onClick={() => setDeleteConfirm(null)}
                  >
                    ยกเลิก
                  </button>
                </div>
              )}

              <div className="mb-space-1 text-base font-semibold text-primary">{goal.goalName}</div>
              {goal.description && <div className="mb-space-2 text-sm text-secondary">{goal.description}</div>}

              <ProgressBar percent={pct} status={goal.status} />

              <div className="mt-space-1 flex flex-wrap items-center justify-between gap-space-1 text-sm text-secondary">
                <span>
                  ออมแล้ว: <strong className="font-semibold text-accent">{formatCurrency(current)}</strong>
                </span>
                <span className="text-tertiary">
                  เป้า: {formatCurrency(target)}
                </span>
              </div>
              {remaining > 0 && (
                <div className="mt-space-1 text-xs text-tertiary">
                  ยังขาดอีก <strong className="font-semibold text-warn">{formatCurrency(remaining)}</strong>
                </div>
              )}
              {pct >= 100 && (
                <div className="mt-space-2 text-center text-sm font-semibold text-pos">🎉 บรรลุเป้าหมายแล้ว!</div>
              )}
            </div>
          );
        })}
      </div>

      {/* Completed Goals (collapsed) */}
      {completedGoals.length > 0 && (
        <details className="mt-space-5" onToggle={(e) => setCompletedOpen(e.target.open)}>
          <summary className={`cursor-pointer select-none py-space-2 text-sm font-medium text-secondary marker:content-none [&::-webkit-details-marker]:hidden ${FOCUS_RING}`}>
            {completedOpen ? '▼' : '▶'} ✅ เป้าหมายที่สำเร็จแล้ว ({completedGoals.length})
          </summary>
          <div className="flex flex-col gap-space-4">
            {completedGoals.map(goal => (
              <div key={goal._id} className="rounded-md border border-border-default bg-surface-2 p-space-4 opacity-60">
                <div className="mb-space-1 text-base font-semibold text-primary">{goal.goalName}</div>
                <ProgressBar percent={100} status="completed" />
                <div className="mt-space-1 flex flex-wrap items-center justify-between gap-space-1 text-sm text-secondary">
                  <span>
                    ออมแล้ว: <strong className="font-semibold text-accent">{formatCurrency(goal.currentAmount || 0)}</strong>
                  </span>
                  <span className="text-tertiary">
                    เป้า: {formatCurrency(goal.targetAmount || 0)}
                  </span>
                </div>
                <div className="mt-space-2 text-center text-sm font-semibold text-pos">🎉 สำเร็จ</div>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
