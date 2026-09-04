/**
 * คอมโพเนนต์: CreditCardDetail (หน้าจอ 2)
 * รายละเอียดบัตร 1 ใบ: สรุปวงเงิน/หนี้ + แผนผ่อนทั้งหมดของบัตรนั้น พร้อมตารางผ่อนรายงวด
 *
 * ตารางผ่อน: กางไว้บน desktop, พับไว้บนมือถือ (window.innerWidth < BP.md ตอน init)
 * แผน 60 งวดจะไม่ถูกเทลงจอมือถือทั้งก้อน — แสดง 6 งวดถัดไปที่ยังไม่ชำระ + งวดที่ชำระแล้ว
 *
 * Graphite redesign (credit-cards-graphite pass):
 * - Tailwind แทน CreditCard.module.css แล้ว
 * - Finding 4 (architecture review): breakpoint literal 768/767 เดิม → import BP จาก
 *   src/shared/utils/frontend/breakpoints.js แทน ตัวเลขไม่เปลี่ยน (BP.md === 768) เปลี่ยนแค่แหล่งที่มา
 *   (ADR-019 rule 4, Constraint 16 — breakpoints.js เองก็ระบุไฟล์/บรรทัดนี้ไว้ตั้งแต่ Foundation pass)
 * - UX_SPEC §9: header stat block → RevolvingBalanceSection → รายการแผนผ่อน (ลำดับเดิมถูกต้องอยู่แล้ว
 *   ตามคอมเมนต์เดิม "ยอดหมุนเวียนเป็นภาระหลักของบัตร จึงอยู่เหนือรายการแผนผ่อน") ตารางผ่อนเป็น C5 ที่
 *   md+ และ C4 stack ที่ base (คงพฤติกรรมเดิมทุกประการ — desktop table + mobile card สลับด้วย CSS
 *   responsive แทนการ toggle ด้วย JS)
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  formatDayLabel,
  formatIsoDateTH,
  resolveInstallmentDueDate,
  round2,
  PLAN_STATUS
} from '../../shared/utils/creditCardUtils';
import { formatMonthKeyTH } from '../../shared/utils/dateUtils';
import { formatCurrency } from '../../shared/utils/frontend/numberUtils';
import { BP } from '../../shared/utils/frontend/breakpoints';
import { Icons } from './Icons';
import RevolvingBalanceSection from './RevolvingBalanceSection';

const COLLAPSED_UNPAID_PREVIEW = 6;
const LONG_PLAN_THRESHOLD = 12;

const FOCUS_RING = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2';
const CARD = 'rounded-md border border-border-default bg-surface-1 p-space-4 shadow-elev-1 md:p-space-5';
const BTN_GHOST = `inline-flex min-h-11 items-center justify-center gap-space-2 rounded-sm border border-border-interactive bg-surface-2 px-space-4 text-sm font-medium text-primary transition-colors duration-fast ease-graphite hover:bg-surface-3 ${FOCUS_RING}`;
const ICON_BTN = `flex h-11 w-11 shrink-0 items-center justify-center rounded-sm border border-border-default bg-surface-2 text-secondary transition-colors duration-fast ease-graphite hover:bg-surface-3 ${FOCUS_RING}`;
const SECTION_TITLE = 'm-0 text-lg font-semibold text-primary';
const PAID_PILL = `min-h-11 w-full rounded-sm border border-border-default bg-surface-2 text-center text-sm font-medium text-secondary transition-colors duration-fast ease-graphite disabled:opacity-60 ${FOCUS_RING}`;
const PAID_PILL_ON = 'border-pos/40 bg-pos/14 text-pos';
const BADGE = 'inline-flex w-fit items-center gap-space-1 rounded-full border border-border-default bg-surface-2 px-space-2 py-[2px] text-xs font-medium text-secondary';

function PlanMenu({ plan, onRename, onEdit, onCancel, onDelete }) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef(null);
  const editable = plan.installmentsPaid === 0 && plan.status !== PLAN_STATUS.CANCELLED;

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
    action?.(plan);
  };

  return (
    <div className="relative shrink-0" ref={wrapperRef}>
      <button
        type="button"
        className={ICON_BTN}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={`ตัวเลือกของแผน ${plan.itemName}`}
        onClick={() => setOpen(value => !value)}
      >
        <Icons.Settings size={16} />
      </button>
      {open && (
        <div className="absolute right-0 top-[calc(100%+6px)] z-30 flex min-w-[240px] flex-col gap-[2px] rounded-md border border-border-default bg-surface-3 p-space-2 shadow-elev-3" role="menu">
          <button
            type="button"
            role="menuitem"
            className={`flex min-h-11 items-center gap-space-2 rounded-sm px-space-3 text-left text-sm text-primary hover:bg-surface-2 ${FOCUS_RING}`}
            onClick={() => run(onRename)}
          >
            <Icons.Edit size={16} /> แก้ไขชื่อรายการ
          </button>
          <button
            type="button"
            role="menuitem"
            className={`flex min-h-11 items-center gap-space-2 rounded-sm px-space-3 text-left text-sm text-primary hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-transparent ${FOCUS_RING}`}
            disabled={!editable}
            title={editable ? undefined : `แก้ไขไม่ได้เพราะชำระไปแล้ว ${plan.installmentsPaid} งวด`}
            onClick={() => run(onEdit)}
          >
            <Icons.Settings size={16} /> แก้ไขแผน
          </button>
          {!editable && plan.status !== PLAN_STATUS.CANCELLED && (
            <p className="m-0 px-space-3 pb-space-2 text-xs leading-relaxed text-tertiary">
              {`แก้ไขไม่ได้เพราะชำระไปแล้ว ${plan.installmentsPaid} งวด — ให้ยกเลิกแผนแล้วสร้างใหม่`}
            </p>
          )}
          {plan.status !== PLAN_STATUS.CANCELLED && (
            <button
              type="button"
              role="menuitem"
              className={`flex min-h-11 items-center gap-space-2 rounded-sm px-space-3 text-left text-sm text-neg hover:bg-neg/10 ${FOCUS_RING}`}
              onClick={() => run(onCancel)}
            >
              <Icons.X size={16} /> ยกเลิกแผน
            </button>
          )}
          <button
            type="button"
            role="menuitem"
            className={`flex min-h-11 items-center gap-space-2 rounded-sm px-space-3 text-left text-sm text-neg hover:bg-neg/10 disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-transparent ${FOCUS_RING}`}
            disabled={plan.installmentsPaid > 0}
            title={plan.installmentsPaid > 0 ? 'ลบไม่ได้เพราะมีงวดที่ชำระแล้ว — ให้ยกเลิกแผนแทน' : undefined}
            onClick={() => run(onDelete)}
          >
            <Icons.Trash size={16} /> ลบแผน
          </button>
        </div>
      )}
    </div>
  );
}

function describePlanInterest(plan) {
  if (plan.interestMode === 'manual') {
    return `ค่าธรรมเนียม ${formatCurrency(plan.manualFeePerMonth)} บาท/งวด`;
  }
  const methodLabel = plan.calcMethod === 'effective' ? 'ลดต้นลดดอก' : 'แบบคงที่';
  return `${methodLabel} ${plan.annualRate}%/ปี`;
}

function PlanCard({
  plan,
  card,
  isMobileView,
  pendingKeys,
  onToggleInstallment,
  onRename,
  onEdit,
  onCancel,
  onDelete
}) {
  const [scheduleOpen, setScheduleOpen] = useState(!isMobileView);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    setScheduleOpen(!isMobileView);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMobileView]);

  const schedule = Array.isArray(plan.schedule) ? plan.schedule : [];
  const nextUnpaidNo = plan.nextUnpaid?.no ?? null;
  const isLongPlan = plan.months > LONG_PLAN_THRESHOLD;

  const visibleRows = useMemo(() => {
    if (!isLongPlan || showAll) return schedule;
    let unpaidShown = 0;
    return schedule.filter(row => {
      if (row.paid === true) return true;
      if (unpaidShown < COLLAPSED_UNPAID_PREVIEW) {
        unpaidShown += 1;
        return true;
      }
      return false;
    });
  }, [schedule, isLongPlan, showAll]);

  const settled = plan.status === PLAN_STATUS.COMPLETED || plan.status === PLAN_STATUS.CANCELLED;

  const renderPaidPill = (row) => {
    const key = `${plan.id}_${row.no}`;
    const busy = pendingKeys.includes(key);
    const disabled = busy || plan.status === PLAN_STATUS.CANCELLED;
    return (
      <button
        type="button"
        className={`${PAID_PILL} ${row.paid ? PAID_PILL_ON : ''}`}
        disabled={disabled}
        onClick={() => onToggleInstallment?.(plan.id, row.no, !row.paid, key)}
      >
        {row.paid ? '✓ ชำระแล้ว' : 'ยังไม่ชำระ — แตะเพื่อยืนยัน'}
      </button>
    );
  };

  return (
    <div className={`${CARD} flex flex-col gap-space-2 ${settled ? 'opacity-70' : ''}`}>
      <div className="flex items-start justify-between gap-space-3">
        <h3 className="m-0 line-clamp-2 text-base font-bold text-primary" title={plan.itemName}>{plan.itemName}</h3>
        <PlanMenu
          plan={plan}
          onRename={onRename}
          onEdit={onEdit}
          onCancel={onCancel}
          onDelete={onDelete}
        />
      </div>

      {plan.status === PLAN_STATUS.COMPLETED && <span className={`${BADGE} border-pos/40 bg-pos/16 text-pos`}>✓ ผ่อนครบแล้ว</span>}
      {plan.status === PLAN_STATUS.CANCELLED && <span className={`${BADGE} border-neg/35 bg-neg/14 text-neg`}>ยกเลิกแผนแล้ว</span>}

      <span className="text-xs text-secondary">{`${formatCurrency(plan.totalPrice)} บาท · ${plan.months} งวด`}</span>
      <div className="h-2 overflow-hidden rounded-full bg-surface-3">
        <div className="h-full rounded-full bg-accent transition-[width] duration-slow ease-graphite" style={{ width: `${plan.progressPercent}%` }} />
      </div>
      <span className="text-xs text-secondary">{`${plan.installmentsPaid}/${plan.months} งวด · ชำระแล้ว ${plan.progressPercent}%`}</span>
      <span className="text-xs text-secondary">{`งวดละ ${formatCurrency(plan.monthlyPayment)} บาท · คงเหลือ ${formatCurrency(plan.remainingPayable)} บาท`}</span>
      <span className="text-xs text-secondary">{describePlanInterest(plan)}</span>
      {plan.nextUnpaid && (
        <span className="text-xs text-secondary">
          {`งวดถัดไป ${plan.nextUnpaid.no}/${plan.months} · ${formatIsoDateTH(resolveInstallmentDueDate(card?.dueDay, plan.nextUnpaid.dueMonth))}`}
        </span>
      )}

      <button
        type="button"
        className={`mt-space-1 flex min-h-11 w-full items-center justify-center gap-space-2 rounded-sm border border-border-default bg-surface-2 text-sm font-medium text-secondary ${FOCUS_RING}`}
        aria-expanded={scheduleOpen}
        onClick={() => setScheduleOpen(value => !value)}
      >
        {scheduleOpen ? 'ซ่อนตารางผ่อน' : 'ดูตารางผ่อน'}
        <Icons.ChevronDown size={16} />
      </button>

      {scheduleOpen && (
        <>
          {/* C5 table — md+ */}
          <div className="mt-space-2 hidden overflow-x-auto md:block">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr>
                  <th className="whitespace-nowrap border-b border-border-default px-space-2 py-space-2 text-left font-semibold text-tertiary">งวด</th>
                  <th className="whitespace-nowrap border-b border-border-default px-space-2 py-space-2 text-left font-semibold text-tertiary">เดือน</th>
                  <th className="whitespace-nowrap border-b border-border-default px-space-2 py-space-2 text-right font-semibold text-tertiary">ยอดชำระ</th>
                  <th className="whitespace-nowrap border-b border-border-default px-space-2 py-space-2 text-right font-semibold text-tertiary">เงินต้น</th>
                  <th className="whitespace-nowrap border-b border-border-default px-space-2 py-space-2 text-right font-semibold text-tertiary">ดอกเบี้ย</th>
                  <th className="whitespace-nowrap border-b border-border-default px-space-2 py-space-2 text-left font-semibold text-tertiary">สถานะ</th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map(row => (
                  <tr
                    key={row.no}
                    className={`${row.paid ? 'opacity-60' : ''} ${row.no === nextUnpaidNo ? 'bg-accent-muted' : ''}`}
                  >
                    <td className="whitespace-nowrap border-b border-border-subtle px-space-2 py-space-2 text-primary">{row.no}</td>
                    <td className="whitespace-nowrap border-b border-border-subtle px-space-2 py-space-2 text-primary">{formatMonthKeyTH(row.dueMonth)}</td>
                    <td className="whitespace-nowrap border-b border-border-subtle px-space-2 py-space-2 text-right font-[family-name:var(--font-numeric)] tabular-nums text-primary">{formatCurrency(row.payment)}</td>
                    <td className="whitespace-nowrap border-b border-border-subtle px-space-2 py-space-2 text-right font-[family-name:var(--font-numeric)] tabular-nums text-primary">{formatCurrency(row.principal)}</td>
                    <td className="whitespace-nowrap border-b border-border-subtle px-space-2 py-space-2 text-right font-[family-name:var(--font-numeric)] tabular-nums text-primary">{formatCurrency(row.interest)}</td>
                    <td className="whitespace-nowrap border-b border-border-subtle px-space-2 py-space-2">{renderPaidPill(row)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* C4 stack — base */}
          <div className="mt-space-2 flex flex-col gap-space-2 md:hidden">
            {visibleRows.map(row => (
              <div
                key={row.no}
                className={`flex flex-col gap-space-1 rounded-sm border border-border-subtle bg-surface-2 p-space-3 ${row.paid ? 'opacity-65' : ''} ${row.no === nextUnpaidNo ? 'border-l-2 border-l-accent' : ''}`}
              >
                <div className="flex items-baseline justify-between gap-space-2 text-sm text-secondary">
                  <span>{`งวด ${row.no}`}</span>
                  <span>{formatMonthKeyTH(row.dueMonth)}</span>
                </div>
                <span className="font-[family-name:var(--font-numeric)] text-base font-semibold tabular-nums text-primary">{formatCurrency(row.payment)}</span>
                <span className="text-xs text-tertiary">
                  {`ต้น ${formatCurrency(row.principal)} · ดบ ${formatCurrency(row.interest)}`}
                </span>
                {renderPaidPill(row)}
              </div>
            ))}
          </div>

          {isLongPlan && !showAll && visibleRows.length < schedule.length && (
            <button
              type="button"
              className={`mt-space-2 min-h-11 w-full rounded-sm border border-dashed border-border-default text-sm text-secondary ${FOCUS_RING}`}
              onClick={() => setShowAll(true)}
            >
              {`แสดงทั้งหมด (${plan.months} งวด)`}
            </button>
          )}
        </>
      )}
    </div>
  );
}

export default function CreditCardDetail({
  card,
  plans = [],
  pendingKeys = [],
  onBack,
  onEditCard,
  onDeleteCard,
  onAddPlanForCard,
  onRenamePlan,
  onEditPlan,
  onCancelPlan,
  onDeletePlan,
  onToggleInstallment,
  onConfirmMinimum,
  onRevolvingChanged
}) {
  const [isMobileView, setIsMobileView] = useState(
    () => typeof window !== 'undefined' && window.innerWidth < BP.md
  );

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const media = window.matchMedia(`(max-width: ${BP.md - 1}px)`);
    const update = () => setIsMobileView(media.matches);
    update();
    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', update);
      return () => media.removeEventListener('change', update);
    }
    media.addListener(update);
    return () => media.removeListener(update);
  }, []);

  const orderedPlans = useMemo(() => {
    const rank = (plan) => (plan.status === PLAN_STATUS.ONGOING ? 0 : 1);
    return [...plans].sort((a, b) => rank(a) - rank(b) || String(a.createdAt).localeCompare(String(b.createdAt)));
  }, [plans]);

  if (!card) {
    return (
      <div className="flex flex-col items-center gap-space-3 rounded-md border border-dashed border-border-default bg-sunken px-space-5 py-space-7 text-center">
        <Icons.AlertTriangle size={40} color="var(--color-neg, #F87171)" />
        <h2 className="m-0 text-lg font-semibold text-primary">ไม่พบบัตรใบนี้</h2>
        <button type="button" className={BTN_GHOST} onClick={onBack}>กลับหน้าภาพรวม</button>
      </div>
    );
  }

  const creditLimit = Number(card.creditLimit) || 0;
  const utilisation = creditLimit > 0
    ? Math.min(100, round2((Number(card.remainingPrincipal) || 0) / creditLimit * 100))
    : 0;

  return (
    <div className="flex flex-col gap-space-5">
      <div className="flex items-center gap-space-3">
        <button type="button" className={BTN_GHOST} onClick={onBack} aria-label="กลับหน้าภาพรวม">
          <Icons.ChevronLeft size={16} /> กลับ
        </button>
        <h2 className={SECTION_TITLE}>{card.name}</h2>
      </div>

      <div className="grid grid-cols-1 items-start gap-space-4 md:grid-cols-[320px_1fr]">
        {/* header stat block (C3) */}
        <div className="overflow-hidden rounded-md border border-border-default bg-surface-1 md:sticky md:top-[90px]">
          <div className="h-[10px]" style={{ background: card.color || 'var(--color-accent, #D4A857)' }} />
          <div className="flex flex-col gap-space-2 p-space-4">
            <span className="inline-flex items-center gap-space-2 text-base font-bold text-primary">
              <span className="h-3 w-3 shrink-0 rounded-xs" style={{ background: card.color }} aria-hidden="true" />
              {card.name}
            </span>
            <span className="text-xs text-tertiary">
              {[card.bankName, card.last4 ? `····${card.last4}` : ''].filter(Boolean).join(' · ') || 'ไม่ระบุธนาคาร'}
            </span>

            <span className="mt-space-1 text-xs text-tertiary">หนี้คงเหลือ</span>
            <span className="font-[family-name:var(--font-numeric)] text-2xl font-semibold tabular-nums text-primary">{`${formatCurrency(card.remainingPayable)} บาท`}</span>

            {/* แยกที่มาให้ชัด มิฉะนั้นตัวเลขรวมจะอธิบายไม่ได้เมื่อมีสองแหล่งป้อนเข้ามา */}
            {Number(card.revolvingDue) > 0 && (
              <>
                <div className="flex items-center justify-between gap-space-3 py-[2px] text-sm">
                  <span className="text-tertiary">ผ่อนชำระ</span>
                  <span className="font-semibold text-primary">{formatCurrency(card.installmentPayable)}</span>
                </div>
                <div className="flex items-center justify-between gap-space-3 py-[2px] text-sm">
                  <span className="text-tertiary">ยอดหมุนเวียน</span>
                  <span className="font-semibold text-primary">{formatCurrency(card.revolvingDue)}</span>
                </div>
              </>
            )}

            {creditLimit > 0 && (
              <>
                <div className="flex items-center justify-between gap-space-3 py-[2px] text-sm">
                  <span className="text-tertiary">วงเงิน</span>
                  <span className="font-semibold text-primary">{formatCurrency(creditLimit)}</span>
                </div>
                <div className="flex items-center justify-between gap-space-3 py-[2px] text-sm">
                  <span className="text-tertiary">ใช้ไป</span>
                  <span className="font-semibold text-primary">{formatCurrency(card.remainingPrincipal)}</span>
                </div>
                <div className="flex items-center justify-between gap-space-3 py-[2px] text-sm">
                  <span className="text-tertiary">คงเหลือ</span>
                  <span className="font-semibold text-primary">{formatCurrency(card.availableCredit)}</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-surface-3">
                  <div
                    className={`h-full rounded-full transition-[width] duration-slow ease-graphite ${utilisation >= 80 ? 'bg-neg' : 'bg-accent'}`}
                    style={{ width: `${utilisation}%` }}
                  />
                </div>
                <span className="text-xs text-secondary">{`${utilisation.toFixed(1)}%`}</span>
              </>
            )}

            {/* แถวข้อมูลกำหนดการ (วันสรุปยอด/วันครบกำหนด) เบาลงเล็กน้อยจากแถวการเงินด้านบน — ตัวเลขที่
                เกี่ยวกับการตัดสินใจจริงไม่ควรโดดเท่า metadata (critique 2026-08-29 P3, carried forward
                จาก CreditCard.module.css .detailRowMeta เดิม) */}
            <div className="flex items-center justify-between gap-space-3 py-[2px] text-xs font-medium text-tertiary">
              <span>สรุปยอด</span>
              <span>{formatDayLabel(card.statementDay)}</span>
            </div>
            <div className="flex items-center justify-between gap-space-3 py-[2px] text-xs font-medium text-tertiary">
              <span>ครบกำหนด</span>
              <span>{formatDayLabel(card.dueDay)}</span>
            </div>

            <div className="mt-space-2 flex flex-col gap-space-2">
              <button type="button" className={`${BTN_GHOST} w-full`} onClick={() => onEditCard?.(card)}>
                <Icons.Edit size={16} /> แก้ไขบัตร
              </button>
              <button type="button" className={`${BTN_GHOST} w-full text-neg`} onClick={() => onDeleteCard?.(card)}>
                <Icons.Trash size={16} /> ลบบัตร
              </button>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-space-4">
          {/* ยอดหมุนเวียนเป็นภาระหลักของบัตร จึงอยู่เหนือรายการแผนผ่อนซึ่งเป็นรายละเอียดย่อย (UX_SPEC §9) */}
          <RevolvingBalanceSection
            card={card}
            isMobileView={isMobileView}
            onConfirmMinimum={onConfirmMinimum}
            onChanged={onRevolvingChanged}
          />

          <div className="flex items-center justify-between gap-space-3">
            <h2 className={SECTION_TITLE}>{`แผนผ่อนชำระ (${plans.length})`}</h2>
            <button
              type="button"
              className={`inline-flex min-h-11 items-center justify-center gap-space-2 rounded-sm bg-accent px-space-4 text-sm font-medium text-on-accent transition-colors duration-fast ease-graphite hover:opacity-90 ${FOCUS_RING}`}
              onClick={() => onAddPlanForCard?.(card)}
            >
              <Icons.Plus size={16} /> เพิ่ม
            </button>
          </div>

          {orderedPlans.length === 0 ? (
            <p className="m-0 text-sm text-tertiary">ยังไม่มีแผนผ่อนในบัตรนี้ — กด “เพิ่ม” เพื่อเริ่มต้น</p>
          ) : (
            <div className="flex flex-col gap-space-3">
              {orderedPlans.map(plan => (
                <PlanCard
                  key={plan.id}
                  plan={plan}
                  card={card}
                  isMobileView={isMobileView}
                  pendingKeys={pendingKeys}
                  onToggleInstallment={onToggleInstallment}
                  onRename={onRenamePlan}
                  onEdit={onEditPlan}
                  onCancel={onCancelPlan}
                  onDelete={onDeletePlan}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
