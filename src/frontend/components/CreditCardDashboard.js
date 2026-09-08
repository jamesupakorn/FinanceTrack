/**
 * คอมโพเนนต์: CreditCardDashboard (หน้าจอ 1)
 * ภาพรวมหนี้บัตรทั้งหมด + รายการที่ครบกำหนดเร็ว ๆ นี้ + การ์ดบัตรทุกใบ
 *
 * ตอบคำถามเดียวให้เร็วที่สุด: "เดือนนี้ต้องจ่ายบัตรเท่าไหร่ และผ่อนอะไรอยู่บ้าง"
 * บนมือถือรวม summary เหลือการ์ดเดียวเพื่อให้อ่านได้โดยไม่ต้อง scroll (J1)
 *
 * Graphite redesign (credit-cards-graphite pass) — Tailwind แทน CreditCard.module.css แล้ว
 * UX_SPEC §9 `/credit-cards`: การ์ดแต่ละใบ (C1) แสดงชื่อ/เลข 4 ตัวท้าย/ยอดครบกำหนดรอบปัจจุบัน
 * (`card.revolvingTotalDue` — ฟิลด์นี้ backend คำนวณให้อยู่แล้วผ่าน summariseCard(), ไม่ใช่ตัวเลขใหม่)
 * เป็น C3 stat และ chip --warn เมื่อวันสรุปยอด/ครบกำหนดของบัตรอยู่ภายใน 7 วัน (อ่านจาก
 * `card.nextDueDate` ซึ่งมาจาก resolveCardNextDueDate() ที่ backend คำนวณไว้แล้วเช่นกัน — หน้านี้
 * ไม่ได้เพิ่ม business logic ใหม่ แค่เอาฟิลด์ที่มีอยู่แล้วมาแสดงผลเพิ่ม) ยอดหนี้คงเหลือรวม
 * (`card.remainingPayable`) ยังคงแสดงเป็นบรรทัดรองใต้ยอดครบกำหนดรอบนี้ ไม่ได้ถูกลบออก
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  resolveInstallmentDueDate,
  formatIsoDateTH,
  diffDaysFromToday,
  describeDueDistance,
  formatDayLabel,
  round2,
  PLAN_STATUS
} from '../../shared/utils/creditCardUtils';
import { formatCurrency } from '../../shared/utils/frontend/numberUtils';
import { Icons } from './Icons';

const UPCOMING_WINDOW_DAYS = 7;
const UPCOMING_MAX_ITEMS = 5;
const HIGH_UTILISATION_PERCENT = 80;

const FOCUS_RING = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2';
const CARD = 'rounded-md border border-border-default bg-surface-1 p-space-4 shadow-elev-1 md:p-space-5';
const BTN_PRIMARY = `inline-flex min-h-11 items-center justify-center gap-space-2 rounded-sm bg-accent px-space-4 text-sm font-medium text-on-accent transition-colors duration-fast ease-graphite hover:opacity-90 ${FOCUS_RING}`;
const BTN_GHOST = `inline-flex min-h-11 items-center justify-center gap-space-2 rounded-sm border border-border-interactive bg-surface-2 px-space-4 text-sm font-medium text-primary transition-colors duration-fast ease-graphite hover:bg-surface-3 ${FOCUS_RING}`;
const ICON_BTN = `flex h-11 w-11 shrink-0 items-center justify-center rounded-sm border border-border-default bg-surface-2 text-secondary transition-colors duration-fast ease-graphite hover:bg-surface-3 ${FOCUS_RING}`;
const SECTION_TITLE = 'm-0 text-lg font-semibold text-primary';
const WARN_CHIP = 'inline-flex w-fit items-center gap-space-1 rounded-full border border-warn/40 bg-warn/14 px-space-2 py-[2px] text-xs font-medium text-warn';

/** เมนู ⋯ ของการ์ด — ปิดเมื่อคลิกนอกพื้นที่หรือกด Escape (แบบเดียวกับ userMenuWrapper ใน edit.js) */
function CardMenu({ card, onEdit, onAddPlan, onDelete }) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const handleClickOutside = (event) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target)) setOpen(false);
    };
    const handleEsc = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEsc);
    };
  }, [open]);

  const run = (action) => {
    setOpen(false);
    action?.(card);
  };

  return (
    <div className="relative shrink-0" ref={wrapperRef}>
      <button
        type="button"
        className={ICON_BTN}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={`ตัวเลือกของบัตร ${card.name}`}
        onClick={() => setOpen(value => !value)}
      >
        <Icons.Settings size={16} />
      </button>
      {open && (
        <div className="absolute right-0 top-[calc(100%+6px)] z-30 flex min-w-[220px] flex-col gap-[2px] rounded-md border border-border-default bg-surface-3 p-space-2 shadow-elev-3" role="menu">
          <button
            type="button"
            role="menuitem"
            className={`flex min-h-11 items-center gap-space-2 rounded-sm px-space-3 text-left text-sm text-primary hover:bg-surface-2 ${FOCUS_RING}`}
            onClick={() => run(onEdit)}
          >
            <Icons.Edit size={16} /> แก้ไขบัตร
          </button>
          <button
            type="button"
            role="menuitem"
            className={`flex min-h-11 items-center gap-space-2 rounded-sm px-space-3 text-left text-sm text-primary hover:bg-surface-2 ${FOCUS_RING}`}
            onClick={() => run(onAddPlan)}
          >
            <Icons.Plus size={16} /> เพิ่มแผนผ่อนในบัตรนี้
          </button>
          <button
            type="button"
            role="menuitem"
            className={`flex min-h-11 items-center gap-space-2 rounded-sm px-space-3 text-left text-sm text-neg hover:bg-neg/10 ${FOCUS_RING}`}
            onClick={() => run(onDelete)}
          >
            <Icons.Trash size={16} /> ลบบัตร
          </button>
        </div>
      )}
    </div>
  );
}

export default function CreditCardDashboard({
  cards = [],
  totals = null,
  plans = [],
  loading = false,
  error = null,
  pendingKeys = [],
  onRetry,
  onAddCard,
  onEditCard,
  onDeleteCard,
  onAddPlan,
  onAddPlanForCard,
  onOpenCard,
  onToggleInstallment,
  onOpenCalendar,
  planCreatedNote = null
}) {
  const cardById = useMemo(() => new Map(cards.map(card => [card.id, card])), [cards]);

  /** งวดที่ครบกำหนดภายใน 7 วัน หรือเลยกำหนดแล้ว เรียงตามวันที่ */
  const upcoming = useMemo(() => {
    const events = [];
    plans.forEach(plan => {
      if (plan?.status !== PLAN_STATUS.ONGOING) return;
      const card = cardById.get(plan.cardId);
      if (!card) return;
      (Array.isArray(plan.schedule) ? plan.schedule : []).forEach(row => {
        if (row?.paid === true) return;
        const dueDate = resolveInstallmentDueDate(card.dueDay, row.dueMonth);
        const diffDays = diffDaysFromToday(dueDate);
        if (diffDays === null) return;
        if (diffDays > UPCOMING_WINDOW_DAYS) return;
        events.push({
          key: `${plan.id}_${row.no}`,
          planId: plan.id,
          installmentNo: row.no,
          card,
          plan,
          payment: row.payment,
          dueDate,
          diffDays
        });
      });
    });
    events.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    return events;
  }, [plans, cardById]);

  const hasPlans = plans.length > 0;

  if (loading) {
    return (
      <div role="status" aria-busy="true">
        <span className="sr-only">กำลังโหลดข้อมูลบัตรเครดิต</span>
        <div className="mb-space-5 hidden grid-cols-4 gap-space-3 md:grid">
          {[0, 1, 2, 3].map(index => (
            <div key={index} className="h-[92px] animate-pulse rounded-md bg-surface-2" />
          ))}
        </div>
        <div className="mb-space-5 grid grid-cols-1 gap-space-3 md:hidden">
          <div className="h-[92px] animate-pulse rounded-md bg-surface-2" />
        </div>
        <div className="grid grid-cols-1 gap-space-4 md:grid-cols-2 lg:grid-cols-3">
          <div className="h-[220px] animate-pulse rounded-md bg-surface-2" />
          <div className="h-[220px] animate-pulse rounded-md bg-surface-2" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-space-3 rounded-md border border-neg/35 bg-neg/10 p-space-4 text-neg" role="alert">
        <span>{error}</span>
        <button type="button" className={BTN_GHOST} onClick={onRetry}>ลองใหม่</button>
      </div>
    );
  }

  if (!cards.length) {
    return (
      <div className="flex flex-col items-center gap-space-3 rounded-md border border-dashed border-border-default bg-sunken px-space-5 py-space-7 text-center">
        <Icons.CreditCard size={48} color="var(--color-accent, #D4A857)" />
        <h2 className="m-0 text-lg font-semibold text-primary">ยังไม่มีบัตรเครดิต</h2>
        <p className="m-0 text-sm text-secondary">เพิ่มบัตรเพื่อเริ่มติดตามหนี้และแผนผ่อนชำระ</p>
        <button type="button" className={BTN_PRIMARY} onClick={onAddCard}>
          <Icons.Plus size={16} /> เพิ่มบัตร
        </button>
      </div>
    );
  }

  const monthlyDueTotal = round2(upcoming.reduce((sum, event) => sum + (Number(event.payment) || 0), 0));
  const dueCardCount = new Set(upcoming.map(event => event.card.id)).size;

  return (
    <div className="flex flex-col gap-space-5">
      {/* summary — desktop 4 tiles (C3 stats) */}
      <div className="hidden grid-cols-4 gap-space-3 md:grid" aria-live="polite">
        <div className={CARD}>
          <p className="m-0 mb-space-1 text-sm text-secondary">หนี้คงเหลือรวม</p>
          <p className="m-0 font-[family-name:var(--font-numeric)] text-2xl font-semibold tabular-nums text-primary">{formatCurrency(totals?.remainingPayable || 0)}</p>
          <span className="text-xs text-tertiary">บาท</span>
        </div>
        <div className={CARD}>
          <p className="m-0 mb-space-1 text-sm text-secondary">ครบกำหนดเร็ว ๆ นี้</p>
          <p className="m-0 font-[family-name:var(--font-numeric)] text-2xl font-semibold tabular-nums text-primary">{formatCurrency(monthlyDueTotal)}</p>
          <span className="text-xs text-tertiary">{`บาท · ${dueCardCount} บัตร`}</span>
        </div>
        <div className={CARD}>
          <p className="m-0 mb-space-1 text-sm text-secondary">วงเงินคงเหลือ</p>
          <p className="m-0 font-[family-name:var(--font-numeric)] text-2xl font-semibold tabular-nums text-primary">{formatCurrency(totals?.availableCredit || 0)}</p>
          <span className="text-xs text-tertiary">{`/ ${formatCurrency(totals?.creditLimit || 0)} บาท`}</span>
        </div>
        <div className={CARD}>
          <p className="m-0 mb-space-1 text-sm text-secondary">แผนที่กำลังผ่อน</p>
          <p className="m-0 text-2xl font-semibold text-primary">{`${totals?.ongoingPlanCount || 0} แผน`}</p>
          <span className="text-xs text-tertiary">{`ใน ${totals?.cardCount || 0} บัตร`}</span>
        </div>
      </div>

      {/* summary — mobile single card (J1: อ่านหนี้รวมได้โดยไม่ต้อง scroll) */}
      <div className={`${CARD} md:hidden`} aria-live="polite">
        <p className="m-0 mb-space-1 text-sm text-secondary">หนี้คงเหลือรวม</p>
        <p className="m-0 font-[family-name:var(--font-numeric)] text-2xl font-semibold tabular-nums text-primary">{`${formatCurrency(totals?.remainingPayable || 0)} บาท`}</p>
        <p className="m-0 mt-space-1 text-xs text-tertiary">
          {`ครบกำหนดเร็ว ๆ นี้ ${formatCurrency(monthlyDueTotal)} · เหลือวงเงิน ${formatCurrency(totals?.availableCredit || 0)} · ${totals?.ongoingPlanCount || 0} แผน`}
        </p>
      </div>

      {planCreatedNote && <p className="m-0 text-sm text-tertiary">{planCreatedNote}</p>}

      <div>
        <div className="mb-space-3 flex items-center justify-between gap-space-3">
          <h2 className={SECTION_TITLE}>ครบกำหนดเร็ว ๆ นี้</h2>
          {upcoming.length > UPCOMING_MAX_ITEMS && (
            <button type="button" className={BTN_GHOST} onClick={onOpenCalendar}>ดูทั้งหมดในปฏิทิน</button>
          )}
        </div>

        {upcoming.length === 0 ? (
          <p className="m-0 text-sm text-tertiary">{`ไม่มีรายการครบกำหนดใน ${UPCOMING_WINDOW_DAYS} วันนี้ 🎉`}</p>
        ) : (
          <div className="flex flex-col gap-space-2">
            {upcoming.slice(0, UPCOMING_MAX_ITEMS).map(event => {
              const overdue = event.diffDays < 0;
              const busy = pendingKeys.includes(event.key);
              return (
                <div
                  key={event.key}
                  className="flex min-h-14 flex-col gap-space-2 rounded-sm border border-border-default bg-surface-2 p-space-3"
                  style={{ borderLeft: `4px solid ${overdue ? 'var(--color-neg, #F87171)' : (event.card.color || 'var(--color-accent, #D4A857)')}` }}
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-space-3">
                    <span className="inline-flex items-center gap-space-2 font-medium text-primary">
                      {overdue && <Icons.AlertTriangle size={16} color="var(--color-neg, #F87171)" />}
                      <span className="h-3 w-3 shrink-0 rounded-xs" style={{ background: event.card.color }} aria-hidden="true" />
                      {`${event.card.name}${event.card.last4 ? ` ····${event.card.last4}` : ''}`}
                    </span>
                    <span className="whitespace-nowrap font-[family-name:var(--font-numeric)] text-base font-semibold tabular-nums text-primary">{`${formatCurrency(event.payment)} บาท`}</span>
                  </div>
                  <span className="text-xs text-secondary">
                    {`${event.plan.itemName} · งวด ${event.installmentNo}/${event.plan.months}`}
                  </span>
                  <span className={`text-xs ${overdue ? 'text-neg' : 'text-secondary'}`}>
                    {`${formatIsoDateTH(event.dueDate)} · ${describeDueDistance(event.diffDays)}`}
                  </span>
                  <button
                    type="button"
                    className={`min-h-11 w-full rounded-sm border border-border-default bg-surface-1 text-sm font-medium text-secondary transition-colors duration-fast ease-graphite disabled:opacity-60 ${FOCUS_RING}`}
                    disabled={busy}
                    onClick={() => onToggleInstallment?.(event.planId, event.installmentNo, true, event.key)}
                  >
                    ยังไม่ชำระ — แตะเพื่อยืนยัน
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div>
        <div className="mb-space-3 flex items-center justify-between gap-space-3">
          <h2 className={SECTION_TITLE}>บัตรทั้งหมด</h2>
        </div>

        <div className="grid grid-cols-1 gap-space-4 md:grid-cols-2 lg:grid-cols-3">
          {cards.map(card => {
            const creditLimit = Number(card.creditLimit) || 0;
            const utilisation = creditLimit > 0
              ? Math.min(100, round2((Number(card.remainingPrincipal) || 0) / creditLimit * 100))
              : 0;
            const highUtilisation = creditLimit > 0 && utilisation >= HIGH_UTILISATION_PERCENT;
            const nextDueDiff = diffDaysFromToday(card.nextDueDate);
            // UX_SPEC §9: chip --warn เมื่อวันสรุปยอด/ครบกำหนดของบัตรอยู่ภายใน 7 วัน — nextDueDate
            // มาจาก resolveCardNextDueDate() ที่ backend คำนวณรวมทั้งงวดผ่อนและ cycle หมุนเวียนแล้ว
            const dueSoon = nextDueDiff !== null && nextDueDiff <= UPCOMING_WINDOW_DAYS;
            return (
              <div key={card.id} className={`${CARD} flex flex-col gap-space-2`} style={{ borderLeft: `4px solid ${card.color || 'var(--color-accent, #D4A857)'}` }}>
                <div className="flex items-start justify-between gap-space-2">
                  <span className="inline-flex min-w-0 items-center gap-space-2 text-base font-semibold text-primary">
                    <span className="h-3 w-3 shrink-0 rounded-xs" style={{ background: card.color }} aria-hidden="true" />
                    {card.name}
                  </span>
                  <CardMenu
                    card={card}
                    onEdit={onEditCard}
                    onAddPlan={onAddPlanForCard}
                    onDelete={onDeleteCard}
                  />
                </div>
                <span className="text-xs text-tertiary">
                  {[card.bankName, card.last4 ? `····${card.last4}` : ''].filter(Boolean).join(' · ') || 'ไม่ระบุธนาคาร'}
                </span>

                <span className="mt-space-1 text-xs text-tertiary">ยอดครบกำหนดรอบนี้</span>
                <span className="font-[family-name:var(--font-numeric)] text-2xl font-semibold tabular-nums text-primary">{`${formatCurrency(card.revolvingTotalDue || 0)} บาท`}</span>
                <span className="text-xs text-secondary">{`หนี้คงเหลือรวม ${formatCurrency(card.remainingPayable)} บาท`}</span>

                {dueSoon && (
                  <span className={WARN_CHIP}>
                    <Icons.AlertTriangle size={12} />
                    {nextDueDiff < 0 ? `เลยกำหนด ${Math.abs(nextDueDiff)} วัน` : `ครบกำหนดใน ${nextDueDiff} วัน`}
                  </span>
                )}

                {creditLimit > 0 && (
                  <>
                    <div className="mt-space-1 h-2 overflow-hidden rounded-full bg-surface-3">
                      <div
                        className={`h-full rounded-full transition-[width] duration-slow ease-graphite ${highUtilisation ? 'bg-neg' : 'bg-accent'}`}
                        style={{ width: `${utilisation}%` }}
                      />
                    </div>
                    <span className="text-xs text-secondary">
                      {`ใช้ไป ${utilisation.toFixed(1)}% · วงเงิน ${formatCurrency(creditLimit)} · เหลือ ${formatCurrency(card.availableCredit)}`}
                    </span>
                    {highUtilisation && (
                      <span className={WARN_CHIP}>
                        <Icons.AlertTriangle size={12} /> ใช้วงเงินเกิน {HIGH_UTILISATION_PERCENT}%
                      </span>
                    )}
                  </>
                )}

                <span className="text-xs text-tertiary">
                  {`สรุปยอด ${formatDayLabel(card.statementDay)} · ครบกำหนด ${formatDayLabel(card.dueDay)}`}
                </span>
                <span className="text-xs text-tertiary">{`${card.ongoingPlanCount} แผนกำลังผ่อน`}</span>

                <div className="mt-space-2">
                  <button type="button" className={`${BTN_GHOST} w-full`} onClick={() => onOpenCard?.(card.id)}>
                    ดูรายละเอียด
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {!hasPlans && <p className="m-0 text-sm text-tertiary">ยังไม่มีแผนผ่อน — กด + เพิ่มแผนผ่อนชำระ</p>}

      <div>
        <button type="button" className={BTN_PRIMARY} onClick={onAddPlan}>
          <Icons.Plus size={16} /> เพิ่มแผนผ่อนชำระ
        </button>
      </div>
    </div>
  );
}
