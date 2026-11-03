/**
 * คอมโพเนนต์: CardPayNextSummary (presentational)
 * "ชำระรอบบิลนี้" — ยอดที่ต้องชำระของรอบบิลที่เลือก + ปุ่มจ่าย/ยกเลิก (spec-credit-card-detail-redesign §5.3)
 *
 * ⚠ ไม่คำนวณเงินเอง: ทุกตัวเลขมาจาก currentCycle / cardTotal ที่ server คำนวณ (BR-CC-013, SPEND-2/SPEND-4)
 *   ย้ายมาจาก RevolvingBalanceSection.tsx โดยคงข้อความเดิม; เพียงสลับเครื่องหมายเพื่อแสดงผล (เครดิต)
 *   caption "คงเหลือ totalDue - minPaymentDue" ก็ย้ายมาตามเดิม
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { formatDayLabel, formatIsoDateTH, resolveCardDueDate } from '../../shared/utils/creditCardUtils';
import { formatMonthKeyTH } from '../../shared/utils/dateUtils';
import { formatCurrency } from '../../shared/utils/frontend/numberUtils';
import type { CardTotal, CurrentCycle, RevolvingCard, RevolvingCycle, RevolvingStatus } from '../../shared/utils/frontend/useRevolvingCycle';
import { Icons } from './Icons';
import LoadingSkeleton, { SkeletonBlock } from './LoadingSkeleton';

const FOCUS_RING = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2';
const CARD = 'rounded-md border border-border-default bg-surface-1 p-space-4 shadow-elev-1 md:p-space-5';
const BTN_PRIMARY = `flex min-h-12 w-full items-center justify-center rounded-sm bg-accent px-space-4 text-sm font-semibold text-on-accent transition-colors duration-fast ease-graphite hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60 ${FOCUS_RING}`;
const BTN_SECONDARY = `flex min-h-12 w-full items-center justify-center rounded-sm border border-border-interactive bg-surface-2 px-space-4 text-sm font-semibold text-primary transition-colors duration-fast ease-graphite disabled:cursor-not-allowed disabled:opacity-60 ${FOCUS_RING}`;
const BTN_GHOST = `min-h-11 rounded-sm border border-border-interactive bg-surface-2 px-space-4 text-sm font-medium text-primary transition-colors duration-fast ease-graphite hover:bg-surface-3 disabled:opacity-60 ${FOCUS_RING}`;

export interface CardPayNextSummaryProps {
  card: RevolvingCard;
  month: string;
  status: RevolvingStatus;
  currentCycle: CurrentCycle;
  previousMonthCycle: RevolvingCycle | null;
  cardTotal: CardTotal | null;
  busy: boolean;
  onPayFull: () => void;
  onPayMinimum: () => void;
  onUndo: () => void;
  onRetry: () => void;
  /** BillingMonthSwitcher (ตัวสลับเดือนอยู่ในกล่องสรุปตาม AC-CD1) */
  switcher?: ReactNode;
}

export default function CardPayNextSummary({
  card,
  month,
  status,
  currentCycle,
  previousMonthCycle,
  cardTotal,
  busy,
  onPayFull,
  onPayMinimum,
  onUndo,
  onRetry,
  switcher
}: CardPayNextSummaryProps) {
  const [breakdownOpen, setBreakdownOpen] = useState(false);
  const payFullRef = useRef<HTMLButtonElement | null>(null);
  const undoRef = useRef<HTMLButtonElement | null>(null);
  // ปุ่มที่กดจะ unmount → จองว่าจะ focus ปุ่มไหนต่อ (I-13) แล้วย้าย focus เมื่อ action จบ (busy=false)
  const pendingFocusRef = useRef<'undo' | 'pay' | null>(null);

  const settled = currentCycle.paymentAction !== null;
  const hasSomethingDue = currentCycle.totalDue > 0;
  const cashbackAmount = Number(currentCycle.cashbackAmount) || 0;
  const isCredit = currentCycle.totalDue < 0;
  // แคชแบคหักยอดหมดพอดี: แสดงแค่บรรทัดศูนย์ ไม่แสดง settled panel ("จ่ายเต็มแล้ว 0.00" จะอ่านแล้วผิด — C-8)
  // เดือนที่ totalDue = 0 โดยไม่มีแคชแบค ยังแสดง settled panel เหมือนเดิม
  const isZeroAfterCashback = currentCycle.totalDue === 0 && cashbackAmount > 0;
  // paymentAction ที่บันทึกไว้บนเดือนเครดิต/ศูนย์หลังแคชแบคยังเก็บไว้ แต่ไม่มีผล จึงซ่อนไว้ (N-2)
  const showSettledPanel = settled && !isCredit && !isZeroAfterCashback;
  const showPayActions = hasSomethingDue && !settled;
  const nothingDue = !hasSomethingDue && !showSettledPanel && !isZeroAfterCashback && !isCredit;
  const hasBreakdown = currentCycle.carriedBalance !== 0 || Number(currentCycle.newSpend) > 0;

  // m-1: confirm ที่ถูกยกเลิกไม่เคยทำให้ busy=true → ล้างตัวจองเมื่อเปลี่ยนเดือน/การ์ด ไม่ให้ focus เด้งภายหลัง
  useEffect(() => {
    pendingFocusRef.current = null;
  }, [month, card.id]);

  useEffect(() => {
    if (busy || status !== 'ready') return;
    const target = pendingFocusRef.current;
    if (!target) return;
    pendingFocusRef.current = null;
    (target === 'undo' ? undoRef.current : payFullRef.current)?.focus();
  }, [busy, status, showSettledPanel, showPayActions]);

  const dueDate = resolveCardDueDate(card, month);
  const dueLabel = dueDate
    ? `ครบกำหนด ${formatIsoDateTH(dueDate)}`
    : `ครบกำหนด ${formatDayLabel(card.dueDay ?? '')}`;

  return (
    <section className={`${CARD} flex flex-col gap-space-2`} aria-labelledby="pay-next-title">
      <h3 id="pay-next-title" className="m-0 text-lg font-semibold text-primary">ชำระรอบบิลนี้</h3>
      {switcher}

      {status === 'loading' && (
        // โครงร่างแทนสถานะ "รวยที่สุด" ของจริง (hasSomethingDue && !settled) จึงอาจสูงเกินจริงเล็กน้อยเมื่อ
        // บัตรชำระแล้ว/ยังไม่เคยใช้ — เลือกฝั่งนี้โดยตั้งใจ เพราะปุ่มจ่ายเงินคือเหตุผลที่ผู้ใช้เปิดหน้านี้
        // ถ้าจองที่ให้ไม่พอ ปุ่มจะโผล่มาใต้นิ้วหลังโหลดเสร็จ (เสี่ยงกดพลาด) — UX_SPEC §4 C-5
        <LoadingSkeleton label="กำลังโหลดยอดใช้จ่ายหมุนเวียน..." className="flex flex-col gap-space-2">
          <SkeletonBlock className="h-[22px] w-[160px]" />
          {/* ยอดที่ต้องชำระ = text-3xl clamp(2rem,1.6rem+2vw,2.75rem) × 1.2 → 40px ที่ 390px, 53px ที่ ≥1024px */}
          <SkeletonBlock className="h-[40px] w-[200px] md:h-[53px]" />
          <SkeletonBlock className="h-[18px] w-[220px]" />
          <SkeletonBlock className="h-[18px] w-[160px]" />
          <SkeletonBlock className="h-[18px] w-[200px]" />
          <SkeletonBlock className="h-11 w-full" />
          <div className="mt-space-2 flex flex-col gap-space-2">
            <SkeletonBlock className="h-12 w-full" />
            <SkeletonBlock className="h-12 w-full" />
          </div>
        </LoadingSkeleton>
      )}

      {status === 'error' && (
        <div className="flex flex-col items-start gap-space-2">
          <p role="alert" className="m-0 text-sm text-neg">โหลดยอดใช้จ่ายหมุนเวียนไม่สำเร็จ</p>
          <button type="button" className={BTN_GHOST} onClick={onRetry}>ลองใหม่</button>
        </div>
      )}

      {status === 'ready' && (
        <>
          {/* ยอดรวมบัตรมาจาก server (cardTotal.actual) เท่านั้น — ถ้ายังไม่มี ห้ามเอายอดหมุนเวียนมาแสดงใต้ป้าย "ยอดรวมบัตร" */}
          {cardTotal && (
            <>
              <span className="text-sm font-semibold text-secondary">
                {settled && !isCredit && !isZeroAfterCashback ? 'ยอดรวมบัตรรอบนี้' : 'ยอดรวมบัตรที่ต้องเตรียมจ่าย'}
              </span>
              <span className="font-[family-name:var(--font-numeric)] text-3xl font-bold tabular-nums text-primary">{`${formatCurrency(cardTotal.actual)} ฿`}</span>
              <span className="text-xs text-tertiary">{dueLabel}</span>
              <span className="text-xs text-tertiary">ยอดรวมของรอบนี้ ไม่ใช่ยอดคงเหลือหลังชำระ</span>
              <dl className="m-0 flex flex-col gap-space-1 rounded-sm border border-border-subtle bg-surface-2 px-space-3 py-space-2 text-sm">
                <div className="flex items-baseline justify-between gap-space-3">
                  <dt className="text-tertiary">งวดผ่อน</dt>
                  <dd className="m-0 font-semibold tabular-nums text-primary">{`${formatCurrency(cardTotal.installmentTotal)} ฿`}</dd>
                </div>
                <div className="flex items-baseline justify-between gap-space-3">
                  <dt className="text-tertiary">ยอดหมุนเวียน</dt>
                  <dd className="m-0 font-semibold tabular-nums text-primary">{`${formatCurrency(Math.max(currentCycle.totalDue, 0))} ฿`}</dd>
                </div>
              </dl>
            </>
          )}

          {hasSomethingDue && (
            <>
              {!cardTotal && (
                <>
                  <span className="text-sm font-semibold text-secondary">ยอดหมุนเวียนที่ต้องชำระ</span>
                  <span className="font-[family-name:var(--font-numeric)] text-3xl font-bold tabular-nums text-primary">{`${formatCurrency(currentCycle.totalDue)} ฿`}</span>
                  <span className="text-xs text-tertiary">{dueLabel}</span>
                </>
              )}
              <span className="text-xs text-tertiary">
                {`ขั้นต่ำ ${card.minPaymentPercent ?? 10}% ของยอดหมุนเวียน = ${formatCurrency(currentCycle.minPaymentDue)} ฿`}
              </span>
              {cashbackAmount > 0 && (
                <span className="text-xs text-pos">{`หักแคชแบคแล้ว ${formatCurrency(cashbackAmount)} ฿`}</span>
              )}
            </>
          )}

          {isZeroAfterCashback && (
            <p className="m-0 text-sm text-tertiary">แคชแบคหักยอดหมุนเวียนเดือนนี้หมดพอดี · ไม่มียอดหมุนเวียนต้องชำระ</p>
          )}

          {isCredit && (
            <div className="flex flex-col gap-space-1 rounded-sm border border-pos/40 border-l-[3px] border-l-pos bg-pos/10 p-space-3">
              <span className="text-sm font-bold text-pos">
                {`เครดิตคงเหลือ ${formatCurrency(currentCycle.creditBalance)} ฿`}
              </span>
              <span className="text-xs text-tertiary">ไม่มียอดหมุนเวียนต้องชำระเดือนนี้</span>
              <span className="text-xs text-tertiary">เครดิตจะยกไปหักยอดหมุนเวียนเดือนหน้าโดยอัตโนมัติ</span>
            </div>
          )}

          {nothingDue && (
            <>
              <p className="m-0 text-sm text-tertiary">ไม่มียอดใช้จ่ายหมุนเวียนต้องชำระในรอบนี้</p>
              {!currentCycle.stored && currentCycle.carriedBalance === 0 && (
                <p className="m-0 text-sm text-tertiary">ยังไม่ได้บันทึกยอดใช้จ่ายของเดือนนี้</p>
              )}
            </>
          )}

          {hasBreakdown && (
            <>
              <button
                type="button"
                className={`flex min-h-11 w-full items-center justify-between gap-space-2 rounded-sm border border-border-default bg-surface-2 px-space-3 text-sm font-medium text-secondary ${FOCUS_RING}`}
                aria-expanded={breakdownOpen}
                aria-controls="pay-next-breakdown"
                onClick={() => setBreakdownOpen(value => !value)}
              >
                รายละเอียดยอด
                <span className={`transition-transform motion-reduce:transition-none ${breakdownOpen ? 'rotate-180' : ''}`}><Icons.ChevronDown size={16} /></span>
              </button>
              {breakdownOpen && (
                <div id="pay-next-breakdown" className="flex flex-col gap-space-2">
                  {currentCycle.carriedBalance > 0 ? (
                    <div className="flex items-center justify-between gap-space-3 rounded-sm border border-border-subtle bg-surface-2 px-space-3 py-space-2 text-sm">
                      <span className="text-tertiary">ยอดยกมา</span>
                      <span className="font-semibold text-primary">{`${formatCurrency(currentCycle.carriedBalance)} ฿`}</span>
                    </div>
                  ) : currentCycle.carriedBalance < 0 ? (
                    <div className="flex items-center justify-between gap-space-3 rounded-sm border border-border-subtle bg-surface-2 px-space-3 py-space-2 text-sm">
                      <span className="text-tertiary">เครดิตยกมา</span>
                      <span className="font-semibold text-pos">{`${formatCurrency(-currentCycle.carriedBalance)} ฿`}</span>
                    </div>
                  ) : null}
                  {currentCycle.carriedBalance > 0 && previousMonthCycle && (
                    <span className="text-xs text-tertiary">
                      {`ยกมาจาก ${formatMonthKeyTH(previousMonthCycle.month)}`}
                      {previousMonthCycle.interest > 0 ? ` · รวมดอกเบี้ย ${formatCurrency(previousMonthCycle.interest)} ฿` : ''}
                      {' · คำนวณจากเดือนก่อนหน้าโดยอัตโนมัติ'}
                    </span>
                  )}
                  {/* เครดิตไม่มีดอกเบี้ย (BR-CC-030) จึงไม่มีส่วน "รวมดอกเบี้ย" */}
                  {currentCycle.carriedBalance < 0 && previousMonthCycle && (
                    <span className="text-xs text-tertiary">
                      {`ยกมาจาก ${formatMonthKeyTH(previousMonthCycle.month)} · คำนวณจากเดือนก่อนหน้าโดยอัตโนมัติ`}
                    </span>
                  )}
                  <p className="m-0 text-sm text-secondary">ยอดใช้จ่ายใหม่ {formatCurrency(currentCycle.newSpend)} ฿</p>
                </div>
              )}
            </>
          )}

          {showPayActions && (
            <div role="group" aria-labelledby="pay-revolving-title" className="mt-space-2 flex flex-col gap-space-2">
              <span id="pay-revolving-title" className="text-sm font-semibold text-secondary">ชำระยอดหมุนเวียน</span>
              <button
                ref={payFullRef}
                type="button"
                className={BTN_PRIMARY}
                disabled={busy}
                onClick={() => { pendingFocusRef.current = 'undo'; onPayFull(); }}
              >
                {`บันทึกชำระยอดหมุนเวียนเต็มจำนวน ${formatCurrency(currentCycle.totalDue)} ฿`}
              </button>
              <button
                type="button"
                className={BTN_SECONDARY}
                disabled={busy}
                onClick={() => { pendingFocusRef.current = 'undo'; onPayMinimum(); }}
              >
                {`บันทึกชำระขั้นต่ำยอดหมุนเวียน ${formatCurrency(currentCycle.minPaymentDue)} ฿`}
              </button>
              <span className="text-xs text-tertiary">บันทึกเฉพาะยอดหมุนเวียน · งวดผ่อนจัดการแยกต่างหาก</span>
            </div>
          )}

          {showSettledPanel && (
            <>
              <div className="flex flex-col gap-space-1 rounded-sm border border-pos/40 border-l-[3px] border-l-pos bg-pos/10 p-space-3 opacity-90">
                <span className="text-sm font-bold text-pos">
                  {currentCycle.paymentAction === 'minimum'
                    ? `✓ จ่ายขั้นต่ำยอดหมุนเวียนแล้ว ${formatCurrency(currentCycle.paidAmount)} ฿`
                    : `✓ จ่ายยอดหมุนเวียนเต็มจำนวนแล้ว ${formatCurrency(currentCycle.paidAmount)} ฿`}
                </span>
                {currentCycle.paymentAction === 'minimum' ? (
                  <>
                    <span className="text-xs text-tertiary">
                      {`ยกไปเดือนหน้า ${formatCurrency(currentCycle.closingBalance)} ฿`}
                    </span>
                    <span className="text-xs text-tertiary">
                      {`(คงเหลือ ${formatCurrency(currentCycle.totalDue - currentCycle.minPaymentDue)} + ดอกเบี้ย ${formatCurrency(currentCycle.interest)})`}
                    </span>
                  </>
                ) : (
                  <span className="text-xs text-tertiary">ไม่มียอดยกไปเดือนหน้า · ไม่มีดอกเบี้ย</span>
                )}
              </div>
              <button
                ref={undoRef}
                type="button"
                className={BTN_GHOST}
                disabled={busy}
                onClick={() => { pendingFocusRef.current = 'pay'; onUndo(); }}
              >
                ยกเลิกการชำระยอดหมุนเวียน
              </button>
            </>
          )}
        </>
      )}
    </section>
  );
}
