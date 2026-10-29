/**
 * หน้า: /credit-cards
 * หน้าจัดการบัตรเครดิตและแผนผ่อนชำระ แยกออกจาก shell ของ edit.js (ADR-008)
 *
 * ข้อมูลบัตร/แผนไม่ผูกกับเดือน จึงตอบสัญญา selectedMonth + triggerSave + Floating Action Bar
 * ของ edit.js ไม่ได้ หน้านี้จึงมี save model ของตัวเอง: บันทึกทันทีต่อ action พร้อม toast
 *
 * มุมมองภายใน 2 แบบ ควบคุมด้วย query string เพื่อให้ deep link และปุ่ม back ทำงาน:
 *   /credit-cards                 → ภาพรวม
 *   /credit-cards?card=<cardId>   → รายละเอียดบัตร (ปลายทางของลิงก์จาก ExpenseTable)
 * ปฏิทินไม่อยู่ในหน้านี้ (ADR-025) — เข้าถึงได้จากเมนู "ปฏิทิน" ของ Layout เท่านั้น
 *
 * Graphite redesign (credit-cards-graphite pass) — เต็มหน้าเปลี่ยนเป็น Tailwind แล้ว ไม่ import
 * CreditCard.module.css / CreditCardForm.module.css อีกต่อไป
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import CreditCardDashboard from '../src/frontend/components/CreditCardDashboard';
import CreditCardDetail from '../src/frontend/components/CreditCardDetail';
import Layout from '../src/frontend/components/Layout';
import CreditCardForm from '../src/frontend/components/CreditCardForm';
import InstallmentPlanForm, {
  type PlanSubmitOptions,
  type PlanSubmitValues,
  type ValidatedPlanValue
} from '../src/frontend/components/InstallmentPlanForm';
import { BackdatedPaidFailureDialog } from '../src/frontend/components/BackdatedInstallmentsDialog';
import { Icons } from '../src/frontend/components/Icons';
import { useSession } from '../src/frontend/contexts/SessionContext';
import { creditCardAPI, expenseAPI, userSettingsAPI } from '../src/shared/utils/frontend/apiUtils';
import type { BankAccount } from '../src/shared/utils/bankAccountShape';
import { applyPaidSequentially } from '../src/shared/utils/installmentBackdate';
import { showToast } from '../src/shared/utils/frontend/toast';
import { formatCurrency } from '../src/shared/utils/frontend/numberUtils';
import { formatMonthKeyTH } from '../src/shared/utils/dateUtils';
import { addMonths, buildSchedule, PLAN_STATUS } from '../src/shared/utils/creditCardUtils';
import { getTabbableElements } from '../src/shared/utils/frontend/focusTrap';
import type { CurrentCycle } from '../src/frontend/components/RevolvingBalanceSection';

const FOCUS_RING = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2';

interface CreditCardRecord {
  id: string;
  name: string;
  bankAccountId?: string;
  color?: string;
  remainingPayable: number | string;
  availableCredit: number | string;
}

interface InstallmentScheduleEntry {
  no: number;
  dueMonth: string;
  payment: number | string;
  principal: number | string;
  interest: number | string;
  paid?: boolean;
}

interface BackdateFailureState {
  cardId: string;
  itemName: string;
  months: number;
  requestedCount: number;
  failed: Array<{ no: number; dueMonth: string }>;
}

interface CreditPlanRecord {
  id: string;
  cardId: string;
  itemName: string;
  totalPrice: number | string;
  monthlyPayment: number | string;
  remainingPayable: number | string;
  months: number;
  status?: string;
  installmentsPaid: number;
  schedule?: InstallmentScheduleEntry[];
  installmentsRemaining?: number;
  progressPercent: number;
  [key: string]: unknown;
}

type PlanFormValues = ValidatedPlanValue;

interface RevolvingPreview {
  remaining: number;
  interest: number;
  closingBalance: number;
}

interface ConfirmState {
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void | Promise<void>;
}

interface ConfirmDialogProps extends ConfirmState {
  open: boolean;
  onCancel: () => void;
  busy: boolean;
}

/** กล่องยืนยันสำหรับ action ที่ทำลายข้อมูลหรือสร้างหนี้ — action อื่นทั้งหมดใช้ toast แทน */
function ConfirmDialog({ open, title, message, confirmLabel, onCancel, onConfirm, busy }: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const confirmButtonRef = useRef<HTMLButtonElement | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const onCancelRef = useRef(onCancel);
  onCancelRef.current = onCancel;

  useEffect(() => {
    if (!open) return undefined;
    triggerRef.current = typeof document !== 'undefined' ? document.activeElement as HTMLElement | null : null;
    const timer = setTimeout(() => confirmButtonRef.current?.focus(), 40);
    return () => clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onCancelRef.current?.();
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = getTabbableElements(dialogRef.current);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      triggerRef.current?.focus?.();
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[110] flex items-end justify-center overflow-y-auto bg-[rgba(10,10,11,0.72)] p-0 backdrop-blur-sm md:items-center md:p-space-5"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div
        ref={dialogRef}
        className="flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-lg bg-surface-3 shadow-elev-3 md:max-h-[85vh] md:max-w-sm md:rounded-lg"
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="flex items-center justify-between gap-space-3 border-b border-border-subtle px-space-5 py-space-4">
          <h2 className="m-0 text-lg font-semibold text-primary">{title}</h2>
          <button
            type="button"
            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-sm text-secondary hover:bg-surface-2 ${FOCUS_RING}`}
            onClick={onCancel}
            aria-label="ปิด"
          >
            <Icons.X size={18} />
          </button>
        </div>
        <div className="flex flex-col gap-space-4 overflow-y-auto px-space-5 py-space-4">
          <p className="m-0 text-sm leading-relaxed text-secondary">{message}</p>
        </div>
        <div className="flex flex-col-reverse items-stretch gap-space-3 border-t border-border-subtle px-space-5 py-space-4 md:flex-row md:items-center md:justify-end">
          <button
            type="button"
            className={`min-h-11 rounded-sm border border-border-interactive bg-surface-2 px-space-4 text-sm font-medium text-primary ${FOCUS_RING}`}
            onClick={onCancel}
          >
            ยกเลิก
          </button>
          <button
            type="button"
            ref={confirmButtonRef}
            className={`min-h-11 rounded-sm border border-neg bg-neg/10 px-space-4 text-sm font-semibold text-neg disabled:opacity-60 ${FOCUS_RING}`}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? 'กำลังดำเนินการ...' : (confirmLabel || 'ยืนยัน')}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function CreditCardsPage() {
  const router = useRouter();
  const { currentUser } = useSession();

  const [cards, setCards] = useState<CreditCardRecord[]>([]);
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [totals, setTotals] = useState<Record<string, unknown> | null>(null);
  const [plans, setPlans] = useState<CreditPlanRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingKeys, setPendingKeys] = useState<string[]>([]);
  const pendingKeysRef = useRef<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [planCreatedNote, setPlanCreatedNote] = useState<string | null>(null);

  const [cardFormOpen, setCardFormOpen] = useState(false);
  const [editingCard, setEditingCard] = useState<CreditCardRecord | null>(null);
  const [planFormOpen, setPlanFormOpen] = useState(false);
  const [editingPlan, setEditingPlan] = useState<CreditPlanRecord | null>(null);
  const [lockedCardId, setLockedCardId] = useState<string | null>(null);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const [backdateFailure, setBackdateFailure] = useState<BackdateFailureState | null>(null);

  const selectedCardId = typeof router.query.card === 'string' ? router.query.card : null;

  const loadData = useCallback(async ({ silent = false }: { silent?: boolean } = {}): Promise<void> => {
    if (!currentUser?.id) return;
    if (!silent) setLoading(true);
    try {
      const [cardsResponse, plansResponse] = await Promise.all([
        creditCardAPI.getCards(),
        creditCardAPI.getPlans()
      ]);
      setCards(Array.isArray(cardsResponse?.cards) ? cardsResponse.cards : []);
      setTotals(cardsResponse?.totals || null);
      setPlans(Array.isArray(plansResponse?.plans) ? plansResponse.plans : []);
      setError(null);
    } catch (loadError) {
      console.error('Error loading credit card data:', loadError);
      const message = (loadError as { message?: string } | null)?.message;
      setError(message || 'โหลดข้อมูลบัตรเครดิตไม่สำเร็จ');
      showToast('โหลดข้อมูลบัตรเครดิตไม่สำเร็จ', 'error');
    } finally {
      setLoading(false);
    }
  }, [currentUser?.id]);

  const loadBankAccounts = useCallback(async (): Promise<void> => {
    if (!currentUser?.id) return;
    try {
      const data = await userSettingsAPI.get();
      if (!Array.isArray(data?.bankAccounts)) throw new Error('Invalid bank account response');
      setBankAccounts(data.bankAccounts);
    } catch (loadError) {
      console.warn('Could not load bank accounts for the card form:', loadError);
    }
  }, [currentUser?.id]);

  useEffect(() => {
    if (currentUser?.id) loadData();
  }, [currentUser?.id, loadData]);

  useEffect(() => {
    setBankAccounts([]);
    if (currentUser?.id) loadBankAccounts();
  }, [currentUser?.id, loadBankAccounts]);

  // ผู้ใช้อาจเพิ่งติ๊กชำระใน edit.js อีกแท็บ — โหลดใหม่เมื่อกลับมาที่หน้านี้
  useEffect(() => {
    if (!currentUser?.id) return undefined;
    const handleFocus = () => {
      loadData({ silent: true });
      loadBankAccounts();
    };
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [currentUser?.id, loadBankAccounts, loadData]);

  const goTo = useCallback((query: Record<string, string> = {}) => {
    router.push({ pathname: '/credit-cards', query }, undefined, { shallow: true });
  }, [router]);

  const selectedCard = useMemo(
    () => cards.find(card => card.id === selectedCardId) || null,
    [cards, selectedCardId]
  );
  const selectedCardPlans = useMemo(
    () => plans.filter(plan => plan.cardId === selectedCardId),
    [plans, selectedCardId]
  );

  // ------------------------------------------------------------- card actions

  const handleOpenAddCard = () => {
    setEditingCard(null);
    setCardFormOpen(true);
  };

  const handleOpenEditCard = (card: CreditCardRecord) => {
    setEditingCard(card);
    setCardFormOpen(true);
  };

  const handleSubmitCard = async (payload: Record<string, unknown>): Promise<void> => {
    setSubmitting(true);
    try {
      await creditCardAPI.saveCard(payload);
      setCardFormOpen(false);
      setEditingCard(null);
      showToast(payload.id ? 'แก้ไขบัตรแล้ว' : 'เพิ่มบัตรแล้ว');
      await loadData({ silent: true });
    } catch (submitError) {
      const message = (submitError as { message?: string } | null)?.message;
      showToast(message || 'บันทึกบัตรไม่สำเร็จ', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteCard = (card: CreditCardRecord) => {
    setConfirmState({
      title: 'ลบบัตรเครดิต',
      message: `ลบบัตร ${card.name}? แผนผ่อนที่จบแล้วหรือยกเลิกแล้วของบัตรนี้จะถูกลบไปด้วย`,
      confirmLabel: 'ลบบัตร',
      onConfirm: async () => {
        try {
          await creditCardAPI.deleteCard(card.id);
          setConfirmState(null);
          showToast('ลบบัตรแล้ว');
          if (selectedCardId === card.id) goTo({});
          await loadData({ silent: true });
        } catch (deleteError) {
          setConfirmState(null);
          const message = (deleteError as { message?: string } | null)?.message;
          showToast(
            message === 'card has active installment plans'
              ? 'บัตรนี้มีแผนผ่อนที่ยังไม่จบ — ต้องยกเลิกหรือผ่อนให้ครบก่อน'
              : (message || 'ลบบัตรไม่สำเร็จ'),
            'error'
          );
        }
      }
    });
  };

  // ------------------------------------------------------------- plan actions

  const handleOpenAddPlan = (card: CreditCardRecord | null = null) => {
    if (!cards.length) {
      showToast('กรุณาเพิ่มบัตรก่อนสร้างแผนผ่อน', 'error');
      return;
    }
    setEditingPlan(null);
    setLockedCardId(card?.id || null);
    setPlanFormOpen(true);
  };

  const handleOpenEditPlan = (plan: CreditPlanRecord) => {
    setEditingPlan(plan);
    setLockedCardId(plan.cardId);
    setPlanFormOpen(true);
  };

  const handleSubmitPlan = async (values: PlanSubmitValues, options?: PlanSubmitOptions): Promise<void> => {
    setSubmitting(true);
    try {
      if (editingPlan) {
        await creditCardAPI.updatePlan(editingPlan.id, values);
        showToast('แก้ไขแผนผ่อนแล้ว');
      } else {
        if (!('startMonth' in values) || !('months' in values)) {
          throw new Error('Invalid plan submission');
        }
        const planValues: PlanFormValues = values;
        setBackdateFailure(null);
        const created = await creditCardAPI.createPlan(planValues);
        const paidNos = options?.paidInstallmentNos ?? [];
        const serverSchedule: InstallmentScheduleEntry[] = Array.isArray(created?.plan?.schedule)
          ? created.plan.schedule
          : [];
        const lastMonth = addMonths(planValues.startMonth, planValues.months - 1);
        setPlanCreatedNote(
          `เพิ่มเข้ารายจ่ายเดือน ${formatMonthKeyTH(planValues.startMonth)} – ${formatMonthKeyTH(lastMonth)} แล้ว`
        );
        if (paidNos.length === 0) {
          showToast('เพิ่มแผนผ่อนชำระแล้ว');
        } else {
          const selectedRows = paidNos.map(no => serverSchedule.find(row => row.no === no));
          const missingNos = paidNos.filter((no, index) => !selectedRows[index]);
          const rowsToMark = selectedRows
            .filter((row): row is InstallmentScheduleEntry => Boolean(row))
            .map(({ no, dueMonth }) => ({ no, dueMonth }));
          const result = await applyPaidSequentially(
            created?.plan?.id ?? '',
            rowsToMark,
            expenseAPI.setPaid
          );
          let failedNos = [...new Set([...result.failedNos, ...missingNos])].sort((a, b) => a - b);
          let reconciledPlan: CreditPlanRecord | undefined;

          if (failedNos.length > 0) {
            try {
              const response = await creditCardAPI.getPlans({ cardId: planValues.cardId });
              reconciledPlan = Array.isArray(response?.plans)
                ? response.plans.find((plan: CreditPlanRecord) => plan.id === created?.plan?.id)
                : undefined;
              if (reconciledPlan) {
                const persistedSchedule = Array.isArray(reconciledPlan.schedule) ? reconciledPlan.schedule : [];
                failedNos = failedNos.filter(no => persistedSchedule.find(row => row.no === no)?.paid !== true);
              }
            } catch (reconcileError) {
              console.error('Failed to reconcile backdated installment payments:', reconcileError);
            }
          }

          const fallbackSchedule = buildSchedule({
            ...planValues,
            calcMethod: planValues.calcMethod ?? undefined
          }).schedule;
          const failed = failedNos.map(no => ({
            no,
            dueMonth: serverSchedule.find(row => row.no === no)?.dueMonth
              ?? fallbackSchedule.find(row => row.no === no)?.dueMonth
              ?? ''
          }));
          const completed = reconciledPlan
            ? reconciledPlan.status === PLAN_STATUS.COMPLETED
            : failed.length === 0 && result.succeededNos.length === serverSchedule.length && serverSchedule.length > 0;

          if (failed.length > 0) {
            showToast(`เพิ่มแผนผ่อนชำระแล้ว แต่บันทึกชำระไม่สำเร็จ ${failed.length} งวด`, 'error');
            setBackdateFailure({
              cardId: planValues.cardId,
              itemName: planValues.itemName,
              months: planValues.months,
              requestedCount: paidNos.length,
              failed
            });
          } else if (completed) {
            showToast('เพิ่มแผนผ่อนชำระแล้ว · ผ่อนครบแล้ว 🎉');
          } else {
            showToast(`เพิ่มแผนผ่อนชำระแล้ว · บันทึกชำระแล้ว ${paidNos.length} งวด`);
          }
        }
      }
      setPlanFormOpen(false);
      setEditingPlan(null);
      setLockedCardId(null);
      await loadData({ silent: true });
    } catch (submitError) {
      const message = (submitError as { message?: string } | null)?.message;
      showToast(message || 'บันทึกแผนผ่อนไม่สำเร็จ', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancelPlan = (plan: CreditPlanRecord) => {
    setConfirmState({
      title: 'ยกเลิกแผนผ่อน',
      message: `ยกเลิกแผนผ่อน ${plan.itemName}? งวดที่ชำระแล้ว ${plan.installmentsPaid} งวดจะยังคงอยู่ในประวัติ ส่วนงวดที่เหลือจะถูกนำออกจากรายจ่ายเดือนถัดไป`,
      confirmLabel: 'ยืนยันยกเลิกแผน',
      onConfirm: async () => {
        try {
          await creditCardAPI.cancelPlan(plan.id);
          setConfirmState(null);
          showToast('ยกเลิกแผนผ่อนแล้ว');
          await loadData({ silent: true });
        } catch (cancelError) {
          setConfirmState(null);
          const message = (cancelError as { message?: string } | null)?.message;
          showToast(message || 'ยกเลิกแผนไม่สำเร็จ', 'error');
        }
      }
    });
  };

  const handleDeletePlan = (plan: CreditPlanRecord) => {
    setConfirmState({
      title: 'ลบแผนผ่อน',
      message: `ลบแผนผ่อน ${plan.itemName} ออกถาวร?`,
      confirmLabel: 'ลบแผน',
      onConfirm: async () => {
        try {
          await creditCardAPI.deletePlan(plan.id);
          setConfirmState(null);
          showToast('ลบแผนผ่อนแล้ว');
          await loadData({ silent: true });
        } catch (deleteError) {
          setConfirmState(null);
          const message = (deleteError as { message?: string } | null)?.message;
          showToast(
            message === 'plan has paid installments — cancel it instead'
              ? 'ลบไม่ได้เพราะมีงวดที่ชำระแล้ว — ให้ยกเลิกแผนแทน'
              : (message || 'ลบแผนไม่สำเร็จ'),
            'error'
          );
        }
      }
    });
  };

  // ------------------------------------------------------- revolving actions

  /**
   * จ่ายขั้นต่ำต้องยืนยันก่อน เพราะมันสร้างหนี้ยกไปเดือนหน้าพร้อมดอกเบี้ย
   * (จ่ายเต็มไม่ต้องยืนยัน เพราะย้อนกลับได้ใน 1 แตะ)
   */
  const handleConfirmMinimum = useCallback(({ card, cycle, onConfirm }: {
    card?: { name?: string } | null;
    cycle?: CurrentCycle | null;
    onConfirm?: () => void | Promise<void>;
  }) => {
    // ตัวเลขทุกตัวมาจาก minimumPreview ที่ server คำนวณให้ — หน้านี้ไม่คำนวณเงินเอง
    const preview = cycle?.minimumPreview || { remaining: 0, interest: 0, closingBalance: 0 };
    setConfirmState({
      title: `จ่ายขั้นต่ำ · ${card?.name || ''}`.trim(),
      message: `จ่าย ${formatCurrency(cycle?.minPaymentDue ?? 0)} ฿ วันนี้ · ยอด ${formatCurrency(preview.remaining)} ฿ จะถูกยกไปเดือนหน้าพร้อมดอกเบี้ย ${formatCurrency(preview.interest)} ฿ (รวม ${formatCurrency(preview.closingBalance)} ฿)`,
      confirmLabel: 'ยืนยันจ่ายขั้นต่ำ',
      onConfirm: async () => {
        setConfirmState(null);
        await onConfirm?.();
      }
    });
  }, []);

  /** ติ๊กชำระแบบ optimistic — ล้มเหลวแล้วย้อนสถานะกลับพร้อม toast */
  const handleToggleInstallment = async (planId: string, installmentNo: number, paid: boolean, pendingKey: string): Promise<void> => {
    if (pendingKeysRef.current.has(pendingKey)) return;
    pendingKeysRef.current.add(pendingKey);
    setPendingKeys(keys => [...keys, pendingKey]);
    const applyPaid = (nextPaid: boolean) => setPlans(currentPlans => currentPlans.map(plan => {
      if (plan.id !== planId) return plan;
      const schedule = (Array.isArray(plan.schedule) ? plan.schedule : [])
        .map(row => (row.no === installmentNo ? { ...row, paid: nextPaid } : row));
      const installmentsPaid = schedule.filter(row => row.paid === true).length;
      return {
        ...plan,
        schedule,
        installmentsPaid,
        installmentsRemaining: Math.max(0, plan.months - installmentsPaid),
        progressPercent: plan.months > 0 ? Math.round((installmentsPaid / plan.months) * 10000) / 100 : 0
      };
    }));
    applyPaid(paid);

    try {
      const response = await creditCardAPI.setInstallmentPaid(planId, installmentNo, paid);
      if (response?.plan?.status === PLAN_STATUS.COMPLETED) {
        showToast('ผ่อนครบแล้ว 🎉');
      } else {
        showToast('อัปเดตสถานะงวดแล้ว');
      }
      await loadData({ silent: true });
    } catch (error) {
      applyPaid(!paid);
      const message = (error as { message?: string } | null)?.message;
      showToast(message || 'อัปเดตสถานะงวดไม่สำเร็จ', 'error');
    } finally {
      pendingKeysRef.current.delete(pendingKey);
      setPendingKeys(keys => keys.filter(key => key !== pendingKey));
    }
  };

  return (
    <Layout
      activeNav="credit-cards"
      title="บัตรเครดิต & แผนผ่อนชำระ"
      headerActions={(
        <button
          type="button"
          className={`inline-flex min-h-11 items-center justify-center gap-space-2 rounded-sm bg-accent px-space-4 text-sm font-medium text-on-accent transition-colors duration-fast ease-graphite hover:opacity-90 ${FOCUS_RING}`}
          onClick={handleOpenAddCard}
        >
          <Icons.Plus size={16} /> <span>เพิ่มบัตร</span>
        </button>
      )}
      onCalendarClose={({ changed }: { changed?: boolean } = {}) => { if (changed) loadData({ silent: true }); }}
    >
      <div className="flex flex-col gap-space-5">
        {selectedCardId ? (
          <CreditCardDetail
            card={selectedCard}
            plans={selectedCardPlans}
            pendingKeys={pendingKeys}
            onBack={() => goTo({})}
            onEditCard={handleOpenEditCard}
            onDeleteCard={handleDeleteCard}
            onAddPlanForCard={handleOpenAddPlan}
            onRenamePlan={handleOpenEditPlan}
            onEditPlan={handleOpenEditPlan}
            onCancelPlan={handleCancelPlan}
            onDeletePlan={handleDeletePlan}
            onToggleInstallment={handleToggleInstallment}
            onConfirmMinimum={handleConfirmMinimum}
            onRevolvingChanged={() => loadData({ silent: true })}
          />
        ) : (
          <CreditCardDashboard
            cards={cards}
            totals={totals}
            plans={plans}
            loading={loading}
            error={error}
            pendingKeys={pendingKeys}
            planCreatedNote={planCreatedNote}
            onRetry={() => loadData()}
            onAddCard={handleOpenAddCard}
            onEditCard={handleOpenEditCard}
            onDeleteCard={handleDeleteCard}
            onAddPlan={() => handleOpenAddPlan(null)}
            onAddPlanForCard={handleOpenAddPlan}
            onOpenCard={(cardId: string) => goTo({ card: cardId })}
            onToggleInstallment={handleToggleInstallment}
          />
        )}

        <CreditCardForm
          open={cardFormOpen}
          card={editingCard}
          existingCards={cards}
          bankAccounts={bankAccounts}
          submitting={submitting}
          onClose={() => { setCardFormOpen(false); setEditingCard(null); }}
          onSubmit={handleSubmitCard}
        />

        <InstallmentPlanForm
          open={planFormOpen}
          plan={editingPlan}
          cards={cards}
          lockedCardId={lockedCardId}
          submitting={submitting}
          onClose={() => { setPlanFormOpen(false); setEditingPlan(null); setLockedCardId(null); }}
          onSubmit={handleSubmitPlan}
        />

        <ConfirmDialog
          open={Boolean(confirmState)}
          title={confirmState?.title || ''}
          message={confirmState?.message || ''}
          confirmLabel={confirmState?.confirmLabel || ''}
          onCancel={() => setConfirmState(null)}
          onConfirm={confirmState?.onConfirm || (() => undefined)}
          busy={false}
        />
        <BackdatedPaidFailureDialog
          open={Boolean(backdateFailure)}
          itemName={backdateFailure?.itemName ?? ''}
          months={backdateFailure?.months ?? 0}
          requestedCount={backdateFailure?.requestedCount ?? 0}
          failed={backdateFailure?.failed ?? []}
          onClose={() => setBackdateFailure(null)}
          onGoToCard={() => {
            const cardId = backdateFailure?.cardId;
            setBackdateFailure(null);
            if (cardId && selectedCardId !== cardId) goTo({ card: cardId });
          }}
        />
      </div>
    </Layout>
  );
}