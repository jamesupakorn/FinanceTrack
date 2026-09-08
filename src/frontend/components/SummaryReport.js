/**
 * คอมโพเนนต์: SummaryReport
 * แสดงสรุปรายรับ รายจ่าย เงินออม และโครงสร้างกระแสเงินสด (CashFlowRing) ของเดือนที่เลือก
 * ตัวเลขทั้งหมดมาจาก getMonthlySummaryModel() เดียวกับ Dashboard/MonthComparison (BR-DASH-005) —
 * ปิดข้อยกเว้นสุดท้ายของ BR-DASH-005 (Amendment A2) หลังจากที่ก่อนหน้านี้ไฟล์นี้ยังมี pipeline คำนวณยอด
 * แยกเป็นของตัวเอง (ดูรายละเอียดใน spec-reports-settings.md §Amendment A2)
 *
 * Graphite redesign (Reports pass) — Tailwind only, ไม่ import SummaryReport.module.css อีกต่อไป
 * (task-size-reports-graphite.md Step 1). ไม่มี card ของตัวเอง — คอมโพเนนต์นี้ mount อยู่ในตัว body ของ
 * CollapsibleSection ที่ pages/reports.js เป็นคนให้ C1 card chrome (surface-1/border/elev-1) อยู่แล้ว
 * ใส่การ์ดซ้ำที่นี่จะผิดกติกา C1 "never nest a card inside a card" — ส่วน "สรุป" ที่ต้องแยกกลุ่มสายตา
 * จากวงแหวนใช้ --surface-2 + border ตามกติกาการจัดกลุ่มซ้อน (C1) แทน ไม่ใช่การ์ดใบที่สอง
 *
 * CashFlowRing.js (ย้ายมาก่อนแล้วตอน Dashboard pass, ไม่แตะที่นี่) มี [container-type:inline-size] อยู่บน
 * <section> ของตัวเอง ทำให้ container-query legend-wrap fix (@container max-width:330px) ทำงานได้ในตัว
 * ไม่ว่าจะฝังในคอนเทนเนอร์แคบแค่ไหนก็ตาม — ไม่ต้องเติม container-type เพิ่มที่นี่ (ยืนยันจากซอร์สจริง)
 *
 * ค่าทุกตัวในตาราง "สรุป" คงเป็น text-primary เสมอ (C3: "value is always text-primary; the delta
 * carries pos/neg, not the value" — ของเดิมมี .income/.remaining/.tax ใส่สีลงตัวเลขตรง ๆ ซึ่งขัดกติกานี้)
 * ตัดสีออกจากค่าทุกตัวในรอบนี้ ไม่ใช่ regression — เป็นการ align กับ token rule ที่ประกาศไว้แล้ว
 * @param {object} props
 * @param {string} props.selectedMonth - เดือนที่เลือก (YYYY-MM)
 */

import React, { useState, useEffect } from 'react';
import { round2 } from '../../shared/utils/creditCardUtils';
import { formatCurrency } from '../../shared/utils/frontend/numberUtils';
import { incomeAPI, expenseAPI, savingsAPI, taxAPI, salaryAPI, savingsGoalsAPI, dailyExpenseAPI } from '../../shared/utils/frontend/apiUtils';
import { getMonthlySummaryModel } from '../../shared/utils/frontend/monthlySummary';
import { formatMonthLabelTH } from '../../shared/utils/frontend/monthUtils';
import { useSession } from '../contexts/SessionContext';
import CashFlowRing from './CashFlowRing';

const FOCUS_RING = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2';

/**
 * รายงานสรุปภาพรวมการเงิน
 */
const SummaryReport = ({ selectedMonth }) => {
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

  // แถวของตาราง "สรุป" — name ซ้าย + amount ขวา tabular-nums ตามกติกา C4 (§5 component vocabulary)
  // ค่าทุกแถวเป็น text-primary เสมอ ไม่ใส่สี pos/neg/warn/info ลงตัวค่าตรง ๆ (C3) — ผิดกับของเดิม
  const summaryRows = [
    {
      key: 'income',
      label: 'ยอดรวมรายรับรายเดือน',
      value: getDisplay(model?.totalIncome || 0)
    },
    {
      key: 'generalExpense',
      label: 'รายจ่ายทั่วไป',
      value: getDisplay(model?.generalExpense || 0)
    },
    {
      key: 'creditCard',
      label: 'บัตรเครดิต',
      value: getDisplay(model?.creditCard || 0)
    },
    {
      key: 'unpaid',
      label: 'ยอดค้างชำระ',
      value: getDisplay(model?.unpaid?.total || 0)
    },
    {
      key: 'savings',
      label: 'ยอดรวมเงินเก็บรายเดือน',
      value: getDisplay(model?.savings || 0)
    },
    {
      key: 'goalTarget',
      label: 'รวมเป้าหมายเงินออม',
      value: getDisplay(totalGoalsTarget)
    },
    {
      key: 'remaining',
      label: 'ยอดเงินคงเหลือ',
      qualifier: 'ก่อนหักรายจ่ายรายวัน/ออม',
      value: getDisplay(remainingBalance)
    },
    {
      key: 'tax',
      label: 'ภาษีสะสมตั้งแต่เดือนแรก',
      value: getDisplay(model?.taxAccumulated || 0)
    }
  ];

  return (
    <div className="flex flex-col gap-space-5">
      <h3 className="m-0 text-lg font-semibold text-primary">งบประมาณ</h3>

      {currentUser?.isDemo && effectiveMonth && selectedMonth && effectiveMonth !== selectedMonth && (
        <p className="m-0 rounded-sm border border-info/30 bg-info/10 px-space-3 py-space-2 text-sm text-info">
          บัญชีเดโม่ไม่มีข้อมูลเดือนที่เลือก จึงแสดงข้อมูลล่าสุดจาก {formatMonthLabelTH(effectiveMonth)}
        </p>
      )}

      {/*
        ring+table side-by-side ใช้ container query (@container) ไม่ใช่ md: breakpoint ตรง ๆ —
        pages/reports.js's lg tier วางการ์ดนี้ในผัง 2 คอลัมน์ (UX_SPEC §9) ทำให้ความกว้างจริงของการ์ด
        แคบกว่า viewport มาก (~350px ที่ 1024px viewport) md:flex-row (ผูกกับ viewport width) จึงยัง
        สั่ง side-by-side อยู่ทั้งที่พื้นที่จริงไม่พอ ทำให้ label ห่อคำแตกเป็น 3 บรรทัด — เทคนิคเดียวกับที่
        CashFlowRing.js ใช้แก้ปัญหา legend เดียวกันนี้อยู่แล้ว (BUG-A2-1) เอามาใช้ซ้ำที่นี่ (min-width
        560px ≈ พอสำหรับวงแหวน ~250px + ตาราง ~280px วางเคียงกันแบบไม่บีบ)
      */}
      <div className="flex flex-col gap-space-5 [container-type:inline-size] [@container(min-width:560px)]:flex-row [@container(min-width:560px)]:items-start">
        {/* โครงสร้างกระแสเงินสด — CashFlowRing ตัวเดียวกับ Dashboard ในโหมดแสดงผลอย่างเดียว (Amendment A2) */}
        <div className="min-w-0 [@container(min-width:560px)]:flex-1">
          <CashFlowRing
            model={model}
            interactive={false}
            monthLabel={formatMonthLabelTH(effectiveMonth)}
          />
        </div>

        {/* ตาราง "สรุป" — surface-2 + border (C1 nested-grouping rule), ไม่ใช่การ์ดใบที่สอง */}
        <div className="min-w-0 [@container(min-width:560px)]:flex-1">
          <h4 className="m-0 mb-space-3 text-sm font-medium text-secondary">สรุป</h4>
          <div className="flex flex-col divide-y divide-border-subtle rounded-md border border-border-default bg-surface-2">
            {summaryRows.map((row) => (
              <div
                key={row.key}
                tabIndex={0}
                aria-label={`${row.label}: ${row.value}`}
                className={`flex min-h-14 items-center justify-between gap-space-3 px-space-3 py-space-2 ${FOCUS_RING}`}
              >
                <span className="text-sm text-secondary">
                  {row.label}
                  {row.qualifier && <small className="mt-1 block text-xs text-tertiary">{row.qualifier}</small>}
                </span>
                <span className="whitespace-nowrap text-lg font-semibold text-primary tabular-nums">{row.value}</span>
              </div>
            ))}
          </div>

          {/* ป้ายอธิบายศัพท์ (AC-RS-43) — ตรงกลางวงแหวนกับแถวยอดเงินคงเหลือคือคนละยอด เจตนา ไม่ใช่ข้อผิดพลาด */}
          <p className="m-0 mt-space-3 text-xs text-tertiary">
            กระแสเงินสดสุทธิ (ตรงกลางวงแหวน) = รายรับ − รายจ่ายทั่วไป − รายจ่ายประจำวัน − เงินออม − บัตรเครดิต
            {' · '}
            ยอดเงินคงเหลือ = รายรับ − รายจ่ายทั่วไป − บัตรเครดิต (ยังไม่หักรายจ่ายประจำวันและเงินออม)
          </p>
        </div>
      </div>
    </div>
  );
};

export default SummaryReport;
