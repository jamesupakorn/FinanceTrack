import React, { useState, useEffect } from 'react';
import { formatCurrency, maskNumberFormat, parseToNumber } from '../../shared/utils/numberUtils';
import { incomeAPI, expenseAPI, savingsAPI, taxAPI, salaryAPI } from '../../shared/utils/apiUtils';
import styles from '../styles/SummaryReport.module.css';

const SummaryReport = ({ selectedMonth, mode = 'view' }) => {

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


  useEffect(() => {
    loadSummaryData();
  }, [selectedMonth]); // เพิ่ม selectedMonth เป็น dependency

  const loadSummaryData = async () => {
    try {
      const currentMonth = selectedMonth || new Date().toISOString().slice(0, 7); // ใช้ selectedMonth prop หรือเดือนปัจจุบัน
      const currentYear = new Date().getFullYear().toString();
      
      // ดึงข้อมูลจาก API
      const [incomeData, expenseData, savingsData, taxData, salaryData] = await Promise.all([
        incomeAPI.getByMonth(currentMonth),
        expenseAPI.getByMonth(currentMonth),
        savingsAPI.getByMonth(currentMonth),
        taxAPI.getByYear(currentYear), // เปลี่ยนเป็นดึงตามปี
        salaryAPI.getByMonth(currentMonth)
      ]);

      // ใช้ยอดรวมที่คำนวณแล้วจากแต่ละ API
      const totalIncome = parseFloat(incomeData.รวม || 0); // ยอดรวมจาก รายรับรายเดือน
  const totalExpenseAll = parseFloat(expenseData.totalEstimate || 0); // ยอดรวมจาก totalEstimate
  const totalExpenseActual = parseFloat(expenseData.totalActualPaid || 0); // ยอดรวมจาก totalActualPaid
      const totalSavings = parseFloat(savingsData.รวมเงินเก็บ || 0); // ยอดรวมจาก รวมเงินเก็บ
      
  // ดึงข้อมูลภาษีจากปีปัจจุบัน (ใช้ key accumulated_tax ให้ตรง backend)
  const taxAccumulated = parseFloat(taxData[currentYear]?.accumulated_tax || 0);
      
      // คำนวณยอดคงเหลือ
      const remainingRough = totalIncome - totalExpenseAll; // รายรับ - รวมประมาณ
      const remainingActual = totalIncome - totalExpenseActual; // รายรับ - จ่ายจริง

      setSummaryData({
        ยอดรวมรายรับรายเดือน: totalIncome,
        ยอดรวมค่าใช้จ่ายรายเดือน_ทั้งหมด: totalExpenseAll,
        ยอดรวมค่าใช้จ่ายรายเดือน_จ่ายจริง: totalExpenseActual,
        ยอดรวมเงินเก็บรายเดือน: totalSavings,
        ภาษีสะสมตั้งแต่เดือนแรก: taxAccumulated,
        ยอดเงินคงเหลือ_ประมาณการ: remainingRough,
        ยอดเงินคงเหลือ_จริง: remainingActual
      });

      // คำนวณเปอร์เซ็นต์สำหรับ pie chart ประมาณการ
      const totalEstimated = totalIncome + totalExpenseAll;
      const totalActual = totalIncome + totalExpenseActual;
      setChartData({
        ประมาณการ: {
          รับ: totalIncome,
          จ่าย: totalExpenseAll,
          เปอร์เซ็นต์รับ: totalEstimated > 0 ? Math.round((totalIncome / totalEstimated) * 100) : 0,
          เปอร์เซ็นต์จ่าย: totalEstimated > 0 ? Math.round((totalExpenseAll / totalEstimated) * 100) : 0
        },
        จ่ายจริง: {
          รับ: totalIncome,
          จ่าย: totalExpenseActual,
          เปอร์เซ็นต์รับ: totalActual > 0 ? Math.round((totalIncome / totalActual) * 100) : 0,
          เปอร์เซ็นต์จ่าย: totalActual > 0 ? Math.round((totalExpenseActual / totalActual) * 100) : 0
        }
      });
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
          <div className={styles.legendItem}>
            <span className={`${styles.legendColor} ${styles.income}`}></span>
            <span>รับ : {รับPercent}%</span>
          </div>
          <div className={styles.legendItem}>
            <span className={`${styles.legendColor} ${styles.expense}`}></span>
            <span>จ่าย : {จ่ายPercent}%</span>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className={styles.summaryReport}>
      <h2 className={styles.reportTitle}>งบประมาณ</h2>
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
                <div className={styles.summaryItem}>
                  <span className={styles.itemLabel}>ยอดรวมรายรับรายเดือน</span>
                  <span className={`${styles.itemValue} ${styles.income}`}>{mode === 'edit' ? formatCurrency(summaryData.ยอดรวมรายรับรายเดือน) : (() => { const val = parseToNumber(summaryData.ยอดรวมรายรับรายเดือน); const masked = maskNumberFormat(val); console.log('รายรับรายเดือน:', val, '=>', masked); return masked; })()}</span>
                </div>
                <div className={styles.summaryItem}>
                  <span className={styles.itemLabel}>ยอดรวมค่าใช้จ่ายรายเดือน ทั้งหมด</span>
                  <span className={styles.itemValue}>{mode === 'edit' ? formatCurrency(summaryData.ยอดรวมค่าใช้จ่ายรายเดือน_ทั้งหมด) : (() => { const val = parseToNumber(summaryData.ยอดรวมค่าใช้จ่ายรายเดือน_ทั้งหมด); const masked = maskNumberFormat(val); console.log('ค่าใช้จ่ายทั้งหมด:', val, '=>', masked); return masked; })()}</span>
                </div>
                <div className={styles.summaryItem}>
                  <span className={styles.itemLabel}>ยอดรวมเงินเก็บรายเดือน</span>
                  <span className={styles.itemValue}>{mode === 'edit' ? formatCurrency(summaryData.ยอดรวมเงินเก็บรายเดือน) : (() => { const val = parseToNumber(summaryData.ยอดรวมเงินเก็บรายเดือน); const masked = maskNumberFormat(val); console.log('เงินเก็บรายเดือน:', val, '=>', masked); return masked; })()}</span>
                </div>
                <div className={styles.summaryItem}>
                  <span className={styles.itemLabel}>ยอดเงินคงเหลือ ประมาณการ</span>
                  <span className={`${styles.itemValue} ${styles.remaining}`}>{mode === 'edit' ? formatCurrency(summaryData.ยอดเงินคงเหลือ_ประมาณการ) : (() => { const val = parseToNumber(summaryData.ยอดเงินคงเหลือ_ประมาณการ); const masked = maskNumberFormat(val); console.log('คงเหลือประมาณการ:', val, '=>', masked); return masked; })()}</span>
                </div>
              </div>
            </div>
            {/* ตารางจ่ายจริง */}
            <div className={`${styles.summaryTable} ${styles.actual}`}>
              <h4 className={styles.tableSubtitle}>จ่ายจริง</h4>
              <div className={styles.summaryGrid}>
                <div className={styles.summaryItem}>
                  <span className={styles.itemLabel}>ยอดรวมรายรับรายเดือน</span>
                  <span className={`${styles.itemValue} ${styles.income}`}>{mode === 'edit' ? formatCurrency(summaryData.ยอดรวมรายรับรายเดือน) : (() => { const val = parseToNumber(summaryData.ยอดรวมรายรับรายเดือน); const masked = maskNumberFormat(val); console.log('รายรับรายเดือน(จ่ายจริง):', val, '=>', masked); return masked; })()}</span>
                </div>
                <div className={styles.summaryItem}>
                  <span className={styles.itemLabel}>ยอดรวมค่าใช้จ่ายรายเดือน จ่ายจริง</span>
                  <span className={styles.itemValue}>{mode === 'edit' ? formatCurrency(summaryData.ยอดรวมค่าใช้จ่ายรายเดือน_จ่ายจริง) : (() => { const val = parseToNumber(summaryData.ยอดรวมค่าใช้จ่ายรายเดือน_จ่ายจริง); const masked = maskNumberFormat(val); console.log('ค่าใช้จ่ายจ่ายจริง:', val, '=>', masked); return masked; })()}</span>
                </div>
                <div className={styles.summaryItem}>
                  <span className={styles.itemLabel}>ยอดรวมเงินเก็บรายเดือน</span>
                  <span className={styles.itemValue}>{mode === 'edit' ? formatCurrency(summaryData.ยอดรวมเงินเก็บรายเดือน) : (() => { const val = parseToNumber(summaryData.ยอดรวมเงินเก็บรายเดือน); const masked = maskNumberFormat(val); console.log('เงินเก็บรายเดือน(จ่ายจริง):', val, '=>', masked); return masked; })()}</span>
                </div>
                <div className={styles.summaryItem}>
                  <span className={styles.itemLabel}>ยอดเงินคงเหลือ จริง</span>
                  <span className={`${styles.itemValue} ${styles.remaining}`}>{mode === 'edit' ? formatCurrency(summaryData.ยอดเงินคงเหลือ_จริง) : (() => { const val = parseToNumber(summaryData.ยอดเงินคงเหลือ_จริง); const masked = maskNumberFormat(val); console.log('คงเหลือจริง:', val, '=>', masked); return masked; })()}</span>
                </div>
              </div>
            </div>
          </div>
          {/* ภาษีสะสม (แยกต่างหาก) */}
          <div className={styles.taxSummary}>
            <div className={`${styles.summaryItem} ${styles.taxSection}`}>
              <span className={styles.itemLabel}>ภาษีสะสมตั้งแต่เดือนแรก</span>
              <span className={`${styles.itemValue} ${styles.tax}`}>{mode === 'edit' ? formatCurrency(summaryData.ภาษีสะสมตั้งแต่เดือนแรก) : (() => { const val = parseToNumber(summaryData.ภาษีสะสมตั้งแต่เดือนแรก); const masked = maskNumberFormat(val); console.log('ภาษีสะสม:', val, '=>', masked); return masked; })()}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SummaryReport;