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
 *
 * Graphite redesign (credit-cards-graphite pass) — เต็มหน้าเปลี่ยนเป็น Tailwind แล้ว ไม่ import
 * CreditCard.module.css / CreditCardForm.module.css อีกต่อไป (ทั้งสองไฟล์ยังอยู่บน disk เพราะ
 * ExpenseCalendarModal.js/ExpenseCalendar.js/SalaryModal.js/UnsavedChangesDialog.js ยัง depend อยู่ —
 * ดู task-context-credit-cards-graphite.md "CRITICAL FINDING", เป็น named exception ต่อ ADR-019 rule 5)
 * ConfirmDialog เปลี่ยนมาใช้ getTabbableElements จาก focusTrap.js แทน querySelectorAll ของตัวเอง
 * (TD-M06 conformance — เดิมมีแค่ Escape listener + inline trap คัดลอกจาก CreditCardForm.js รุ่นก่อน
 * extraction, ดู architecture-review-credit-cards-graphite.md Finding 2)
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import CreditCardDashboard from '../src/frontend/components/CreditCardDashboard';
import CreditCardDetail from '../src/frontend/components/CreditCardDetail';
import Layout from '../src/frontend/components/Layout';
import CreditCardForm from '../src/frontend/components/CreditCardForm';
import InstallmentPlanForm from '../src/frontend/components/InstallmentPlanForm';
import { Icons } from '../src/frontend/components/Icons';
import { useSession } from '../src/frontend/contexts/SessionContext';
import { creditCardAPI } from '../src/shared/utils/frontend/apiUtils';
import { showToast } from '../src/shared/utils/frontend/toast';
import { formatCurrency } from '../src/shared/utils/frontend/numberUtils';
import { formatMonthKeyTH } from '../src/shared/utils/dateUtils';
import { addMonths, PLAN_STATUS } from '../src/shared/utils/creditCardUtils';
import { getTabbableElements } from '../src/shared/utils/frontend/focusTrap';

const FOCUS_RING = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2';

/** กล่องยืนยันสำหรับ action ที่ทำลายข้อมูล (ลบบัตร/ยกเลิกแผน/ลบแผน/จ่ายขั้นต่ำ) — action อื่นทั้งหมด
 *  ใช้ toast แทน เป็น C9 (Sheet/Modal) — role="alertdialog" + aria-modal + focus trap ผ่าน
 *  getTabbableElements ที่ใช้ร่วมกับ CreditCardForm.js/InstallmentPlanForm.js + Escape + focus restore */
function ConfirmDialog({ open, title, message, confirmLabel, onCancel, onConfirm, busy }) {
  const dialogRef = useRef(null);
  const confirmButtonRef = useRef(null);
  const triggerRef = useRef(null);
  // เก็บ onCancel ล่าสุดไว้ใน ref แทนการใส่เป็น dependency ของ effect ด้านล่างตรงๆ — ถ้า parent
  // re-render ระหว่างเปิด dialog (เช่น RevolvingBalanceSection เรียก onChanged ให้ CreditCardsPage
  // โหลดข้อมูลใหม่แบบ silent) onCancel prop (arrow function ใหม่ทุก render) จะทำให้ effect cleanup
  // แล้ว re-run กลางอากาศ ซึ่ง cleanup เดิมมี triggerRef.current?.focus?.() อยู่ด้วย — โฟกัสจะหลุดออก
  // จาก dialog ไปที่หน้าเบื้องหลังทันทีแม้ dialog ยังเปิดอยู่ (พบจากการ live-verify รอบ Graphite นี้
  // — ไม่เคยถูกทดสอบในเบราว์เซอร์จริงมาก่อน ดู task-context/architecture-review Finding 3)
  const onCancelRef = useRef(onCancel);
  onCancelRef.current = onCancel;

  useEffect(() => {
    if (!open) return undefined;
    triggerRef.current = typeof document !== 'undefined' ? document.activeElement : null;
    const timer = setTimeout(() => confirmButtonRef.current?.focus(), 40);
    return () => clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const handleKeyDown = (event) => {
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
      className="fixed inset-0 z-[60] flex items-end justify-center overflow-y-auto bg-[rgba(10,10,11,0.72)] p-0 backdrop-blur-sm md:items-center md:p-space-5"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel?.();
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
  // calendarTrigger: นับขึ้นเพื่อสั่งให้ Layout เปิดโมดัลปฏิทินรวม (แพทเทิร์นเดียวกับ triggerSave — ADR-003)
  // แทน calendarOpen เดิม เพราะโมดัลย้ายไปรวมอยู่ที่ Layout หนึ่งเดียวทั้งแอปแล้ว (AC-SH-13)
  const [calendarTrigger, setCalendarTrigger] = useState(0);

  const selectedCardId = typeof router.query.card === 'string' ? router.query.card : null;

  // legacy deep link (ลิงก์ footer ข้อความ LINE เดิม / bookmark เก่า) — เปิดโมดัลปฏิทินอัตโนมัติ (AC-69)
  useEffect(() => {
    if (router.query.view === 'calendar') {
      setCalendarTrigger(prev => prev + 1);
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

  return (
    <Layout
      activeNav="credit-cards"
      title="บัตรเครดิต & แผนผ่อนชำระ"
      headerActions={(
        <>
          <button
            type="button"
            className={`inline-flex min-h-11 items-center justify-center gap-space-2 rounded-sm bg-accent px-space-4 text-sm font-medium text-on-accent transition-colors duration-fast ease-graphite hover:opacity-90 ${FOCUS_RING}`}
            onClick={handleOpenAddCard}
          >
            <Icons.Plus size={16} /> <span>เพิ่มบัตร</span>
          </button>
          <button
            type="button"
            className={`inline-flex min-h-11 items-center justify-center gap-space-2 rounded-sm border border-border-interactive bg-surface-2 px-space-4 text-sm font-medium text-primary transition-colors duration-fast ease-graphite hover:bg-surface-3 ${FOCUS_RING}`}
            onClick={() => setCalendarTrigger(prev => prev + 1)}
          >
            <Icons.Calendar size={16} /> <span>ปฏิทิน</span>
          </button>
        </>
      )}
      calendarTrigger={calendarTrigger}
      onCalendarClose={({ changed } = {}) => { if (changed) loadData({ silent: true }); }}
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
            onOpenCard={(cardId) => goTo({ card: cardId })}
            onOpenCalendar={() => setCalendarTrigger(prev => prev + 1)}
            onToggleInstallment={handleToggleInstallment}
          />
        )}

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
    </Layout>
  );
}
