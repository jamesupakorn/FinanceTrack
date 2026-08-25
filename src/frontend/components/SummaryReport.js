/**
 * คอมโพเนนต์: SummaryReport
 * แสดงสรุปรายรับ รายจ่าย เงินออม และโครงสร้างกระแสเงินสด (CashFlowRing) ของเดือนที่เลือก
 * ตัวเลขทั้งหมดมาจาก getMonthlySummaryModel() เดียวกับ Dashboard/MonthComparison (BR-DASH-005) —
 * ปิดข้อยกเว้นสุดท้ายของ BR-DASH-005 (Amendment A2) หลังจากที่ก่อนหน้านี้ไฟล์นี้ยังมี pipeline คำนวณยอด
 * แยกเป็นของตัวเอง (ดูรายละเอียดใน spec-reports-settings.md §Amendment A2)
 * @param {object} props
 * @param {string} props.selectedMonth - เดือนที่เลือก (YYYY-MM)
 * @param {number} [props.allocatableAmount] - ยอดที่ควรเก็บต่อเดือน (ยังไม่มีผู้เรียกส่งค่านี้จริง — D-4)
 */

import React, { useState, useEffect } from 'react';
import { round2 } from '../../shared/utils/creditCardUtils';
import { formatCurrency } from '../../shared/utils/frontend/numberUtils';
import { incomeAPI, expenseAPI, savingsAPI, taxAPI, salaryAPI, savingsGoalsAPI, dailyExpenseAPI } from '../../shared/utils/frontend/apiUtils';
import { getMonthlySummaryModel } from '../../shared/utils/frontend/monthlySummary';
import { formatMonthLabelTH } from '../../shared/utils/frontend/monthUtils';
import { useSession } from '../contexts/SessionContext';
import CashFlowRing from './CashFlowRing';
import styles from '../styles/SummaryReport.module.css';

/**
 * รายงานสรุปภาพรวมการเงิน
 */
const SummaryReport = ({ selectedMonth, allocatableAmount }) => {
  const { currentUser } = useSession();

  // null = ยังไม่มีข้อมูล/กำลังโหลด/ทุก request ล้มเหลว (E25) — ห้ามตั้งเป็นก้อนศูนย์ เพราะ
  // CashFlowRing's !model guard (CashFlowRing.js:36) เขียนมาให้รองรับ null โดยเฉพาะ
  const [model, setModel] = useState(null);

  const [totalGoalsTarget, setTotalGoalsTarget] = useState(0);

  const [effectiveMonth, setEffectiveMonth] = useState(selectedMonth || '');

  const parseYearFromMonth = (monthKey) => {
    if (typeof monthKey !== 'string' || !/^\d{4}-\d{2}$/.test(monthKey)) {
      return new Date().getFullYear().toString();
    }
    return monthKey.split('-')[0];
  };

  // ทดสอบเดือนว่างแบบเดิม (4 เงื่อนไข) ยุบเหลือ 3 — เงื่อนไขที่ 4 เดิม (_ทั้งหมด) เป็นค่าซ้ำของ
  // _จ่ายจริง อยู่แล้ว (summaryUtils.js:32-33) จึงหายไปเองเมื่อย้ายมาที่ model
  const isSummaryEmpty = (m) => {
    if (!m) return true;
    return Number(m.totalIncome || 0) === 0
      && Number((m.generalExpense || 0) + (m.creditCard || 0)) === 0
      && Number(m.savings || 0) === 0;
  };

  const getLatestMonthWithData = async (currentMonth) => {
    const [incomeAll, expenseAll, savingsAll, salaryAll] = await Promise.all([
      incomeAPI.getAll(),
      expenseAPI.getAll(),
      savingsAPI.getAll(),
      salaryAPI.getAll()
    ]);

    const monthRegex = /^\d{4}-\d{2}$/;
    const monthSet = new Set([
      ...Object.keys(incomeAll?.months || {}),
      ...Object.keys(expenseAll?.months || {}),
      ...Object.keys(savingsAll?.months || {}),
      ...Object.keys(salaryAll?.months || {})
    ].filter(month => monthRegex.test(month)));

    const months = Array.from(monthSet).sort((a, b) => b.localeCompare(a));
    if (!months.length) return null;
    if (months.includes(currentMonth)) return currentMonth;
    return months[0];
  };


  useEffect(() => {
    loadSummaryData();
  }, [selectedMonth, currentUser?.id]); // เพิ่ม selectedMonth เป็น dependency

  const loadSummaryData = async () => {
    try {
      const currentMonth = selectedMonth || new Date().toISOString().slice(0, 7); // ใช้ selectedMonth prop หรือเดือนปัจจุบัน
      let monthToUse = currentMonth;
      let yearToUse = parseYearFromMonth(monthToUse);

      const loadByMonth = async (monthKey, yearKey) => {
        // dailyExpenseAPI อยู่ในนี้ (ไม่ใช่นอก loadByMonth) เพื่อให้ fallback เดโม่ด้านล่างยิงซ้ำให้เดือน
        // สำรองด้วย ไม่ใช่ค้างอยู่ที่เดือนว่างเดือนแรก (AC-RS-44)
        const [incomeData, expenseData, savingsData, taxData, salaryData, dailyExpenseData] = await Promise.all([
          incomeAPI.getByMonth(monthKey),
          expenseAPI.getByMonth(monthKey),
          savingsAPI.getByMonth(monthKey),
          taxAPI.getByYear(yearKey),
          salaryAPI.getByMonth(monthKey),
          dailyExpenseAPI.getByMonth(monthKey).catch(() => ({ totalMonthly: 0 }))
        ]);
        return getMonthlySummaryModel({
          month: monthKey,
          incomeData,
          expenseData,
          savingsData,
          dailyExpenseData,
          salaryData,
          taxData
        });
      };

      let currentModel = await loadByMonth(monthToUse, yearToUse);

      if (currentUser?.isDemo && isSummaryEmpty(currentModel)) {
        const fallbackMonth = await getLatestMonthWithData(currentMonth);
        if (fallbackMonth && fallbackMonth !== currentMonth) {
          monthToUse = fallbackMonth;
          yearToUse = parseYearFromMonth(monthToUse);
          currentModel = await loadByMonth(monthToUse, yearToUse);
        }
      }

      setEffectiveMonth(monthToUse);
      setModel(currentModel);
      // Fetch active goals total after the model is already rendered (truly non-blocking)
      savingsGoalsAPI.getAll()
        .then(goalsRes => {
          const activeGoals = (goalsRes?.goals || [])
            .filter(g => g.status !== 'completed' && g.status !== 'abandoned');
          setTotalGoalsTarget(activeGoals.reduce((sum, g) => sum + (parseFloat(g.targetAmount) || 0), 0));
        })
        .catch(() => { /* non-blocking; leave previous value */ });
    } catch (error) {
      console.error('Error loading summary data:', error);
    }
  };

  // Helper: format value for display
  const getDisplay = (value) => formatCurrency(value);

  // ยอดเงินคงเหลือ คงสูตรเดิม (income − (general + creditCard)) เจตนา — ไม่ใช่ model.netCashFlow
  // ซึ่งหักรายจ่ายประจำวัน/เงินออมด้วย เป็นคนละยอดกัน (AC-RS-42/BR-DASH-004) เหมือนกับที่
  // pages/reports.js:151-152 (PDF path) ทำอยู่แล้ว
  const remainingBalance = round2(
    (model?.totalIncome || 0) - round2((model?.generalExpense || 0) + (model?.creditCard || 0))
  );

  return (
    <div className={styles.summaryReport}>
      <h2 className={styles.reportTitle}>งบประมาณ</h2>
      {currentUser?.isDemo && effectiveMonth && selectedMonth && effectiveMonth !== selectedMonth && (
        <p className={styles.reportHint}>
          บัญชีเดโม่ไม่มีข้อมูลเดือนที่เลือก จึงแสดงข้อมูลล่าสุดจาก {formatMonthLabelTH(effectiveMonth)}
        </p>
      )}
      <div className={styles.summaryContent}>
        {/* โครงสร้างกระแสเงินสด — CashFlowRing ตัวเดียวกับ Dashboard ในโหมดแสดงผลอย่างเดียว (Amendment A2) */}
        <div className={styles.chartsSection}>
          <CashFlowRing
            model={model}
            interactive={false}
            monthLabel={formatMonthLabelTH(effectiveMonth)}
          />
        </div>

        {/* Summary Table Section */}
        <div className={styles.summaryTablesSection}>
          <h3 className={styles.tableTitle}>สรุป</h3>
          <div className={styles.tablesGrid}>
            <div className={`${styles.summaryTable} ${styles.actual}`}>
              <h4 className={styles.tableSubtitle}>สรุปรายเดือน</h4>
              <div className={styles.summaryGrid}>
                <div
                  className={styles.summaryItem}
                  tabIndex={0}
                  aria-label={`ยอดรวมรายรับรายเดือน: ${getDisplay(model?.totalIncome || 0)}`}
                >
                  <span className={styles.itemLabel}>ยอดรวมรายรับรายเดือน</span>
                  <span className={`${styles.itemValue} ${styles.income}`}>{getDisplay(model?.totalIncome || 0)}</span>
                </div>
                <div
                  className={styles.summaryItem}
                  tabIndex={0}
                  aria-label={`รายจ่ายทั่วไป: ${getDisplay(model?.generalExpense || 0)}`}
                >
                  <span className={styles.itemLabel}>รายจ่ายทั่วไป</span>
                  <span className={styles.itemValue}>{getDisplay(model?.generalExpense || 0)}</span>
                </div>
                <div
                  className={styles.summaryItem}
                  tabIndex={0}
                  aria-label={`บัตรเครดิต: ${getDisplay(model?.creditCard || 0)}`}
                >
                  <span className={styles.itemLabel}>บัตรเครดิต</span>
                  <span className={styles.itemValue}>{getDisplay(model?.creditCard || 0)}</span>
                </div>
                <div
                  className={styles.summaryItem}
                  tabIndex={0}
                  aria-label={`ยอดค้างชำระ: ${getDisplay(model?.unpaid?.total || 0)}`}
                >
                  <span className={styles.itemLabel}>ยอดค้างชำระ</span>
                  <span className={styles.itemValue}>{getDisplay(model?.unpaid?.total || 0)}</span>
                </div>
                <div
                  className={styles.summaryItem}
                  tabIndex={0}
                  aria-label={`ยอดรวมเงินเก็บรายเดือน: ${getDisplay(model?.savings || 0)}`}
                >
                  <span className={styles.itemLabel}>ยอดรวมเงินเก็บรายเดือน</span>
                  <span className={styles.itemValue}>{getDisplay(model?.savings || 0)}</span>
                </div>
                <div
                  className={styles.summaryItem}
                  tabIndex={0}
                  aria-label={`ควรเก็บต่อเดือน: ${getDisplay(allocatableAmount ?? 0)}`}
                >
                  <span className={styles.itemLabel}>ควรเก็บต่อเดือน</span>
                  <span className={`${styles.itemValue} ${styles.income}`}>{getDisplay(allocatableAmount ?? 0)}</span>
                </div>
                <div
                  className={styles.summaryItem}
                  tabIndex={0}
                  aria-label={`รวมเป้าหมายเงินออม: ${getDisplay(totalGoalsTarget)}`}
                >
                  <span className={styles.itemLabel}>รวมเป้าหมายเงินออม</span>
                  <span className={`${styles.itemValue} ${styles.goalTarget}`}>{getDisplay(totalGoalsTarget)}</span>
                </div>
                <div
                  className={styles.summaryItem}
                  tabIndex={0}
                  aria-label={`ยอดเงินคงเหลือ: ${getDisplay(remainingBalance)}`}
                >
                  <span className={styles.itemLabel}>ยอดเงินคงเหลือ</span>
                  <span className={`${styles.itemValue} ${styles.remaining}`}>{getDisplay(remainingBalance)}</span>
                </div>
                <div
                  className={`${styles.summaryItem} ${styles.taxSection}`}
                  tabIndex={0}
                  aria-label={`ภาษีสะสมตั้งแต่เดือนแรก: ${getDisplay(model?.taxAccumulated || 0)}`}
                >
                  <span className={styles.itemLabel}>ภาษีสะสมตั้งแต่เดือนแรก</span>
                  <span className={`${styles.itemValue} ${styles.tax}`}>{getDisplay(model?.taxAccumulated || 0)}</span>
                </div>
              </div>
              {/* ป้ายอธิบายศัพท์ (AC-RS-43) — ตรงกลางวงแหวนกับแถวยอดเงินคงเหลือคือคนละยอด เจตนา ไม่ใช่ข้อผิดพลาด */}
              <p className={styles.summaryHint}>
                กระแสเงินสดสุทธิ (ตรงกลางวงแหวน) = รายรับ − รายจ่ายทั่วไป − รายจ่ายประจำวัน − เงินออม − บัตรเครดิต
                {' · '}
                ยอดเงินคงเหลือ = รายรับ − รายจ่ายทั่วไป − บัตรเครดิต (ยังไม่หักรายจ่ายประจำวันและเงินออม)
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SummaryReport;
