/**
 * SavingsGoalTracker - แสดงและจัดการเป้าหมายเงินออม
 * currentAmount คำนวณจาก savings_type ที่ตรงชื่อ goal เท่านั้น
 */
import { useState, useEffect, useCallback, useMemo, useRef, type FormEvent, type SyntheticEvent } from 'react';
import { savingsGoalsAPI, salaryAPI, incomeAPI, expenseAPI, dailyExpenseAPI } from '../../shared/utils/frontend/apiUtils';
import { getSummaryData } from '../../shared/utils/frontend/summaryUtils';
import LoadingSkeleton, { SkeletonBlock } from './LoadingSkeleton';
import { formatCurrency } from '../../shared/utils/frontend/numberUtils';
import { showToast } from '../../shared/utils/frontend/toast';
import { Icons } from './Icons';
import ListToolbar from './ListToolbar';
import { useListCriteria } from '../contexts/ListViewContext';
import { compareListValues, matchesListQuery, projectList } from '../../shared/utils/frontend/listView';
import { useListProjection } from '../../shared/utils/frontend/useListProjection';

interface SavingsGoal {
  _id: string;
  goalName: string;
  description?: string;
  targetAmount?: number;
  currentAmount?: number;
  category?: string;
  priority: string;
  status?: string;
  allocationPercent?: number | string;
  notes?: string;
  metadata?: { progressPercentage?: number; remainingAmount?: number };
  [key: string]: unknown;
}

interface GoalFormState {
  goalName: string;
  description: string;
  targetAmount: string;
  category: string;
  priority: string;
  notes: string;
}

interface GoalAllocationResult {
  goal: SavingsGoal;
  monthlyAlloc: number;
  monthsLeft: number | null;
  completionDate: Date | null;
  allocationPercent: number;
}

interface SavingsGoalTrackerProps {
  refreshTrigger?: number;
  selectedMonth?: string | null;
  onAllocatableChange?: (amount: number) => void;
  onRegisterSave?: (save: (() => void | Promise<unknown>) | null) => void;
  onSaved?: () => void;
}

const CATEGORY_OPTIONS = [
  { value: 'emergency', label: '🛡️ ฉุกเฉิน' },
  { value: 'investment', label: '📈 ลงทุน' },
  { value: 'life_event', label: '🎊 เหตุการณ์สำคัญ' },
  { value: 'travel', label: '✈️ การเดินทาง' },
  { value: 'education', label: '📚 การศึกษา' },
  { value: 'property', label: '🏠 ทรัพย์สิน' },
  { value: 'vehicle', label: '🚗 ยานพาหนะ' },
  { value: 'health', label: '💊 สุขภาพ' },
  { value: 'other', label: '🎯 อื่นๆ' }
];

const CATEGORY_LEGACY_MAP: Record<string, string> = {
  wedding: 'life_event',
  vacation: 'travel',
  home: 'property',
  car: 'vehicle'
};

const PRIORITY_OPTIONS = [
  { value: 'high', label: 'สูง', tone: 'border-neg/40 text-neg' },
  { value: 'medium', label: 'กลาง', tone: 'border-warn/40 text-warn' },
  { value: 'low', label: 'ต่ำ', tone: 'border-pos/40 text-pos' }
];

const THAI_SHORT_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

const FOCUS_RING = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2';
const INPUT = `h-11 w-full rounded-sm border border-border-interactive bg-surface-2 px-space-3 text-base text-primary outline-none ${FOCUS_RING}`;
const ICON_BTN = `flex h-11 w-11 shrink-0 items-center justify-center rounded-sm text-secondary ${FOCUS_RING}`;

function formatCompletion(monthsLeft: number | null, completionDate: Date | null): string {
  if (monthsLeft == null) return 'เดือนนี้ยังไม่ได้รับการจัดสรร';
  if (monthsLeft === 0) return 'ครบแล้ว';
  const label = completionDate
    ? ` (${THAI_SHORT_MONTHS[completionDate.getMonth()]} ${completionDate.getFullYear() + 543})`
    : '';
  return `ครบใน ${monthsLeft} เดือน${label}`;
}

const EMPTY_FORM: GoalFormState = {
  goalName: '',
  description: '',
  targetAmount: '',
  category: 'other',
  priority: 'medium',
  notes: ''
};

function parseAllocationPercent(value: unknown): number {
  const parsed = Number.parseFloat(String(value ?? '').replace(/,/g, ''));
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.min(100, parsed);
}

function normalizeAllocationMap(map: Record<string, unknown>, goals: SavingsGoal[]): Record<string, number> {
  const normalized: Record<string, number> = {};
  goals.forEach(goal => { normalized[goal._id] = parseAllocationPercent(map[goal._id]); });
  return normalized;
}

function ProgressBar({ percent, status }: { percent: number; status?: string }) {
  const capped = Math.min(100, Math.max(0, percent || 0));
  const isComplete = capped >= 100 || status === 'completed';
  return (
    <div className="my-space-2 flex items-center gap-space-2">
      <div className="h-3 flex-1 overflow-hidden rounded-full bg-surface-3">
        <div className={`h-full rounded-full transition-[width] duration-slow ease-graphite ${isComplete ? 'bg-pos' : 'bg-accent'}`} style={{ width: `${capped}%` }} />
      </div>
      <span className="w-12 shrink-0 text-right font-[family-name:var(--font-numeric)] text-xs font-semibold tabular-nums text-secondary">{capped.toFixed(1)}%</span>
    </div>
  );
}

export default function SavingsGoalTracker({
  refreshTrigger,
  selectedMonth,
  onAllocatableChange,
  onRegisterSave,
  onSaved
}: SavingsGoalTrackerProps) {
  const [criteria, setCriteria] = useListCriteria('savings-goals');
  const formRef = useRef<HTMLFormElement | null>(null);
  const [goals, setGoals] = useState<SavingsGoal[]>([]);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<GoalFormState>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [plannerOpen, setPlannerOpen] = useState(false);
  const [completedOpen, setCompletedOpen] = useState(false);
  const [dailyExpenseTotal, setDailyExpenseTotal] = useState(0);
  const [plannerNetIncome, setPlannerNetIncome] = useState<number | null>(null);
  const [plannerLoading, setPlannerLoading] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [allocationInputs, setAllocationInputs] = useState<Record<string, string>>({});
  const [lastSavedAllocationInputs, setLastSavedAllocationInputs] = useState<Record<string, number>>({});
  const [savingAllocation, setSavingAllocation] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [loadRevision, setLoadRevision] = useState(0);

  const loadGoals = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const data = await savingsGoalsAPI.getAll() as { goals?: SavingsGoal[] } | null;
      setGoals(data?.goals || []);
      setLoadRevision(value => value + 1);
    } catch (error) {
      console.error('SavingsGoalTracker load error:', error);
      setLoadError(true);
    } finally {
      setLoading(false);
      setDeleteConfirm(null);
    }
  }, []);

  useEffect(() => { void loadGoals(); }, [loadGoals, refreshTrigger]);

  useEffect(() => {
    if (!plannerOpen || !selectedMonth) return undefined;
    let cancelled = false;
    setPlannerNetIncome(null);
    setPlannerLoading(true);
    void (async () => {
      try {
        const year = selectedMonth.split('-')[0];
        const [incomeData, expenseData, salaryData, dailyData] = await Promise.all([
          incomeAPI.getByMonth(selectedMonth),
          expenseAPI.getByMonth(selectedMonth),
          salaryAPI.getByMonth(selectedMonth),
          dailyExpenseAPI.getByMonth(selectedMonth).catch(() => ({ totalMonthly: 0 }))
        ]);
        if (cancelled) return;
        const summary = getSummaryData({ incomeData, expenseData, savingsData: {}, taxData: {}, salaryData, currentMonth: selectedMonth, currentYear: year });
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

  const currentAllocatable = plannerOpen ? Math.max(0, (plannerNetIncome ?? 0) - dailyExpenseTotal) : 0;

  useEffect(() => {
    onAllocatableChange?.(currentAllocatable);
  }, [currentAllocatable, onAllocatableChange]);

  const handleFormChange = (field: keyof GoalFormState, value: string) => {
    setForm(prev => ({ ...prev, [field]: value }));
  };

  const openCreate = () => {
    setForm(EMPTY_FORM);
    setEditingId(null);
    setShowForm(true);
    setTimeout(() => formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
  };

  const openEdit = (goal: SavingsGoal) => {
    setDeleteConfirm(null);
    const category = CATEGORY_LEGACY_MAP[goal.category || ''] || goal.category || 'other';
    setForm({
      goalName: goal.goalName || '',
      description: goal.description || '',
      targetAmount: goal.targetAmount?.toString() || '',
      category: CATEGORY_OPTIONS.some(option => option.value === category) ? category : 'other',
      priority: goal.priority || 'medium',
      notes: goal.notes || ''
    });
    setEditingId(goal._id);
    setShowForm(true);
  };

  const handleCancel = () => {
    setShowForm(false);
    setEditingId(null);
    setForm(EMPTY_FORM);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!form.goalName.trim() || !form.targetAmount) {
      showToast('กรุณากรอกชื่อเป้าหมายและจำนวนเงิน', 'error');
      return;
    }
    setSubmitting(true);
    try {
      const payload = { ...form, targetAmount: parseFloat(form.targetAmount.replace(/,/g, '')) || 0 };
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
    } catch (error) {
      const message = (error as { message?: string } | null)?.message;
      showToast(message || 'เกิดข้อผิดพลาด', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = (goalId: string) => setDeleteConfirm(goalId);

  const handleDeleteConfirmed = async (goalId: string) => {
    setDeleteConfirm(null);
    try {
      await savingsGoalsAPI.delete(goalId);
      showToast('ลบเป้าหมายสำเร็จ');
      await loadGoals();
    } catch {
      showToast('ลบไม่สำเร็จ', 'error');
    }
  };

  const handleMarkComplete = async (goal: SavingsGoal) => {
    try {
      await savingsGoalsAPI.update(goal._id, { status: 'completed' });
      showToast(`"${goal.goalName}" บรรลุเป้าหมายแล้ว! 🎉`);
      await loadGoals();
    } catch {
      showToast('เกิดข้อผิดพลาด', 'error');
    }
  };

  const activeGoals = goals.filter(goal => goal.status !== 'completed' && goal.status !== 'abandoned');
  const completedGoals = goals.filter(goal => goal.status === 'completed');

  useEffect(() => {
    const nextInputs: Record<string, string> = {};
    activeGoals.forEach(goal => {
      const raw = Number(goal.allocationPercent);
      nextInputs[goal._id] = Number.isFinite(raw) && raw > 0 ? String(raw) : '';
    });
    setAllocationInputs(nextInputs);
    setLastSavedAllocationInputs(normalizeAllocationMap(nextInputs, activeGoals));
  }, [goals]);

  const hasUnsavedAllocationChanges = useMemo(() => {
    const current = normalizeAllocationMap(allocationInputs, activeGoals);
    const saved = normalizeAllocationMap(lastSavedAllocationInputs, activeGoals);
    return activeGoals.some(goal => current[goal._id] !== saved[goal._id]);
  }, [allocationInputs, lastSavedAllocationInputs, activeGoals]);

  const manualAllocationTotal = useMemo(
    () => activeGoals.reduce((sum, goal) => sum + parseAllocationPercent(allocationInputs[goal._id]), 0),
    [activeGoals, allocationInputs]
  );

  const allocationResults = useMemo<GoalAllocationResult[]>(() => {
    if (!plannerOpen) return [];
    const allocatableAmount = Math.max(0, (plannerNetIncome ?? 0) - dailyExpenseTotal);
    const remainingOf = (goal: SavingsGoal) => goal.metadata?.remainingAmount ?? Math.max(0, (goal.targetAmount || 0) - (goal.currentAmount || 0));
    const fundableGoals = activeGoals.filter(goal => remainingOf(goal) > 0);

    if (manualAllocationTotal > 0) {
      const tierRank: Record<string, number> = { high: 0, medium: 1, low: 2 };
      return [...activeGoals]
        .sort((a, b) => (tierRank[a.priority] ?? 3) - (tierRank[b.priority] ?? 3))
        .map(goal => {
          const remaining = remainingOf(goal);
          const allocationPercent = parseAllocationPercent(allocationInputs[goal._id]);
          if (remaining <= 0) return { goal, monthlyAlloc: 0, monthsLeft: 0, completionDate: null, allocationPercent };
          const normalizedShare = allocationPercent > 0 ? allocationPercent / manualAllocationTotal : 0;
          const monthlyAlloc = Math.max(0, allocatableAmount * normalizedShare);
          const monthsLeft = monthlyAlloc > 0 ? Math.ceil(remaining / monthlyAlloc) : null;
          const completionDate = monthsLeft != null && monthsLeft > 0 ? (() => { const date = new Date(); date.setMonth(date.getMonth() + monthsLeft); return date; })() : null;
          return { goal, monthlyAlloc, monthsLeft, completionDate, allocationPercent };
        });
    }

    const tierOrder = ['high', 'medium', 'low'];
    const resultMap = new Map<string, Omit<GoalAllocationResult, 'goal' | 'allocationPercent'>>();
    let pool = allocatableAmount;
    for (const tier of tierOrder) {
      const tierGoals = fundableGoals.filter(goal => goal.priority === tier);
      if (!tierGoals.length) continue;
      if (pool <= 0) {
        tierGoals.forEach(goal => resultMap.set(goal._id, { monthlyAlloc: 0, monthsLeft: null, completionDate: null }));
        continue;
      }
      const slice = pool / tierGoals.length;
      let consumed = 0;
      tierGoals.forEach(goal => {
        const remaining = remainingOf(goal);
        const monthsLeft = slice > 0 ? Math.ceil(remaining / slice) : null;
        const completionDate = monthsLeft != null && monthsLeft > 0 ? (() => { const date = new Date(); date.setMonth(date.getMonth() + monthsLeft); return date; })() : null;
        resultMap.set(goal._id, { monthlyAlloc: slice, monthsLeft, completionDate });
        consumed += Math.min(remaining, slice);
      });
      pool = Math.max(0, pool - consumed);
    }
    activeGoals.filter(goal => !resultMap.has(goal._id)).forEach(goal => resultMap.set(goal._id, { monthlyAlloc: 0, monthsLeft: 0, completionDate: null }));
    const tierRank: Record<string, number> = { high: 0, medium: 1, low: 2 };
    return [...activeGoals]
      .sort((a, b) => (tierRank[a.priority] ?? 3) - (tierRank[b.priority] ?? 3))
      .map(goal => ({ goal, ...(resultMap.get(goal._id) || { monthlyAlloc: 0, monthsLeft: null, completionDate: null }), allocationPercent: parseAllocationPercent(allocationInputs[goal._id]) }));
  }, [plannerOpen, plannerNetIncome, dailyExpenseTotal, activeGoals, allocationInputs, manualAllocationTotal]);

  const allocatable = Math.max(0, (plannerNetIncome ?? 0) - dailyExpenseTotal);
  const compareGoals = criteria.order ? (a: SavingsGoal, b: SavingsGoal) => {
    const field = criteria.order.split('-')[0];
    const value = (goal: SavingsGoal) => field === 'name' ? goal.goalName
      : field === 'progress' ? goal.metadata?.progressPercentage
        : goal.metadata?.remainingAmount ?? (goal.targetAmount == null ? undefined : Math.max(0, goal.targetAmount - (goal.currentAmount || 0)));
    return compareListValues(value(a), value(b), criteria.order.endsWith('-desc'));
  } : undefined;
  const goalProjection = useListProjection({
    rows: [...activeGoals, ...completedGoals], getId: goal => goal._id,
    matches: goal => matchesListQuery(goal.goalName, criteria.query)
      && (!criteria.filters.status || goal.status === criteria.filters.status)
      && (!criteria.filters.category || (CATEGORY_LEGACY_MAP[goal.category || ''] || goal.category || 'other') === criteria.filters.category)
      && (!criteria.filters.priority || goal.priority === criteria.filters.priority),
    compare: compareGoals, group: goal => goal.status === 'completed' ? 'completed' : 'active',
    criteriaKey: JSON.stringify(criteria), datasetKey: `${selectedMonth}:${loading}:${loadRevision}`, editable: true
  });
  const visibleActiveGoals = goalProjection.items.filter(goal => goal.status !== 'completed');
  const visibleCompletedGoals = goalProjection.items.filter(goal => goal.status === 'completed');
  const hasGoalRestriction = Boolean(criteria.query || Object.values(criteria.filters).some(Boolean));
  const visibleGoalIds = new Set(goalProjection.items.map(goal => goal._id));
  const visibleAllocations = projectList(allocationResults, result => visibleGoalIds.has(result.goal._id),
    compareGoals ? (a, b) => compareGoals(a.goal, b.goal) : undefined);

  const handleAllocationInputChange = (goalId: string, value: string) => {
    setAllocationInputs(prev => ({ ...prev, [goalId]: value }));
  };

  const handleSaveAllocation = useCallback(async ({ silent = true }: { silent?: boolean } = {}) => {
    if (!activeGoals.length || savingAllocation) return;
    if (!hasUnsavedAllocationChanges) {
      if (!silent) showToast('ไม่มีการเปลี่ยนแปลงสัดส่วน');
      return;
    }
    setSavingAllocation(true);
    try {
      const allocations = activeGoals.map(goal => {
        const percent = parseAllocationPercent(allocationInputs[goal._id]);
        return { goalId: goal._id, allocationPercent: percent > 0 ? Math.round(percent * 100) / 100 : null };
      });
      await savingsGoalsAPI.saveAllocations(allocations);
      setLastSavedAllocationInputs(normalizeAllocationMap(allocationInputs, activeGoals));
      if (!silent) showToast('บันทึกสัดส่วนเงินออมเรียบร้อย');
      onSaved?.();
    } catch (error) {
      const message = (error as { message?: string } | null)?.message;
      if (!silent) showToast(message || 'บันทึกสัดส่วนไม่สำเร็จ', 'error');
    } finally {
      setSavingAllocation(false);
    }
  }, [activeGoals, savingAllocation, hasUnsavedAllocationChanges, allocationInputs, onSaved]);

  useEffect(() => {
    if (!onRegisterSave) return undefined;
    onRegisterSave(() => handleSaveAllocation({ silent: false }));
    return () => onRegisterSave(null);
  }, [onRegisterSave, handleSaveAllocation]);

  return (
    <div className="rounded-md border border-border-default bg-surface-1 p-space-4 shadow-elev-1 md:p-space-5">
      <div className="mb-space-2 flex flex-wrap items-center justify-between gap-space-2">
        <h3 className="flex items-center gap-space-2 text-lg font-medium text-primary"><Icons.Target size={20} />เป้าหมายเงินออม</h3>
        <button type="button" className={`min-h-11 shrink-0 rounded-sm bg-accent px-space-4 text-sm font-medium text-on-accent ${FOCUS_RING}`} onClick={openCreate}>+ เพิ่มเป้าหมาย</button>
      </div>

      <p className="mb-space-4 text-xs italic text-tertiary">ตั้งชื่อรายการออมให้ตรงกับชื่อเป้าหมาย ยอดจะถูกนับเข้า progress อัตโนมัติ</p>
      {!loading && !loadError && <ListToolbar label="เป้าหมายเงินออม" criteria={criteria} onChange={setCriteria}
        visible={goalProjection.items.length} total={activeGoals.length + completedGoals.length}
        changed={goalProjection.changed} onRefresh={goalProjection.refresh} groupNote="เรียงภายในแต่ละกลุ่ม"
        filters={[
          { key: 'status', label: 'สถานะเป้าหมาย', options: [
            { value: 'active', label: 'กำลังออม' }, { value: 'completed', label: 'สำเร็จแล้ว' }
          ] },
          { key: 'category', label: 'หมวดหมู่เป้าหมาย', options: CATEGORY_OPTIONS },
          { key: 'priority', label: 'ความสำคัญเป้าหมาย', options: PRIORITY_OPTIONS }
        ]} orders={[
          { value: 'name-asc', label: 'ชื่อ: ก–ฮ / A–Z' }, { value: 'name-desc', label: 'ชื่อ: ฮ–ก / Z–A' },
          { value: 'progress-asc', label: 'ความคืบหน้า: น้อยไปมาก' }, { value: 'progress-desc', label: 'ความคืบหน้า: มากไปน้อย' },
          { value: 'remaining-asc', label: 'ยอดที่ยังขาด: น้อยไปมาก' }, { value: 'remaining-desc', label: 'ยอดที่ยังขาด: มากไปน้อย' }
        ]} />}
      {loadError && <p role="alert" className="text-sm text-neg">โหลดเป้าหมายเงินออมไม่สำเร็จ <button type="button" className={ICON_BTN} onClick={() => void loadGoals()}>ลองใหม่</button></p>}

      {activeGoals.length > 0 && (
        <>
          <div className="text-sm text-secondary">สัดส่วนรวม: <strong className="font-semibold text-primary">{manualAllocationTotal.toFixed(1)}%</strong>{manualAllocationTotal > 0 && Math.abs(manualAllocationTotal - 100) > 0.1 && <span className="text-tertiary"> (ระบบจะเฉลี่ยตามสัดส่วนที่ใส่)</span>}</div>
          {hasUnsavedAllocationChanges && <div className="-mt-space-1 mb-space-3 text-xs text-tertiary">การเปลี่ยนแปลงสัดส่วนจะถูกบันทึกพร้อมปุ่มบันทึกหลักของหน้าเงินออม</div>}
        </>
      )}

      <details className="mb-space-5 mt-space-5 overflow-hidden rounded-md border border-border-default bg-surface-2" onToggle={(event: SyntheticEvent<HTMLDetailsElement>) => setPlannerOpen(event.currentTarget.open)}>
        <summary className={`flex cursor-pointer select-none items-center justify-between gap-space-2 p-space-3 text-sm font-semibold text-primary marker:content-none [&::-webkit-details-marker]:hidden ${FOCUS_RING}`}><span>{plannerOpen ? '▼' : '▶'} แผนการจัดสรรเงินออม</span></summary>
        <div className="flex flex-col gap-space-3 border-t border-border-subtle p-space-4">
          {activeGoals.length === 0 ? <div className="text-sm text-secondary">เพิ่มเป้าหมายก่อนเพื่อใช้แผนการจัดสรร</div> : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-space-2 text-sm text-secondary"><span>ยอดคงเหลือหลังหักค่าใช้จ่าย:</span><span className="font-semibold text-accent">{plannerLoading ? 'กำลังโหลด...' : plannerNetIncome == null ? 'ไม่พบข้อมูล' : formatCurrency(plannerNetIncome)}</span></div>
              {!plannerLoading && (plannerNetIncome == null || plannerNetIncome <= 0) ? <div className="text-sm text-secondary">ไม่พบข้อมูลรายรับ — กรอกยอดรายรับในแท็บ รายรับ ก่อน</div> : (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-space-2 text-sm text-secondary"><span>ค่าใช้จ่ายรายวัน/เดือน:</span><span className="font-semibold text-accent">{plannerLoading ? 'กำลังโหลด...' : formatCurrency(dailyExpenseTotal)}</span></div>
                  <div className="text-sm text-secondary">เงินที่จัดสรรได้: <span className="text-base font-bold text-accent">{formatCurrency(allocatable)}</span></div>
                  {allocatable <= 0 ? <div className="rounded-sm border border-warn/25 bg-warn/10 p-space-3 text-sm text-warn">⚠ รายรับน้อยกว่าค่าใช้จ่าย ไม่สามารถจัดสรรได้</div> : (
                    <>
                      <div className="my-space-1 h-px bg-border-subtle" />
                      {visibleAllocations.map(({ goal, monthlyAlloc, monthsLeft, completionDate }) => {
                        const priorityInfo = PRIORITY_OPTIONS.find(option => option.value === goal.priority) || PRIORITY_OPTIONS[1];
                        const funded = monthsLeft === 0;
                        const noAlloc = !funded && monthlyAlloc <= 0;
                        return (
                          <div key={goal._id} className="flex flex-col gap-space-1 rounded-sm border border-border-subtle bg-surface-1 p-space-3">
                            <div className="text-sm font-semibold text-primary">{goal.goalName}{' '}<span className={`rounded-full border px-space-2 py-[2px] text-xs font-medium ${priorityInfo.tone}`}>{priorityInfo.label}</span></div>
                            {funded ? <div className="text-sm font-semibold text-pos">ครบแล้ว</div> : noAlloc ? <div className="text-xs text-neg">เดือนนี้ยังไม่ได้รับการจัดสรร</div> : (
                              <div className="flex flex-wrap items-center gap-space-3 text-sm text-secondary"><span className="font-semibold text-accent">ออมเดือนนี้: {formatCurrency(monthlyAlloc)}</span><span className="text-tertiary">{formatCompletion(monthsLeft, completionDate)}</span></div>
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

      {showForm && (
        <form ref={formRef} className="mb-space-5 rounded-md border border-border-subtle bg-surface-2 p-space-4" onSubmit={handleSubmit}>
          <div className="mb-space-3 flex flex-wrap gap-space-3">
            <div className="flex min-w-[140px] flex-1 flex-col gap-space-1"><label className="text-xs font-medium text-secondary">ชื่อเป้าหมาย *</label><input className={INPUT} type="text" value={form.goalName} onChange={event => handleFormChange('goalName', event.target.value)} placeholder="เช่น Emergency Fund, Wedding" required /></div>
            <div className="flex min-w-[140px] flex-1 flex-col gap-space-1"><label className="text-xs font-medium text-secondary">เป้าหมาย (บาท) *</label><input className={`${INPUT} text-right font-[family-name:var(--font-numeric)] tabular-nums`} type="text" inputMode="decimal" value={form.targetAmount} onChange={event => handleFormChange('targetAmount', event.target.value)} placeholder="เช่น 100000" required /></div>
          </div>
          <div className="mb-space-3 flex flex-wrap gap-space-3">
            <div className="flex min-w-[140px] flex-1 flex-col gap-space-1"><label className="text-xs font-medium text-secondary">หมวดหมู่</label><select className={INPUT} value={form.category} onChange={event => handleFormChange('category', event.target.value)}>{CATEGORY_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></div>
            <div className="flex min-w-[140px] flex-1 flex-col gap-space-1"><label className="text-xs font-medium text-secondary">ความสำคัญ</label><select className={INPUT} value={form.priority} onChange={event => handleFormChange('priority', event.target.value)}>{PRIORITY_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></div>
          </div>
          <div className="mb-space-3 flex flex-col gap-space-1"><label className="text-xs font-medium text-secondary">คำอธิบาย</label><input className={INPUT} type="text" value={form.description} onChange={event => handleFormChange('description', event.target.value)} placeholder="คำอธิบายเพิ่มเติม (ไม่บังคับ)" /></div>
          <div className="flex gap-space-3">
            <button className={`min-h-11 rounded-sm bg-accent px-space-5 text-sm font-semibold text-on-accent disabled:opacity-50 ${FOCUS_RING}`} type="submit" disabled={submitting}>{submitting ? 'กำลังบันทึก...' : editingId ? 'อัปเดต' : 'สร้างเป้าหมาย'}</button>
            <button className={`min-h-11 rounded-sm border border-border-interactive px-space-4 text-sm text-secondary ${FOCUS_RING}`} type="button" onClick={handleCancel}>ยกเลิก</button>
          </div>
        </form>
      )}

      {loading && activeGoals.length === 0 && (
        <LoadingSkeleton label="กำลังโหลด..." className="flex flex-col gap-space-4">
          {[0, 1].map(index => (
            <div key={index} className="rounded-md border border-border-default bg-surface-2 p-space-4">
              <div className="mb-space-2 flex flex-wrap items-center justify-between gap-space-2"><div className="flex flex-wrap items-center gap-space-2"><SkeletonBlock on="surface-2" className="h-6 w-[88px] rounded-full" /><SkeletonBlock on="surface-2" className="h-6 w-[56px] rounded-full" /><SkeletonBlock on="surface-2" className="h-11 w-[104px]" /></div><div className="flex items-center gap-space-1"><SkeletonBlock on="surface-2" className="h-11 w-11" /><SkeletonBlock on="surface-2" className="h-11 w-11" /></div></div>
              <SkeletonBlock on="surface-2" className="mb-space-1 h-[26px] w-[160px]" />
              <div className="my-space-2 flex items-center gap-space-2"><SkeletonBlock on="surface-2" className="h-3 flex-1 rounded-full" /><SkeletonBlock on="surface-2" className="h-[18px] w-12" /></div>
              <div className="mt-space-1 flex items-center justify-between gap-space-1"><SkeletonBlock on="surface-2" className="h-[22px] w-[140px]" /><SkeletonBlock on="surface-2" className="h-[22px] w-[110px]" /></div>
              <SkeletonBlock on="surface-2" className="mt-space-1 h-[18px] w-[120px]" />
            </div>
          ))}
        </LoadingSkeleton>
      )}

      {!loading && !loadError && goals.length === 0 && !showForm && <div className="rounded-md border border-dashed border-border-default bg-sunken py-space-6 text-center text-secondary"><p>ยังไม่มีเป้าหมายเงินออม</p><p className="mt-space-1 text-xs italic text-tertiary">กดปุ่ม &quot;เพิ่มเป้าหมาย&quot; เพื่อเริ่มต้น</p></div>}

      <div className="flex flex-col gap-space-4" aria-busy={loading && activeGoals.length > 0 ? 'true' : undefined}>
        {visibleActiveGoals.map(goal => {
          const pct = goal.metadata?.progressPercentage || 0;
          const current = goal.currentAmount || 0;
          const target = goal.targetAmount || 0;
          const remaining = goal.metadata?.remainingAmount ?? Math.max(0, target - current);
          const priorityInfo = PRIORITY_OPTIONS.find(option => option.value === goal.priority) || PRIORITY_OPTIONS[1];
          const resolvedCategory = CATEGORY_LEGACY_MAP[goal.category || ''] || goal.category;
          const categoryInfo = CATEGORY_OPTIONS.find(option => option.value === resolvedCategory) || CATEGORY_OPTIONS.find(option => option.value === 'other')!;
          return (
            <div key={goal._id} className="rounded-md border border-border-default bg-surface-2 p-space-4">
              <div className="mb-space-2 flex flex-wrap items-center justify-between gap-space-2">
                <div className="flex flex-wrap items-center gap-space-2">
                  <span className="rounded-full border border-border-subtle bg-surface-3 px-space-2 py-[2px] text-xs text-secondary">{categoryInfo.label}</span>
                  <span className={`rounded-full border px-space-2 py-[2px] text-xs font-medium ${priorityInfo.tone}`}>{priorityInfo.label}</span>
                  <div className="inline-flex items-center gap-space-2"><label htmlFor={`card-alloc-${goal._id}`} className="text-xs text-tertiary">สัดส่วน</label><input id={`card-alloc-${goal._id}`} type="text" inputMode="decimal" className={`h-11 w-20 rounded-sm border border-border-interactive bg-surface-1 px-space-2 text-base text-primary outline-none ${FOCUS_RING}`} value={allocationInputs[goal._id] ?? ''} onChange={event => handleAllocationInputChange(goal._id, event.target.value)} placeholder="0" /><span className="text-xs text-secondary">%</span></div>
                </div>
                <div className="flex items-center gap-space-1">
                  <button className={`${ICON_BTN} hover:bg-surface-3`} onClick={() => openEdit(goal)} aria-label={`แก้ไข ${goal.goalName}`} type="button"><Icons.Edit size={16} /></button>
                  {pct >= 100 && <button className={`${ICON_BTN} bg-pos/15 text-pos hover:bg-pos/25`} onClick={() => handleMarkComplete(goal)} aria-label={`ทำเครื่องหมายว่าสำเร็จ ${goal.goalName}`} type="button">✓</button>}
                  <button className={`${ICON_BTN} hover:bg-neg/15 hover:text-neg`} onClick={() => handleDelete(goal._id)} aria-label={`ลบ ${goal.goalName}`} type="button"><Icons.Trash size={16} /></button>
                </div>
              </div>

              {deleteConfirm === goal._id && (
                <div className="mb-space-2 flex flex-wrap items-center gap-space-2 rounded-sm border border-neg/25 bg-neg/10 p-space-3">
                  <span className="min-w-0 flex-1 text-sm text-secondary">ลบ &ldquo;{goal.goalName}&rdquo; ใช่หรือไม่?</span>
                  <button className={`min-h-11 shrink-0 rounded-sm border border-neg px-space-4 text-sm font-semibold text-neg ${FOCUS_RING}`} type="button" onClick={() => handleDeleteConfirmed(goal._id)}>ยืนยัน</button>
                  <button className={`min-h-11 shrink-0 rounded-sm border border-border-interactive px-space-3 text-sm text-secondary ${FOCUS_RING}`} type="button" onClick={() => setDeleteConfirm(null)}>ยกเลิก</button>
                </div>
              )}

              <div className="mb-space-1 text-base font-semibold text-primary">{goal.goalName}</div>
              {goal.description && <div className="mb-space-2 text-sm text-secondary">{goal.description}</div>}
              <ProgressBar percent={pct} status={goal.status} />
              <div className="mt-space-1 flex flex-wrap items-center justify-between gap-space-1 text-sm text-secondary"><span>ออมแล้ว: <strong className="font-semibold text-accent">{formatCurrency(current)}</strong></span><span className="text-tertiary">เป้า: {formatCurrency(target)}</span></div>
              {remaining > 0 && <div className="mt-space-1 text-xs text-tertiary">ยังขาดอีก <strong className="font-semibold text-warn">{formatCurrency(remaining)}</strong></div>}
              {pct >= 100 && <div className="mt-space-2 text-center text-sm font-semibold text-pos">🎉 บรรลุเป้าหมายแล้ว!</div>}
            </div>
          );
        })}
      </div>

      {visibleCompletedGoals.length > 0 && (
        <details className="mt-space-5" open={completedOpen || hasGoalRestriction} onToggle={event => {
          if (!hasGoalRestriction) setCompletedOpen(event.currentTarget.open);
        }}>
          <summary className={`cursor-pointer select-none py-space-2 text-sm font-medium text-secondary marker:content-none [&::-webkit-details-marker]:hidden ${FOCUS_RING}`}>{completedOpen || hasGoalRestriction ? '▼' : '▶'} ✅ เป้าหมายที่สำเร็จแล้ว ({visibleCompletedGoals.length})</summary>
          <div className="flex flex-col gap-space-4">{visibleCompletedGoals.map(goal => (
            <div key={goal._id} className="rounded-md border border-border-default bg-surface-2 p-space-4 opacity-60">
              <div className="mb-space-1 text-base font-semibold text-primary">{goal.goalName}</div><ProgressBar percent={100} status="completed" />
              <div className="mt-space-1 flex flex-wrap items-center justify-between gap-space-1 text-sm text-secondary"><span>ออมแล้ว: <strong className="font-semibold text-accent">{formatCurrency(goal.currentAmount || 0)}</strong></span><span className="text-tertiary">เป้า: {formatCurrency(goal.targetAmount || 0)}</span></div>
              <div className="mt-space-2 text-center text-sm font-semibold text-pos">🎉 สำเร็จ</div>
            </div>
          ))}</div>
        </details>
      )}
    </div>
  );
}