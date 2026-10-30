/**
 * คอมโพเนนต์: CreditCardCreditBreakdown
 * แผงแสดงวงเงินคงเหลือแยกตามบัตร (drill-down ของ tile "วงเงินคงเหลือ")
 *
 * แสดง availableCredit / creditLimit ที่เซิร์ฟเวอร์ส่งมาตรง ๆ ไม่คำนวณยอดเงินใหม่ที่ client
 * (parse/sort เพื่อการแสดงผลเท่านั้น) — D-7..D-10
 *
 * หมายเหตุ: import token จาก CreditCardDashboard เป็น circular แต่ใช้เฉพาะตอน render จึงปลอดภัย
 */

import type { KeyboardEvent } from 'react';
import { formatCurrency } from '../../shared/utils/frontend/numberUtils';
import { Icons } from './Icons';
import { BTN_GHOST, CARD, FOCUS_RING, SECTION_TITLE } from './CreditCardDashboard';

export interface CreditBreakdownCard {
  id: string;
  name: string;
  color?: string;
  last4?: string;
  creditLimit?: number | string;
  availableCredit: number | string;
}

/** D-9: Number(x) ที่ไม่ finite ถือเป็น 0 */
function numOf(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function hasLimit(card: CreditBreakdownCard): boolean {
  return numOf(card.creditLimit) > 0;
}

/** D-10: บัตรที่มีวงเงินก่อน เรียง available น้อย→มาก, ชื่อ (th), id; บัตรไม่มีวงเงินต่อท้าย */
export function rankCardsByAvailableCredit<T extends CreditBreakdownCard>(cards: readonly T[]): T[] {
  const byName = (a: T, b: T) => a.name.localeCompare(b.name, 'th') || a.id.localeCompare(b.id);
  const limited = cards
    .filter(hasLimit)
    .sort((a, b) => numOf(a.availableCredit) - numOf(b.availableCredit) || byName(a, b));
  const unlimited = cards.filter(card => !hasLimit(card)).sort(byName);
  return [...limited, ...unlimited];
}

interface CreditCardCreditBreakdownProps {
  id: string;
  cards: readonly CreditBreakdownCard[];
  totalAvailable?: number | string;
  totalLimit?: number | string;
  onOpenCard?: (cardId: string) => void;
  onClose: () => void;
}

export default function CreditCardCreditBreakdown({ id, cards, totalAvailable, totalLimit, onOpenCard, onClose }: CreditCardCreditBreakdownProps) {
  const ranked = rankCardsByAvailableCredit(cards);
  const titleId = `${id}-title`;

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Escape') return;
    onClose();
    event.stopPropagation();
  };

  return (
    <section id={id} aria-labelledby={titleId} className={`${CARD} flex flex-col gap-space-3`} onKeyDown={handleKeyDown}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-space-3 gap-y-space-1">
        <h2 id={titleId} className={SECTION_TITLE}>วงเงินคงเหลือแยกตามบัตร</h2>
        <span className="text-sm text-secondary">{`${formatCurrency(totalAvailable || 0)} / ${formatCurrency(totalLimit || 0)} บาท · ${cards.length} บัตร`}</span>
      </div>

      <ul aria-label="บัตรเรียงตามวงเงินคงเหลือจากน้อยไปมาก" className="m-0 flex list-none flex-col gap-space-2 p-0">
        {ranked.map(card => {
          const label = `${card.name}${card.last4 ? ` ····${card.last4}` : ''}`;
          const limited = hasLimit(card);
          const available = formatCurrency(card.availableCredit);
          const limit = formatCurrency(card.creditLimit ?? 0);
          return (
            <li key={card.id}>
              <button
                type="button"
                className={`flex min-h-11 w-full items-start justify-between gap-space-3 rounded-sm border border-border-default bg-surface-2 px-space-3 py-space-2 text-left text-primary hover:bg-surface-3 ${FOCUS_RING}`}
                aria-label={limited
                  ? `ดูรายละเอียดบัตร ${label} วงเงินคงเหลือ ${available} จาก ${limit} บาท`
                  : `ดูรายละเอียดบัตร ${label} ไม่ได้ระบุวงเงิน`}
                onClick={() => onOpenCard?.(card.id)}
              >
                <span className="flex min-w-0 items-start gap-space-2">
                  <span className="mt-[4px] h-3 w-3 shrink-0 rounded-xs" style={{ background: card.color }} aria-hidden="true" />
                  <span className="min-w-0 break-words">{label}</span>
                </span>
                <span className="flex min-w-0 max-w-[60%] items-start gap-space-2">
                  {limited ? (
                    <span className="text-right font-[family-name:var(--font-numeric)] font-semibold tabular-nums">
                      <span className="whitespace-nowrap">{available} /</span>{' '}<span className="whitespace-nowrap">{limit} บาท</span>
                    </span>
                  ) : (
                    <span className="text-sm text-tertiary">ไม่ได้ระบุวงเงิน</span>
                  )}
                  <span aria-hidden="true" className="mt-[2px] text-tertiary"><Icons.ChevronRight size={16} /></span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      <div className="flex justify-end">
        <button type="button" className={BTN_GHOST} onClick={onClose}>ซ่อนรายละเอียด</button>
      </div>
    </section>
  );
}
