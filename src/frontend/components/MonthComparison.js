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
 *
 * Graphite redesign (Reports pass) — Tailwind only, ไม่ import Reports.module.css อีกต่อไป. โครงสร้าง
 * ข้อมูล/การดึงข้อมูลไม่เปลี่ยนเลย (คงเดิม 100% — ตัด/แก้เฉพาะ markup+className) ตามมติผู้ใช้ที่ยืนยันแล้ว
 * ใน Stage 1.5: คงโครงสร้าง "การ์ดต่อเดือนสูงสุด 6 การ์ด" ไว้ที่ base tier — ไม่ยุบเป็นตารางแบบ 2 เดือน/
 * ต่อแถวเมตริก (ตัวเลือกที่ถูกพิจารณาแล้วปฏิเสธอย่างชัดเจน) เปลี่ยนแค่ "รูปทรงภายในการ์ด" จาก <dl> เดิม
 * เป็นแถวแบบ C4 (ชื่อซ้าย --text-base, ยอด+เดลต้าขวา, tabular-nums) ตาม UX_SPEC §9 ส่วน md+ ยังเป็น
 * ตาราง C5 (คอลัมน์ตัวเลขชิดขวา + tabular-nums) เหมือนเดิม — คอมโพเนนต์นี้ไม่รู้จักผัง 2 คอลัมน์ที่ lg
 * (นั่นเป็นหน้าที่ของ pages/reports.js's grid ตาม UX_SPEC §9's "lg: two columns... this component only
 * knows about its own section")
 */

import { useEffect, useMemo, useState } from 'react';
import { incomeAPI, expenseAPI, savingsAPI, dailyExpenseAPI } from '../../shared/utils/frontend/apiUtils';
import { getMonthlySummaryModel } from '../../shared/utils/frontend/monthlySummary';
import { round2 } from '../../shared/utils/creditCardUtils';
import { formatCurrency } from '../../shared/utils/frontend/numberUtils';
import { formatMonthLabelTH } from '../../shared/utils/frontend/monthUtils';
import { Icons } from './Icons';
import LoadingSkeleton, { SkeletonBlock } from './LoadingSkeleton';

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

// เดลต้าชิป (C8) — ขึ้น = pos, ลง = neg, เสมอมีไอคอน+ข้อความกำกับ ไม่ใช้สีอย่างเดียว (N2)
function DeltaBadge({ delta }) {
  if (!delta || delta.percent === null || delta.amount === null) {
    return <span className="text-sm text-tertiary">—</span>;
  }
  const isUp = delta.amount >= 0;
  const Icon = isUp ? Icons.TrendingUp : Icons.TrendingDown;
  const word = isUp ? 'เพิ่มขึ้น' : 'ลดลง';
  const absPercent = Math.abs(delta.percent);
  const tone = isUp ? 'border-pos/40 bg-pos/10 text-pos' : 'border-neg/40 bg-neg/10 text-neg';
  return (
    <span className={`inline-flex w-fit items-center gap-1 whitespace-nowrap rounded-full border px-space-2 py-[2px] text-xs font-medium ${tone}`}>
      {/* ไอคอน+ตัวเลขที่เห็น ซ่อนจาก screen reader — มีเวอร์ชันอ่านง่ายแยกไว้ข้างล่างแทน (UX_SPEC §Accessibility) */}
      <span aria-hidden="true" className="inline-flex items-center gap-1">
        <Icon size={12} />
        {`${word} ${absPercent}%`}
      </span>
      <span className="sr-only">{`${word} ${absPercent} เปอร์เซ็นต์`}</span>
    </span>
  );
}

// ชิปข้อมูลบางส่วนไม่ครบ (C8, warn — เสมอมีไอคอน+ข้อความกำกับ)
function PartialDataChip() {
  return (
    <span className="inline-flex w-fit items-center gap-1 whitespace-nowrap rounded-full border border-warn/40 bg-warn/10 px-space-2 py-[2px] text-xs font-medium text-warn">
      <Icons.AlertTriangle size={12} />
      ข้อมูลบางส่วนไม่ครบ
    </span>
  );
}

// แถวแบบ C4 ในการ์ด — ชื่อซ้าย (text-base), ยอดขวา tabular-nums
function ComparisonRow({ label, value, emphasized }) {
  return (
    <div className={`flex min-h-11 items-center justify-between gap-space-3 border-b border-border-subtle py-space-2 last:border-b-0 ${emphasized ? 'pt-space-3' : ''}`}>
      <span className={`text-base ${emphasized ? 'font-semibold text-primary' : 'text-secondary'}`}>{label}</span>
      <span className={`whitespace-nowrap tabular-nums ${emphasized ? 'text-lg font-bold text-primary' : 'text-base font-medium text-primary'}`}>{value}</span>
    </div>
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
    // โครงร่างต้องมี [container-type:inline-size] และ @container query ชุดเดียวกับของจริง (:171, :177,
    // :218) ไม่งั้นใน /reports ที่ lg วางการ์ดนี้ในคอลัมน์แคบ โครงร่างจะเลือกทรงผิดทาง — บั๊กประเภทเดียวกับ
    // BUG-A2-1 ที่คอมเมนต์ :166-170 ถูกเขียนขึ้นมาแก้
    // ใช้ <div> ไม่ใช่ <table> เปล่า: ตารางว่างใน a11y tree แย่กว่าไม่มีตาราง และ role="status" ประกาศให้แล้ว
    return (
      <LoadingSkeleton
        label="กำลังโหลดข้อมูลเปรียบเทียบ..."
        className="flex flex-col gap-space-4 [container-type:inline-size]"
      >
        <SkeletonBlock className="h-[18px] w-full max-w-[420px]" />

        {/* container ≥640px — ทรงตาราง C5: 8 คอลัมน์ คอลัมน์ตัวเลขชิดขวา */}
        <div className="hidden [@container(min-width:640px)]:block">
          <div className="flex items-center gap-space-2 border-b border-border-subtle px-space-2 py-space-3">
            <SkeletonBlock className="h-[18px] w-[72px] flex-[1.2]" />
            {[0, 1, 2, 3, 4, 5, 6].map((index) => (
              <div key={index} className="flex flex-1 justify-end">
                <SkeletonBlock className="h-[18px] w-[56px]" />
              </div>
            ))}
          </div>
          {[0, 1, 2].map((row) => (
            <div key={row} className="flex items-center gap-space-2 border-b border-border-subtle px-space-2 py-space-3 last:border-b-0">
              <SkeletonBlock className="h-[22px] w-[88px] flex-[1.2]" />
              {[0, 1, 2, 3, 4, 5, 6].map((index) => (
                <div key={index} className="flex flex-1 justify-end">
                  <SkeletonBlock className="h-[22px] w-[72px]" />
                </div>
              ))}
            </div>
          ))}
        </div>

        {/* container <640px — การ์ดต่อเดือน (:218-236) */}
        <div className="flex flex-col gap-space-3 [@container(min-width:640px)]:hidden">
          {[0, 1, 2].map((card) => (
            <div key={card} className="rounded-md border border-border-default bg-surface-2 p-space-4">
              <div className="mb-space-2 flex items-center justify-between gap-space-3">
                <SkeletonBlock on="surface-2" className="h-[26px] w-[120px]" />
                <SkeletonBlock on="surface-2" className="h-6 w-[96px] rounded-full" />
              </div>
              <div className="flex flex-col">
                {[0, 1, 2, 3, 4].map((index) => (
                  <div key={index} className="flex min-h-11 items-center justify-between gap-space-3 border-b border-border-subtle py-space-2">
                    <SkeletonBlock on="surface-2" className="h-[26px] w-[96px]" />
                    <SkeletonBlock on="surface-2" className="h-[26px] w-[80px]" />
                  </div>
                ))}
                {/* แถวสุดท้าย "สุทธิ" — emphasized: pt-space-3, text-lg (ComparisonRow :83-90) */}
                <div className="flex min-h-11 items-center justify-between gap-space-3 py-space-2 pt-space-3">
                  <SkeletonBlock on="surface-2" className="h-[27px] w-[64px]" />
                  <SkeletonBlock on="surface-2" className="h-[27px] w-[104px]" />
                </div>
              </div>
            </div>
          ))}
        </div>
      </LoadingSkeleton>
    );
  }

  if (loadError) {
    return <p className="m-0 text-sm text-secondary">โหลดข้อมูลเปรียบเทียบไม่สำเร็จ</p>;
  }

  if (rows.length < 2) {
    return <p className="m-0 text-sm text-secondary">ต้องมีข้อมูลอย่างน้อย 2 เดือนจึงจะเปรียบเทียบได้</p>;
  }

  return (
    // container query แทน md: breakpoint ตรง ๆ — pages/reports.js's lg tier วางการ์ดนี้ในผัง 2 คอลัมน์
    // (UX_SPEC §9) ทำให้ความกว้างจริงของการ์ดแคบกว่า viewport มาก (~330px ที่ 1024px viewport) ตาราง 8
    // คอลัมน์ (C5) ต้องการอย่างน้อย ~640px ถึงจะไม่บีบ (ยืนยันแล้วว่าพอดีที่ md เดี่ยว ~686px จริง) —
    // md: (ผูกกับ viewport width) จึงยังสั่งโชว์ตารางทั้งที่พื้นที่จริงไม่พอ ตัดคอลัมน์ขวาหายไปเงียบ ๆ
    // เทคนิคเดียวกับที่ SummaryReport.js/CashFlowRing.js ใช้แก้ปัญหาเดียวกันนี้อยู่แล้ว (BUG-A2-1)
    <div className="flex flex-col gap-space-4 [container-type:inline-size]">
      <p className="m-0 text-xs text-tertiary">
        กระแสเงินสดสุทธิ = รายรับ − รายจ่ายทั้งหมดในเดือนนั้น · Δ = เทียบกับเดือนก่อนหน้า
      </p>

      {/* container ≥640px: ตาราง C5 — คอลัมน์ตัวเลขชิดขวา + tabular-nums */}
      <div className="hidden overflow-x-auto [@container(min-width:640px)]:block">
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">{`ตารางเปรียบเทียบยอดรายเดือนย้อนหลัง ${rowsWithDelta.length} เดือน`}</caption>
          <thead>
            <tr className="border-b border-border-subtle">
              <th scope="col" className="px-space-2 py-space-3 text-left text-xs font-medium text-secondary">เดือน</th>
              <th scope="col" className="px-space-2 py-space-3 text-right text-xs font-medium text-secondary">รายรับ</th>
              <th scope="col" className="px-space-2 py-space-3 text-right text-xs font-medium text-secondary">รายจ่ายทั่วไป</th>
              <th scope="col" className="px-space-2 py-space-3 text-right text-xs font-medium text-secondary">รายจ่ายประจำวัน</th>
              <th scope="col" className="px-space-2 py-space-3 text-right text-xs font-medium text-secondary">เงินออม</th>
              <th scope="col" className="px-space-2 py-space-3 text-right text-xs font-medium text-secondary">บัตรเครดิต</th>
              <th scope="col" className="px-space-2 py-space-3 text-right text-xs font-medium text-secondary">กระแสเงินสดสุทธิ</th>
              <th scope="col" className="px-space-2 py-space-3 text-right text-xs font-medium text-secondary">เปลี่ยนแปลง</th>
            </tr>
          </thead>
          <tbody>
            {rowsWithDelta.map((row) => (
              <tr key={row.month} className="border-b border-border-subtle last:border-b-0">
                <th scope="row" className="px-space-2 py-space-3 text-left font-medium text-primary">
                  <span className="flex flex-wrap items-center gap-space-2">
                    {formatMonthLabelTH(row.month)}
                    {row.dailyFailed && <PartialDataChip />}
                  </span>
                </th>
                <td className="whitespace-nowrap px-space-2 py-space-3 text-right tabular-nums text-primary">{formatCurrency(row.model.totalIncome)}</td>
                <td className="whitespace-nowrap px-space-2 py-space-3 text-right tabular-nums text-primary">{formatCurrency(row.model.generalExpense)}</td>
                <td className="whitespace-nowrap px-space-2 py-space-3 text-right tabular-nums text-primary">{row.dailyFailed ? '—' : formatCurrency(row.model.dailyExpense)}</td>
                <td className="whitespace-nowrap px-space-2 py-space-3 text-right tabular-nums text-primary">{formatCurrency(row.model.savings)}</td>
                <td className="whitespace-nowrap px-space-2 py-space-3 text-right tabular-nums text-primary">{formatCurrency(row.model.creditCard)}</td>
                <td className="whitespace-nowrap px-space-2 py-space-3 text-right font-semibold tabular-nums text-primary">{formatCurrency(row.model.netCashFlow)}</td>
                <td className="px-space-2 py-space-3 text-right">
                  <span className="inline-flex justify-end"><DeltaBadge delta={row.delta} /></span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* container <640px: การ์ดต่อเดือน (คงโครงสร้างเดิม — มติผู้ใช้) แถวภายในเป็น C4 — ไม่มีการเลื่อน
          แนวนอนของข้อมูลการเงิน (AC-RS-23) รวมถึงตอนคอนเทนเนอร์แคบเพราะ lg 2-คอลัมน์ ไม่ใช่แค่มือถือ */}
      <div className="flex flex-col gap-space-3 [@container(min-width:640px)]:hidden">
        {rowsWithDelta.map((row) => (
          <div key={row.month} className="rounded-md border border-border-default bg-surface-2 p-space-4">
            <div className="mb-space-2 flex items-center justify-between gap-space-3">
              <span className="text-base font-semibold text-primary">{formatMonthLabelTH(row.month)}</span>
              <DeltaBadge delta={row.delta} />
            </div>
            {row.dailyFailed && <div className="mb-space-2"><PartialDataChip /></div>}
            <div className="flex flex-col">
              <ComparisonRow label="รายรับ" value={formatCurrency(row.model.totalIncome)} />
              <ComparisonRow label="รายจ่ายทั่วไป" value={formatCurrency(row.model.generalExpense)} />
              <ComparisonRow label="รายจ่ายประจำวัน" value={row.dailyFailed ? '—' : formatCurrency(row.model.dailyExpense)} />
              <ComparisonRow label="เงินออม" value={formatCurrency(row.model.savings)} />
              <ComparisonRow label="บัตรเครดิต" value={formatCurrency(row.model.creditCard)} />
              <ComparisonRow label="สุทธิ" value={formatCurrency(row.model.netCashFlow)} emphasized />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
