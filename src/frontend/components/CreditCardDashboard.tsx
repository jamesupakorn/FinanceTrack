/**
 * คอมโพเนนต์: CreditCardDashboard (หน้าจอ 1)
 * ภาพรวมหนี้บัตรทั้งหมด + รายการที่ครบกำหนดเร็ว ๆ นี้ + การ์ดบัตรทุกใบ
 *
 * ตอบคำถามเดียวให้เร็วที่สุด: "เดือนนี้ต้องจ่ายบัตรเท่าไหร่ และผ่อนอะไรอยู่บ้าง"
 * บนมือถือรวม summary เหลือการ์ดเดียวเพื่อให้อ่านได้โดยไม่ต้อง scroll (J1)
 *
 * Graphite redesign (credit-cards-graphite pass) — Tailwind แทน CreditCard.module.css แล้ว
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  resolveCardDueDate,
  formatIsoDateTH,
  diffDaysFromToday,
  describeDueDistance,
  round2,
  PLAN_STATUS,
  normaliseDayValue
} from '../../shared/utils/creditCardUtils';
import { formatCurrency } from '../../shared/utils/frontend/numberUtils';
import { fitFontSizeCss } from '../../shared/utils/frontend/ringTextFit';
import { Icons } from './Icons';
import CreditCardTileGrid, { TILE_GRID_CLASS } from './CreditCardTileGrid';

interface DashboardCard {
  id: string;
  name: string;
  color?: string;
  bankIssuer?: unknown;
  bankName?: string;
  last4?: string;
  creditLimit?: number | string;
  remainingPrincipal?: number | string;
  revolvingTotalDue?: number | string;
  revolvingDue?: number | string;
  revolvingDueMonth?: string | null;
  payableRevolvingDue?: number | string;
  payableRevolvingMonth?: string | null;
  remainingPayable: number | string;
  availableCredit: number | string;
  statementDay?: number | string | null;
  dueDay?: number | string;
  nextDueDate?: string | null;
  ongoingPlanCount?: number;
}

interface PlanScheduleEntry {
  no: number;
  paid?: boolean;
  dueMonth: string;
  payment: number | string;
}

interface DashboardPlan {
  id: string;
  cardId: string;
  itemName: string;
  months: number;
  status?: string;
  schedule?: PlanScheduleEntry[];
}

interface DashboardTotals {
  remainingPayable?: number | string;
  availableCredit?: number | string;
  creditLimit?: number | string;
  ongoingPlanCount?: number;
  cardCount?: number;
}

interface UpcomingGroup {
  key: string;
  card: DashboardCard;
  dueDate: string;
  diffDays: number;
  installmentCount: number;
  installmentSubtotal: number;
  revolvingSubtotal: number;
  total: number;
}

interface UpcomingProjection {
  groups: UpcomingGroup[];
  error: string | null;
}

type CardAction = (card: DashboardCard) => void;

interface CreditCardDashboardProps {
  cards?: DashboardCard[];
  totals?: DashboardTotals | null;
  plans?: DashboardPlan[];
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void | Promise<void>;
  onAddCard?: () => void;
  onEditCard?: CardAction;
  onDeleteCard?: CardAction;
  onAddPlan?: () => void;
  onAddPlanForCard?: (card: DashboardCard | null) => void;
  onOpenCard?: (cardId: string) => void;
  planCreatedNote?: string | null;
}

export const UPCOMING_WINDOW_DAYS = 7;
const UPCOMING_MAX_GROUPS = 5;
const VALID_MONTH_KEY = /^\d{4}-(0[1-9]|1[0-2])$/;
export const HIGH_UTILISATION_PERCENT = 80;

export const FOCUS_RING = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2';
const CARD = 'rounded-md border border-border-default bg-surface-1 p-space-4 shadow-elev-1 md:p-space-5';
// รักษา line-box เดิมของ text-2xl ไว้แม้ font-size จะหดลง เพื่อให้แถว caption ของ 4 tile เรียงกันพอดี (spec D-5)
export const TILE_AMOUNT_LINE_HEIGHT = 'calc(var(--text-2xl) * 1.3)';
const BTN_PRIMARY = `inline-flex min-h-11 items-center justify-center gap-space-2 rounded-sm bg-accent px-space-4 text-sm font-medium text-on-accent transition-colors duration-fast ease-graphite hover:opacity-90 ${FOCUS_RING}`;
export const BTN_GHOST = `inline-flex min-h-11 items-center justify-center gap-space-2 rounded-sm border border-border-interactive bg-surface-2 px-space-4 text-sm font-medium text-primary transition-colors duration-fast ease-graphite hover:bg-surface-3 ${FOCUS_RING}`;
const ICON_BTN = `flex h-11 w-11 shrink-0 items-center justify-center rounded-sm border border-border-default bg-surface-2 text-secondary transition-colors duration-fast ease-graphite hover:bg-surface-3 ${FOCUS_RING}`;
const SECTION_TITLE = 'm-0 text-lg font-semibold text-primary';
const WARN_CHIP = 'inline-flex w-fit items-center gap-space-1 rounded-full border border-warn/40 bg-warn/14 px-space-2 py-[2px] text-xs font-medium text-warn';

/** เมนู ⋯ ของการ์ด — ปิดเมื่อคลิกนอกพื้นที่หรือกด Escape (แบบเดียวกับ userMenuWrapper ใน edit.js) */
export function CardMenu({ card, onEdit, onAddPlan, onDelete }: {
  card: DashboardCard;
  onEdit?: CardAction;
  onAddPlan?: CardAction;
  onDelete?: CardAction;
}) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return undefined;
    const handleClickOutside = (event: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) setOpen(false);
    };
    const handleEsc = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEsc);
    };
  }, [open]);

  const run = (action?: CardAction) => {
    // รายการเมนูที่กดจะถูก unmount เมื่อเมนูปิด — คืน focus ที่ปุ่ม ⋯ ก่อน เพื่อให้ dialog ที่เปิดต่อคืน focus ได้ถูกที่
    triggerRef.current?.focus();
    setOpen(false);
    action?.(card);
  };

  return (
    <div className="relative shrink-0" ref={wrapperRef}>
      <button
        type="button"
        ref={triggerRef}
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
            <Icons.Plus size={16} /> เพิ่มรายจ่าย
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
  onRetry,
  onAddCard,
  onEditCard,
  onDeleteCard,
  onAddPlan,
  onAddPlanForCard,
  onOpenCard,
  planCreatedNote = null
}: CreditCardDashboardProps) {
  const cardById = useMemo(() => new Map(cards.map(card => [card.id, card])), [cards]);
  const [showAllUpcoming, setShowAllUpcoming] = useState(false);

  /** รวมภาระที่ยังไม่ชำระตามบัตรและวันที่ครบกำหนด ก่อนจำกัดจำนวนกลุ่มที่แสดง */
  const upcomingProjection = useMemo<UpcomingProjection>(() => {
    const groupsByCard = new Map<string, Map<string, UpcomingGroup>>();
    const getGroup = (card: DashboardCard, dueDate: string, diffDays: number): UpcomingGroup => {
      let cardGroups = groupsByCard.get(card.id);
      if (!cardGroups) {
        cardGroups = new Map<string, UpcomingGroup>();
        groupsByCard.set(card.id, cardGroups);
      }
      let group = cardGroups.get(dueDate);
      if (!group) {
        group = {
          key: `${card.id}:${dueDate}`,
          card,
          dueDate,
          diffDays,
          installmentCount: 0,
          installmentSubtotal: 0,
          revolvingSubtotal: 0,
          total: 0
        };
        cardGroups.set(dueDate, group);
      }
      return group;
    };

    plans.forEach(plan => {
      if (plan?.status !== PLAN_STATUS.ONGOING) return;
      const card = cardById.get(plan.cardId);
      if (!card) return;
      (Array.isArray(plan.schedule) ? plan.schedule : []).forEach(row => {
        if (row?.paid === true) return;
        const dueDate = resolveCardDueDate(card, row.dueMonth);
        if (!dueDate) return;
        const diffDays = diffDaysFromToday(dueDate);
        if (diffDays === null) return;
        if (diffDays > UPCOMING_WINDOW_DAYS) return;
        const group = getGroup(card, dueDate, diffDays);
        group.installmentCount += 1;
        group.installmentSubtotal += Number(row.payment) || 0;
      });
    });

    for (const card of cards) {
      // R-2 override (spec-credit-card-cross-month-due.md): รอบบิลที่ครบกำหนดในเดือนนี้ (payable) ยังค้างจ่าย
      // และไม่ใช่รอบปัจจุบัน → ใช้รอบนั้น "แทน" รอบปัจจุบัน ไม่บวกเพิ่ม (ยอดค้างถูก carry เข้ารอบปัจจุบันแล้ว)
      // ยอด derive ฝั่งเซิร์ฟเวอร์ใน summariseCard ทุกครั้งที่ GET ไม่ได้คำนวณ/เก็บที่ client
      const payableMonth = card.payableRevolvingMonth;
      const payableDue = Number(card.payableRevolvingDue);
      const usePayable = typeof payableMonth === 'string'
        && VALID_MONTH_KEY.test(payableMonth)
        && payableMonth !== card.revolvingDueMonth
        && Number.isFinite(payableDue)
        && payableDue > 0;

      const revolvingDue = usePayable ? payableDue : Number(card.revolvingDue);
      if (!Number.isFinite(revolvingDue) || revolvingDue <= 0) continue;

      const dueMonth = usePayable ? payableMonth : card.revolvingDueMonth;
      const dueDay = normaliseDayValue(card.dueDay);
      if (typeof dueMonth !== 'string' || !VALID_MONTH_KEY.test(dueMonth) || dueDay === null) {
        return {
          groups: [],
          error: `ข้อมูลวันครบกำหนดของยอดหมุนเวียนบัตร ${card.name} ไม่ถูกต้อง กรุณาลองโหลดใหม่`
        };
      }

      // วันครบกำหนดจริงของรอบบิล — อาจอยู่เดือนถัดไปตาม statementDay (XM-5)
      const dueDate = resolveCardDueDate(card, dueMonth);
      const diffDays = dueDate ? diffDaysFromToday(dueDate) : null;
      if (!dueDate || diffDays === null) {
        return {
          groups: [],
          error: `ข้อมูลวันครบกำหนดของยอดหมุนเวียนบัตร ${card.name} ไม่ถูกต้อง กรุณาลองโหลดใหม่`
        };
      }
      if (diffDays > UPCOMING_WINDOW_DAYS) continue;

      getGroup(card, dueDate, diffDays).revolvingSubtotal += revolvingDue;
    }

    const groups = Array.from(groupsByCard.values())
      .flatMap(cardGroups => Array.from(cardGroups.values()))
      .map(group => {
        const installmentSubtotal = round2(group.installmentSubtotal);
        const revolvingSubtotal = round2(group.revolvingSubtotal);
        return {
          ...group,
          installmentSubtotal,
          revolvingSubtotal,
          total: round2(installmentSubtotal + revolvingSubtotal)
        };
      })
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.card.id.localeCompare(b.card.id));

    return { groups, error: null };
  }, [cards, plans, cardById]);

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
        <div className={TILE_GRID_CLASS}>
          <div className="h-[220px] animate-pulse rounded-md bg-surface-2" />
          <div className="h-[220px] animate-pulse rounded-md bg-surface-2" />
        </div>
      </div>
    );
  }

  if (error || upcomingProjection.error) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-space-3 rounded-md border border-neg/35 bg-neg/10 p-space-4 text-neg" role="alert">
        <span>{error || upcomingProjection.error}</span>
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

  const upcoming = upcomingProjection.groups;
  const monthlyDueTotal = round2(upcoming.reduce((sum, group) => sum + group.total, 0));
  const dueCardCount = new Set(upcoming.map(group => group.card.id)).size;
  const visibleUpcoming = showAllUpcoming ? upcoming : upcoming.slice(0, UPCOMING_MAX_GROUPS);

  return (
    <div className="flex flex-col gap-space-5">
      {/* summary — desktop 4 tiles (C3 stats) */}
      <div className="hidden grid-cols-4 gap-space-3 md:grid" aria-live="polite">
        <div className={`${CARD} min-w-0 [container-type:inline-size]`}>
          <p className="m-0 mb-space-1 text-sm text-secondary">หนี้คงเหลือรวม</p>
          <p
            className="m-0 whitespace-nowrap font-[family-name:var(--font-numeric)] text-2xl font-semibold tabular-nums text-primary"
            style={{ fontSize: fitFontSizeCss(formatCurrency(totals?.remainingPayable || 0)), lineHeight: TILE_AMOUNT_LINE_HEIGHT }}
          >
            {formatCurrency(totals?.remainingPayable || 0)}
          </p>
          <span className="text-xs text-tertiary">บาท</span>
        </div>
        <div className={`${CARD} min-w-0 [container-type:inline-size]`}>
          <p className="m-0 mb-space-1 text-sm text-secondary">ครบกำหนดเร็ว ๆ นี้</p>
          <p
            className="m-0 whitespace-nowrap font-[family-name:var(--font-numeric)] text-2xl font-semibold tabular-nums text-primary"
            style={{ fontSize: fitFontSizeCss(formatCurrency(monthlyDueTotal)), lineHeight: TILE_AMOUNT_LINE_HEIGHT }}
          >
            {formatCurrency(monthlyDueTotal)}
          </p>
          <span className="text-xs text-tertiary">{`บาท · ${dueCardCount} บัตร`}</span>
        </div>
        <div className={`${CARD} min-w-0 [container-type:inline-size]`}>
          <p className="m-0 mb-space-1 text-sm text-secondary">วงเงินคงเหลือ</p>
          <p
            className="m-0 whitespace-nowrap font-[family-name:var(--font-numeric)] text-2xl font-semibold tabular-nums text-primary"
            style={{ fontSize: fitFontSizeCss(formatCurrency(totals?.availableCredit || 0)), lineHeight: TILE_AMOUNT_LINE_HEIGHT }}
          >
            {formatCurrency(totals?.availableCredit || 0)}
          </p>
          <span className="text-xs text-tertiary">{`/ `}<span className="whitespace-nowrap">{formatCurrency(totals?.creditLimit || 0)}</span>{` บาท`}</span>
        </div>
        <div className={CARD}>
          <p className="m-0 mb-space-1 text-sm text-secondary">แผนที่กำลังผ่อน</p>
          <p className="m-0 text-2xl font-semibold text-primary">{`${totals?.ongoingPlanCount || 0} แผน`}</p>
          <span className="text-xs text-tertiary">{`ใน ${totals?.cardCount || 0} บัตร`}</span>
        </div>
      </div>

      {/* summary — mobile single card (J1: อ่านหนี้รวมได้โดยไม่ต้อง scroll) */}
      <div className={`${CARD} min-w-0 md:hidden`} aria-live="polite">
        <p className="m-0 mb-space-1 text-sm text-secondary">หนี้คงเหลือรวม</p>
        <p className="m-0 font-[family-name:var(--font-numeric)] text-2xl font-semibold tabular-nums text-primary">
          <span className="whitespace-nowrap">{formatCurrency(totals?.remainingPayable || 0)}</span>{' บาท'}
        </p>
        <p className="m-0 mt-space-1 text-xs text-tertiary">
          {'ครบกำหนดเร็ว ๆ นี้ '}<span className="max-w-full break-all">{formatCurrency(monthlyDueTotal)}</span>
          {` · ${dueCardCount} บัตร`}
          {' · เหลือวงเงิน '}<span className="whitespace-nowrap">{formatCurrency(totals?.availableCredit || 0)}</span>
          {` · ${totals?.ongoingPlanCount || 0} แผน`}
        </p>
      </div>

      {planCreatedNote && <p className="m-0 text-sm text-tertiary">{planCreatedNote}</p>}

      <div>
        <div className="mb-space-3 flex items-center justify-between gap-space-3">
          <h2 className={SECTION_TITLE}>ครบกำหนดเร็ว ๆ นี้</h2>
        </div>

        {upcoming.length === 0 ? (
          <p className="m-0 text-sm text-tertiary">{`ไม่มีรายการครบกำหนดใน ${UPCOMING_WINDOW_DAYS} วันนี้ 🎉`}</p>
        ) : (
          <div className="flex flex-col gap-space-3">
            <ul
              id="upcoming-groups"
              aria-label="รายการบัตรเครดิตที่ครบกำหนดเร็ว ๆ นี้"
              className="m-0 flex list-none flex-col gap-space-2 p-0"
            >
              {visibleUpcoming.map((group, index) => {
                const overdue = group.diffDays < 0;
                const headingId = `upcoming-card-${index}`;
                return (
                  <li key={group.key}>
                    <article
                      className="flex min-h-14 min-w-0 flex-col gap-space-2 rounded-sm border border-border-default bg-surface-2 p-space-3"
                      style={{ borderLeft: `4px solid ${overdue ? 'var(--color-neg, #F87171)' : (group.card.color || 'var(--color-accent, #D4A857)')}` }}
                      aria-labelledby={headingId}
                    >
                      <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-space-3">
                        <h3 id={headingId} className="m-0 inline-flex min-w-0 items-center gap-space-2 break-words font-medium text-primary">
                          {overdue && <Icons.AlertTriangle size={16} color="var(--color-neg, #F87171)" />}
                          <span className="h-3 w-3 shrink-0 rounded-xs" style={{ background: group.card.color }} aria-hidden="true" />
                          <span className="min-w-0 break-words">{`${group.card.name}${group.card.last4 ? ` ····${group.card.last4}` : ''}`}</span>
                        </h3>
                        <span className="max-w-full break-all text-right font-[family-name:var(--font-numeric)] text-base font-semibold tabular-nums text-primary">{`${formatCurrency(group.total)} บาท`}</span>
                      </div>
                      <span className={`text-xs ${overdue ? 'text-neg' : 'text-secondary'}`}>
                        {`${formatIsoDateTH(group.dueDate)} · ${describeDueDistance(group.diffDays)}`}
                      </span>
                      {(group.installmentCount > 0 || group.revolvingSubtotal > 0) && (
                        <div className="flex min-w-0 flex-wrap gap-x-space-4 gap-y-space-1 text-xs text-secondary">
                          {group.installmentCount > 0 && (
                            <span className="break-words">{`ผ่อนชำระ ${group.installmentCount} งวด · ${formatCurrency(group.installmentSubtotal)} บาท`}</span>
                          )}
                          {group.revolvingSubtotal > 0 && (
                            <span className="break-words">{`ยอดหมุนเวียน · ${formatCurrency(group.revolvingSubtotal)} บาท`}</span>
                          )}
                        </div>
                      )}
                      <button
                        type="button"
                        className={`min-h-11 w-full rounded-sm border border-border-default bg-surface-1 px-space-3 text-sm font-medium text-secondary transition-colors duration-fast ease-graphite ${FOCUS_RING}`}
                        onClick={() => onOpenCard?.(group.card.id)}
                        aria-label={`ดูรายละเอียดบัตร ${group.card.name} (${group.card.id}) วันที่ ${formatIsoDateTH(group.dueDate)}`}
                      >
                        ดูรายละเอียดบัตร
                      </button>
                    </article>
                  </li>
                );
              })}
            </ul>
            {upcoming.length > UPCOMING_MAX_GROUPS && (
              <button
                type="button"
                className={BTN_GHOST}
                aria-expanded={showAllUpcoming}
                aria-controls="upcoming-groups"
                onClick={() => setShowAllUpcoming(value => !value)}
              >
                {showAllUpcoming ? 'แสดงน้อยลง' : `แสดงทั้งหมด (${upcoming.length} รายการ)`}
              </button>
            )}
          </div>
        )}
      </div>

      <div>
        <div className="mb-space-3 flex items-center justify-between gap-space-3">
          <h2 className={SECTION_TITLE}>บัตรทั้งหมด</h2>
        </div>

        <CreditCardTileGrid
          cards={cards}
          plans={plans}
          onEditCard={onEditCard}
          onAddPlanForCard={onAddPlanForCard}
          onDeleteCard={onDeleteCard}
          onOpenCard={onOpenCard}
        />
      </div>

      {!hasPlans && <p className="m-0 text-sm text-tertiary">ยังไม่มีแผนผ่อน — กด + เพิ่มรายจ่าย</p>}

      <div>
        <button type="button" data-add-expense-fallback className={BTN_PRIMARY} onClick={onAddPlan}>
          <Icons.Plus size={16} /> เพิ่มรายจ่าย
        </button>
      </div>
    </div>
  );
}