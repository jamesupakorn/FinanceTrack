/**
 * คอมโพเนนต์: SummaryReport
 * แสดงสรุปรายรับ รายจ่าย เงินออม และกราฟภาพรวม
 * @param {object} props
 * @param {string} props.selectedMonth - เดือนที่เลือก (YYYY-MM)
 */

import React, { useState, useEffect } from 'react';
import { formatCurrency } from '../../shared/utils/frontend/numberUtils';
import { incomeAPI, expenseAPI, savingsAPI, taxAPI, salaryAPI } from '../../shared/utils/frontend/apiUtils';
import { getSummaryData, getChartData } from '../../shared/utils/frontend/summaryUtils';
import { formatMonthLabelTH } from '../../shared/utils/frontend/monthUtils';
import { useSession } from '../contexts/SessionContext';
import styles from '../styles/SummaryReport.module.css';

/**
 * รายงานสรุปภาพรวมการเงิน
 */
const SummaryReport = ({ selectedMonth }) => {
  const { currentUser } = useSession();

  const [summaryData, setSummaryData] = useState({
    ยอดรวมรายรับรายเดือน: 0,
    ยอดรวมค่าใช้จ่ายรายเดือน_ทั้งหมด: 0,
    ยอดรวมค่าใช้จ่ายรายเดือน_จ่ายจริง: 0,
    ยอดรวมเงินเก็บรายเดือน: 0,
    ภาษีสะสมตั้งแต่เดือนแรก: 0,
    ยอดเงินคงเหลือ_ประมาณการ: 0,
    ยอดเงินคงเหลือ_จริง: 0
  });

  const [chartData, setChartData] = useState({
    ประมาณการ: {
      รับ: 0,
      จ่าย: 0,
      เปอร์เซ็นต์รับ: 0,
      เปอร์เซ็นต์จ่าย: 0
    },
    จ่ายจริง: {
      รับ: 0,
      จ่าย: 0,
      เปอร์เซ็นต์รับ: 0,
      เปอร์เซ็นต์จ่าย: 0
    }
  });

  const [effectiveMonth, setEffectiveMonth] = useState(selectedMonth || '');

  const parseYearFromMonth = (monthKey) => {
    if (typeof monthKey !== 'string' || !/^\d{4}-\d{2}$/.test(monthKey)) {
      return new Date().getFullYear().toString();
    }
    return monthKey.split('-')[0];
  };

  const isSummaryEmpty = (summary) => {
    if (!summary) return true;
    return Number(summary.ยอดรวมรายรับรายเดือน || 0) === 0
      && Number(summary.ยอดรวมค่าใช้จ่ายรายเดือน_ทั้งหมด || 0) === 0
      && Number(summary.ยอดรวมค่าใช้จ่ายรายเดือน_จ่ายจริง || 0) === 0
      && Number(summary.ยอดรวมเงินเก็บรายเดือน || 0) === 0;
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
        const [incomeData, expenseData, savingsData, taxData, salaryData] = await Promise.all([
          incomeAPI.getByMonth(monthKey),
          expenseAPI.getByMonth(monthKey),
          savingsAPI.getByMonth(monthKey),
          taxAPI.getByYear(yearKey),
          salaryAPI.getByMonth(monthKey)
        ]);
        return getSummaryData({
          incomeData,
          expenseData,
          savingsData,
          taxData,
          salaryData,
          currentMonth: monthKey,
          currentYear: yearKey
        });
      };

      let summary = await loadByMonth(monthToUse, yearToUse);

      if (currentUser?.isDemo && isSummaryEmpty(summary)) {
        const fallbackMonth = await getLatestMonthWithData(currentMonth);
        if (fallbackMonth && fallbackMonth !== currentMonth) {
          monthToUse = fallbackMonth;
          yearToUse = parseYearFromMonth(monthToUse);
          summary = await loadByMonth(monthToUse, yearToUse);
        }
      }

      setEffectiveMonth(monthToUse);
      setSummaryData(summary);
      setChartData(getChartData({
        totalIncome: summary.ยอดรวมรายรับรายเดือน,
        totalExpenseAll: summary.ยอดรวมค่าใช้จ่ายรายเดือน_ทั้งหมด,
        totalExpenseActual: summary.ยอดรวมค่าใช้จ่ายรายเดือน_จ่ายจริง
      }));
    } catch (error) {
      console.error('Error loading summary data:', error);
    }
  };

  // Simple SVG Pie Chart Component
  const PieChart = ({ รับPercent, จ่ายPercent, title }) => {
    const radius = 80;
    const circumference = 2 * Math.PI * radius;
    const รับOffset = circumference - (รับPercent / 100) * circumference;
    
    return (
      <div className={styles.pieChartContainer}>
        <h4 className={styles.chartSubtitle}>{title}</h4>
        <svg width="200" height="200" viewBox="0 0 200 200">
          {/* Background circle */}
          <circle
            cx="100"
            cy="100"
            r={radius}
            fill="none"
            stroke="var(--border-color)"
            strokeWidth="40"
          />
          
          {/* รับ (Income) segment - ใช้สีจากธีม */}
          <circle
            cx="100"
            cy="100"
            r={radius}
            fill="none"
            stroke="var(--secondary-color)"
            strokeWidth="40"
            strokeDasharray={circumference}
            strokeDashoffset={รับOffset}
            transform="rotate(-90 100 100)"
            strokeLinecap="round"
          />
          
          {/* จ่าย (Expense) segment - ใช้สีจากธีม */}
          <circle
            cx="100"
            cy="100"
            r={radius}
            fill="none"
            stroke="var(--danger-color)"
            strokeWidth="40"
            strokeDasharray={circumference}
            strokeDashoffset={circumference - (จ่ายPercent / 100) * circumference}
            transform={`rotate(${(รับPercent / 100) * 360 - 90} 100 100)`}
            strokeLinecap="round"
          />
          
          {/* Center text */}
          <text x="100" y="85" textAnchor="middle" className={styles.chartLabel}>รับ-จ่าย</text>
          <text x="100" y="110" textAnchor="middle" className={styles.chartPercentage}>{รับPercent}%</text>
        </svg>
          <div className={styles.chartLegend}>
            <div
              className={styles.legendItem}
              tabIndex={0}
              aria-label={`รับ : ${รับPercent}%`}
            >
              <span className={`${styles.legendColor} ${styles.income}`}></span>
              <span>รับ : {รับPercent}%</span>
            </div>
            <div
              className={styles.legendItem}
              tabIndex={0}
              aria-label={`จ่าย : ${จ่ายPercent}%`}
            >
              <span className={`${styles.legendColor} ${styles.expense}`}></span>
              <span>จ่าย : {จ่ายPercent}%</span>
            </div>
          </div>
      </div>
    );
  };

  // Helper: format value for display
  const getDisplay = (value) => formatCurrency(value);

  return (
    <div className={styles.summaryReport}>
      <h2 className={styles.reportTitle}>งบประมาณ</h2>
      {currentUser?.isDemo && effectiveMonth && selectedMonth && effectiveMonth !== selectedMonth && (
        <p className={styles.reportHint}>
          บัญชีเดโม่ไม่มีข้อมูลเดือนที่เลือก จึงแสดงข้อมูลล่าสุดจาก {formatMonthLabelTH(effectiveMonth)}
        </p>
      )}
      <div className={styles.summaryContent}>
        {/* Pie Chart Section */}
        <div className={styles.chartsSection}>
          <h3 className={styles.chartTitle}>% ของรายรับที่ใช้</h3>
          <div className={styles.chartsGrid}>
            <PieChart 
              รับPercent={chartData.ประมาณการ.เปอร์เซ็นต์รับ}
              จ่ายPercent={chartData.ประมาณการ.เปอร์เซ็นต์จ่าย}
              title="ประมาณการ"
            />
            <PieChart 
              รับPercent={chartData.จ่ายจริง.เปอร์เซ็นต์รับ}
              จ่ายPercent={chartData.จ่ายจริง.เปอร์เซ็นต์จ่าย}
              title="จ่ายจริง"
            />
          </div>
        </div>

        {/* Summary Table Section */}
        <div className={styles.summaryTablesSection}>
          <h3 className={styles.tableTitle}>สรุป</h3>
          <div className={styles.tablesGrid}>
            {/* ตารางประมาณการ */}
            <div className={`${styles.summaryTable} ${styles.estimated}`}>
              <h4 className={styles.tableSubtitle}>ประมาณการ</h4>
              <div className={styles.summaryGrid}>
                <div
                  className={styles.summaryItem}
                  tabIndex={0}
                  aria-label={`ยอดรวมรายรับรายเดือน: ${getDisplay(summaryData.ยอดรวมรายรับรายเดือน)}`}
                >
                  <span className={styles.itemLabel}>ยอดรวมรายรับรายเดือน</span>
                  <span className={`${styles.itemValue} ${styles.income}`}>{getDisplay(summaryData.ยอดรวมรายรับรายเดือน)}</span>
                </div>
                <div
                  className={styles.summaryItem}
                  tabIndex={0}
                  aria-label={`ยอดรวมค่าใช้จ่ายรายเดือน ทั้งหมด: ${getDisplay(summaryData.ยอดรวมค่าใช้จ่ายรายเดือน_ทั้งหมด)}`}
                >
                  <span className={styles.itemLabel}>ยอดรวมค่าใช้จ่ายรายเดือน ทั้งหมด</span>
                  <span className={styles.itemValue}>{getDisplay(summaryData.ยอดรวมค่าใช้จ่ายรายเดือน_ทั้งหมด)}</span>
                </div>
                <div
                  className={styles.summaryItem}
                  tabIndex={0}
                  aria-label={`ยอดรวมเงินเก็บรายเดือน: ${getDisplay(summaryData.ยอดรวมเงินเก็บรายเดือน)}`}
                >
                  <span className={styles.itemLabel}>ยอดรวมเงินเก็บรายเดือน</span>
                  <span className={styles.itemValue}>{getDisplay(summaryData.ยอดรวมเงินเก็บรายเดือน)}</span>
                </div>
                <div
                  className={styles.summaryItem}
                  tabIndex={0}
                  aria-label={`ยอดเงินคงเหลือ ประมาณการ: ${getDisplay(summaryData.ยอดเงินคงเหลือ_ประมาณการ)}`}
                >
                  <span className={styles.itemLabel}>ยอดเงินคงเหลือ ประมาณการ</span>
                  <span className={`${styles.itemValue} ${styles.remaining}`}>{getDisplay(summaryData.ยอดเงินคงเหลือ_ประมาณการ)}</span>
                </div>
              </div>
            </div>
            {/* ตารางจ่ายจริง */}
            <div className={`${styles.summaryTable} ${styles.actual}`}>
              <h4 className={styles.tableSubtitle}>จ่ายจริง</h4>
              <div className={styles.summaryGrid}>
                <div
                  className={styles.summaryItem}
                  tabIndex={0}
                  aria-label={`ยอดรวมรายรับรายเดือน: ${getDisplay(summaryData.ยอดรวมรายรับรายเดือน)}`}
                >
                  <span className={styles.itemLabel}>ยอดรวมรายรับรายเดือน</span>
                  <span className={`${styles.itemValue} ${styles.income}`}>{getDisplay(summaryData.ยอดรวมรายรับรายเดือน)}</span>
                </div>
                <div
                  className={styles.summaryItem}
                  tabIndex={0}
                  aria-label={`ยอดรวมค่าใช้จ่ายรายเดือน จ่ายจริง: ${getDisplay(summaryData.ยอดรวมค่าใช้จ่ายรายเดือน_จ่ายจริง)}`}
                >
                  <span className={styles.itemLabel}>ยอดรวมค่าใช้จ่ายรายเดือน จ่ายจริง</span>
                  <span className={styles.itemValue}>{getDisplay(summaryData.ยอดรวมค่าใช้จ่ายรายเดือน_จ่ายจริง)}</span>
                </div>
                <div
                  className={styles.summaryItem}
                  tabIndex={0}
                  aria-label={`ยอดรวมเงินเก็บรายเดือน: ${getDisplay(summaryData.ยอดรวมเงินเก็บรายเดือน)}`}
                >
                  <span className={styles.itemLabel}>ยอดรวมเงินเก็บรายเดือน</span>
                  <span className={styles.itemValue}>{getDisplay(summaryData.ยอดรวมเงินเก็บรายเดือน)}</span>
                </div>
                <div
                  className={styles.summaryItem}
                  tabIndex={0}
                  aria-label={`ยอดเงินคงเหลือ จริง: ${getDisplay(summaryData.ยอดเงินคงเหลือ_จริง)}`}
                >
                  <span className={styles.itemLabel}>ยอดเงินคงเหลือ จริง</span>
                  <span className={`${styles.itemValue} ${styles.remaining}`}>{getDisplay(summaryData.ยอดเงินคงเหลือ_จริง)}</span>
                </div>
              </div>
            </div>
          </div>
          {/* ภาษีสะสม (แยกต่างหาก) */}
          <div className={styles.taxSummary}>
            <div
              className={`${styles.summaryItem} ${styles.taxSection}`}
              tabIndex={0}
              aria-label={`ภาษีสะสมตั้งแต่เดือนแรก: ${getDisplay(summaryData.ภาษีสะสมตั้งแต่เดือนแรก)}`}
            >
              <span className={styles.itemLabel}>ภาษีสะสมตั้งแต่เดือนแรก</span>
              <span className={`${styles.itemValue} ${styles.tax}`}>{getDisplay(summaryData.ภาษีสะสมตั้งแต่เดือนแรก)}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SummaryReport;