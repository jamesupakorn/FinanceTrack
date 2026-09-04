/**
 * หน้า: /reports — P4 · reports-settings
 * บ้านของ SummaryReport (ย้ายมาจาก /workspace แบบไม่แก้ — AC-RS-17) บวกของใหม่ชิ้นเดียวของเฟสนี้:
 * MonthComparison และปุ่ม Download Report PDF (ย้ายมาจาก workspace.js พร้อม buildMonthlyReportPayload
 * ที่สลับไปใช้ getMonthlySummaryModel — ปิด known inconsistency เดิมของ ADR-013, AC-RS-27/29)
 *
 * Design Amendment A1 (superseded by A3): เครื่องคำนวณเงินเดือนเคยย้ายไปเป็นหน้าแยก /salary — แผนนั้น
 * ถูกยกเลิกแล้ว กลับไปอยู่ในแท็บ "รายรับ" ของ /workspace แทน (pages/salary.js ตอนนี้เป็นแค่ redirect
 * shim) หน้านี้จึงเหลือ 2 ส่วนเนื้อหา ไม่ใช่ 3 — ยังเป็น collapsible ทั้งคู่ (UX Review, AC-RS-30):
 * สรุปรายเดือน default เปิด (ตัวเลขที่ผู้ใช้มาเช็คหน้านี้), เปรียบเทียบรายเดือน default พับ
 * ท้ายหน้ามีลิงก์ทางเข้าไปแท็บ "รายรับ" พร้อมเปิด SalaryModal ให้เลย (คำนวณเงินเดือน →) สำหรับผู้ใช้ที่
 * เคยเจอเครื่องคำนวณอยู่ที่นี่ (E23, ปรับตาม A3)
 *
 * Graphite redesign (Reports pass) — Tailwind only, ไม่ import Reports.module.css อีกต่อไป
 * (task-size-reports-graphite.md Step 3). CollapsibleSection ท้องถิ่นด้านล่างแทนที่ header ที่มือเขียนเอง
 * เดิมด้วย CollapsibleHeading.js ตัวเดียวกับ Dashboard pass (ไม่แตะไฟล์นั้น — ใช้ตามที่มีอยู่) แต่
 * CollapsibleHeading ไม่มี prop สำหรับ aria-controls ผูกกับ body region ของมันเอง (ไม่เคยต้องใช้ตอน
 * Dashboard pass เพราะ BudgetHealthPanel/DashboardCalendarSection ไม่มี id คู่กัน) จึง patch attribute
 * aria-controls ลงบน <button> ภายในด้วย DOM query สั้น ๆ ใน useEffect แทน (คง header+chevron+
 * aria-expanded+aria-controls→div#id relationship ของโค้ดเดิมไว้ครบ โดยไม่แก้ CollapsibleHeading.js เอง)
 *
 * AC-20: reportMonthModalOpen เดิม Escape-close อย่างเดียว ไม่มี focus trap — ตอนนี้ Tab วนในโมดัล,
 * Escape ปิด, focus คืนกลับจุดเปิดโมดัลเมื่อปิด (แพทเทิร์นเดียวกับ UnsavedChangesDialog.js แต่ markup เป็น
 * Tailwind C9 ล้วน ไม่ใช้ CreditCardForm.module.css เพราะยังไม่ migrate) ใช้ getTabbableElements จาก
 * focusTrap.js ตรง ๆ (TD-M06) ไม่เขียน selector ใหม่เอง
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import Layout from '../src/frontend/components/Layout';
import SummaryReport from '../src/frontend/components/SummaryReport';
import MonthComparison from '../src/frontend/components/MonthComparison';
import CollapsibleHeading from '../src/frontend/components/CollapsibleHeading';
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
import { getTabbableElements } from '../src/shared/utils/frontend/focusTrap';

const FOCUS_RING = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2';
// การ์ด/แผงหลักทุกใบใช้กติกาเดียวกัน (C1 §5 component vocabulary) — ตัวคงที่เดียวกับที่ pages/index.js ใช้
const CARD = 'rounded-md border border-border-default bg-surface-1 p-space-4 shadow-elev-1 md:p-space-5';

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

/**
 * ส่วนพับเก็บได้ — ใช้ 2 ครั้งในหน้านี้ (สรุปรายเดือน/เปรียบเทียบรายเดือน — AC-RS-30)
 * ห่อ CollapsibleHeading.js (ของเดิมจาก Dashboard pass, ไม่แตะไฟล์นั้น) แล้ว patch aria-controls ลงบน
 * <button> ภายในด้วย DOM query — CollapsibleHeading เองไม่มี prop สำหรับ wiring นี้ (ไม่เคยต้องใช้มาก่อน)
 * เพื่อคง button[aria-controls] → div#id relationship ของ CollapsibleSection มือเขียนเดิมไว้ครบ
 */
function CollapsibleSection({ headingId, bodyId, title, defaultExpanded, children }) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const headingWrapRef = useRef(null);

  useEffect(() => {
    const button = headingWrapRef.current?.querySelector('button');
    if (button) button.setAttribute('aria-controls', bodyId);
  }, [bodyId]);

  return (
    <section className={CARD}>
      <div ref={headingWrapRef}>
        <CollapsibleHeading
          headingId={headingId}
          expanded={expanded}
          onToggle={() => setExpanded((prev) => !prev)}
          title={title}
        />
      </div>
      {expanded && <div id={bodyId} className="pt-space-4">{children}</div>}
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

  // AC-20: Tab วนในโมดัล, Escape ปิด, focus คืนกลับที่ปุ่มเปิดเมื่อปิดจริง (เดินตามแพทเทิร์นเดียวกับ
  // UnsavedChangesDialog.js — จับ document.activeElement ตอนเปิด, ตั้ง focus แรกให้ element ที่ tab
  // ได้ตัวแรกในโมดัล, ใช้ getTabbableElements จาก focusTrap.js แทนการเขียน selector เอง (TD-M06))
  const modalRef = useRef(null);

  useEffect(() => {
    if (!reportMonthModalOpen) return undefined;
    const previouslyFocused = typeof document !== 'undefined' ? document.activeElement : null;
    const focusFirstTimer = setTimeout(() => {
      const focusable = getTabbableElements(modalRef.current);
      (focusable[0] || modalRef.current)?.focus();
    }, 0);

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        setReportMonthModalOpen(false);
        return;
      }
      if (event.key !== 'Tab' || !modalRef.current) return;
      const focusable = getTabbableElements(modalRef.current);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      clearTimeout(focusFirstTimer);
      document.removeEventListener('keydown', handleKeyDown);
      previouslyFocused?.focus?.();
    };
  }, [reportMonthModalOpen]);

  const monthLabel = selectedMonth ? getMonthLabel(selectedMonth) : '';

  // ปุ่ม Download Report PDF — C7 secondary button, อยู่ใน headerActions ของ Layout เหมือนเดิม
  // (ไม่ย้ายที่ — Stage 1.5 ยืนยันแล้วว่าตำแหน่งถูกต้องอยู่แล้ว)
  const headerActions = (
    <button
      type="button"
      className={`inline-flex min-h-11 items-center gap-space-2 rounded-sm border border-border-interactive bg-surface-2 px-space-4 text-sm font-medium text-primary disabled:cursor-not-allowed disabled:opacity-55 ${FOCUS_RING}`}
      onClick={handleOpenReportMonthModal}
      disabled={isDownloadingReport || months.length === 0}
    >
      <Icons.Save size={16} />
      {isDownloadingReport ? 'กำลังสร้าง PDF...' : 'Download Report PDF'}
    </button>
  );

  return (
    <Layout activeNav="reports" title="รายงาน" headerActions={headerActions}>
      {/* ไม่มี padding/max-width ของตัวเอง — Layout.module.css's .content ให้ทั้งสองอย่างอยู่แล้ว
          (28px padding + max-width 1280px auto margin) เหมือนที่ pages/index.js (Dashboard pass) ทำ */}
      <div className="flex w-full flex-col gap-space-5">
        <div className="flex items-center justify-center gap-space-3">
          <button
            type="button"
            className={`inline-flex h-11 w-11 items-center justify-center rounded-full border border-border-default bg-surface-2 text-primary ${FOCUS_RING}`}
            onClick={() => handleNavigateMonth(-1)}
            aria-label="เดือนก่อนหน้า"
          >
            <Icons.ChevronLeft size={18} />
          </button>
          <span className="min-w-[120px] text-center text-base font-bold text-primary">{monthLabel}</span>
          <button
            type="button"
            className={`inline-flex h-11 w-11 items-center justify-center rounded-full border border-border-default bg-surface-2 text-primary ${FOCUS_RING}`}
            onClick={() => handleNavigateMonth(1)}
            aria-label="เดือนถัดไป"
          >
            <Icons.ChevronRight size={18} />
          </button>
        </div>

        {/* lg: สองคอลัมน์ — สรุปซ้าย เปรียบเทียบขวา (UX_SPEC §9) */}
        <div className="flex flex-col gap-space-5 lg:grid lg:grid-cols-2 lg:items-start">
          <CollapsibleSection headingId="reports-summary" bodyId="reports-summary-body" title="สรุปรายเดือน" defaultExpanded>
            <SummaryReport selectedMonth={selectedMonth} />
          </CollapsibleSection>

          <CollapsibleSection headingId="reports-comparison" bodyId="reports-comparison-body" title="เปรียบเทียบรายเดือน (6 เดือนล่าสุด)" defaultExpanded={false}>
            <MonthComparison />
          </CollapsibleSection>
        </div>

        {/* ทางเข้าเครื่องคำนวณเงินเดือนจุดที่สอง (A1) — low-emphasis text link ไม่ใช่ปุ่ม ไม่แข่งกับ
            Download Report PDF ใน headerActions */}
        <div className="text-center">
          <Link
            href="/workspace/income?salary=open"
            className={`inline-flex min-h-11 items-center rounded-xs px-space-2 text-sm font-semibold text-accent no-underline ${FOCUS_RING}`}
            aria-describedby="reports-salary-link-hint"
          >
            คำนวณเงินเดือน →
          </Link>
          <p id="reports-salary-link-hint" className="m-0 text-xs text-tertiary">ย้ายไปอยู่ในแท็บรายรับแล้ว</p>
        </div>
      </div>

      {reportMonthModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-[rgba(10,10,11,0.72)] p-space-4 md:items-center"
          role="presentation"
          onMouseDown={(event) => { if (event.target === event.currentTarget) setReportMonthModalOpen(false); }}
        >
          <div
            ref={modalRef}
            className="flex max-h-[85vh] w-full max-w-md flex-col gap-space-4 overflow-y-auto rounded-lg bg-surface-3 p-space-5 shadow-elev-3"
            role="dialog"
            aria-modal="true"
            aria-label="เลือกเดือนในรายงาน"
          >
            <div className="flex items-center justify-between gap-space-3">
              <h3 className="m-0 text-lg font-semibold text-primary">เลือกเดือนในรายงาน</h3>
              <button
                type="button"
                className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-secondary hover:bg-surface-2 ${FOCUS_RING}`}
                onClick={() => setReportMonthModalOpen(false)}
                aria-label="ปิด"
              >
                <Icons.X size={18} />
              </button>
            </div>
            <p className="m-0 text-sm text-secondary">เดือนที่เลือก: {reportMonthLabel}</p>
            <div className="flex gap-space-3">
              <button
                type="button"
                className={`min-h-11 flex-1 rounded-sm border border-border-interactive bg-surface-2 text-sm font-medium text-primary ${FOCUS_RING}`}
                onClick={handleSelectAllReportMonths}
              >
                เลือกทั้งหมด
              </button>
              <button
                type="button"
                className={`min-h-11 flex-1 rounded-sm border border-border-interactive bg-surface-2 text-sm font-medium text-primary ${FOCUS_RING}`}
                onClick={handleClearReportMonths}
              >
                ล้างที่เลือก
              </button>
            </div>
            <div className="flex flex-col gap-space-1 overflow-y-auto">
              {months.map((month) => {
                const checked = selectedReportMonths.includes(month);
                return (
                  <label
                    key={month}
                    className={`flex min-h-11 cursor-pointer items-center gap-space-3 rounded-sm px-space-2 text-sm text-primary hover:bg-surface-2 ${checked ? 'bg-accent-muted' : ''}`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleReportMonthSelection(month)}
                      className="h-5 w-5 shrink-0 accent-accent"
                    />
                    <span>{getMonthLabel(month)}</span>
                  </label>
                );
              })}
            </div>
            <div className="flex justify-end gap-space-3">
              <button
                type="button"
                className={`min-h-11 rounded-sm border border-border-interactive bg-surface-2 px-space-4 text-sm font-medium text-primary ${FOCUS_RING}`}
                onClick={() => setReportMonthModalOpen(false)}
              >
                ยกเลิก
              </button>
              <button
                type="button"
                className={`min-h-11 rounded-sm bg-accent px-space-4 text-sm font-medium text-on-accent disabled:cursor-not-allowed disabled:opacity-55 ${FOCUS_RING}`}
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
