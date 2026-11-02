/**
 * คอมโพเนนต์: RevolvingBalanceSection
 * ส่วนท้ายของหน้ารายละเอียดบัตร: disclosure "แคชแบค" + disclosure "ประวัติยอดหมุนเวียน"
 * (spec-credit-card-detail-redesign §5.6 — ส่วนยอดที่ต้องชำระย้ายไป CardPayNextSummary, fetch/action ย้ายไป useRevolvingCycle)
 *
 * ⚠ คอมโพเนนต์นี้ **ไม่คำนวณเงินเอง** เลยแม้แต่ช่องเดียว — รับ state จาก hook เป็น props
 * ช่องตัวเลขเป็น type="text" + inputMode เสมอ (ADR-006) และบันทึกตอน blur ไม่ใช่ทุกคีย์
 * แคชแบค: totalDue/carriedBalance/closingBalance ของ server อาจติดลบ = เครดิต
 *   คอมโพเนนต์แค่สลับเครื่องหมายเพื่อแสดงผล (formatBalance) ไม่ได้คำนวณเงินเพิ่ม
 * ปุ่มทุกปุ่มสูง ≥ 44px
 *
 * แผงแคชแบคใช้ `hidden` แทนการ unmount (DD-3) เพื่อให้ draft/input identity อยู่รอดตอนพับ-กาง
 * และพับด้วยปุ่มจะ focus ปุ่มก่อนเสมอ เพื่อให้ blur (และการบันทึก) ทำงานก่อนแผงซ่อน (I-26)
 */

import { useEffect, useRef, useState } from 'react';
import { formatMonthKeyTH } from '../../shared/utils/dateUtils';
import { formatCurrency } from '../../shared/utils/frontend/numberUtils';
import type { RevolvingCycleState } from '../../shared/utils/frontend/useRevolvingCycle';
import { Icons } from './Icons';

export type { CurrentCycle, RevolvingCard } from '../../shared/utils/frontend/useRevolvingCycle';

interface RevolvingBalanceSectionProps {
  month: string;
  isMobileView?: boolean;
  rev: RevolvingCycleState;
}

/** แสดงยอดคงเหลือแบบมีเครื่องหมาย — ติดลบ = เครดิต (แสดงผลเท่านั้น ไม่ใช่การคำนวณเงิน) */
const formatBalance = (value: number): string => (Number(value) < 0 ? `เครดิต ${formatCurrency(-Number(value))}` : formatCurrency(value));

const FOCUS_RING = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2';
const CARD = 'rounded-md border border-border-default bg-surface-1 p-space-4 shadow-elev-1 md:p-space-5';
const DISCLOSURE = `flex min-h-11 w-full items-center justify-between gap-space-2 rounded-sm border border-border-default bg-surface-2 px-space-3 text-left text-sm font-medium text-secondary ${FOCUS_RING}`;

export default function RevolvingBalanceSection({ month, isMobileView = false, rev }: RevolvingBalanceSectionProps) {
  const { history, truncated, currentCycle, cashbackDraft, busy, status } = rev;
  const [historyOpen, setHistoryOpen] = useState(!isMobileView);
  const [cashbackOpen, setCashbackOpen] = useState(!isMobileView);
  const cashbackToggleRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    setHistoryOpen(!isMobileView);
    setCashbackOpen(!isMobileView);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMobileView]);

  const cashbackAmount = Number(currentCycle.cashbackAmount) || 0;
  const cashbackSummary = status !== 'ready' ? '' : cashbackAmount > 0 ? `${formatCurrency(cashbackAmount)} ฿` : 'ยังไม่ได้กรอก';

  const toggleCashback = () => {
    // พับ/กางด้วยปุ่ม: focus ปุ่มก่อนเพื่อให้ input blur → บันทึก ก่อนแผงซ่อน
    cashbackToggleRef.current?.focus();
    setCashbackOpen(value => !value);
  };

  return (
    <div className="flex flex-col gap-space-4">
      <section className={`${CARD} flex flex-col gap-space-2`}>
        <h3 className="m-0">
          <button
            ref={cashbackToggleRef}
            type="button"
            className={DISCLOSURE}
            aria-expanded={cashbackOpen}
            aria-controls="revolving-cashback-panel"
            onClick={toggleCashback}
          >
            <span>{`แคชแบค · ${formatMonthKeyTH(month)}`}</span>
            <span className="flex items-center gap-space-2">
              {cashbackSummary && <span className="font-semibold text-primary">{cashbackSummary}</span>}
              <span className={`transition-transform motion-reduce:transition-none ${cashbackOpen ? 'rotate-180' : ''}`}><Icons.ChevronDown size={16} /></span>
            </span>
          </button>
        </h3>
        <div id="revolving-cashback-panel" hidden={!cashbackOpen} className={cashbackOpen ? 'flex flex-col gap-space-2' : 'hidden'}>
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
            disabled={busy || status !== 'ready'}
            onChange={(event) => rev.changeCashbackDraft(event.target.value)}
            onFocus={rev.focusCashback}
            onBlur={(event) => rev.blurCashback(event.target.value)}
            placeholder="0.00"
          />
          <span id="revolving-cashback-help" className="text-xs text-tertiary">
            กรอกยอดเงินคืนตามที่แสดงใน statement · หักออกจากยอดที่ต้องชำระ ถ้าเกินยอด ส่วนที่เหลือจะยกไปหักเดือนหน้า
          </span>
        </div>
      </section>

      {history.length > 0 && (
        <section className={`${CARD} flex flex-col gap-space-2`}>
          <h3 className="m-0">
            <button
              type="button"
              className={DISCLOSURE}
              aria-expanded={historyOpen}
              aria-controls="revolving-history-panel"
              onClick={() => setHistoryOpen(value => !value)}
            >
              <span>{historyOpen ? 'ซ่อนประวัติยอดหมุนเวียน' : `ประวัติยอดหมุนเวียน (${history.length} เดือน)`}</span>
              <span className={`transition-transform motion-reduce:transition-none ${historyOpen ? 'rotate-180' : ''}`}><Icons.ChevronDown size={16} /></span>
            </button>
          </h3>

          {historyOpen && (
            <div id="revolving-history-panel">
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
                      <tr
                        key={cycle.month}
                        aria-current={cycle.month === month ? 'true' : undefined}
                        className={`${cycle.isImplicit ? 'opacity-60' : ''} ${cycle.month === month ? 'bg-accent-muted' : ''}`}
                      >
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
                    aria-current={cycle.month === month ? 'true' : undefined}
                    className={`flex flex-col gap-space-1 rounded-sm border border-border-subtle bg-surface-2 p-space-3 ${cycle.isImplicit ? 'opacity-60' : ''} ${cycle.month === month ? 'bg-accent-muted' : ''}`}
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
            </div>
          )}
        </section>
      )}
    </div>
  );
}
