/**
 * คอมโพเนนต์: CreditCardTile — tile รูปบัตรเครดิตแบบพลิกได้ (spec-credit-card-tiles §5.3-5.4)
 *
 * FRONT: ชื่อ/ธนาคาร/····last4, "ยอดที่ต้องจ่ายรอบนี้" (totalDueThisMonth จาก API — ไม่มีสูตรเงินฝั่ง client),
 *        sub-line ผ่อน/ไม่ผ่อน, chip ครบกำหนด (ตรรกะ nextDueDate เดิม, D3), แถบวงเงิน
 * BACK:  หนี้คงเหลือรวม, วงเงิน/ใช้ไป/เหลือ, วันสรุปยอด/ครบกำหนด, จำนวนแผน, "เลยกำหนด K งวด" (K > 0),
 *        ปุ่มดูรายละเอียด + CardMenu เดิม (export in place จาก CreditCardDashboard, REV-5)
 *
 * A11y (REV-6): ปุ่มพลิกเป็น <button aria-pressed> ชื่อบอกด้านที่แสดง; ด้านที่ซ่อน = inert + aria-hidden;
 * ย้าย focus ไปปุ่มแรกของด้านใหม่ "ก่อน" ซ่อนด้านเดิม; Escape บนด้านหลัง = กลับด้านหน้า;
 * prefers-reduced-motion => สลับทันที (ไม่มี transition / ไม่ cross-fade)
 * สีตัวอักษรคงที่ขาว/ดำจาก pickTileTextColor (ไม่ขึ้นกับ theme)
 */

import { useCallback, useRef, useState, type KeyboardEvent } from 'react';
import { flushSync } from 'react-dom';
import { diffDaysFromToday, formatDayLabel, round2 } from '../../shared/utils/creditCardUtils';
import { formatCurrency } from '../../shared/utils/frontend/numberUtils';
import { fitFontSizeCss } from '../../shared/utils/frontend/ringTextFit';
import { FOCUSABLE_SELECTOR, getTabbableElements } from '../../shared/utils/frontend/focusTrap';
import { pickTileTextColor } from '../../shared/utils/frontend/creditCardTileUtils';
import { Icons } from './Icons';
import BankIssuerMark from './BankIssuerMark';
import {
  CardMenu,
  BTN_GHOST,
  FOCUS_RING,
  HIGH_UTILISATION_PERCENT,
  TILE_AMOUNT_LINE_HEIGHT,
  UPCOMING_WINDOW_DAYS
} from './CreditCardDashboard';

type MenuCard = Parameters<typeof CardMenu>[0]['card'];

/** ฟิลด์ใหม่จาก API (backend half) อยู่บน props type ของ tile — ไม่แตะ interface DashboardCard (review §b.1) */
export type TileCard = MenuCard & {
  dueMonth?: string;
  installmentDueThisMonth?: number | string;
  revolvingDueThisMonth?: number | string;
  totalDueThisMonth?: number | string;
};

export type TileCardAction = (card: TileCard) => void;

export interface CreditCardTileProps {
  card: TileCard;
  /** จำนวนงวดเลยกำหนดที่ยังไม่ติ๊ก (countOverdueInstallments) — แสดงเฉพาะเมื่อ > 0 */
  overdueInstallmentCount?: number;
  onEditCard?: TileCardAction;
  onAddPlanForCard?: TileCardAction;
  onDeleteCard?: TileCardAction;
  onOpenCard?: (cardId: string) => void;
}

type Side = 'front' | 'back';

const FALLBACK_TILE_COLOR = '#6b7280';
const toAmount = (value: unknown): number => {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
};

/** ปุ่มแรกที่ Tab ไปถึงได้ — getTabbableElements ก่อน; ถ้าไม่มีกล่องเรขาคณิต (เช่นระหว่าง layout) ใช้ selector + tabIndex */
function firstFocusable(root: HTMLElement | null): HTMLElement | null {
  if (!root) return null;
  const tabbable = getTabbableElements(root);
  if (tabbable.length) return tabbable[0];
  const candidates = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
  return candidates.find(el => el.tabIndex >= 0 && !(el as HTMLButtonElement).disabled) || null;
}

export default function CreditCardTile({
  card,
  overdueInstallmentCount = 0,
  onEditCard,
  onAddPlanForCard,
  onDeleteCard,
  onOpenCard
}: CreditCardTileProps) {
  const [side, setSide] = useState<Side>('front');
  // ด้านที่กำลังจะแสดง: ถูกปลด inert ก่อน แล้วจึงย้าย focus แล้วค่อยซ่อนด้านเดิม (REV-6)
  const [opening, setOpening] = useState<Side | null>(null);
  const frontRef = useRef<HTMLDivElement | null>(null);
  const backRef = useRef<HTMLDivElement | null>(null);

  const flipTo = useCallback((target: Side) => {
    if (target === side) return;
    flushSync(() => setOpening(target));
    firstFocusable(target === 'back' ? backRef.current : frontRef.current)?.focus();
    setSide(target);
    setOpening(null);
  }, [side]);

  const isBack = side === 'back';
  const isHidden = (face: Side) => face !== side && face !== opening;

  const background = card.color || FALLBACK_TILE_COLOR;
  const { color: textColor } = pickTileTextColor(background);
  // พื้นหลังสีกลับด้านสำหรับ chip/แถบ — คอนทราสต์เท่ากับข้อความหลัก (>= 4.5:1)
  const inverseChipStyle = { background: textColor, color: background };

  const totalDue = toAmount(card.totalDueThisMonth);
  const installmentDue = toAmount(card.installmentDueThisMonth);
  const revolvingDue = toAmount(card.revolvingDueThisMonth);
  const subParts = [
    installmentDue !== 0 ? `ผ่อน ${formatCurrency(installmentDue)}` : null,
    revolvingDue !== 0 ? `ไม่ผ่อน ${formatCurrency(revolvingDue)}` : null
  ].filter(Boolean) as string[];

  const creditLimit = Number(card.creditLimit) || 0;
  const utilisation = creditLimit > 0
    ? Math.min(100, round2((Number(card.remainingPrincipal) || 0) / creditLimit * 100))
    : 0;
  const highUtilisation = creditLimit > 0 && utilisation >= HIGH_UTILISATION_PERCENT;
  // D3: ความหมาย chip เดิมทุกประการ — nextDueDate จาก resolveCardNextDueDate() ฝั่ง backend
  const nextDueDiff = card.nextDueDate ? diffDaysFromToday(card.nextDueDate) : null;
  const dueSoon = nextDueDiff !== null && nextDueDiff <= UPCOMING_WINDOW_DAYS;

  const bankLine = [card.bankName, card.last4 ? `····${card.last4}` : ''].filter(Boolean).join(' · ') || 'ไม่ระบุธนาคาร';
  const amountText = formatCurrency(totalDue);

  const FACE = 'flex min-h-[13rem] min-w-0 flex-col gap-space-2 rounded-md p-space-4 [backface-visibility:hidden] [grid-area:face] md:p-space-5';
  const FLIP_BTN = `inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-space-1 rounded-sm border border-current px-space-2 text-xs font-medium ${FOCUS_RING}`;
  const faceStyle = { background, color: textColor };

  const handleBackKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    // เมนู ⋯ ที่เปิดอยู่จัดการ Escape เอง (ปิดเมนู) — ไม่พลิกซ้อน
    if (backRef.current?.querySelector('[role="menu"]')) return;
    event.preventDefault();
    flipTo('front');
  };

  return (
    <div
      className="min-w-0 [perspective:1200px]"
      data-testid={`cc-tile-${card.id}`}
      data-side={side}
    >
      <div
        className={`grid aspect-[1.6/1] w-full [grid-template-areas:'face'] [transform-style:preserve-3d] transition-transform duration-slow ease-graphite motion-reduce:transition-none ${isBack ? '[transform:rotateY(180deg)]' : ''}`}
        data-testid="cc-tile-rotor"
      >
        {/* FRONT */}
        <div
          ref={frontRef}
          className={`${FACE} ${isHidden('front') ? 'motion-reduce:invisible' : ''}`}
          style={faceStyle}
          aria-hidden={isHidden('front') ? true : undefined}
          inert={isHidden('front')}
          data-face="front"
        >
          <div className="flex items-start justify-between gap-space-2">
            <span className="inline-flex min-w-0 items-center gap-space-2 text-base font-semibold">
              <BankIssuerMark card={card} size={24} />
              <span className="min-w-0 break-words">{card.name}</span>
            </span>
            <button
              type="button"
              className={FLIP_BTN}
              aria-pressed={isBack}
              aria-label={`แสดงด้านหลังบัตร ${card.name}`}
              onClick={() => flipTo('back')}
            >
              <Icons.ChevronRight size={16} />
            </button>
          </div>

          <span className="text-xs">ยอดที่ต้องจ่ายรอบนี้</span>
          <span
            className="font-[family-name:var(--font-numeric)] text-2xl font-semibold tabular-nums"
            style={{ fontSize: fitFontSizeCss(amountText), lineHeight: TILE_AMOUNT_LINE_HEIGHT }}
            data-testid="cc-tile-amount"
          >
            <span className="whitespace-nowrap">{amountText}</span>{' บาท'}
          </span>
          {subParts.length > 0 && (
            <span className="text-xs" data-testid="cc-tile-subline">{subParts.join(' · ')}</span>
          )}

          {dueSoon && (
            <span
              className="inline-flex w-fit items-center gap-space-1 rounded-full px-space-2 py-[2px] text-xs font-semibold"
              style={inverseChipStyle}
              data-testid="cc-tile-due-chip"
            >
              <Icons.AlertTriangle size={12} />
              {nextDueDiff < 0 ? `เลยกำหนด ${Math.abs(nextDueDiff)} วัน` : `ครบกำหนดใน ${nextDueDiff} วัน`}
            </span>
          )}

          {creditLimit > 0 && (
            <div className="mt-auto flex flex-col gap-space-1">
              <div
                className="h-1 overflow-hidden rounded-full"
                style={{ background: `color-mix(in srgb, ${textColor} 30%, transparent)` }}
                role="img"
                aria-label={`ใช้วงเงินไป ${utilisation.toFixed(1)}%`}
              >
                <div className="h-full rounded-full" style={{ width: `${utilisation}%`, background: textColor }} />
              </div>
              {highUtilisation && (
                <span className="inline-flex w-fit items-center gap-space-1 rounded-full px-space-2 py-[2px] text-xs font-semibold" style={inverseChipStyle}>
                  <Icons.AlertTriangle size={12} /> ใช้วงเงินเกิน {HIGH_UTILISATION_PERCENT}%
                </span>
              )}
            </div>
          )}

          <span className="text-xs">{bankLine}</span>
        </div>

        {/* BACK */}
        <div
          ref={backRef}
          className={`${FACE} [transform:rotateY(180deg)] ${isHidden('back') ? 'motion-reduce:invisible' : ''}`}
          style={faceStyle}
          aria-hidden={isHidden('back') ? true : undefined}
          inert={isHidden('back')}
          data-face="back"
          onKeyDown={handleBackKeyDown}
        >
          <div className="flex items-start justify-between gap-space-2">
            <button
              type="button"
              className={FLIP_BTN}
              aria-pressed={isBack}
              aria-label={`กลับด้านหน้าบัตร ${card.name}`}
              onClick={() => flipTo('front')}
            >
              <Icons.ChevronLeft size={16} />
            </button>
            <CardMenu
              card={card}
              onEdit={onEditCard as ((c: MenuCard) => void) | undefined}
              onAddPlan={onAddPlanForCard as ((c: MenuCard) => void) | undefined}
              onDelete={onDeleteCard as ((c: MenuCard) => void) | undefined}
            />
          </div>

          <span className="text-xs">หนี้คงเหลือรวม</span>
          <span className="font-[family-name:var(--font-numeric)] text-lg font-semibold tabular-nums">
            <span className="whitespace-nowrap">{formatCurrency(card.remainingPayable)}</span>{' บาท'}
          </span>
          {creditLimit > 0 && (
            <span className="text-xs">
              {`วงเงิน ${formatCurrency(creditLimit)} · ใช้ไป ${utilisation.toFixed(1)}% · เหลือ ${formatCurrency(card.availableCredit)}`}
            </span>
          )}
          <span className="text-xs">
            {`สรุปยอด ${formatDayLabel(card.statementDay as number | string)} · ครบกำหนด ${formatDayLabel(card.dueDay as number | string)}`}
          </span>
          <span className="text-xs">{`${card.ongoingPlanCount ?? 0} แผนกำลังผ่อน`}</span>

          {overdueInstallmentCount > 0 && (
            <div className="flex flex-col gap-[2px]" data-testid="cc-tile-overdue-installments">
              <span className="inline-flex w-fit items-center gap-space-1 rounded-full px-space-2 py-[2px] text-xs font-semibold" style={inverseChipStyle}>
                <Icons.AlertTriangle size={12} />
                {`เลยกำหนด ${overdueInstallmentCount} งวด`}
              </span>
              <span className="text-xs">ติ๊กงวดที่จ่ายแล้วในรายละเอียด</span>
            </div>
          )}

          <div className="mt-auto">
            <button type="button" className={`${BTN_GHOST} w-full`} onClick={() => onOpenCard?.(card.id)}>
              ดูรายละเอียด
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
