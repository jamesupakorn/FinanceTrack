/**
 * SavingsGoalTracker - แสดงและจัดการเป้าหมายเงินออม
 * - แสดง progress bar แต่ละเป้าหมาย
 * - currentAmount คำนวณจาก savings_type ที่ตรงชื่อ goal เท่านั้น
 */
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { savingsGoalsAPI, salaryAPI, incomeAPI, expenseAPI, dailyExpenseAPI } from '../../shared/utils/frontend/apiUtils';
import { getSummaryData } from '../../shared/utils/frontend/summaryUtils';
import { formatCurrency } from '../../shared/utils/frontend/numberUtils';
import { showToast } from '../../shared/utils/frontend/toast';
import { Icons } from './Icons';
import styles from '../styles/SavingsGoalTracker.module.css';

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

const PRIORITY_OPTIONS = [
  { value: 'high', label: 'สูง', color: '#ef4444' },
  { value: 'medium', label: 'กลาง', color: '#f59e0b' },
  { value: 'low', label: 'ต่ำ', color: '#22c55e' },
];

const THAI_SHORT_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

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

function ProgressBar({ percent, status }) {
  const capped = Math.min(100, Math.max(0, percent || 0));
  const isComplete = capped >= 100 || status === 'completed';
  return (
    <div className={styles.progressBarTrack}>
      <div
        className={`${styles.progressBarFill} ${isComplete ? styles.progressComplete : ''}`}
        style={{ width: `${capped}%` }}
      />
      <span className={styles.progressLabel}>{capped.toFixed(1)}%</span>
    </div>
  );
}

export default function SavingsGoalTracker({ refreshTrigger, selectedMonth, onAllocatableChange, triggerSave }) {
  const formRef = useRef(null);
  const lastSaveTriggerRef = useRef(triggerSave);
  const [goals, setGoals] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [plannerOpen, setPlannerOpen] = useState(false);
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
    } catch (err) {
      if (!silent) showToast(err?.message || 'บันทึกสัดส่วนไม่สำเร็จ', 'error');
    } finally {
      setSavingAllocation(false);
    }
  };

  useEffect(() => {
    if (triggerSave === lastSaveTriggerRef.current) return;
    lastSaveTriggerRef.current = triggerSave;
    if (!triggerSave || triggerSave <= 0) return;
    handleSaveAllocation({ silent: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [triggerSave]);

  return (
    <div className={styles.container}>
      {/* Header */}
      <div className={styles.header}>
        <h3 className={styles.title}>
          <Icons.Target size={20} color="var(--secondary-color)" />
          เป้าหมายเงินออม
        </h3>
        <button className={styles.addGoalBtn} onClick={openCreate} type="button">
          <Icons.Plus size={16} color="white" />
          เพิ่มเป้าหมาย
        </button>
      </div>

      {/* Hint */}
      <p className={styles.hint}>
        ตั้งชื่อรายการออมให้ตรงกับชื่อเป้าหมาย ยอดจะถูกนับเข้า progress อัตโนมัติ
      </p>

      {activeGoals.length > 0 && (
        <>
          <div className={styles.plannerSplitSummary}>
            สัดส่วนรวม: <strong>{manualAllocationTotal.toFixed(1)}%</strong>
            {manualAllocationTotal > 0 && Math.abs(manualAllocationTotal - 100) > 0.1 && (
              <span className={styles.plannerSplitHint}> (ระบบจะเฉลี่ยตามสัดส่วนที่ใส่)</span>
            )}
          </div>
          {hasUnsavedAllocationChanges && (
            <div className={styles.saveHint}>การเปลี่ยนแปลงสัดส่วนจะถูกบันทึกพร้อมปุ่มบันทึกหลักของหน้าเงินออม</div>
          )}
        </>
      )}

      {/* Allocation Planner */}
      <details
        className={styles.plannerSection}
        onToggle={(e) => setPlannerOpen(e.target.open)}
      >
        <summary className={styles.plannerHeader}>แผนการจัดสรรเงินออม</summary>
        <div className={styles.plannerBody}>
          {activeGoals.length === 0 ? (
            <div className={styles.plannerAllocRow}>เพิ่มเป้าหมายก่อนเพื่อใช้แผนการจัดสรร</div>
          ) : (
            <>
              <div className={styles.plannerInfoRow}>
                <span>ยอดคงเหลือหลังหักค่าใช้จ่าย:</span>
                <span className={styles.plannerInfoValue}>
                  {plannerLoading
                    ? 'กำลังโหลด...'
                    : (plannerNetIncome == null
                        ? 'ไม่พบข้อมูล'
                        : formatCurrency(plannerNetIncome))}
                </span>
              </div>

              {!plannerLoading && (plannerNetIncome == null || plannerNetIncome <= 0) ? (
                <div className={styles.plannerAllocRow}>
                  ไม่พบข้อมูลรายรับ — กรอกยอดรายรับในแท็บ รายรับ ก่อน
                </div>
              ) : (
                <>
                  <div className={styles.plannerInfoRow}>
                    <span>ค่าใช้จ่ายรายวัน/เดือน:</span>
                    <span className={styles.plannerInfoValue}>
                      {plannerLoading ? 'กำลังโหลด...' : formatCurrency(dailyExpenseTotal)}
                    </span>
                  </div>

                  <div className={styles.plannerAllocRow}>
                    เงินที่จัดสรรได้:{' '}
                    <span className={styles.plannerAllocValue}>{formatCurrency(allocatable)}</span>
                  </div>

                  {allocatable <= 0 ? (
                    <div className={styles.plannerWarning}>
                      ⚠ รายรับน้อยกว่าค่าใช้จ่าย ไม่สามารถจัดสรรได้
                    </div>
                  ) : (
                    <>
                      <div className={styles.plannerDivider} />
                      {allocationResults.map(({ goal, monthlyAlloc, monthsLeft, completionDate }) => {
                        const priorityInfo = PRIORITY_OPTIONS.find(p => p.value === goal.priority) || PRIORITY_OPTIONS[1];
                        const funded = monthsLeft === 0;
                        const noAlloc = !funded && (monthlyAlloc || 0) <= 0;
                        return (
                          <div key={goal._id} className={styles.plannerGoalRow}>
                            <div className={styles.plannerGoalName}>
                              {goal.goalName}{' '}
                              <span
                                className={styles.priorityBadge}
                                style={{ borderColor: priorityInfo.color, color: priorityInfo.color }}
                              >
                                {priorityInfo.label}
                              </span>
                            </div>
                            {funded ? (
                              <div className={styles.plannerGoalFunded}>ครบแล้ว</div>
                            ) : noAlloc ? (
                              <div className={styles.plannerNoAlloc}>เดือนนี้ยังไม่ได้รับการจัดสรร</div>
                            ) : (
                              <div className={styles.plannerGoalAlloc}>
                                <span className={styles.plannerGoalAllocAmount}>
                                  ออมเดือนนี้: {formatCurrency(monthlyAlloc)}
                                </span>
                                <span className={styles.plannerGoalMonths}>
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
        <form ref={formRef} className={styles.form} onSubmit={handleSubmit}>
          <div className={styles.formRow}>
            <div className={styles.formGroup}>
              <label className={styles.label}>ชื่อเป้าหมาย *</label>
              <input
                className={styles.input}
                type="text"
                value={form.goalName}
                onChange={e => handleFormChange('goalName', e.target.value)}
                placeholder="เช่น Emergency Fund, Wedding"
                required
              />
            </div>
            <div className={styles.formGroup}>
              <label className={styles.label}>เป้าหมาย (บาท) *</label>
              <input
                className={styles.input}
                type="text"
                inputMode="decimal"
                value={form.targetAmount}
                onChange={e => handleFormChange('targetAmount', e.target.value)}
                placeholder="เช่น 100000"
                required
              />
            </div>
          </div>
          <div className={styles.formRow}>
            <div className={styles.formGroup}>
              <label className={styles.label}>หมวดหมู่</label>
              <select
                className={styles.select}
                value={form.category}
                onChange={e => handleFormChange('category', e.target.value)}
              >
                {CATEGORY_OPTIONS.map(c => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </div>
            <div className={styles.formGroup}>
              <label className={styles.label}>ความสำคัญ</label>
              <select
                className={styles.select}
                value={form.priority}
                onChange={e => handleFormChange('priority', e.target.value)}
              >
                {PRIORITY_OPTIONS.map(p => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </select>
            </div>
          </div>
          <div className={styles.formGroup}>
            <label className={styles.label}>คำอธิบาย</label>
            <input
              className={styles.input}
              type="text"
              value={form.description}
              onChange={e => handleFormChange('description', e.target.value)}
              placeholder="คำอธิบายเพิ่มเติม (ไม่บังคับ)"
            />
          </div>
          <div className={styles.formActions}>
            <button className={styles.submitBtn} type="submit" disabled={submitting}>
              {submitting ? 'กำลังบันทึก...' : (editingId ? 'อัปเดต' : 'สร้างเป้าหมาย')}
            </button>
            <button className={styles.cancelBtn} type="button" onClick={handleCancel}>
              ยกเลิก
            </button>
          </div>
        </form>
      )}

      {/* Loading */}
      {loading && <div className={styles.loading}>กำลังโหลด...</div>}

      {/* Active Goals */}
      {!loading && activeGoals.length === 0 && !showForm && (
        <div className={styles.emptyState}>
          <p>ยังไม่มีเป้าหมายเงินออม</p>
          <p className={styles.emptyHint}>กดปุ่ม "เพิ่มเป้าหมาย" เพื่อเริ่มต้น</p>
        </div>
      )}

      <div className={styles.goalList}>
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
            <div key={goal._id} className={styles.goalCard}>
              <div className={styles.goalCardTop}>
                <div className={styles.goalMeta}>
                  <span className={styles.categoryBadge}>{categoryInfo.label}</span>
                  <span
                    className={styles.priorityBadge}
                    style={{ borderColor: priorityInfo.color, color: priorityInfo.color }}
                  >
                    {priorityInfo.label}
                  </span>
                  <div className={styles.goalAllocationControls}>
                    <label htmlFor={`card-alloc-${goal._id}`}>สัดส่วน</label>
                    <input
                      id={`card-alloc-${goal._id}`}
                      type="text"
                      inputMode="decimal"
                      className={styles.goalAllocationInput}
                      value={allocationInputs[goal._id] ?? ''}
                      onChange={(e) => handleAllocationInputChange(goal._id, e.target.value)}
                      placeholder="0"
                    />
                    <span className={styles.goalAllocationUnit}>%</span>
                  </div>

                </div>
                <div className={styles.goalActions}>
                  <button
                    className={styles.editBtn}
                    onClick={() => openEdit(goal)}
                    title="แก้ไข"
                    type="button"
                  >
                    <Icons.Edit size={13} color="currentColor" />
                  </button>
                  {pct >= 100 && (
                    <button
                      className={styles.completeBtn}
                      onClick={() => handleMarkComplete(goal)}
                      title="ทำเครื่องหมายว่าสำเร็จ"
                      type="button"
                    >
                      ✓
                    </button>
                  )}
                  <button
                    className={styles.deleteBtn}
                    onClick={() => handleDelete(goal._id)}
                    title="ลบ"
                    type="button"
                  >
                    <Icons.Trash size={13} color="currentColor" />
                  </button>
                </div>
              </div>

              {deleteConfirm === goal._id && (
                <div className={styles.deleteConfirmRow}>
                  <span className={styles.deleteConfirmText}>
                    ลบ &ldquo;{goal.goalName}&rdquo; ใช่หรือไม่?
                  </span>
                  <button
                    className={styles.deleteConfirmYes}
                    type="button"
                    onClick={() => handleDeleteConfirmed(goal._id)}
                  >
                    ยืนยัน
                  </button>
                  <button
                    className={styles.deleteConfirmNo}
                    type="button"
                    onClick={() => setDeleteConfirm(null)}
                  >
                    ยกเลิก
                  </button>
                </div>
              )}

              <div className={styles.goalName}>{goal.goalName}</div>
              {goal.description && <div className={styles.goalDesc}>{goal.description}</div>}

              <ProgressBar percent={pct} status={goal.status} />

              <div className={styles.goalAmounts}>
                <span className={styles.amountCurrent}>
                  ออมแล้ว: <strong>{formatCurrency(current)}</strong>
                </span>
                <span className={styles.amountTarget}>
                  เป้า: {formatCurrency(target)}
                </span>
              </div>
              {remaining > 0 && (
                <div className={styles.remaining}>
                  ยังขาดอีก <strong>{formatCurrency(remaining)}</strong>
                </div>
              )}
              {pct >= 100 && (
                <div className={styles.goalAchieved}>🎉 บรรลุเป้าหมายแล้ว!</div>
              )}
            </div>
          );
        })}
      </div>

      {/* Completed Goals (collapsed) */}
      {completedGoals.length > 0 && (
        <details className={styles.completedSection}>
          <summary className={styles.completedSummary}>
            ✅ เป้าหมายที่สำเร็จแล้ว ({completedGoals.length})
          </summary>
          <div className={styles.goalList}>
            {completedGoals.map(goal => (
              <div key={goal._id} className={`${styles.goalCard} ${styles.goalCardCompleted}`}>
                <div className={styles.goalName}>{goal.goalName}</div>
                <ProgressBar percent={100} status="completed" />
                <div className={styles.goalAmounts}>
                  <span className={styles.amountCurrent}>
                    ออมแล้ว: <strong>{formatCurrency(goal.currentAmount || 0)}</strong>
                  </span>
                  <span className={styles.amountTarget}>
                    เป้า: {formatCurrency(goal.targetAmount || 0)}
                  </span>
                </div>
                <div className={styles.goalAchieved}>🎉 สำเร็จ</div>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
