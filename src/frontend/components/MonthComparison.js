/**
 * คอมโพเนนต์: MonthComparison
 * ตารางเปรียบเทียบยอดรายเดือนย้อนหลัง N เดือน (N = min(6, จำนวนเดือนที่มีข้อมูล), ล่าสุดก่อน)
 * เป็นชิ้นส่วนใหม่ชิ้นเดียวของ /reports (ส่วนที่เหลือคือการย้าย SalaryCalculator/SummaryReport มาตั้ง)
 *
 * ⚠ ไม่คำนวณยอดเงินเอง (BR-DASH-005/AC-RS-19) — ทุกแถวคือผลลัพธ์ getMonthlySummaryModel() ตรง ๆ
 *   ข้อยกเว้นเดียวคือ Δ (ผลต่าง/เปอร์เซ็นต์เทียบเดือนก่อนหน้า) ซึ่งเป็นเลขเปรียบเทียบระหว่างสองแถวที่คำนวณ
 *   มาแล้ว ไม่ใช่การ derive ยอดเงินใหม่ (ไม่ใช่สิ่งที่ AC-RS-19/BR-DASH-005 คุ้มครอง ซึ่งคุ้มครองเฉพาะยอด
 *   รายรับ/รายจ่าย/เงินออม/บัตรเครดิตจริง ไม่ให้มีที่คำนวณซ้ำสอง path)
 *
 * ข้อมูลรายรับ/รายจ่ายทั่วไป/เงินออม มาจาก 3 คำขอ getAll() เท่านั้น (ไม่ใช่ 3N) — dailyExpenseAPI ไม่มี
 * getAll() จึงต้องยิง getByMonth ทีละเดือนสูงสุด N ครั้งใน Promise.all เดียว แต่ละคำขอ .catch เป็นของ
 * ตัวเอง ไม่ให้เดือนหนึ่งล้มเหลวแล้วพังทั้งตาราง (AC-RS-20/E12) — ปักธง __failed ไว้ภายใน (ไม่ส่งต่อให้
 * getMonthlySummaryModel เห็น) เพื่อแยก "ยอดจริงเป็น 0" ออกจาก "โหลดไม่สำเร็จ" ตาม UX_SPEC (never silently 0)
 */

import { useEffect, useMemo, useState } from 'react';
import { incomeAPI, expenseAPI, savingsAPI, dailyExpenseAPI } from '../../shared/utils/frontend/apiUtils';
import { getMonthlySummaryModel } from '../../shared/utils/frontend/monthlySummary';
import { round2 } from '../../shared/utils/creditCardUtils';
import { formatCurrency } from '../../shared/utils/frontend/numberUtils';
import { formatMonthLabelTH } from '../../shared/utils/frontend/monthUtils';
import { Icons } from './Icons';
import styles from '../styles/Reports.module.css';

const MAX_MONTHS = 6;
const MONTH_RE = /^\d{4}-\d{2}$/;

/**
 * Δ ของกระแสเงินสดสุทธิ เทียบกับเดือนก่อนหน้า (แถวถัดไปในรายการ เพราะเรียงล่าสุดก่อน)
 * previous.netCashFlow === 0 → คืน percent เป็น null (แสดง "—") กัน Infinity/NaN เสมอ (AC-RS-21/E11)
 */
function computeDelta(currentModel, previousModel) {
  if (!previousModel) return { amount: null, percent: null };
  const amount = round2(currentModel.netCashFlow - previousModel.netCashFlow);
  const percent = previousModel.netCashFlow === 0
    ? null
    : round2((amount / Math.abs(previousModel.netCashFlow)) * 100);
  return { amount, percent };
}

function DeltaBadge({ delta }) {
  if (!delta || delta.percent === null || delta.amount === null) {
    return <span className={styles.deltaCell}>—</span>;
  }
  const isUp = delta.amount >= 0;
  const Icon = isUp ? Icons.TrendingUp : Icons.TrendingDown;
  const word = isUp ? 'เพิ่มขึ้น' : 'ลดลง';
  const absPercent = Math.abs(delta.percent);
  return (
    <span className={`${styles.deltaCell} ${isUp ? styles.deltaUp : styles.deltaDown}`}>
      {/* ไอคอน+ตัวเลขที่เห็น ซ่อนจาก screen reader — มีเวอร์ชันอ่านง่ายแยกไว้ข้างล่างแทน (UX_SPEC §Accessibility) */}
      <span aria-hidden="true" className={styles.deltaVisible}>
        <Icon size={14} />
        {`${word} ${absPercent}%`}
      </span>
      <span className={styles.srOnly}>{`${word} ${absPercent} เปอร์เซ็นต์`}</span>
    </span>
  );
}

export default function MonthComparison() {
  const [rows, setRows] = useState(null); // null = กำลังโหลด
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [incomeAll, expenseAll, savingsAll] = await Promise.all([
          incomeAPI.getAll(),
          expenseAPI.getAll(),
          savingsAPI.getAll()
        ]);

        const monthSet = new Set([
          ...Object.keys(incomeAll?.months || {}),
          ...Object.keys(expenseAll?.months || {}),
          ...Object.keys(savingsAll?.months || {})
        ].filter((month) => MONTH_RE.test(month)));

        const months = Array.from(monthSet).sort((a, b) => b.localeCompare(a)).slice(0, MAX_MONTHS);

        const dailyResults = await Promise.all(
          months.map((month) => dailyExpenseAPI.getByMonth(month).catch(() => ({ totalMonthly: 0, __failed: true })))
        );

        const builtRows = months.map((month, index) => {
          const dailyExpenseData = dailyResults[index];
          const model = getMonthlySummaryModel({
            month,
            incomeData: incomeAll?.months?.[month] || {},
            expenseData: expenseAll?.months?.[month] || {},
            savingsData: savingsAll?.months?.[month] || {},
            dailyExpenseData
          });
          return { month, model, dailyFailed: Boolean(dailyExpenseData?.__failed) };
        });

        if (!cancelled) setRows(builtRows);
      } catch (error) {
        console.error('Failed to load month comparison:', error);
        if (!cancelled) {
          setLoadError(true);
          setRows([]);
        }
      }
    }

    load();
    return () => { cancelled = true; };
  }, []);

  const rowsWithDelta = useMemo(() => {
    if (!rows) return [];
    return rows.map((row, index) => ({
      ...row,
      delta: computeDelta(row.model, rows[index + 1]?.model)
    }));
  }, [rows]);

  if (rows === null) {
    return <p className={styles.comparisonStatus}>กำลังโหลดข้อมูลเปรียบเทียบ...</p>;
  }

  if (loadError) {
    return <p className={styles.comparisonStatus}>โหลดข้อมูลเปรียบเทียบไม่สำเร็จ</p>;
  }

  if (rows.length < 2) {
    return <p className={styles.comparisonStatus}>ต้องมีข้อมูลอย่างน้อย 2 เดือนจึงจะเปรียบเทียบได้</p>;
  }

  return (
    <div className={styles.comparisonWrap}>
      <p className={styles.comparisonHint}>
        กระแสเงินสดสุทธิ = รายรับ − รายจ่ายทั้งหมดในเดือนนั้น · Δ = เทียบกับเดือนก่อนหน้า
      </p>

      {/* เดสก์ท็อป: ตาราง */}
      <table className={styles.comparisonTable}>
        <caption className={styles.srOnly}>{`ตารางเปรียบเทียบยอดรายเดือนย้อนหลัง ${rowsWithDelta.length} เดือน`}</caption>
        <thead>
          <tr>
            <th scope="col">เดือน</th>
            <th scope="col">รายรับ</th>
            <th scope="col">รายจ่ายทั่วไป</th>
            <th scope="col">รายจ่ายประจำวัน</th>
            <th scope="col">เงินออม</th>
            <th scope="col">บัตรเครดิต</th>
            <th scope="col">กระแสเงินสดสุทธิ</th>
            <th scope="col">เปลี่ยนแปลง</th>
          </tr>
        </thead>
        <tbody>
          {rowsWithDelta.map((row) => (
            <tr key={row.month}>
              <th scope="row">
                {formatMonthLabelTH(row.month)}
                {row.dailyFailed && <span className={styles.comparisonPartialChip}>ข้อมูลบางส่วนไม่ครบ</span>}
              </th>
              <td>{formatCurrency(row.model.totalIncome)}</td>
              <td>{formatCurrency(row.model.generalExpense)}</td>
              <td>{row.dailyFailed ? '—' : formatCurrency(row.model.dailyExpense)}</td>
              <td>{formatCurrency(row.model.savings)}</td>
              <td>{formatCurrency(row.model.creditCard)}</td>
              <td className={styles.comparisonHeadlineCell}>{formatCurrency(row.model.netCashFlow)}</td>
              <td><DeltaBadge delta={row.delta} /></td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* มือถือ: การ์ดต่อเดือน — ไม่มีการเลื่อนแนวนอนของข้อมูลการเงิน (AC-RS-23) */}
      <div className={styles.comparisonCards}>
        {rowsWithDelta.map((row) => (
          <div key={row.month} className={styles.comparisonCard}>
            <div className={styles.comparisonCardHeader}>
              <span className={styles.comparisonCardMonth}>{formatMonthLabelTH(row.month)}</span>
              <DeltaBadge delta={row.delta} />
            </div>
            {row.dailyFailed && <span className={styles.comparisonPartialChip}>ข้อมูลบางส่วนไม่ครบ</span>}
            <dl className={styles.comparisonCardList}>
              <div className={styles.comparisonCardRow}>
                <dt>รายรับ</dt>
                <dd>{formatCurrency(row.model.totalIncome)}</dd>
              </div>
              <div className={styles.comparisonCardRow}>
                <dt>รายจ่ายทั่วไป</dt>
                <dd>{formatCurrency(row.model.generalExpense)}</dd>
              </div>
              <div className={styles.comparisonCardRow}>
                <dt>รายจ่ายประจำวัน</dt>
                <dd>{row.dailyFailed ? '—' : formatCurrency(row.model.dailyExpense)}</dd>
              </div>
              <div className={styles.comparisonCardRow}>
                <dt>เงินออม</dt>
                <dd>{formatCurrency(row.model.savings)}</dd>
              </div>
              <div className={styles.comparisonCardRow}>
                <dt>บัตรเครดิต</dt>
                <dd>{formatCurrency(row.model.creditCard)}</dd>
              </div>
              <div className={`${styles.comparisonCardRow} ${styles.comparisonCardNet}`}>
                <dt>สุทธิ</dt>
                <dd>{formatCurrency(row.model.netCashFlow)}</dd>
              </div>
            </dl>
          </div>
        ))}
      </div>
    </div>
  );
}
