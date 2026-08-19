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
 * - defaultHistoryOpen {boolean} กางประวัติไว้เลยไหม (desktop = true)
 * - onConfirmMinimum {function({card, cycle, onConfirm})} ขอให้หน้าแม่เปิด ConfirmDialog
 * - onChanged {function} แจ้งหน้าแม่ให้โหลดยอดรวมของบัตรใหม่
 *
 * ช่องตัวเลขเป็น type="text" + inputMode เสมอ (ADR-006) และบันทึกตอน blur ไม่ใช่ทุกคีย์
 * ปุ่มทุกปุ่มสูง ≥ 44px ผ่านคลาสที่มีอยู่แล้ว (.primaryButton / .paidPill / .scheduleToggle)
 */

import { useCallback, useEffect, useState } from 'react';
import { getCurrentMonthKey, formatDayLabel } from '../../shared/utils/creditCardUtils';
import { formatMonthKeyTH } from '../../shared/utils/dateUtils';
import { creditCardAPI } from '../../shared/utils/frontend/apiUtils';
import { formatCurrency, parseAndFormat } from '../../shared/utils/frontend/numberUtils';
import { showToast } from '../../shared/utils/frontend/toast';
import { Icons } from './Icons';
import styles from '../styles/CreditCard.module.css';

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

export default function RevolvingBalanceSection({
  card,
  month = getCurrentMonthKey(),
  defaultHistoryOpen = false,
  onConfirmMinimum,
  onChanged
}) {
  const [cycles, setCycles] = useState([]);
  const [truncated, setTruncated] = useState(false);
  const [spendDraft, setSpendDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [historyOpen, setHistoryOpen] = useState(defaultHistoryOpen);

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

  if (!card) return null;

  const currentCycle = cycles.find(item => item.month === month) || EMPTY_CYCLE;
  const previousMonthCycle = [...cycles]
    .filter(item => item.month < month)
    .sort((a, b) => a.month.localeCompare(b.month))
    .pop() || null;
  const history = [...cycles].sort((a, b) => b.month.localeCompare(a.month));

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
    <section className={styles.revolvingSection} aria-label="ยอดใช้จ่ายหมุนเวียน">
      <div className={styles.sectionHeaderRow}>
        <h2 className={styles.sectionTitle}>ยอดใช้จ่ายหมุนเวียน</h2>
        <span className={styles.revolvingMonth}>{formatMonthKeyTH(month)}</span>
      </div>

      {loading ? (
        <p className={styles.hint}>กำลังโหลดยอดใช้จ่ายหมุนเวียน...</p>
      ) : (
        <>
          {currentCycle.carriedBalance > 0 ? (
            <div className={styles.revolvingRow}>
              <span className={styles.detailRowLabel}>ยอดยกมา</span>
              <span className={styles.detailRowValue}>{`${formatCurrency(currentCycle.carriedBalance)} ฿`}</span>
            </div>
          ) : null}
          {currentCycle.carriedBalance > 0 && previousMonthCycle && (
            <span className={styles.revolvingHint}>
              {`ยกมาจาก ${formatMonthKeyTH(previousMonthCycle.month)}`}
              {previousMonthCycle.interest > 0 ? ` · รวมดอกเบี้ย ${formatCurrency(previousMonthCycle.interest)} ฿` : ''}
              {' · คำนวณจากเดือนก่อนหน้าโดยอัตโนมัติ'}
            </span>
          )}
          {!currentCycle.stored && currentCycle.carriedBalance === 0 && (
            <p className={styles.hint}>ยังไม่ได้บันทึกยอดใช้จ่ายของเดือนนี้</p>
          )}

          <label className={styles.revolvingLabel} htmlFor="revolving-spend">
            ยอดใช้จ่ายใหม่เดือนนี้ (บาท)
          </label>
          <input
            id="revolving-spend"
            name="newSpend"
            type="text"
            inputMode="decimal"
            className={styles.revolvingSpendInput}
            value={spendDraft}
            disabled={busy}
            onChange={(event) => setSpendDraft(event.target.value)}
            onBlur={(event) => handleSpendBlur(event.target.value)}
            placeholder="0.00"
          />
          <span className={styles.revolvingHint}>กรอกยอดจาก statement ของเดือนนี้</span>

          {hasSomethingDue && (
            <>
              <div className={styles.revolvingDivider} />
              <span className={styles.revolvingLabel}>ยอดที่ต้องชำระทั้งหมด</span>
              <span className={styles.revolvingTotal}>{`${formatCurrency(currentCycle.totalDue)} ฿`}</span>
              <span className={styles.revolvingHint}>
                {`ขั้นต่ำ ${card.minPaymentPercent ?? 10}% = ${formatCurrency(currentCycle.minPaymentDue)} ฿`}
              </span>
              <span className={styles.revolvingHint}>
                {`ครบกำหนด ${formatDayLabel(card.dueDay)}`}
              </span>
            </>
          )}

          {hasSomethingDue && !settled && (
            <div className={styles.revolvingActions}>
              <button
                type="button"
                className={styles.primaryButton}
                disabled={busy}
                onClick={handlePayFull}
              >
                {`จ่ายเต็มจำนวน ${formatCurrency(currentCycle.totalDue)} ฿`}
              </button>
              <button
                type="button"
                className={styles.secondaryAction}
                disabled={busy}
                onClick={handlePayMinimum}
              >
                {`จ่ายขั้นต่ำ ${formatCurrency(currentCycle.minPaymentDue)} ฿`}
              </button>
            </div>
          )}

          {settled && (
            <>
              <div className={styles.revolvingSettled}>
                <span className={styles.revolvingSettledTitle}>
                  {currentCycle.paymentAction === 'minimum'
                    ? `✓ จ่ายขั้นต่ำแล้ว ${formatCurrency(currentCycle.paidAmount)} ฿`
                    : `✓ จ่ายเต็มจำนวนแล้ว ${formatCurrency(currentCycle.paidAmount)} ฿`}
                </span>
                {currentCycle.paymentAction === 'minimum' ? (
                  <>
                    <span className={styles.revolvingHint}>
                      {`ยกไปเดือนหน้า ${formatCurrency(currentCycle.closingBalance)} ฿`}
                    </span>
                    <span className={styles.revolvingHint}>
                      {`(คงเหลือ ${formatCurrency(currentCycle.totalDue - currentCycle.minPaymentDue)} + ดอกเบี้ย ${formatCurrency(currentCycle.interest)})`}
                    </span>
                  </>
                ) : (
                  <span className={styles.revolvingHint}>ไม่มียอดยกไปเดือนหน้า · ไม่มีดอกเบี้ย</span>
                )}
              </div>
              <button
                type="button"
                className={styles.ghostButton}
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
                className={styles.scheduleToggle}
                aria-expanded={historyOpen}
                onClick={() => setHistoryOpen(value => !value)}
              >
                {historyOpen ? 'ซ่อนประวัติยอดหมุนเวียน' : `ประวัติยอดหมุนเวียน (${cycles.length} เดือน)`}
                <Icons.ChevronDown size={16} />
              </button>

              {historyOpen && (
                <>
                  {/* desktop */}
                  <div className={styles.scheduleTableWrap}>
                    <table className={styles.scheduleTable}>
                      <thead>
                        <tr>
                          <th>เดือน</th>
                          <th>ยกมา</th>
                          <th>ใช้จ่าย</th>
                          <th>ชำระ</th>
                          <th>ยกไป</th>
                        </tr>
                      </thead>
                      <tbody>
                        {history.map(cycle => (
                          <tr key={cycle.month} className={cycle.isImplicit ? styles.rowImplicit : ''}>
                            <td>{formatMonthKeyTH(cycle.month)}</td>
                            <td>{formatCurrency(cycle.carriedBalance)}</td>
                            <td>{cycle.isImplicit ? '—' : formatCurrency(cycle.newSpend)}</td>
                            <td>
                              {cycle.paymentAction === null
                                ? 'ยังไม่ชำระ'
                                : `${cycle.paymentAction === 'minimum' ? 'ขั้นต่ำ' : 'เต็ม'} ${formatCurrency(cycle.paidAmount)}`}
                            </td>
                            <td>
                              {formatCurrency(cycle.closingBalance)}
                              {cycle.interest > 0 ? ` (+ดบ ${formatCurrency(cycle.interest)})` : ''}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* mobile */}
                  <div className={styles.scheduleCards}>
                    {history.map(cycle => (
                      <div
                        key={cycle.month}
                        className={`${styles.scheduleCard} ${cycle.isImplicit ? styles.rowImplicit : ''}`}
                      >
                        <div className={styles.scheduleCardHead}>
                          <span>{formatMonthKeyTH(cycle.month)}</span>
                          <span>
                            {cycle.paymentAction === null
                              ? 'ยังไม่ชำระ'
                              : (cycle.paymentAction === 'minimum' ? 'ขั้นต่ำ' : 'เต็ม')}
                          </span>
                        </div>
                        <span className={styles.scheduleCardAmount}>{formatCurrency(cycle.totalDue)}</span>
                        <span className={styles.scheduleCardSplit}>
                          {`ยกมา ${formatCurrency(cycle.carriedBalance)} · ใช้จ่าย ${cycle.isImplicit ? '—' : formatCurrency(cycle.newSpend)}`}
                        </span>
                        <span className={styles.scheduleCardSplit}>
                          {`ยกไป ${formatCurrency(cycle.closingBalance)}${cycle.interest > 0 ? ` (+ดบ ${formatCurrency(cycle.interest)})` : ''}`}
                        </span>
                      </div>
                    ))}
                  </div>

                  {truncated && (
                    <span className={styles.revolvingHint}>แสดงได้สูงสุด 60 เดือน — บางเดือนที่บันทึกไว้อยู่นอกช่วงที่แสดง</span>
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
