/**
 * คอมโพเนนต์: CreditCardPlansBreakdown
 * แผงแสดงแผนที่กำลังผ่อนแยกตามแผน จัดกลุ่มตามบัตร (drill-down ของ tile "แผนที่กำลังผ่อน")
 *
 * นับงวด/เลือกงวดถัดไปเท่านั้น ไม่รวมยอด payment ที่ client — D-11..D-16
 *
 * หมายเหตุ: import token จาก CreditCardDashboard เป็น circular แต่ใช้เฉพาะตอน render จึงปลอดภัย
 */

import type { KeyboardEvent } from 'react';
import { PLAN_STATUS, resolveCardDueDate, formatIsoDateTH } from '../../shared/utils/creditCardUtils';
import { formatCurrency } from '../../shared/utils/frontend/numberUtils';
import { Icons } from './Icons';
import { BTN_GHOST, CARD, FOCUS_RING, SECTION_TITLE } from './CreditCardDashboard';

export interface PlansBreakdownCard {
  id: string;
  name: string;
  color?: string;
  last4?: string;
  statementDay?: number | string | null;
  dueDay?: number | string;
}

export interface PlansBreakdownScheduleEntry {
  no: number;
  paid?: boolean;
  dueMonth: string;
  payment: number | string;
}

export interface PlansBreakdownPlan {
  id: string;
  cardId: string;
  itemName: string;
  months: number;
  status?: string;
  schedule?: PlansBreakdownScheduleEntry[];
}

export interface PlanRowData<P extends PlansBreakdownPlan = PlansBreakdownPlan> {
  plan: P;
  remaining: number;
  total: number;
  next: { payment: number | string; dueMonth: string } | null;
  scheduleState: 'next' | 'allPaid' | 'none';
}

export interface PlanGroup<C extends PlansBreakdownCard = PlansBreakdownCard, P extends PlansBreakdownPlan = PlansBreakdownPlan> {
  card: C;
  plans: PlanRowData<P>[];
}

const hasDueMonth = (row: PlanRowData) => typeof row.next?.dueMonth === 'string' && row.next.dueMonth !== '';

/** D-11/D-12/D-13/D-16: เลือก+นับ+เรียงเพื่อแสดงผลเท่านั้น ไม่บวก payment */
export function groupOngoingPlansByCard<C extends PlansBreakdownCard, P extends PlansBreakdownPlan>(
  cards: readonly C[],
  plans: readonly P[]
): PlanGroup<C, P>[] {
  const cardIds = new Set(cards.map(card => card.id));
  const byCard = new Map<string, PlanRowData<P>[]>();

  (plans || []).forEach(plan => {
    if (plan?.status !== PLAN_STATUS.ONGOING || !cardIds.has(plan.cardId)) return;
    const schedule = Array.isArray(plan.schedule) ? plan.schedule : [];
    const unpaid = schedule.filter(row => row?.paid !== true);
    let next: PlanRowData<P>['next'] = null;
    let nextNo = Infinity;
    unpaid.forEach(row => {
      if (row && Number(row.no) < nextNo) {
        nextNo = Number(row.no);
        next = { payment: row.payment, dueMonth: row.dueMonth };
      }
    });
    const firstRow = unpaid.find(Boolean);
    if (!next && firstRow) next = { payment: firstRow.payment, dueMonth: firstRow.dueMonth };
    const scheduleState: PlanRowData['scheduleState'] = next ? 'next' : (schedule.length > 0 ? 'allPaid' : 'none');
    const row: PlanRowData<P> = { plan, remaining: unpaid.length, total: plan.months, next, scheduleState };
    const list = byCard.get(plan.cardId);
    if (list) list.push(row); else byCard.set(plan.cardId, [row]);
  });

  const byName = (a: PlanRowData<P>, b: PlanRowData<P>) =>
    a.plan.itemName.localeCompare(b.plan.itemName, 'th') || a.plan.id.localeCompare(b.plan.id);
  const compare = (a: PlanRowData<P>, b: PlanRowData<P>) => {
    // แถวที่ไม่มี dueMonth ถือเหมือนไม่มีงวดถัดไป (ไม่ crash)
    const aKey = hasDueMonth(a) ? a.next!.dueMonth : null;
    const bKey = hasDueMonth(b) ? b.next!.dueMonth : null;
    if (aKey !== null && bKey !== null) return aKey.localeCompare(bKey) || byName(a, b);
    if (aKey !== null) return -1;
    if (bKey !== null) return 1;
    return byName(a, b);
  };

  const groups: PlanGroup<C, P>[] = [];
  cards.forEach(card => {
    const rows = byCard.get(card.id);
    if (rows && rows.length) groups.push({ card, plans: rows.sort(compare) });
  });
  return groups;
}

interface CreditCardPlansBreakdownProps {
  id: string;
  cards: readonly PlansBreakdownCard[];
  plans: readonly PlansBreakdownPlan[];
  totalPlans?: number;
  onOpenCard?: (cardId: string) => void;
  onClose: () => void;
}

export default function CreditCardPlansBreakdown({ id, cards, plans, totalPlans, onOpenCard, onClose }: CreditCardPlansBreakdownProps) {
  const groups = groupOngoingPlansByCard(cards, plans);
  const titleId = `${id}-title`;

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Escape') return;
    onClose();
    event.stopPropagation();
  };

  return (
    <section id={id} aria-labelledby={titleId} className={`${CARD} flex flex-col gap-space-3`} onKeyDown={handleKeyDown}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-space-3 gap-y-space-1">
        <h2 id={titleId} className={SECTION_TITLE}>แผนที่กำลังผ่อนแยกตามแผน</h2>
        <span className="text-sm text-secondary">{`${totalPlans || 0} แผน · ${groups.length} บัตร`}</span>
      </div>

      {groups.length === 0 ? (
        <p className="m-0 text-sm text-tertiary">ไม่มีแผนที่กำลังผ่อน</p>
      ) : (
        <ul aria-label="แผนที่กำลังผ่อน จัดกลุ่มตามบัตร" className="m-0 flex list-none flex-col gap-space-3 p-0">
          {groups.map(({ card, plans: rows }, index) => {
            const headingId = `${id}-card-${index}`;
            const cardLabel = `${card.name}${card.last4 ? ` ····${card.last4}` : ''}`;
            return (
              <li key={card.id}>
                <h3 id={headingId} className="m-0 flex min-w-0 items-start gap-space-2 text-sm font-medium text-secondary">
                  <span className="mt-[4px] h-3 w-3 shrink-0 rounded-xs" style={{ background: card.color }} aria-hidden="true" />
                  <span className="min-w-0 break-words">{cardLabel}</span>
                  {` · ${rows.length} แผน`}
                </h3>
                <ul aria-labelledby={headingId} className="m-0 mt-space-2 flex list-none flex-col gap-space-2 p-0">
                  {rows.map(({ plan, remaining, total, next, scheduleState }) => {
                    let detail: string;
                    let detailAria: string;
                    if (scheduleState === 'next' && next) {
                      const amount = formatCurrency(next.payment);
                      const dueDate = typeof next.dueMonth === 'string' ? resolveCardDueDate(card, next.dueMonth) : null;
                      detail = `งวดถัดไป ${amount} บาท${dueDate ? ` · ${formatIsoDateTH(dueDate)}` : ''}`;
                      detailAria = `งวดถัดไป ${amount} บาท`;
                    } else if (scheduleState === 'allPaid') {
                      detail = 'ชำระครบทุกงวดแล้ว';
                      detailAria = detail;
                    } else {
                      detail = 'ไม่มีข้อมูลตารางผ่อน';
                      detailAria = detail;
                    }
                    return (
                      <li key={plan.id}>
                        <button
                          type="button"
                          className={`flex min-h-11 w-full flex-col items-stretch gap-space-1 rounded-sm border border-border-default bg-surface-2 px-space-3 py-space-2 text-left text-primary hover:bg-surface-3 ${FOCUS_RING}`}
                          aria-label={`ดูรายละเอียดบัตร ${cardLabel} แผน ${plan.itemName} เหลือ ${remaining} จาก ${total} งวด ${detailAria}`}
                          onClick={() => onOpenCard?.(plan.cardId)}
                        >
                          <span className="flex items-start justify-between gap-space-3">
                            <span className="min-w-0 break-words font-medium">{plan.itemName}</span>
                            <span className="flex shrink-0 items-start gap-space-2">
                              <span className="whitespace-nowrap text-sm tabular-nums">{`เหลือ ${remaining}/${total} งวด`}</span>
                              <span aria-hidden="true" className="mt-[2px] text-tertiary"><Icons.ChevronRight size={16} /></span>
                            </span>
                          </span>
                          <span className="block break-words text-xs text-secondary">{detail}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </li>
            );
          })}
        </ul>
      )}

      <div className="flex justify-end">
        <button type="button" className={BTN_GHOST} onClick={onClose}>ซ่อนรายละเอียด</button>
      </div>
    </section>
  );
}
