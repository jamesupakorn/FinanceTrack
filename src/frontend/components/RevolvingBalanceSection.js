/**
 * คอมโพเนนต์: RevolvingBalanceSection
 * ส่วน "ยอดใช้จ่ายหมุนเวียน" ภายในหน้ารายละเอียดบัตร (หน้าจอ 2)
 *
 * ⚠ คอมโพเนนต์นี้ **ไม่คำนวณเงินเอง** เลยแม้แต่ช่องเดียว
 *   ตัวเลขทุกตัวมาจาก /api/credit-cards/revolving ซึ่งคำนวณด้วย buildRevolvingCycles()
 *   พรีวิวกับค่าที่บันทึกจึงไม่มีทางไม่ตรงกัน (หลักการเดียวกับ buildSchedule — ADR-010/011)
 *
 * พร็อพ:
 * - card {object} บัตรที่กำลังดู
 * - month {string} YYYY-MM เดือนที่ทำรายการ (ค่าเริ่มต้น = เดือนปัจจุบัน)
 * - isMobileView {boolean} จอปัจจุบันเป็น breakpoint มือถือไหม — ใช้กำหนดค่าเริ่มต้นของ historyOpen
 *   (desktop = กางไว้เลย) และ sync ใหม่ทุกครั้งที่ breakpoint เปลี่ยนจริง (ไม่ใช่แค่ตอน mount)
 * - onConfirmMinimum {function({card, cycle, onConfirm})} ขอให้หน้าแม่เปิด ConfirmDialog
 * - onChanged {function} แจ้งหน้าแม่ให้โหลดยอดรวมของบัตรใหม่
 *
 * ช่องตัวเลขเป็น type="text" + inputMode เสมอ (ADR-006) และบันทึกตอน blur ไม่ใช่ทุกคีย์
 * ปุ่มทุกปุ่มสูง ≥ 44px
 *
 * Graphite redesign (credit-cards-graphite pass) — Tailwind แทน CreditCard.module.css แล้ว
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { getCurrentMonthKey, formatDayLabel } from '../../shared/utils/creditCardUtils';
import { formatMonthKeyTH } from '../../shared/utils/dateUtils';
import { creditCardAPI } from '../../shared/utils/frontend/apiUtils';
import { formatCurrency, parseAndFormat } from '../../shared/utils/frontend/numberUtils';
import { showToast } from '../../shared/utils/frontend/toast';
import { Icons } from './Icons';

const EMPTY_CYCLE = {
  newSpend: 0,
  carriedBalance: 0,
  totalDue: 0,
  minPaymentDue: 0,
  paymentAction: null,
  amountDue: 0,
  paidAmount: 0,
  interest: 0,
  closingBalance: 0,
  stored: false,
  isImplicit: true
};

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
}) {
  const [cycles, setCycles] = useState([]);
  const [truncated, setTruncated] = useState(false);
  const [spendDraft, setSpendDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [historyOpen, setHistoryOpen] = useState(!isMobileView);

  useEffect(() => {
    setHistoryOpen(!isMobileView);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMobileView]);

  const cardId = card?.id;

  const applyChain = useCallback((response) => {
    const nextCycles = Array.isArray(response?.cycles) ? response.cycles : [];
    setCycles(nextCycles);
    setTruncated(response?.truncated === true);
    const current = nextCycles.find(item => item.month === month);
    setSpendDraft(current ? parseAndFormat(current.newSpend) : '');
  }, [month]);

  useEffect(() => {
    if (!cardId) return undefined;
    let cancelled = false;
    setLoading(true);
    creditCardAPI.getRevolving({ cardId })
      .then((response) => {
        if (cancelled) return;
        applyChain(response);
      })
      .catch(() => {
        if (cancelled) return;
        setCycles([]);
        setTruncated(false);
        setSpendDraft('');
        showToast('โหลดยอดใช้จ่ายหมุนเวียนไม่สำเร็จ', 'error');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [cardId, applyChain]);

  // ต้องอยู่เหนือ `if (!card) return null;` เสมอ — hooks ห้ามถูกเรียกแบบมีเงื่อนไข
  // cycles/month ไม่ผูกกับ card เลย จึง compute ได้แม้ card ยังไม่มา (ผลลัพธ์แค่ยังไม่ได้ใช้)
  const { currentCycle, previousMonthCycle, history } = useMemo(() => {
    const current = cycles.find(item => item.month === month) || EMPTY_CYCLE;
    const previous = [...cycles]
      .filter(item => item.month < month)
      .sort((a, b) => a.month.localeCompare(b.month))
      .pop() || null;
    const sortedHistory = [...cycles].sort((a, b) => b.month.localeCompare(a.month));
    return { currentCycle: current, previousMonthCycle: previous, history: sortedHistory };
  }, [cycles, month]);

  if (!card) return null;

  const runAction = async (task, successMessage, failureMessage) => {
    setBusy(true);
    try {
      const response = await task();
      applyChain(response);
      showToast(successMessage);
      onChanged?.();
    } catch (error) {
      showToast(error.message || failureMessage, 'error');
    } finally {
      setBusy(false);
    }
  };

  // บันทึกตอน blur เท่านั้น — ไม่ debounce ระหว่างพิมพ์ กัน focus หลุดบนมือถือ
  const handleSpendBlur = (rawValue) => {
    const formatted = rawValue.trim() ? parseAndFormat(rawValue) : '0.00';
    setSpendDraft(formatted);
    if (formatted === parseAndFormat(currentCycle.newSpend)) return;
    runAction(
      () => creditCardAPI.saveRevolvingSpend(cardId, month, formatted),
      'บันทึกยอดใช้จ่ายแล้ว',
      'บันทึกยอดใช้จ่ายไม่สำเร็จ'
    );
  };

  const handlePayFull = () => runAction(
    () => creditCardAPI.setRevolvingAction(cardId, month, 'full'),
    'บันทึกจ่ายเต็มจำนวนแล้ว',
    'บันทึกการชำระไม่สำเร็จ'
  );

  // จ่ายขั้นต่ำ = สร้างหนี้ก้อนใหม่ จึงต้องยืนยันก่อน ต่างจากจ่ายเต็มที่ย้อนกลับได้ใน 1 แตะ
  const handlePayMinimum = () => {
    const confirmAction = () => runAction(
      () => creditCardAPI.setRevolvingAction(cardId, month, 'minimum'),
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
    () => creditCardAPI.setRevolvingAction(cardId, month, null),
    'ยกเลิกการชำระแล้ว',
    'ยกเลิกการชำระไม่สำเร็จ'
  );

  const settled = currentCycle.paymentAction !== null;
  const hasSomethingDue = currentCycle.totalDue > 0;

  return (
    <section className={`${CARD} flex flex-col gap-space-2`} aria-label="ยอดใช้จ่ายหมุนเวียน">
      <div className="flex items-center justify-between gap-space-3">
        <h2 className="m-0 text-lg font-semibold text-primary">ยอดใช้จ่ายหมุนเวียน</h2>
        <span className="text-sm font-semibold text-tertiary">{formatMonthKeyTH(month)}</span>
      </div>

      {loading ? (
        <p className="m-0 text-sm text-tertiary">กำลังโหลดยอดใช้จ่ายหมุนเวียน...</p>
      ) : (
        <>
          {currentCycle.carriedBalance > 0 ? (
            <div className="flex items-center justify-between gap-space-3 rounded-sm border border-border-subtle bg-surface-2 px-space-3 py-space-2 text-sm">
              <span className="text-tertiary">ยอดยกมา</span>
              <span className="font-semibold text-primary">{`${formatCurrency(currentCycle.carriedBalance)} ฿`}</span>
            </div>
          ) : null}
          {currentCycle.carriedBalance > 0 && previousMonthCycle && (
            <span className="text-xs text-tertiary">
              {`ยกมาจาก ${formatMonthKeyTH(previousMonthCycle.month)}`}
              {previousMonthCycle.interest > 0 ? ` · รวมดอกเบี้ย ${formatCurrency(previousMonthCycle.interest)} ฿` : ''}
              {' · คำนวณจากเดือนก่อนหน้าโดยอัตโนมัติ'}
            </span>
          )}
          {!currentCycle.stored && currentCycle.carriedBalance === 0 && (
            <p className="m-0 text-sm text-tertiary">ยังไม่ได้บันทึกยอดใช้จ่ายของเดือนนี้</p>
          )}

          <label className="text-sm font-semibold text-secondary" htmlFor="revolving-spend">
            ยอดใช้จ่ายใหม่เดือนนี้ (บาท)
          </label>
          <input
            id="revolving-spend"
            name="newSpend"
            type="text"
            inputMode="decimal"
            className={`min-h-12 w-full rounded-sm border border-border-interactive bg-surface-2 px-space-3 text-right font-[family-name:var(--font-numeric)] text-xl font-semibold tabular-nums text-primary outline-none transition-colors duration-fast ease-graphite focus:border-accent disabled:opacity-60 ${FOCUS_RING}`}
            value={spendDraft}
            disabled={busy}
            onChange={(event) => setSpendDraft(event.target.value)}
            onBlur={(event) => handleSpendBlur(event.target.value)}
            placeholder="0.00"
          />
          <span className="text-xs text-tertiary">กรอกยอดจาก statement ของเดือนนี้</span>

          {hasSomethingDue && (
            <>
              <div className="h-px bg-border-subtle" />
              <span className="text-sm font-semibold text-secondary">ยอดที่ต้องชำระทั้งหมด</span>
              <span className="font-[family-name:var(--font-numeric)] text-3xl font-bold tabular-nums text-primary">{`${formatCurrency(currentCycle.totalDue)} ฿`}</span>
              <span className="text-xs text-tertiary">
                {`ขั้นต่ำ ${card.minPaymentPercent ?? 10}% = ${formatCurrency(currentCycle.minPaymentDue)} ฿`}
              </span>
              <span className="text-xs text-tertiary">
                {`ครบกำหนด ${formatDayLabel(card.dueDay)}`}
              </span>
            </>
          )}

          {hasSomethingDue && !settled && (
            <div className="mt-space-2 flex flex-col gap-space-2 md:flex-row">
              <button
                type="button"
                className={BTN_PRIMARY}
                disabled={busy}
                onClick={handlePayFull}
              >
                {`จ่ายเต็มจำนวน ${formatCurrency(currentCycle.totalDue)} ฿`}
              </button>
              <button
                type="button"
                className={BTN_SECONDARY}
                disabled={busy}
                onClick={handlePayMinimum}
              >
                {`จ่ายขั้นต่ำ ${formatCurrency(currentCycle.minPaymentDue)} ฿`}
              </button>
            </div>
          )}

          {settled && (
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
              <button
                type="button"
                className={BTN_GHOST}
                disabled={busy}
                onClick={handleUndo}
              >
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
                          <th className="whitespace-nowrap border-b border-border-default px-space-2 py-space-2 text-left font-semibold text-tertiary">ชำระ</th>
                          <th className="whitespace-nowrap border-b border-border-default px-space-2 py-space-2 text-right font-semibold text-tertiary">ยกไป</th>
                        </tr>
                      </thead>
                      <tbody>
                        {history.map(cycle => (
                          <tr key={cycle.month} className={cycle.isImplicit ? 'opacity-60' : ''}>
                            <td className="whitespace-nowrap border-b border-border-subtle px-space-2 py-space-2 text-primary">{formatMonthKeyTH(cycle.month)}</td>
                            <td className="whitespace-nowrap border-b border-border-subtle px-space-2 py-space-2 text-right font-[family-name:var(--font-numeric)] tabular-nums text-primary">{formatCurrency(cycle.carriedBalance)}</td>
                            <td className="whitespace-nowrap border-b border-border-subtle px-space-2 py-space-2 text-right font-[family-name:var(--font-numeric)] tabular-nums text-primary">{cycle.isImplicit ? '—' : formatCurrency(cycle.newSpend)}</td>
                            <td className="whitespace-nowrap border-b border-border-subtle px-space-2 py-space-2 text-primary">
                              {cycle.paymentAction === null
                                ? 'ยังไม่ชำระ'
                                : `${cycle.paymentAction === 'minimum' ? 'ขั้นต่ำ' : 'เต็ม'} ${formatCurrency(cycle.paidAmount)}`}
                            </td>
                            <td className="whitespace-nowrap border-b border-border-subtle px-space-2 py-space-2 text-right font-[family-name:var(--font-numeric)] tabular-nums text-primary">
                              {formatCurrency(cycle.closingBalance)}
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
                            {cycle.paymentAction === null
                              ? 'ยังไม่ชำระ'
                              : (cycle.paymentAction === 'minimum' ? 'ขั้นต่ำ' : 'เต็ม')}
                          </span>
                        </div>
                        <span className="font-[family-name:var(--font-numeric)] text-base font-semibold tabular-nums text-primary">{formatCurrency(cycle.totalDue)}</span>
                        <span className="text-xs text-tertiary">
                          {`ยกมา ${formatCurrency(cycle.carriedBalance)} · ใช้จ่าย ${cycle.isImplicit ? '—' : formatCurrency(cycle.newSpend)}`}
                        </span>
                        <span className="text-xs text-tertiary">
                          {`ยกไป ${formatCurrency(cycle.closingBalance)}${cycle.interest > 0 ? ` (+ดบ ${formatCurrency(cycle.interest)})` : ''}`}
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
