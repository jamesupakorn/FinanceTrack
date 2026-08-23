/**
 * หน้า: /reports — P4 · reports-settings
 * บ้านใหม่ของ SalaryCalculator + SummaryReport (ย้ายมาจาก /workspace แบบไม่แก้ทั้งคู่ — AC-RS-17)
 * บวกของใหม่ชิ้นเดียวของเฟสนี้: MonthComparison และปุ่ม Download Report PDF (ย้ายมาจาก workspace.js
 * พร้อม buildMonthlyReportPayload ที่สลับไปใช้ getMonthlySummaryModel — ปิด known inconsistency เดิม
 * ของ ADR-013, AC-RS-27/29)
 *
 * 3 ส่วนเนื้อหาเป็น collapsible ทั้งหมด (UX Review, AC-RS-30): สรุปรายเดือน default เปิด (ตัวเลขที่ผู้ใช้
 * มาเช็คหน้านี้), คำนวณเงินเดือน/เปรียบเทียบรายเดือน default พับ — กันไม่ให้ 4 ส่วนน้ำหนักเท่ากันกลาย
 * เป็นความรกที่ /workspace เพิ่งเอาออกไป ใช้แพทเทิร์น header+chevron+aria-expanded เดียวกับที่ /workspace
 * (เดิม) และ BudgetHealthPanel ใช้อยู่แล้ว ไม่ได้คิดใหม่
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Layout from '../src/frontend/components/Layout';
import SalaryCalculator from '../src/frontend/components/SalaryCalculator';
import SummaryReport from '../src/frontend/components/SummaryReport';
import MonthComparison from '../src/frontend/components/MonthComparison';
import { Icons } from '../src/frontend/components/Icons';
import { useSession } from '../src/frontend/contexts/SessionContext';
import { showToast } from '../src/shared/utils/frontend/toast';
import {
  incomeAPI, expenseAPI, savingsAPI, salaryAPI, taxAPI, investmentAPI, dailyExpenseAPI
} from '../src/shared/utils/frontend/apiUtils';
import { getMonthlySummaryModel } from '../src/shared/utils/frontend/monthlySummary';
import { getChartData } from '../src/shared/utils/frontend/summaryUtils';
import { round2, getCurrentMonthKey, addMonths } from '../src/shared/utils/creditCardUtils';
import { formatMonthLabelTH } from '../src/shared/utils/frontend/monthUtils';
import { downloadSummaryReportPdf } from '../src/shared/utils/frontend/reportPdf';
import styles from '../src/frontend/styles/Reports.module.css';

const SELECTED_MONTH_KEY = 'edit_selected_month'; // คีย์เดียวกับ /workspace และ Dashboard (ADR-012)
const MONTH_RE = /^\d{4}-\d{2}$/;
const DEFAULT_INCOME_LABELS = {
  salary: 'เงินเดือน',
  income2: 'แหล่งรายรับ 2',
  other: 'อื่นๆ'
};

const toNumericValue = (value) => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') {
    const numeric = Number(value.replace(/,/g, '').trim());
    return Number.isFinite(numeric) ? numeric : 0;
  }
  return 0;
};

const isNumericLike = (value) => {
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed.length) return false;
    return Number.isFinite(Number(trimmed.replace(/,/g, '')));
  }
  return false;
};

const buildIncomeDetailRows = (incomeData) => {
  const labels = incomeData?.__labels && typeof incomeData.__labels === 'object' ? incomeData.__labels : {};
  const ignoredFields = new Set(['month', '_id', 'รวม', '__labels', 'userId']);
  return Object.entries(incomeData || {})
    .filter(([key, value]) => !ignoredFields.has(key) && isNumericLike(value))
    .map(([key, value]) => ({
      item: (typeof labels[key] === 'string' && labels[key].trim()) ? labels[key].trim() : (DEFAULT_INCOME_LABELS[key] || key),
      amount: toNumericValue(value)
    }));
};

const buildExpenseDetailRows = (expenseData) => {
  const ignoredFields = new Set(['totalActualPaid', 'accountSummary', 'month', '_id', 'userId']);
  return Object.entries(expenseData || {})
    .filter(([key, value]) => {
      if (ignoredFields.has(key)) return false;
      if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
      return 'actual' in value || 'name' in value;
    })
    .map(([key, value]) => ({
      item: (typeof value.name === 'string' && value.name.trim()) ? value.name.trim() : key,
      actual: toNumericValue(value.actual),
      paid: value.paid === true || value.paid === 'true' ? 'ชำระแล้ว' : 'ยังไม่ชำระ'
    }));
};

const buildSavingsDetailRows = (savingsData) => {
  const savingsList = Array.isArray(savingsData?.savings_list) ? savingsData.savings_list : [];
  return savingsList.map((item, index) => ({
    item: item?.savings_type || item?.รายการ || `รายการที่ ${index + 1}`,
    amount: toNumericValue(item?.savings_amount ?? item?.จำนวนเงิน ?? 0)
  }));
};

const parseYearFromMonth = (monthKey) => {
  if (typeof monthKey !== 'string' || !/^\d{4}-\d{2}$/.test(monthKey)) {
    return String(new Date().getFullYear());
  }
  return monthKey.split('-')[0];
};

const getMonthLabel = (monthKey) => {
  try {
    return formatMonthLabelTH(monthKey);
  } catch (error) {
    return monthKey;
  }
};

/**
 * ย้ายมาจาก workspace.js (เดิม edit.js) พร้อมสลับ source ยอดเงินจาก getSummaryData (scalar ก้อนเดียว
 * totalActualPaid) มาเป็น getMonthlySummaryModel (แยกรายจ่ายทั่วไป/บัตรเครดิตแล้ว — ปิด known
 * inconsistency ของ ADR-013 ตาม §Known inconsistency closed here ของสเปค)
 *
 * เพิ่มการดึงยอดรายวัน 1 ครั้ง (เดือนที่เลือกเท่านั้น ไม่ใช่ N เดือนแบบ MonthComparison) — ของเดิมไม่เคย
 * ดึงเลย ทำให้ getMonthlySummaryModel เห็น dailyExpenseData เป็น undefined แล้วพิมพ์ 0 เงียบ ๆ ทุกครั้ง
 * (escalation finding OQ-RS-C / AC-RS-29)
 */
const buildMonthlyReportPayload = async (monthKey, taxByYearCache) => {
  const currentYear = parseYearFromMonth(monthKey);
  let taxData = taxByYearCache.get(currentYear);

  if (!taxData) {
    try {
      taxData = await taxAPI.getByYear(currentYear);
    } catch (error) {
      taxData = {};
    }
    taxByYearCache.set(currentYear, taxData);
  }

  const [incomeData, expenseData, savingsData, salaryData, dailyExpenseData] = await Promise.all([
    incomeAPI.getByMonth(monthKey).catch(() => ({})),
    expenseAPI.getByMonth(monthKey).catch(() => ({})),
    savingsAPI.getByMonth(monthKey).catch(() => ({})),
    salaryAPI.getByMonth(monthKey).catch(() => ({})),
    dailyExpenseAPI.getByMonth(monthKey).catch(() => ({ totalMonthly: 0 }))
  ]);

  const model = getMonthlySummaryModel({
    month: monthKey,
    incomeData,
    expenseData,
    savingsData,
    dailyExpenseData,
    salaryData,
    taxData
  });

  // ยอดเงินคงเหลือยังคำนวณจากผลรวม (ทั่วไป+บัตรเครดิต) เดียวกับตัวเลขก้อนเดียวเดิมทุกประการ — ไม่รวม
  // เงินออม/รายวันเข้ามาด้วย เพื่อให้ตัวเลขนี้เหมือนเดิมไม่เปลี่ยน (AC-RS-24 — มีแค่บรรทัดรายจ่ายเท่านั้น
  // ที่ตั้งใจเปลี่ยนตาม AC-RS-27)
  const totalExpenseActual = round2(model.generalExpense + model.creditCard);
  const remaining = round2(model.totalIncome - totalExpenseActual);

  const summaryData = {
    ยอดรวมรายรับรายเดือน: model.totalIncome,
    ยอดรวมค่าใช้จ่ายรายเดือน_ทั่วไป: model.generalExpense,
    ยอดรวมค่าใช้จ่ายรายเดือน_บัตรเครดิต: model.creditCard,
    ยอดรวมค่าใช้จ่ายรายเดือน_รายวัน: model.dailyExpense,
    ยอดรวมค่าใช้จ่ายรายเดือน_ยังไม่ชำระ: model.unpaid.total,
    ยอดรวมเงินเก็บรายเดือน: model.savings,
    ภาษีสะสมตั้งแต่เดือนแรก: model.taxAccumulated,
    ยอดเงินคงเหลือ: remaining
  };

  const chartData = getChartData({
    totalIncome: model.totalIncome,
    totalExpenseActual
  });

  return {
    reportMonth: monthKey,
    monthLabel: getMonthLabel(monthKey),
    summaryData,
    chartData,
    details: {
      incomeRows: buildIncomeDetailRows(incomeData),
      expenseRows: buildExpenseDetailRows(expenseData),
      savingsRows: buildSavingsDetailRows(savingsData)
    }
  };
};

/** ส่วนพับเก็บได้ — ใช้ซ้ำ 3 ครั้งในหน้านี้ (สรุปรายเดือน/คำนวณเงินเดือน/เปรียบเทียบรายเดือน — AC-RS-30) */
function CollapsibleSection({ id, title, defaultExpanded, children }) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  return (
    <section className={styles.panelCard}>
      <button
        type="button"
        className={styles.collapsibleHeader}
        onClick={() => setExpanded((prev) => !prev)}
        aria-expanded={expanded}
        aria-controls={id}
      >
        <span className={styles.collapsibleTitle}>{title}</span>
        <span className={`${styles.collapsibleChevron} ${expanded ? styles.collapsibleChevronOpen : ''}`}>
          <Icons.ChevronDown size={18} />
        </span>
      </button>
      {expanded && <div id={id} className={styles.panelBody}>{children}</div>}
    </section>
  );
}

export default function ReportsPage() {
  const { currentUser } = useSession();
  const selectedMonthKey = useMemo(
    () => (currentUser ? `${SELECTED_MONTH_KEY}_${currentUser.id}` : SELECTED_MONTH_KEY),
    [currentUser?.id]
  );

  const [selectedMonth, setSelectedMonth] = useState(null);
  const [months, setMonths] = useState([]);
  const [salaryTriggerSave, setSalaryTriggerSave] = useState(0);
  const [summaryRefreshKey, setSummaryRefreshKey] = useState(0);
  const [isDownloadingReport, setIsDownloadingReport] = useState(false);
  const [reportMonthModalOpen, setReportMonthModalOpen] = useState(false);
  const [selectedReportMonths, setSelectedReportMonths] = useState([]);

  // เลือกเดือนเริ่มต้น — ใช้ localStorage คีย์เดียวกับ /workspace และ Dashboard เสมอ
  useEffect(() => {
    if (!currentUser) return;
    const stored = typeof window !== 'undefined' ? localStorage.getItem(selectedMonthKey) : null;
    setSelectedMonth(stored && MONTH_RE.test(stored) ? stored : getCurrentMonthKey());
  }, [currentUser?.id, selectedMonthKey]);

  useEffect(() => {
    if (!currentUser || !selectedMonth || typeof window === 'undefined') return;
    localStorage.setItem(selectedMonthKey, selectedMonth);
  }, [currentUser, selectedMonth, selectedMonthKey]);

  const handleNavigateMonth = useCallback((delta) => {
    setSelectedMonth((prev) => addMonths(prev, delta));
  }, []);

  // เดือนทั้งหมดที่มีข้อมูลจริง — ใช้กับตัวเลือกเดือนใน modal ดาวน์โหลด PDF เท่านั้น (ย้ายมาจาก workspace.js)
  useEffect(() => {
    if (!currentUser) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const [expenseRes, incomeRes, savingsRes, salaryRes, investmentRes] = await Promise.all([
          expenseAPI.getAll(),
          incomeAPI.getAll(),
          savingsAPI.getAll(),
          salaryAPI.getAll(),
          investmentAPI.getAll()
        ]);
        const expenseMonths = expenseRes?.months ? Object.keys(expenseRes.months) : [];
        const incomeMonths = incomeRes?.months ? Object.keys(incomeRes.months) : [];
        const savingsMonths = savingsRes?.months ? Object.keys(savingsRes.months) : [];
        const salaryMonths = salaryRes?.months ? Object.keys(salaryRes.months) : [];
        const investmentMonths = investmentRes && typeof investmentRes === 'object'
          ? Object.keys(investmentRes).filter((key) => key !== 'months')
          : [];
        const currentMonth = getCurrentMonthKey();
        const allMonths = Array.from(new Set([
          ...expenseMonths, ...incomeMonths, ...savingsMonths, ...salaryMonths, ...investmentMonths
        ])).sort().reverse();
        if (!cancelled) setMonths(allMonths.length ? allMonths : [currentMonth]);
      } catch (err) {
        if (!cancelled) setMonths([getCurrentMonthKey()]);
      }
    })();
    return () => { cancelled = true; };
  }, [currentUser?.id]);

  useEffect(() => {
    setSelectedReportMonths((previous) => {
      const validMonths = previous.filter((month) => months.includes(month));
      if (validMonths.length > 0) return validMonths;
      if (selectedMonth && months.includes(selectedMonth)) return [selectedMonth];
      if (months.length > 0) return [months[0]];
      return [];
    });
  }, [months, selectedMonth]);

  const orderedSelectedReportMonths = useMemo(
    () => months.filter((month) => selectedReportMonths.includes(month)),
    [months, selectedReportMonths]
  );

  const reportMonthLabel = useMemo(() => {
    if (orderedSelectedReportMonths.length === 0) return 'ยังไม่ได้เลือกเดือน';
    if (orderedSelectedReportMonths.length === 1) return getMonthLabel(orderedSelectedReportMonths[0]);
    return `${orderedSelectedReportMonths.length} เดือน`;
  }, [orderedSelectedReportMonths]);

  const toggleReportMonthSelection = (month) => {
    setSelectedReportMonths((previous) => (
      previous.includes(month) ? previous.filter((value) => value !== month) : [...previous, month]
    ));
  };

  const handleSelectAllReportMonths = () => setSelectedReportMonths([...months]);
  const handleClearReportMonths = () => setSelectedReportMonths([]);

  const handleOpenReportMonthModal = () => {
    if (isDownloadingReport) return;
    setReportMonthModalOpen(true);
  };

  const handleDownloadReport = async () => {
    if (isDownloadingReport) {
      showToast('กำลังเตรียมข้อมูลรายงาน กรุณาลองอีกครั้ง', 'info');
      return;
    }
    const targetMonths = orderedSelectedReportMonths;
    if (!targetMonths.length) {
      showToast('ไม่พบเดือนที่ใช้สร้างรายงาน กรุณาเลือกเดือนก่อนดาวน์โหลด', 'error');
      return;
    }
    setReportMonthModalOpen(false);
    setIsDownloadingReport(true);
    try {
      const taxByYearCache = new Map();
      const reportItems = await Promise.all(
        targetMonths.map((monthKey) => buildMonthlyReportPayload(monthKey, taxByYearCache))
      );
      await downloadSummaryReportPdf({ reportItems });
    } catch (error) {
      console.error('Error downloading report PDF:', error);
      showToast('ไม่สามารถดาวน์โหลดรายงาน PDF ได้ กรุณาลองใหม่', 'error');
    } finally {
      setIsDownloadingReport(false);
    }
  };

  useEffect(() => {
    if (!reportMonthModalOpen) return undefined;
    const handleEsc = (event) => { if (event.key === 'Escape') setReportMonthModalOpen(false); };
    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, [reportMonthModalOpen]);

  // "บันทึกเงินเดือน" — bump ตัวนับเดียวกับ triggerSave pattern เดิม (ADR-003) SalaryCalculator เองเป็นคน
  // เรียก salaryAPI.save + showToast('บันทึกข้อมูลเงินเดือนเรียบร้อย') อยู่แล้วภายในตัวมันเอง (AC-RS-18)
  const handleSaveSalaryClick = () => setSalaryTriggerSave((prev) => prev + 1);

  // หลังบันทึกเงินเดือนแล้ว บังคับ SummaryReport รีเฟรชตัวเอง (มันไม่มี prop อื่นให้สั่งรีเฟรชนอกจาก
  // mount ใหม่ — ไฟล์ห้ามแก้ตาม AC-RS-17) เปลี่ยน key จึง remount แล้ว useEffect เดิมของมันยิง fetch ใหม่เอง
  const handleSalaryUpdate = () => setSummaryRefreshKey((prev) => prev + 1);

  const monthLabel = selectedMonth ? getMonthLabel(selectedMonth) : '';

  const headerActions = (
    <button
      type="button"
      className={styles.reportDownloadButton}
      onClick={handleOpenReportMonthModal}
      disabled={isDownloadingReport || months.length === 0}
    >
      <Icons.Save size={16} />
      {isDownloadingReport ? 'กำลังสร้าง PDF...' : 'Download Report PDF'}
    </button>
  );

  return (
    <Layout activeNav="reports" title="รายงาน" headerActions={headerActions}>
      <div className={styles.reportsWrap}>
        <div className={styles.monthNavGroup}>
          <button type="button" className={styles.monthNavButton} onClick={() => handleNavigateMonth(-1)} aria-label="เดือนก่อนหน้า">
            <Icons.ChevronLeft size={18} />
          </button>
          <span className={styles.monthNavLabel}>{monthLabel}</span>
          <button type="button" className={styles.monthNavButton} onClick={() => handleNavigateMonth(1)} aria-label="เดือนถัดไป">
            <Icons.ChevronRight size={18} />
          </button>
        </div>

        <CollapsibleSection id="reports-summary" title="สรุปรายเดือน" defaultExpanded>
          <SummaryReport key={`summary-${summaryRefreshKey}`} selectedMonth={selectedMonth} />
        </CollapsibleSection>

        <CollapsibleSection id="reports-salary" title="คำนวณเงินเดือน" defaultExpanded={false}>
          <div className={styles.salaryActionsRow}>
            <button type="button" className={styles.salarySaveButton} onClick={handleSaveSalaryClick}>
              <Icons.Save size={14} />
              บันทึกเงินเดือน
            </button>
          </div>
          <SalaryCalculator
            selectedMonth={selectedMonth}
            triggerSave={salaryTriggerSave}
            onSalaryUpdate={handleSalaryUpdate}
          />
        </CollapsibleSection>

        <CollapsibleSection id="reports-comparison" title="เปรียบเทียบรายเดือน (6 เดือนล่าสุด)" defaultExpanded={false}>
          <MonthComparison />
        </CollapsibleSection>
      </div>

      {reportMonthModalOpen && (
        <div className={styles.reportMonthModalBackdrop} role="presentation" onClick={() => setReportMonthModalOpen(false)}>
          <div
            className={styles.reportMonthModal}
            role="dialog"
            aria-modal="true"
            aria-label="เลือกเดือนในรายงาน"
            onClick={(event) => event.stopPropagation()}
          >
            <div className={styles.reportMonthModalHeader}>
              <h3 className={styles.reportMonthModalTitle}>เลือกเดือนในรายงาน</h3>
            </div>
            <p className={styles.reportMonthModalHint}>เดือนที่เลือก: {reportMonthLabel}</p>
            <div className={styles.reportMonthActions}>
              <button type="button" onClick={handleSelectAllReportMonths}>เลือกทั้งหมด</button>
              <button type="button" onClick={handleClearReportMonths}>ล้างที่เลือก</button>
            </div>
            <div className={styles.reportMonthList}>
              {months.map((month) => {
                const checked = selectedReportMonths.includes(month);
                return (
                  <label key={month} className={styles.reportMonthItem}>
                    <input type="checkbox" checked={checked} onChange={() => toggleReportMonthSelection(month)} />
                    <span>{getMonthLabel(month)}</span>
                  </label>
                );
              })}
            </div>
            <div className={styles.reportMonthModalFooter}>
              <button type="button" className={styles.reportMonthModalCancelButton} onClick={() => setReportMonthModalOpen(false)}>
                ยกเลิก
              </button>
              <button
                type="button"
                className={styles.reportMonthModalConfirmButton}
                onClick={handleDownloadReport}
                disabled={isDownloadingReport || orderedSelectedReportMonths.length === 0}
              >
                {isDownloadingReport ? 'กำลังสร้าง PDF...' : 'ดาวน์โหลดรายงาน'}
              </button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}
