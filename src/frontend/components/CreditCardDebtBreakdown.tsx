/**
 * คอมโพเนนต์: CreditCardDebtBreakdown
 * แผงแสดงหนี้คงเหลือแยกตามบัตร (drill-down ของ tile "หนี้คงเหลือรวม")
 *
 * แสดงค่า remainingPayable ที่เซิร์ฟเวอร์ส่งมาตรง ๆ ไม่คำนวณยอดเงินใหม่ที่ client
 * (parse/sort เพื่อการแสดงผลเท่านั้น) — D-1..D-4
 *
 * หมายเหตุ: import token จาก CreditCardDashboard เป็น circular แต่ใช้เฉพาะตอน render จึงปลอดภัย
 */

import type { KeyboardEvent } from 'react';
import { formatCurrency } from '../../shared/utils/frontend/numberUtils';
import { Icons } from './Icons';
import { BTN_GHOST, CARD, FOCUS_RING, SECTION_TITLE } from './CreditCardDashboard';

export interface DebtBreakdownCard {
  id: string;
  name: string;
  color?: string;
  last4?: string;
  remainingPayable: number | string;
}

/** D-3: Number(x) ที่ไม่ finite ถือเป็น 0 (ตรงกับ summariseTotals) */
function debtOf(card: DebtBreakdownCard): number {
  const value = Number(card.remainingPayable);
  return Number.isFinite(value) ? value : 0;
}

/** D-4: เรียงหนี้มาก→น้อย, ชื่อ (th), id; แยกบัตรที่ไม่มีหนี้ออกมานับ */
export function rankCardsByRemainingDebt<T extends DebtBreakdownCard>(cards: readonly T[]): { withDebt: T[]; zeroCount: number } {
  const withDebt = cards
    .filter(card => debtOf(card) > 0)
    .sort((a, b) => debtOf(b) - debtOf(a) || a.name.localeCompare(b.name, 'th') || a.id.localeCompare(b.id));
  return { withDebt, zeroCount: cards.length - withDebt.length };
}

interface CreditCardDebtBreakdownProps {
  id: string;
  cards: readonly DebtBreakdownCard[];
  total?: number | string;
  onOpenCard?: (cardId: string) => void;
  onClose: () => void;
}

export default function CreditCardDebtBreakdown({ id, cards, total, onOpenCard, onClose }: CreditCardDebtBreakdownProps) {
  const { withDebt, zeroCount } = rankCardsByRemainingDebt(cards);
  const titleId = `${id}-title`;

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Escape') return;
    onClose();
    event.stopPropagation();
  };

  return (
    <section id={id} aria-labelledby={titleId} className={`${CARD} flex flex-col gap-space-3`} onKeyDown={handleKeyDown}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-space-3 gap-y-space-1">
        <h2 id={titleId} className={SECTION_TITLE}>หนี้คงเหลือแยกตามบัตร</h2>
        <span className="text-sm text-secondary">{`รวม ${formatCurrency(total || 0)} บาท · ${withDebt.length} บัตร`}</span>
      </div>

      {withDebt.length === 0 ? (
        <p className="m-0 text-sm text-tertiary">ไม่มีหนี้คงเหลือในบัตรใด</p>
      ) : (
        <ul aria-label="บัตรเรียงตามหนี้คงเหลือจากมากไปน้อย" className="m-0 flex list-none flex-col gap-space-2 p-0">
          {withDebt.map(card => {
            const label = `${card.name}${card.last4 ? ` ····${card.last4}` : ''}`;
            const amount = formatCurrency(card.remainingPayable);
            return (
              <li key={card.id}>
                <button
                  type="button"
                  className={`flex min-h-11 w-full items-start justify-between gap-space-3 rounded-sm border border-border-default bg-surface-2 px-space-3 py-space-2 text-left text-primary hover:bg-surface-3 ${FOCUS_RING}`}
                  aria-label={`ดูรายละเอียดบัตร ${label} หนี้คงเหลือ ${amount} บาท`}
                  onClick={() => onOpenCard?.(card.id)}
                >
                  <span className="flex min-w-0 items-start gap-space-2">
                    <span className="mt-[4px] h-3 w-3 shrink-0 rounded-xs" style={{ background: card.color }} aria-hidden="true" />
                    <span className="min-w-0 break-words">{label}</span>
                  </span>
                  <span className="flex shrink-0 items-start gap-space-2">
                    <span className="whitespace-nowrap font-[family-name:var(--font-numeric)] font-semibold tabular-nums">{`${amount} บาท`}</span>
                    <span aria-hidden="true" className="mt-[2px] text-tertiary"><Icons.ChevronRight size={16} /></span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {withDebt.length > 0 && zeroCount > 0 && (
        <p className="m-0 text-sm text-tertiary">{`บัตรที่ไม่มีหนี้คงเหลือ ${zeroCount} ใบ`}</p>
      )}

      <div className="flex justify-end">
        <button type="button" className={BTN_GHOST} onClick={onClose}>ซ่อนรายละเอียด</button>
      </div>
    </section>
  );
}
