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
 * ปฏิทินย้ายออกจากหน้านี้เป็นโมดัลรวม (ADR-012 · Feature 2) เปิดจากปุ่ม "ปฏิทิน" ในหัวข้อ
 * `/credit-cards?view=calendar` ยังคงรองรับเป็น legacy deep link ที่เปิดโมดัลนี้อัตโนมัติ (AC-69)
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import CreditCardDashboard from '../src/frontend/components/CreditCardDashboard';
import CreditCardDetail from '../src/frontend/components/CreditCardDetail';
import ExpenseCalendarModal from '../src/frontend/components/ExpenseCalendarModal';
import CreditCardForm from '../src/frontend/components/CreditCardForm';
import InstallmentPlanForm from '../src/frontend/components/InstallmentPlanForm';
import { Icons } from '../src/frontend/components/Icons';
import { useSession } from '../src/frontend/contexts/SessionContext';
import { creditCardAPI } from '../src/shared/utils/frontend/apiUtils';
import { showToast } from '../src/shared/utils/frontend/toast';
import { formatCurrency } from '../src/shared/utils/frontend/numberUtils';
import { formatMonthKeyTH } from '../src/shared/utils/dateUtils';
import { addMonths, PLAN_STATUS } from '../src/shared/utils/creditCardUtils';
import styles from '../src/frontend/styles/CreditCard.module.css';
import formStyles from '../src/frontend/styles/CreditCardForm.module.css';

/** กล่องยืนยันสำหรับ action ที่ทำลายข้อมูล — action อื่นทั้งหมดใช้ toast */
function ConfirmDialog({ open, title, message, confirmLabel, onCancel, onConfirm, busy }) {
  useEffect(() => {
    if (!open) return undefined;
    const handleEsc = (event) => {
      if (event.key === 'Escape') onCancel?.();
    };
    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div className={formStyles.backdrop} role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onCancel?.();
    }}>
      <div className={`${formStyles.modal} ${formStyles.modalNarrow}`} role="alertdialog" aria-modal="true" aria-label={title}>
        <div className={formStyles.modalHeader}>
          <h2 className={formStyles.modalTitle}>{title}</h2>
          <button type="button" className={formStyles.closeButton} onClick={onCancel} aria-label="ปิด">
            <Icons.X size={18} />
          </button>
        </div>
        <div className={formStyles.modalBody}>
          <p className={formStyles.confirmText}>{message}</p>
        </div>
        <div className={formStyles.modalFooter}>
          <button type="button" className={formStyles.secondaryButton} onClick={onCancel}>ยกเลิก</button>
          <button type="button" className={formStyles.dangerButton} onClick={onConfirm} disabled={busy}>
            {busy ? 'กำลังดำเนินการ...' : (confirmLabel || 'ยืนยัน')}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function CreditCardsPage() {
  const router = useRouter();
  const { currentUser, isReady } = useSession();

  const [cards, setCards] = useState([]);
  const [totals, setTotals] = useState(null);
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [pendingKeys, setPendingKeys] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [planCreatedNote, setPlanCreatedNote] = useState(null);

  const [cardFormOpen, setCardFormOpen] = useState(false);
  const [editingCard, setEditingCard] = useState(null);
  const [planFormOpen, setPlanFormOpen] = useState(false);
  const [editingPlan, setEditingPlan] = useState(null);
  const [lockedCardId, setLockedCardId] = useState(null);
  const [confirmState, setConfirmState] = useState(null);
  const [calendarOpen, setCalendarOpen] = useState(false);

  const selectedCardId = typeof router.query.card === 'string' ? router.query.card : null;

  useEffect(() => {
    if (isReady && !currentUser) {
      router.replace('/profiles');
    }
  }, [isReady, currentUser, router]);

  // legacy deep link (ลิงก์ footer ข้อความ LINE เดิม / bookmark เก่า) — เปิดโมดัลปฏิทินอัตโนมัติ (AC-69)
  useEffect(() => {
    if (router.query.view === 'calendar') {
      setCalendarOpen(true);
      router.replace({ pathname: '/credit-cards', query: {} }, undefined, { shallow: true });
    }
  }, [router.query.view, router]);

  const loadData = useCallback(async ({ silent = false } = {}) => {
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
    } catch (err) {
      console.error('Error loading credit card data:', err);
      setError(err.message || 'โหลดข้อมูลบัตรเครดิตไม่สำเร็จ');
      showToast('โหลดข้อมูลบัตรเครดิตไม่สำเร็จ', 'error');
    } finally {
      setLoading(false);
    }
  }, [currentUser?.id]);

  useEffect(() => {
    if (currentUser?.id) loadData();
  }, [currentUser?.id, loadData]);

  // ผู้ใช้อาจเพิ่งติ๊กชำระใน edit.js อีกแท็บ — โหลดใหม่เมื่อกลับมาที่หน้านี้
  useEffect(() => {
    if (!currentUser?.id) return undefined;
    const handleFocus = () => loadData({ silent: true });
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [currentUser?.id, loadData]);

  const goTo = useCallback((query) => {
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

  const handleOpenEditCard = (card) => {
    setEditingCard(card);
    setCardFormOpen(true);
  };

  const handleSubmitCard = async (payload) => {
    setSubmitting(true);
    try {
      await creditCardAPI.saveCard(payload);
      setCardFormOpen(false);
      setEditingCard(null);
      showToast(payload.id ? 'แก้ไขบัตรแล้ว' : 'เพิ่มบัตรแล้ว');
      await loadData({ silent: true });
    } catch (err) {
      showToast(err.message || 'บันทึกบัตรไม่สำเร็จ', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteCard = (card) => {
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
        } catch (err) {
          setConfirmState(null);
          showToast(
            err.message === 'card has active installment plans'
              ? 'บัตรนี้มีแผนผ่อนที่ยังไม่จบ — ต้องยกเลิกหรือผ่อนให้ครบก่อน'
              : (err.message || 'ลบบัตรไม่สำเร็จ'),
            'error'
          );
        }
      }
    });
  };

  // ------------------------------------------------------------- plan actions

  const handleOpenAddPlan = (card = null) => {
    if (!cards.length) {
      showToast('กรุณาเพิ่มบัตรก่อนสร้างแผนผ่อน', 'error');
      return;
    }
    setEditingPlan(null);
    setLockedCardId(card?.id || null);
    setPlanFormOpen(true);
  };

  const handleOpenEditPlan = (plan) => {
    setEditingPlan(plan);
    setLockedCardId(plan.cardId);
    setPlanFormOpen(true);
  };

  const handleSubmitPlan = async (values) => {
    setSubmitting(true);
    try {
      if (editingPlan) {
        await creditCardAPI.updatePlan(editingPlan.id, values);
        showToast('แก้ไขแผนผ่อนแล้ว');
      } else {
        await creditCardAPI.createPlan(values);
        const lastMonth = addMonths(values.startMonth, values.months - 1);
        setPlanCreatedNote(
          `เพิ่มเข้ารายจ่ายเดือน ${formatMonthKeyTH(values.startMonth)} – ${formatMonthKeyTH(lastMonth)} แล้ว`
        );
        showToast('เพิ่มแผนผ่อนชำระแล้ว');
      }
      setPlanFormOpen(false);
      setEditingPlan(null);
      setLockedCardId(null);
      await loadData({ silent: true });
    } catch (err) {
      showToast(err.message || 'บันทึกแผนผ่อนไม่สำเร็จ', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancelPlan = (plan) => {
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
        } catch (err) {
          setConfirmState(null);
          showToast(err.message || 'ยกเลิกแผนไม่สำเร็จ', 'error');
        }
      }
    });
  };

  const handleDeletePlan = (plan) => {
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
        } catch (err) {
          setConfirmState(null);
          showToast(
            err.message === 'plan has paid installments — cancel it instead'
              ? 'ลบไม่ได้เพราะมีงวดที่ชำระแล้ว — ให้ยกเลิกแผนแทน'
              : (err.message || 'ลบแผนไม่สำเร็จ'),
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
  const handleConfirmMinimum = useCallback(({ card, cycle, onConfirm }) => {
    // ตัวเลขทุกตัวมาจาก minimumPreview ที่ server คำนวณให้ — หน้านี้ไม่คำนวณเงินเอง
    const preview = cycle?.minimumPreview || { remaining: 0, interest: 0, closingBalance: 0 };
    setConfirmState({
      title: `จ่ายขั้นต่ำ · ${card?.name || ''}`.trim(),
      message: `จ่าย ${formatCurrency(cycle?.minPaymentDue)} ฿ วันนี้ · ยอด ${formatCurrency(preview.remaining)} ฿ จะถูกยกไปเดือนหน้าพร้อมดอกเบี้ย ${formatCurrency(preview.interest)} ฿ (รวม ${formatCurrency(preview.closingBalance)} ฿)`,
      confirmLabel: 'ยืนยันจ่ายขั้นต่ำ',
      onConfirm: async () => {
        setConfirmState(null);
        await onConfirm?.();
      }
    });
  }, []);

  /** ติ๊กชำระแบบ optimistic — ล้มเหลวแล้วย้อนสถานะกลับพร้อม toast */
  const handleToggleInstallment = async (planId, installmentNo, paid, pendingKey) => {
    setPendingKeys(keys => [...keys, pendingKey]);
    const snapshot = plans;
    setPlans(currentPlans => currentPlans.map(plan => {
      if (plan.id !== planId) return plan;
      const schedule = (Array.isArray(plan.schedule) ? plan.schedule : [])
        .map(row => (row.no === installmentNo ? { ...row, paid } : row));
      const installmentsPaid = schedule.filter(row => row.paid === true).length;
      return {
        ...plan,
        schedule,
        installmentsPaid,
        installmentsRemaining: Math.max(0, plan.months - installmentsPaid),
        progressPercent: plan.months > 0 ? Math.round((installmentsPaid / plan.months) * 10000) / 100 : 0
      };
    }));

    try {
      const response = await creditCardAPI.setInstallmentPaid(planId, installmentNo, paid);
      if (response?.plan?.status === PLAN_STATUS.COMPLETED) {
        showToast('ผ่อนครบแล้ว 🎉');
      } else {
        showToast('อัปเดตสถานะงวดแล้ว');
      }
      await loadData({ silent: true });
    } catch (err) {
      setPlans(snapshot);
      showToast(err.message || 'อัปเดตสถานะงวดไม่สำเร็จ', 'error');
    } finally {
      setPendingKeys(keys => keys.filter(key => key !== pendingKey));
    }
  };

  if (!isReady || !currentUser) {
    return (
      <div className={styles.guardContainer}>
        <Icons.Lock size={48} color="var(--color-primary)" />
        <p>กำลังตรวจสอบสิทธิ์ผู้ใช้...</p>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.container}>
        <header className={styles.pageHeader}>
          <div className={styles.headerTitleGroup}>
            <Icons.CreditCard size={20} color="var(--color-primary)" />
            <h1 className={styles.pageTitle}>บัตรเครดิต &amp; แผนผ่อนชำระ</h1>
          </div>
          <div className={styles.headerActions}>
            <button type="button" className={styles.primaryButton} onClick={handleOpenAddCard}>
              <Icons.Plus size={16} /> <span>เพิ่มบัตร</span>
            </button>
            <button type="button" className={styles.ghostButton} onClick={() => setCalendarOpen(true)}>
              <Icons.Calendar size={16} /> <span>ปฏิทิน</span>
            </button>
            <button type="button" className={styles.ghostButton} onClick={() => router.push('/edit')}>
              <Icons.ChevronLeft size={16} /> <span>กลับหน้าแก้ไข</span>
            </button>
          </div>
        </header>

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
            onOpenCard={(cardId) => goTo({ card: cardId })}
            onOpenCalendar={() => setCalendarOpen(true)}
            onToggleInstallment={handleToggleInstallment}
          />
        )}
      </div>

      <ExpenseCalendarModal
        open={calendarOpen}
        onClose={({ changed } = {}) => {
          setCalendarOpen(false);
          if (changed) loadData({ silent: true });
        }}
      />

      <CreditCardForm
        open={cardFormOpen}
        card={editingCard}
        existingCards={cards}
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
        title={confirmState?.title}
        message={confirmState?.message}
        confirmLabel={confirmState?.confirmLabel}
        onCancel={() => setConfirmState(null)}
        onConfirm={confirmState?.onConfirm}
      />
    </div>
  );
}
