/**
 * คอมโพเนนต์: RevolvingBalanceSection
 * ส่วน "ยอดใช้จ่ายหมุนเวียน" ภายในหน้ารายละเอียดบัตร (หน้าจอ 2)
 *
 * ⚠ คอมโพเนนต์นี้ **ไม่คำนวณเงินเอง** เลยแม้แต่ช่องเดียว
 *   ตัวเลขทุกตัวมาจาก /api/credit-cards/revolving ซึ่งคำนวณด้วย buildRevolvingCycles()
 *   พรีวิวกับค่าที่บันทึกจึงไม่มีทางไม่ตรงกัน (หลักการเดียวกับ buildSchedule — ADR-010/011)
 *
 * ช่องตัวเลขเป็น type="text" + inputMode เสมอ (ADR-006) และบันทึกตอน blur ไม่ใช่ทุกคีย์
 * แคชแบค (credit-card-cashback): totalDue/carriedBalance/closingBalance ของ server อาจติดลบ = เครดิต
 *   คอมโพเนนต์แค่สลับเครื่องหมายเพื่อแสดงผล (formatBalance) ไม่ได้คำนวณเงินเพิ่ม
 * ปุ่มทุกปุ่มสูง ≥ 44px
 *
 * Graphite redesign (credit-cards-graphite pass) — Tailwind แทน CreditCard.module.css แล้ว
 */

import { useCallback, useEffect, useMemo, useState, type ChangeEvent } from 'react';
import { getCurrentMonthKey, formatDayLabel, isValidCashbackAmount, buildRevolvingRowKey } from '../../shared/utils/creditCardUtils';
import type { buildRevolvingCycles } from '../../shared/utils/creditCardUtils';
import { formatMonthKeyTH } from '../../shared/utils/dateUtils';
import { creditCardAPI, expenseAPI } from '../../shared/utils/frontend/apiUtils';
import { formatCurrency, parseAndFormat } from '../../shared/utils/frontend/numberUtils';
import { showToast } from '../../shared/utils/frontend/toast';
import { Icons } from './Icons';
import LoadingSkeleton, { SkeletonBlock } from './LoadingSkeleton';
import CreditSpendItems from './CreditSpendItems';

type RevolvingCycle = ReturnType<typeof buildRevolvingCycles>[number];

export interface RevolvingCard {
  id: string;
  name?: string;
  statementDay?: number | string | null;
  annualRate?: number | string;
  minPaymentPercent?: number | string;
  dueDay?: number | string | null;
}

export type CurrentCycle = Omit<RevolvingCycle, 'id' | 'cardId' | 'month' | 'paidAt' | 'paidSource' | 'minimumPreview'>
  & Partial<Pick<RevolvingCycle, 'id' | 'cardId' | 'month' | 'paidAt' | 'paidSource' | 'minimumPreview'>>;

interface RevolvingBalanceSectionProps {
  card: RevolvingCard | null | undefined;
  month?: string;
  isMobileView?: boolean;
  onConfirmMinimum?: (params: { card: RevolvingCard; cycle: CurrentCycle; onConfirm: () => void | Promise<void> }) => void;
  onChanged?: (month?: string) => void;
}

interface RevolvingResponse {
  cycles?: RevolvingCycle[];
  truncated?: boolean;
}

const EMPTY_CYCLE: CurrentCycle = {
  newSpend: 0,
  carriedBalance: 0,
  totalDue: 0,
  minPaymentDue: 0,
  paymentAction: null,
  amountDue: 0,
  paidAmount: 0,
  interest: 0,
  closingBalance: 0,
  cashbackAmount: 0,
  creditBalance: 0,
  stored: false,
  isImplicit: true
};

/** แสดงยอดคงเหลือแบบมีเครื่องหมาย — ติดลบ = เครดิต (แสดงผลเท่านั้น ไม่ใช่การคำนวณเงิน) */
const formatBalance = (value: number): string => (Number(value) < 0 ? `เครดิต ${formatCurrency(-Number(value))}` : formatCurrency(value));

const FOCUS_RING = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2';
const CARD = 'rounded-md border border-border-default bg-surface-1 p-space-4 shadow-elev-1 md:p-space-5';
const BTN_PRIMARY = `flex min-h-12 w-full items-center justify-center rounded-sm bg-accent px-space-4 text-sm font-semibold text-on-accent transition-colors duration-fast ease-graphite hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60 ${FOCUS_RING}`;
const BTN_SECONDARY = `flex min-h-12 w-full items-center justify-center rounded-sm border border-border-interactive bg-surface-2 px-space-4 text-sm font-semibold text-primary transition-colors duration-fast ease-graphite disabled:cursor-not-allowed disabled:opacity-60 ${FOCUS_RING}`;
const BTN_GHOST = `min-h-11 rounded-sm border border-border-interactive bg-surface-2 px-space-4 text-sm font-medium text-primary transition-colors duration-fast ease-graphite hover:bg-surface-3 disabled:opacity-60 ${FOCUS_RING}`;

export default function RevolvingBalanceSection({
  card,
  month = getCurrentMonthKey(),
  isMobileView = false,
  onConfirmMinimum,
  onChanged
}: RevolvingBalanceSectionProps) {
  const [cycles, setCycles] = useState<RevolvingCycle[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [cardTotal, setCardTotal] = useState<{ actual: number; installmentTotal: number } | null>(null);
  const [cashbackDraft, setCashbackDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [historyOpen, setHistoryOpen] = useState(!isMobileView);

  useEffect(() => {
    setHistoryOpen(!isMobileView);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMobileView]);

  const cardId = card?.id;
  const readCardTotal = useCallback(async () => {
    const expense = await expenseAPI.getByMonth(month);
    const row = cardId ? expense?.[buildRevolvingRowKey(cardId)] : null;
    return { actual: Number(row?.actual) || 0, installmentTotal: Number(row?.breakdown?.installmentTotal) || 0 };
  }, [cardId, month]);

  const applyChain = useCallback((response: RevolvingResponse) => {
    const nextCycles = Array.isArray(response?.cycles) ? response.cycles : [];
    setCycles(nextCycles);
    setTruncated(response?.truncated === true);
    const current = nextCycles.find(item => item.month === month);
    setCashbackDraft(current ? parseAndFormat(current.cashbackAmount || 0) : '');
  }, [month]);

  useEffect(() => {
    if (!cardId) return undefined;
    let cancelled = false;
    setLoading(true);
    Promise.all([creditCardAPI.getRevolving({ cardId, month }), readCardTotal()])
      .then(([response, total]) => {
        if (cancelled) return;
        applyChain(response);
        setCardTotal(total);
      })
      .catch(() => {
        if (cancelled) return;
        setCycles([]);
        setTruncated(false);
        setCardTotal(null);
        setCashbackDraft('');
        showToast('โหลดยอดใช้จ่ายหมุนเวียนไม่สำเร็จ', 'error');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [card, cardId, month, applyChain, readCardTotal]);

  // ต้องอยู่เหนือ `if (!card) return null;` เสมอ — hooks ห้ามถูกเรียกแบบมีเงื่อนไข
  // cycles/month ไม่ผูกกับ card เลย จึง compute ได้แม้ card ยังไม่มา (ผลลัพธ์แค่ยังไม่ได้ใช้)
  const { currentCycle, previousMonthCycle, history } = useMemo(() => {
    const current: CurrentCycle = cycles.find(item => item.month === month) || EMPTY_CYCLE;
    const previous = [...cycles]
      .filter(item => item.month < month)
      .sort((a, b) => a.month.localeCompare(b.month))
      .pop() || null;
    const sortedHistory = [...cycles].sort((a, b) => b.month.localeCompare(a.month));
    return { currentCycle: current, previousMonthCycle: previous, history: sortedHistory };
  }, [cycles, month]);

  if (!card) return null;
  const resolvedCardId = card.id;

  const runAction = async (task: () => Promise<RevolvingResponse>, successMessage: string, failureMessage: string): Promise<void> => {
    setBusy(true);
    try {
      const response = await task();
      applyChain(response);
      setCardTotal(await readCardTotal());
      showToast(successMessage);
      onChanged?.();
    } catch (error) {
      const message = (error as { message?: string } | null)?.message;
      showToast(message || failureMessage, 'error');
    } finally {
      setBusy(false);
    }
  };

  // รูปแบบเดียวกับ handleSpendBlur: ว่าง = ล้างเป็น '0.00' (ห้ามส่ง '' เพราะ server ถือว่า no-op)
  const handleCashbackBlur = (rawValue: string) => {
    const stored = parseAndFormat(currentCycle.cashbackAmount || 0);
    const trimmed = rawValue.trim();
    if (trimmed && !isValidCashbackAmount(trimmed)) {
      setCashbackDraft(stored);
      showToast('แคชแบคต้องเป็นตัวเลขไม่ติดลบ', 'error');
      return;
    }
    const formatted = trimmed ? parseAndFormat(trimmed) : '0.00';
    setCashbackDraft(formatted);
    if (formatted === stored) return;
    runAction(
      () => creditCardAPI.saveRevolvingCashback(resolvedCardId, month, formatted),
      'บันทึกแคชแบคแล้ว',
      'บันทึกแคชแบคไม่สำเร็จ'
    );
  };

  const handlePayFull = () => runAction(
    () => creditCardAPI.setRevolvingAction(resolvedCardId, month, 'full'),
    'บันทึกจ่ายเต็มจำนวนแล้ว',
    'บันทึกการชำระไม่สำเร็จ'
  );

  // จ่ายขั้นต่ำ = สร้างหนี้ก้อนใหม่ จึงต้องยืนยันก่อน ต่างจากจ่ายเต็มที่ย้อนกลับได้ใน 1 แตะ
  const handlePayMinimum = () => {
    const confirmAction = () => runAction(
      () => creditCardAPI.setRevolvingAction(resolvedCardId, month, 'minimum'),
      'บันทึกจ่ายขั้นต่ำแล้ว',
      'บันทึกการชำระไม่สำเร็จ'
    );
    if (typeof onConfirmMinimum === 'function') {
      onConfirmMinimum({ card, cycle: currentCycle, onConfirm: confirmAction });
      return;
    }
    confirmAction();
  };

  const handleUndo = () => runAction(
    () => creditCardAPI.setRevolvingAction(resolvedCardId, month, null),
    'ยกเลิกการชำระแล้ว',
    'ยกเลิกการชำระไม่สำเร็จ'
  );

  const settled = currentCycle.paymentAction !== null;
  const hasSomethingDue = currentCycle.totalDue > 0;
  const cashbackAmount = Number(currentCycle.cashbackAmount) || 0;
  const isCredit = currentCycle.totalDue < 0;
  // แคชแบคหักยอดหมดพอดี: แสดงแค่บรรทัดศูนย์ ไม่แสดง settled panel ("จ่ายเต็มแล้ว 0.00" จะอ่านแล้วผิด — C-8)
  // เดือนที่ totalDue = 0 โดยไม่มีแคชแบค ยังแสดง settled panel เหมือนเดิม
  const isZeroAfterCashback = currentCycle.totalDue === 0 && cashbackAmount > 0;
  // paymentAction ที่บันทึกไว้บนเดือนเครดิต/ศูนย์หลังแคชแบคยังเก็บไว้ แต่ไม่มีผล จึงซ่อนไว้ (N-2)
  const showSettledPanel = settled && !isCredit && !isZeroAfterCashback;

  return (
    <section className={`${CARD} flex flex-col gap-space-2`} aria-label="ยอดใช้จ่ายหมุนเวียน">
      <div className="flex items-center justify-between gap-space-3">
        <h2 className="m-0 text-lg font-semibold text-primary">ยอดใช้จ่ายหมุนเวียน</h2>
        <span className="text-sm font-semibold text-tertiary">{formatMonthKeyTH(month)}</span>
      </div>

      {loading ? (
        // โครงร่างแทนสถานะ "รวยที่สุด" ของจริง (hasSomethingDue && !settled) จึงอาจสูงเกินจริงเล็กน้อยเมื่อ
        // บัตรชำระแล้ว/ยังไม่เคยใช้ — เลือกฝั่งนี้โดยตั้งใจ เพราะปุ่มจ่ายเงินคือเหตุผลที่ผู้ใช้เปิดหน้านี้
        // ถ้าจองที่ให้ไม่พอ ปุ่มจะโผล่มาใต้นิ้วหลังโหลดเสร็จ (เสี่ยงกดพลาด) — UX_SPEC §4 C-5
        // หัวข้อ section อยู่นอก branch นี้อยู่แล้ว จึงคงอยู่ตลอด
        <LoadingSkeleton label="กำลังโหลดยอดใช้จ่ายหมุนเวียน..." className="flex flex-col gap-space-2">
          <div className="flex items-center justify-between gap-space-3 rounded-sm border border-border-subtle bg-surface-2 px-space-3 py-space-2">
            <SkeletonBlock on="surface-2" className="h-[22px] w-[72px]" />
            <SkeletonBlock on="surface-2" className="h-[22px] w-[96px]" />
          </div>
          <SkeletonBlock className="h-[22px] w-[200px]" />
          <SkeletonBlock className="h-12 w-full" />
          <SkeletonBlock className="h-[18px] w-[180px]" />
          <div className="h-px bg-border-subtle" />
          <SkeletonBlock className="h-[22px] w-[160px]" />
          {/* ยอดที่ต้องชำระ = text-3xl clamp(2rem,1.6rem+2vw,2.75rem) × 1.2 → 40px ที่ 390px, 53px ที่ ≥1024px */}
          <SkeletonBlock className="h-[40px] w-[200px] md:h-[53px]" />
          <SkeletonBlock className="h-[18px] w-[220px]" />
          <SkeletonBlock className="h-[18px] w-[160px]" />
          <div className="mt-space-2 flex flex-col gap-space-2 md:flex-row">
            <SkeletonBlock className="h-12 w-full" />
            <SkeletonBlock className="h-12 w-full" />
          </div>
          <SkeletonBlock className="mt-space-1 h-11 w-full" />
        </LoadingSkeleton>
      ) : (
        <>
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
          {!currentCycle.stored && currentCycle.carriedBalance === 0 && (
            <p className="m-0 text-sm text-tertiary">ยังไม่ได้บันทึกยอดใช้จ่ายของเดือนนี้</p>
          )}

          <CreditSpendItems
            key={`${resolvedCardId}-${month}`}
            cardId={resolvedCardId}
            month={month}
            statementDay={card.statementDay}
            dueDay={card.dueDay}
            onChanged={async changedMonth => {
              if (changedMonth === month) {
                const [response, total] = await Promise.all([creditCardAPI.getRevolving({ cardId: resolvedCardId, month }), readCardTotal()]);
                applyChain(response);
                setCardTotal(total);
              }
              onChanged?.(changedMonth);
            }}
          />
          {cardTotal && <p className="text-sm text-secondary">งวดผ่อนเดือนนี้ {formatCurrency(cardTotal.installmentTotal)} ฿ · ยอดรวมบัตร {formatCurrency(cardTotal.actual)} ฿</p>}
          <p className="text-sm text-secondary">ยอดใช้จ่ายใหม่ {formatCurrency(currentCycle.newSpend)} ฿</p>

          <label className="mt-space-1 text-sm font-semibold text-secondary" htmlFor="revolving-cashback">
            แคชแบคที่ได้รับเดือนนี้ (บาท)
          </label>
          <input
            id="revolving-cashback"
            name="cashbackAmount"
            type="text"
            inputMode="decimal"
            aria-describedby="revolving-cashback-help"
            className={`min-h-12 w-full rounded-sm border border-border-interactive bg-surface-2 px-space-3 text-right font-[family-name:var(--font-numeric)] text-lg font-semibold tabular-nums text-primary outline-none transition-colors duration-fast ease-graphite focus:border-accent disabled:opacity-60 ${FOCUS_RING}`}
            value={cashbackDraft}
            disabled={busy}
            onChange={(event) => setCashbackDraft(event.target.value)}
            onBlur={(event) => handleCashbackBlur(event.target.value)}
            placeholder="0.00"
          />
          <span id="revolving-cashback-help" className="text-xs text-tertiary">
            กรอกยอดเงินคืนตามที่แสดงใน statement · หักออกจากยอดที่ต้องชำระ ถ้าเกินยอด ส่วนที่เหลือจะยกไปหักเดือนหน้า
          </span>

          {hasSomethingDue && (
            <>
              <div className="h-px bg-border-subtle" />
              <span className="text-sm font-semibold text-secondary">ยอดที่ต้องชำระทั้งหมด</span>
              <span className="font-[family-name:var(--font-numeric)] text-3xl font-bold tabular-nums text-primary">{`${formatCurrency(currentCycle.totalDue)} ฿`}</span>
              {cashbackAmount > 0 && (
                <span className="text-xs text-pos">{`หักแคชแบคแล้ว ${formatCurrency(cashbackAmount)} ฿`}</span>
              )}
              <span className="text-xs text-tertiary">
                {`ขั้นต่ำ ${card.minPaymentPercent ?? 10}% = ${formatCurrency(currentCycle.minPaymentDue)} ฿`}
              </span>
              <span className="text-xs text-tertiary">
                {`ครบกำหนด ${formatDayLabel(card.dueDay ?? '')}`}
              </span>
            </>
          )}

          {hasSomethingDue && !settled && (
            <div className="mt-space-2 flex flex-col gap-space-2 md:flex-row">
              <button type="button" className={BTN_PRIMARY} disabled={busy} onClick={handlePayFull}>
                {`จ่ายเต็มจำนวน ${formatCurrency(currentCycle.totalDue)} ฿`}
              </button>
              <button type="button" className={BTN_SECONDARY} disabled={busy} onClick={handlePayMinimum}>
                {`จ่ายขั้นต่ำ ${formatCurrency(currentCycle.minPaymentDue)} ฿`}
              </button>
            </div>
          )}

          {isZeroAfterCashback && (
            <>
              <div className="h-px bg-border-subtle" />
              <p className="m-0 text-sm text-tertiary">แคชแบคหักยอดเดือนนี้หมดพอดี · ไม่มียอดต้องชำระ</p>
            </>
          )}

          {isCredit && (
            <>
              <div className="h-px bg-border-subtle" />
              <div className="flex flex-col gap-space-1 rounded-sm border border-pos/40 border-l-[3px] border-l-pos bg-pos/10 p-space-3">
                <span className="text-sm font-bold text-pos">
                  {`เครดิตคงเหลือ ${formatCurrency(currentCycle.creditBalance)} ฿`}
                </span>
                <span className="text-xs text-tertiary">ไม่มียอดต้องชำระเดือนนี้</span>
                <span className="text-xs text-tertiary">เครดิตจะยกไปหักยอดเดือนหน้าโดยอัตโนมัติ</span>
              </div>
            </>
          )}

          {showSettledPanel && (
            <>
              <div className="flex flex-col gap-space-1 rounded-sm border border-pos/40 border-l-[3px] border-l-pos bg-pos/10 p-space-3 opacity-90">
                <span className="text-sm font-bold text-pos">
                  {currentCycle.paymentAction === 'minimum'
                    ? `✓ จ่ายขั้นต่ำแล้ว ${formatCurrency(currentCycle.paidAmount)} ฿`
                    : `✓ จ่ายเต็มจำนวนแล้ว ${formatCurrency(currentCycle.paidAmount)} ฿`}
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
              <button type="button" className={BTN_GHOST} disabled={busy} onClick={handleUndo}>
                ยกเลิกการชำระ
              </button>
            </>
          )}

          {cycles.length > 0 && (
            <>
              <button
                type="button"
                className={`mt-space-1 flex min-h-11 w-full items-center justify-center gap-space-2 rounded-sm border border-border-default bg-surface-2 text-sm font-medium text-secondary ${FOCUS_RING}`}
                aria-expanded={historyOpen}
                onClick={() => setHistoryOpen(value => !value)}
              >
                {historyOpen ? 'ซ่อนประวัติยอดหมุนเวียน' : `ประวัติยอดหมุนเวียน (${cycles.length} เดือน)`}
                <Icons.ChevronDown size={16} />
              </button>

              {historyOpen && (
                <>
                  {/* C5 table — md+ */}
                  <div className="mt-space-2 hidden overflow-x-auto md:block">
                    <table className="w-full border-collapse text-sm">
                      <thead>
                        <tr>
                          <th className="whitespace-nowrap border-b border-border-default px-space-2 py-space-2 text-left font-semibold text-tertiary">เดือน</th>
                          <th className="whitespace-nowrap border-b border-border-default px-space-2 py-space-2 text-right font-semibold text-tertiary">ยกมา</th>
                          <th className="whitespace-nowrap border-b border-border-default px-space-2 py-space-2 text-right font-semibold text-tertiary">ใช้จ่าย</th>
                          <th className="whitespace-nowrap border-b border-border-default px-space-2 py-space-2 text-right font-semibold text-tertiary">แคชแบค</th>
                          <th className="whitespace-nowrap border-b border-border-default px-space-2 py-space-2 text-left font-semibold text-tertiary">ชำระ</th>
                          <th className="whitespace-nowrap border-b border-border-default px-space-2 py-space-2 text-right font-semibold text-tertiary">ยกไป</th>
                        </tr>
                      </thead>
                      <tbody>
                        {history.map(cycle => (
                          <tr key={cycle.month} className={cycle.isImplicit ? 'opacity-60' : ''}>
                            <td className="whitespace-nowrap border-b border-border-subtle px-space-2 py-space-2 text-primary">{formatMonthKeyTH(cycle.month)}</td>
                            <td className="whitespace-nowrap border-b border-border-subtle px-space-2 py-space-2 text-right font-[family-name:var(--font-numeric)] tabular-nums text-primary">{formatBalance(cycle.carriedBalance)}</td>
                            <td className="whitespace-nowrap border-b border-border-subtle px-space-2 py-space-2 text-right font-[family-name:var(--font-numeric)] tabular-nums text-primary">{cycle.isImplicit ? '—' : formatCurrency(cycle.newSpend)}</td>
                            <td className="whitespace-nowrap border-b border-border-subtle px-space-2 py-space-2 text-right font-[family-name:var(--font-numeric)] tabular-nums text-primary">{cycle.isImplicit || !(Number(cycle.cashbackAmount) > 0) ? '—' : formatCurrency(cycle.cashbackAmount)}</td>
                            <td className="whitespace-nowrap border-b border-border-subtle px-space-2 py-space-2 text-primary">
                              {cycle.totalDue < 0
                                ? 'มีเครดิต'
                                : cycle.paymentAction === null
                                ? 'ยังไม่ชำระ'
                                : `${cycle.paymentAction === 'minimum' ? 'ขั้นต่ำ' : 'เต็ม'} ${formatCurrency(cycle.paidAmount)}`}
                            </td>
                            <td className="whitespace-nowrap border-b border-border-subtle px-space-2 py-space-2 text-right font-[family-name:var(--font-numeric)] tabular-nums text-primary">
                              {formatBalance(cycle.closingBalance)}
                              {cycle.interest > 0 ? ` (+ดบ ${formatCurrency(cycle.interest)})` : ''}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* C4 stack — base */}
                  <div className="mt-space-2 flex flex-col gap-space-2 md:hidden">
                    {history.map(cycle => (
                      <div
                        key={cycle.month}
                        className={`flex flex-col gap-space-1 rounded-sm border border-border-subtle bg-surface-2 p-space-3 ${cycle.isImplicit ? 'opacity-60' : ''}`}
                      >
                        <div className="flex items-baseline justify-between gap-space-2 text-sm text-secondary">
                          <span>{formatMonthKeyTH(cycle.month)}</span>
                          <span>
                            {cycle.totalDue < 0
                              ? 'มีเครดิต'
                              : cycle.paymentAction === null
                              ? 'ยังไม่ชำระ'
                              : (cycle.paymentAction === 'minimum' ? 'ขั้นต่ำ' : 'เต็ม')}
                          </span>
                        </div>
                        <span className="font-[family-name:var(--font-numeric)] text-base font-semibold tabular-nums text-primary">{formatBalance(cycle.totalDue)}</span>
                        <span className="text-xs text-tertiary">
                          {`ยกมา ${formatBalance(cycle.carriedBalance)} · ใช้จ่าย ${cycle.isImplicit ? '—' : formatCurrency(cycle.newSpend)}${Number(cycle.cashbackAmount) > 0 ? ` · แคชแบค ${formatCurrency(cycle.cashbackAmount)}` : ''}`}
                        </span>
                        <span className="text-xs text-tertiary">
                          {`ยกไป ${formatBalance(cycle.closingBalance)}${cycle.interest > 0 ? ` (+ดบ ${formatCurrency(cycle.interest)})` : ''}`}
                        </span>
                      </div>
                    ))}
                  </div>

                  {truncated && (
                    <span className="text-xs text-tertiary">แสดงได้สูงสุด 60 เดือน — บางเดือนที่บันทึกไว้อยู่นอกช่วงที่แสดง</span>
                  )}
                </>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}