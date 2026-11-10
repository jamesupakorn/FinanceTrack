/**
 * คอมโพเนนต์: CreditCardTileGrid — ตัวกรองธนาคาร + เรียงตามวันครบกำหนด + grid ของ CreditCardTile
 * (spec-credit-card-tiles §5.1-5.5)
 * - ตัวกรองที่บันทึกไว้อ่านใน useEffect เท่านั้น ไม่ใช่ initial state (T10b: ไม่มี hydration mismatch)
 * - grid ใช้ breakpoint เดียว md: (768px) + auto-fill (D1) — ห้ามเพิ่ม prefix อื่น
 * - tile key ด้วย card.id เพื่อให้สถานะพลิกคงอยู่เมื่อเรียงใหม่/กรอง
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { BankIssuerKey } from '../../shared/utils/creditCardBankCatalog';
import {
  countCardsByIssuer,
  countOverdueInstallments,
  filterCardsByIssuers,
  getLocalTodayIso,
  loadIssuerFilter,
  saveIssuerFilter,
  sortCardsByDue,
  type OverduePlanLike
} from '../../shared/utils/frontend/creditCardTileUtils';
import { getCurrentMonthKey, isLoanCardType } from '../../shared/utils/creditCardUtils';
import CreditCardTile, { type LoanPlanProgress, type TileCard, type TileCardAction } from './CreditCardTile';
import CreditCardFilterBar from './CreditCardFilterBar';
import { BTN_GHOST } from './CreditCardDashboard';

/**
 * ตารางผ่อนของสินเชื่อจาก plans (ทุกสถานะ — สินเชื่อมีแผนได้ครั้งเดียว BR-CC-034)
 * งวดของเดือนนี้ = แถวที่ dueMonth ตรงเดือนปฏิทิน (สินเชื่อไม่มีรอบบิล offset 0, BR-CC-037) — นับอย่างเดียว ไม่มีเลขเงิน
 */
function describeLoanProgress(card: TileCard, plans: readonly OverduePlanLike[]): LoanPlanProgress | null {
  if (!isLoanCardType(card.cardType)) return null;
  const plan = plans.find(item => item?.cardId === card.id) as (OverduePlanLike & { months?: unknown }) | undefined;
  if (!plan) return { hasPlan: false, currentNo: null, months: 0 };
  const schedule = (Array.isArray(plan.schedule) ? plan.schedule : []) as Array<{ no?: unknown; dueMonth?: unknown } | null>;
  const month = card.dueMonth || getCurrentMonthKey();
  const row = schedule.find(item => item?.dueMonth === month);
  const months = Number(plan.months) || schedule.length;
  const no = Number(row?.no);
  return { hasPlan: true, currentNo: Number.isFinite(no) && no > 0 ? no : null, months };
}

export const TILE_GRID_CLASS = 'grid grid-cols-1 gap-space-4 md:grid-cols-[repeat(auto-fill,minmax(18rem,1fr))]';

export interface CreditCardTileGridProps {
  cards: TileCard[];
  plans?: readonly OverduePlanLike[];
  onEditCard?: TileCardAction;
  onAddPlanForCard?: TileCardAction;
  onDeleteCard?: TileCardAction;
  onOpenCard?: (cardId: string) => void;
}

export default function CreditCardTileGrid({
  cards,
  plans = [],
  onEditCard,
  onAddPlanForCard,
  onDeleteCard,
  onOpenCard
}: CreditCardTileGridProps) {
  // initial state ต้องตรงกับ SSR เสมอ ([] = ทั้งหมด) แล้วค่อยกู้คืนจาก localStorage หลัง mount
  const [selected, setSelected] = useState<BankIssuerKey[]>([]);
  const [announcement, setAnnouncement] = useState('');

  useEffect(() => {
    const saved = loadIssuerFilter();
    if (saved.length) setSelected(saved);
  }, []);

  const counts = useMemo(() => countCardsByIssuer(cards), [cards]);
  // ไม่ตัด key ที่ไม่มีบัตรแล้วออก: ผลว่างแสดง empty state + "ล้างตัวกรอง" (§5.5)
  const activeSelected = selected;

  const todayIso = getLocalTodayIso();
  const visible = useMemo(
    () => sortCardsByDue(filterCardsByIssuers(cards, activeSelected), todayIso),
    [cards, activeSelected, todayIso]
  );

  const apply = useCallback((next: BankIssuerKey[]) => {
    setSelected(next);
    saveIssuerFilter(next);
    const shown = filterCardsByIssuers(cards, next).length;
    setAnnouncement(`แสดง ${shown} จาก ${cards.length} บัตร`);
  }, [cards]);

  const handleToggle = (key: BankIssuerKey) => {
    apply(activeSelected.includes(key) ? activeSelected.filter(k => k !== key) : [...activeSelected, key]);
  };
  const handleClear = () => apply([]);

  return (
    <div className="flex flex-col gap-space-3">
      <CreditCardFilterBar
        counts={counts}
        total={cards.length}
        selected={activeSelected}
        onToggle={handleToggle}
        onClear={handleClear}
        announcement={announcement}
      />
      {visible.length === 0 ? (
        <div className="flex flex-col items-start gap-space-2 rounded-md border border-dashed border-border-default bg-sunken p-space-4">
          <p className="m-0 text-sm text-secondary">ไม่มีบัตรของธนาคารที่เลือก</p>
          <button type="button" className={BTN_GHOST} onClick={handleClear}>ล้างตัวกรอง</button>
        </div>
      ) : (
        <div className={TILE_GRID_CLASS} data-testid="cc-tile-grid">
          {visible.map(card => (
            <CreditCardTile
              key={card.id}
              card={card}
              overdueInstallmentCount={countOverdueInstallments(card, plans, todayIso)}
              loanProgress={describeLoanProgress(card, plans)}
              onEditCard={onEditCard}
              onAddPlanForCard={onAddPlanForCard}
              onDeleteCard={onDeleteCard}
              onOpenCard={onOpenCard}
            />
          ))}
        </div>
      )}
    </div>
  );
}
