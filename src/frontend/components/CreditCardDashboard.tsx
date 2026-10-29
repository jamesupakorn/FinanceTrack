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
  resolveInstallmentDueDate,
  formatIsoDateTH,
  diffDaysFromToday,
  describeDueDistance,
  formatDayLabel,
  round2,
  PLAN_STATUS,
  normaliseDayValue
} from '../../shared/utils/creditCardUtils';
import { formatCurrency } from '../../shared/utils/frontend/numberUtils';
import { fitFontSizeCss } from '../../shared/utils/frontend/ringTextFit';
import { Icons } from './Icons';
import BankIssuerMark from './BankIssuerMark';
import { BANK_ISSUERS, BANK_ISSUER_KEYS, getBankIssuer, type BankIssuerKey } from '../../shared/utils/creditCardBankCatalog';

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

const UPCOMING_WINDOW_DAYS = 7;
const UPCOMING_MAX_GROUPS = 5;
const VALID_MONTH_KEY = /^\d{4}-(0[1-9]|1[0-2])$/;
const HIGH_UTILISATION_PERCENT = 80;

const FOCUS_RING = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2';
const CARD = 'rounded-md border border-border-default bg-surface-1 p-space-4 shadow-elev-1 md:p-space-5';
// รักษา line-box เดิมของ text-2xl ไว้แม้ font-size จะหดลง เพื่อให้แถว caption ของ 4 tile เรียงกันพอดี (spec D-5)
const TILE_AMOUNT_LINE_HEIGHT = 'calc(var(--text-2xl) * 1.3)';
const BTN_PRIMARY = `inline-flex min-h-11 items-center justify-center gap-space-2 rounded-sm bg-accent px-space-4 text-sm font-medium text-on-accent transition-colors duration-fast ease-graphite hover:opacity-90 ${FOCUS_RING}`;
const BTN_GHOST = `inline-flex min-h-11 items-center justify-center gap-space-2 rounded-sm border border-border-interactive bg-surface-2 px-space-4 text-sm font-medium text-primary transition-colors duration-fast ease-graphite hover:bg-surface-3 ${FOCUS_RING}`;
const ICON_BTN = `flex h-11 w-11 shrink-0 items-center justify-center rounded-sm border border-border-default bg-surface-2 text-secondary transition-colors duration-fast ease-graphite hover:bg-surface-3 ${FOCUS_RING}`;
const SECTION_TITLE = 'm-0 text-lg font-semibold text-primary';
const WARN_CHIP = 'inline-flex w-fit items-center gap-space-1 rounded-full border border-warn/40 bg-warn/14 px-space-2 py-[2px] text-xs font-medium text-warn';

/** เมนู ⋯ ของการ์ด — ปิดเมื่อคลิกนอกพื้นที่หรือกด Escape (แบบเดียวกับ userMenuWrapper ใน edit.js) */
function CardMenu({ card, onEdit, onAddPlan, onDelete }: {
  card: DashboardCard;
  onEdit?: CardAction;
  onAddPlan?: CardAction;
  onDelete?: CardAction;
}) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

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

/**
 * จัดกลุ่มบัตรตามผู้ออกบัตร เรียงกลุ่มตามลำดับใน BANK_ISSUERS (credit-card-group-by-bank)
 * - กลุ่มที่ไม่มีบัตรจะไม่ถูกส่งกลับ
 * - ภายในกลุ่มคงลำดับเดิมของ array (ไม่ sort)
 * - บัตรที่ bankIssuer ว่าง/ไม่รู้จัก → ไปอยู่กลุ่มอื่นๆ ผ่าน getBankIssuer (อ่านอย่างเดียว ไม่เขียนกลับ, BR-CC-020)
 */
function groupCardsByIssuer(cards: DashboardCard[]): Array<{ key: BankIssuerKey; cards: DashboardCard[] }> {
  return BANK_ISSUER_KEYS
    .map(key => ({ key, cards: cards.filter(card => getBankIssuer(card) === key) }))
    .filter(group => group.cards.length > 0);
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
        const dueDate = resolveInstallmentDueDate(card.dueDay as number | string, row.dueMonth);
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
      const revolvingDue = Number(card.revolvingDue);
      if (!Number.isFinite(revolvingDue) || revolvingDue <= 0) continue;

      const dueMonth = card.revolvingDueMonth;
      const dueDay = normaliseDayValue(card.dueDay);
      if (typeof dueMonth !== 'string' || !VALID_MONTH_KEY.test(dueMonth) || dueDay === null) {
        return {
          groups: [],
          error: `ข้อมูลวันครบกำหนดของยอดหมุนเวียนบัตร ${card.name} ไม่ถูกต้อง กรุณาลองโหลดใหม่`
        };
      }

      const dueDate = resolveInstallmentDueDate(dueDay, dueMonth);
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

  const cardGroups = useMemo(() => groupCardsByIssuer(cards), [cards]);
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

        <div className="flex flex-col gap-space-5">
          {cardGroups.map(group => {
            const issuer = BANK_ISSUERS[group.key];
            const headingId = `cc-issuer-group-${group.key}`;
            return (
              <div key={group.key} role="group" aria-labelledby={headingId} className="flex flex-col gap-space-3">
                <h3 id={headingId} className="m-0 inline-flex items-center gap-space-2 text-sm font-semibold text-secondary">
                  <BankIssuerMark card={{ bankIssuer: group.key, color: issuer.color }} size={24} decorative />
                  {issuer.label}
                </h3>
                <div className="grid grid-cols-1 gap-space-4 md:grid-cols-2 lg:grid-cols-3">
                  {group.cards.map(card => {
                    const creditLimit = Number(card.creditLimit) || 0;
                    const utilisation = creditLimit > 0
                      ? Math.min(100, round2((Number(card.remainingPrincipal) || 0) / creditLimit * 100))
                      : 0;
                    const highUtilisation = creditLimit > 0 && utilisation >= HIGH_UTILISATION_PERCENT;
                    const nextDueDiff = card.nextDueDate ? diffDaysFromToday(card.nextDueDate) : null;
                    // UX_SPEC §9: chip --warn เมื่อวันสรุปยอด/ครบกำหนดของบัตรอยู่ภายใน 7 วัน — nextDueDate
                    // มาจาก resolveCardNextDueDate() ที่ backend คำนวณรวมทั้งงวดผ่อนและ cycle หมุนเวียนแล้ว
                    const dueSoon = nextDueDiff !== null && nextDueDiff <= UPCOMING_WINDOW_DAYS;
                    return (
                      <div key={card.id} className={`${CARD} flex flex-col gap-space-2 min-w-0 [container-type:inline-size]`} style={{ borderLeft: `4px solid ${card.color || 'var(--color-accent, #D4A857)'}` }}>
                        <div className="flex items-start justify-between gap-space-2">
                          <span className="inline-flex min-w-0 items-center gap-space-2 text-base font-semibold text-primary">
                            <BankIssuerMark card={card} size={24} />
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
                        <span
                          className="font-[family-name:var(--font-numeric)] text-2xl font-semibold tabular-nums text-primary"
                          style={{ fontSize: fitFontSizeCss(formatCurrency(card.revolvingTotalDue || 0)), lineHeight: TILE_AMOUNT_LINE_HEIGHT }}
                        >
                          <span className="whitespace-nowrap">{formatCurrency(card.revolvingTotalDue || 0)}</span>{' บาท'}
                        </span>
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
                          {`สรุปยอด ${formatDayLabel(card.statementDay as number | string)} · ครบกำหนด ${formatDayLabel(card.dueDay as number | string)}`}
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
            );
          })}
        </div>
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