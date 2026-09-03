/**
 * คอมโพเนนต์: TaxTable
 * จัดการข้อมูลภาษีรายปีและรายเดือน
 * รองรับการเพิ่ม/ลบปีและบันทึกข้อมูลภาษี
 * @param {object} props
 * @param {string} props.selectedMonth - เดือนที่เลือก (YYYY-MM)
 *
 * Graphite redesign (daily-savings-tax-graphite pass) — Tailwind restyle only, ไม่มี
 * TaxTable.module.css อีกต่อไป. ไม่ใช่ C11 (§8 แถว 8) — ตัวเดียวที่เพิ่ม/ลบได้คือ "ปี" ผ่าน
 * handleAddNewYear/handleDelete ไม่ใช่แถวชื่อ+จำนวนเงิน ตาราง 12 เดือนเป็น grid คงที่ ไม่มีแถวให้
 * เพิ่ม/ลบ ไม่ต้อง wire markDirty ที่นี่
 */

// ...imports and component definition...
import { useState, useEffect } from 'react';
import { formatCurrency, handleNumberInput, handleNumberBlur, parseToNumber } from '../../shared/utils/frontend/numberUtils';
import { createDefault12MonthsObject, sumAccumulated, getSortedYears } from '../../shared/utils/taxUtils';
import { taxAPI, salaryAPI } from '../../shared/utils/frontend/apiUtils';
import { showToast } from '../../shared/utils/frontend/toast';

const FOCUS_RING = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2';
const INPUT = `h-11 w-full rounded-sm border border-border-interactive bg-surface-2 px-space-3 text-base text-primary outline-none ${FOCUS_RING}`;
const SELECT = `h-11 rounded-sm border border-border-interactive bg-surface-2 px-space-3 text-sm text-primary outline-none ${FOCUS_RING}`;
const BTN_SECONDARY = `min-h-11 rounded-sm border border-border-interactive bg-surface-2 px-space-4 text-sm font-medium text-secondary ${FOCUS_RING}`;
const BTN_DANGER = `min-h-11 rounded-sm border border-neg px-space-4 text-sm font-medium text-neg ${FOCUS_RING}`;
const BTN_PRIMARY = `min-h-11 rounded-sm bg-accent px-space-4 text-sm font-medium text-on-accent ${FOCUS_RING}`;

const MONTHS = [
  { month: '01', name: 'มกราคม' }, { month: '02', name: 'กุมภาพันธ์' }, { month: '03', name: 'มีนาคม' },
  { month: '04', name: 'เมษายน' }, { month: '05', name: 'พฤษภาคม' }, { month: '06', name: 'มิถุนายน' },
  { month: '07', name: 'กรกฎาคม' }, { month: '08', name: 'สิงหาคม' }, { month: '09', name: 'กันยายน' },
  { month: '10', name: 'ตุลาคม' }, { month: '11', name: 'พฤศจิกายน' }, { month: '12', name: 'ธันวาคม' }
];

/**
 * ตารางภาษีรายปี
 */
export default function TaxTable({ selectedMonth, salaryUpdateTrigger, onRegisterSave, onSaved }) {
  const handleAmountInputFocus = (event) => {
    event.target.select();
  };

  // ...existing code...
  // เพิ่มปีใหม่ (เฉพาะโหมด edit)
  const handleAddNewYear = (yearAD) => {
    if (!yearAD || allYearData[yearAD]) return;
    // สร้างข้อมูลว่างสำหรับปีใหม่
    const emptyYearData = {
      monthly_tax: createDefault12MonthsObject('0.00'),
      monthly_income: createDefault12MonthsObject('0.00'),
      monthly_provident: createDefault12MonthsObject('0.00')
    };
    setAllYearData(prev => ({ ...prev, [yearAD]: emptyYearData }));
    setSelectedYear(yearAD);
    setMonthlyTax(emptyYearData.monthly_tax);
    setMonthlyIncome(emptyYearData.monthly_income);
    setMonthlyProvident(emptyYearData.monthly_provident);
    setShowAddForm(false);
  };  // ลบปี (เฉพาะโหมด edit)
  const handleDelete = async (yearAD) => {
    if (!yearAD || !allYearData[yearAD]) return;
    // ลบที่ backend ก่อน
    try {
      const result = await taxAPI.deleteYear(yearAD);
      if (!result?.success) {
        showToast(result?.message || 'ลบข้อมูลไม่สำเร็จ', 'error');
        return;
      }
    } catch (e) {
      showToast('เกิดข้อผิดพลาดในการลบข้อมูล', 'error');
      return;
    }
    // ลบที่ frontend
    const updated = { ...allYearData };
    delete updated[yearAD];
    setAllYearData(updated);
    if (selectedYear === yearAD) {
      const years = Object.keys(updated);
      if (years.length > 0) {
        const latest = years.sort((a, b) => parseInt(b) - parseInt(a))[0];
        setSelectedYear(latest);
      } else {
        setSelectedYear('');
        setMonthlyTax({});
        setMonthlyIncome({});
        setMonthlyProvident({});
      }
    }
  };
  const handleSyncFromSalary = async () => {
    try {
      const { months: allMonths } = await salaryAPI.getAll();
      if (!allMonths || typeof allMonths !== 'object') {
        showToast('ไม่พบข้อมูลเงินเดือน', 'info');
        return;
      }
      const yearPrefix = selectedYear + '-';
      const newTax = { ...monthlyTax };
      const newIncome = { ...monthlyIncome };
      const newProvident = { ...monthlyProvident };
      let updated = 0;
      Object.entries(allMonths).forEach(([monthKey, data]) => {
        if (!monthKey.startsWith(yearPrefix)) return;
        const mm = monthKey.split('-')[1];
        const totalIncome = data?.summary?.total_income ?? 0;
        const tax = data?.deduct?.tax ?? 0;
        const provident = data?.deduct?.provident_fund ?? 0;
        newIncome[mm] = parseToNumber(totalIncome).toFixed(2);
        newTax[mm] = parseToNumber(tax).toFixed(2);
        newProvident[mm] = parseToNumber(provident).toFixed(2);
        updated++;
      });
      if (updated === 0) {
        showToast('ไม่พบข้อมูลเงินเดือนสำหรับปีนี้', 'info');
        return;
      }
      setMonthlyIncome(newIncome);
      setMonthlyTax(newTax);
      setMonthlyProvident(newProvident);
      showToast(`ซิงค์ข้อมูลจากเงินเดือน ${updated} เดือนสำเร็จ`);
    } catch (e) {
      showToast('เกิดข้อผิดพลาดในการซิงค์ข้อมูล', 'error');
    }
  };

  // โหลดข้อมูลปีทั้งหมดสำหรับ dropdown ปี (ต้องอยู่ในฟังก์ชันคอมโพเนนต์เท่านั้น)
  useEffect(() => {
    const fetchAllYears = async () => {
      try {
        const data = await taxAPI.getAll();
        setAllYearData(data.tax_by_year || {});
      } catch (error) {
        setAllYearData({});
      }
    };
    fetchAllYears();
  }, []);
  // Save handler: POST all tax data including provident to backend
  const handleSave = async () => {
    try {
      await taxAPI.saveYearly(selectedYear, {
        monthly_tax: monthlyTax,
        monthly_income: monthlyIncome,
        monthly_provident: monthlyProvident
      });
      showToast('บันทึกข้อมูลภาษีสำเร็จ');
      onSaved?.();
    } catch (e) {
      showToast('เกิดข้อผิดพลาดในการบันทึกข้อมูลภาษี', 'error');
    }
  };

  // ลงทะเบียนฟังก์ชันบันทึกกับ ref ของ WorkspaceShell แทนตัวนับ Save All เดิม (Amendment A5 —
  // ดูคำอธิบายเต็มใน IncomeTable.js ที่จุดเดียวกัน) salaryUpdateTrigger ยังอยู่ในพารามิเตอร์เหมือนเดิม
  // แต่ไม่มีใครส่งค่าให้จาก /workspace/tax อีกแล้ว (ผู้ผลิตตัวเดียวคือ modal เงินเดือนอยู่คนละ route แล้ว
  // — /workspace/income) undefined ที่เสถียรทำให้ effect ด้านล่าง (dep [selectedYear, salaryUpdateTrigger])
  // ยังรันตอน mount เหมือนเดิม ซึ่งเป็นการรีเฟรชที่มันต้องการอยู่แล้วพอดี ไม่ต้องแก้ effect นั้นเพิ่ม
  useEffect(() => {
    if (!onRegisterSave) return undefined;
    onRegisterSave(handleSave);
    return () => onRegisterSave(null);
  }, [onRegisterSave, handleSave]);
  // State for provident fund and its tax
  const [monthlyProvident, setMonthlyProvident] = useState({
    '01': '0.00', '02': '0.00', '03': '0.00', '04': '0.00',
    '05': '0.00', '06': '0.00', '07': '0.00', '08': '0.00',
    '09': '0.00', '10': '0.00', '11': '0.00', '12': '0.00'
  });
  // Mapping English tax keys to Thai labels
  const taxKeyThaiMapping = {
    monthly_tax: 'ภาษีรายเดือน',
    accumulated_tax: 'ภาษีสะสม'
  };
  // default ปีที่เลือกเป็น AD (คศ)
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear().toString());
  // รายรับแต่ละเดือนของปีที่เลือก
  const [monthlyIncome, setMonthlyIncome] = useState({
    '01': '0.00', '02': '0.00', '03': '0.00', '04': '0.00',
    '05': '0.00', '06': '0.00', '07': '0.00', '08': '0.00',
    '09': '0.00', '10': '0.00', '11': '0.00', '12': '0.00'
  });
  const [allYearData, setAllYearData] = useState({});
  const [showAddForm, setShowAddForm] = useState(false);
  const [newYear, setNewYear] = useState('');
  const [monthlyTax, setMonthlyTax] = useState({
    '01': '0.00', '02': '0.00', '03': '0.00', '04': '0.00',
    '05': '0.00', '06': '0.00', '07': '0.00', '08': '0.00',
    '09': '0.00', '10': '0.00', '11': '0.00', '12': '0.00'
  });

  // โหลดข้อมูลภาษีและ provident เมื่อปีที่เลือกเปลี่ยน
  useEffect(() => {
    const fetchTaxData = async () => {
      try {
        const data = await taxAPI.getByYear(selectedYear);
        const targetYear = data ? (data[selectedYear] ? selectedYear : Object.keys(data)[0]) : undefined;
        const yearData = targetYear ? data[targetYear] : undefined;
        const default12 = createDefault12MonthsObject('0.00');
        setMonthlyTax((yearData && yearData.monthly_tax) ? yearData.monthly_tax : { ...default12 });
        setMonthlyIncome((yearData && yearData.monthly_income) ? yearData.monthly_income : { ...default12 });
        setMonthlyProvident((yearData && yearData.monthly_provident) ? yearData.monthly_provident : { ...default12 });
      } catch (error) {
        const default12 = createDefault12MonthsObject('0.00');
        setMonthlyTax({ ...default12 });
        setMonthlyIncome({ ...default12 });
        setMonthlyProvident({ ...default12 });
      }
    };
    fetchTaxData();
  }, [selectedYear, salaryUpdateTrigger]);

  const calculateAccumulatedTax = (upToMonth) => sumAccumulated(monthlyTax, upToMonth, parseToNumber);

  // ฟังก์ชันคำนวณรายได้สะสมถึงเดือนที่กำหนด
  const calculateAccumulatedIncome = (upToMonth) => sumAccumulated(monthlyIncome, upToMonth, parseToNumber);

  const getSumDisplay = (obj) => {
    const sum = Object.values(obj).reduce((acc, v) => acc + (parseFloat((v+'').replace(/,/g, '')) || 0), 0);
    return formatCurrency(sum);
  };

  return (
    <div>
      <h2 className="mb-space-4 text-xl font-semibold text-primary">ภาษีสะสม</h2>

      <div className="mb-space-4 flex flex-wrap items-center gap-space-2">
        <label className="text-sm text-secondary">เลือกปี:</label>
        <select
          value={selectedYear}
          onChange={(e) => setSelectedYear(e.target.value)}
          className={SELECT}
        >
          {getSortedYears(allYearData).map(yearAD => {
            const yearBE = (parseInt(yearAD) + 543).toString();
            return <option key={yearAD} value={yearAD}>พ.ศ. {yearBE}</option>;
          })}
        </select>
        <button
          type="button"
          onClick={() => {
            setShowAddForm(!showAddForm);
            if (!showAddForm) {
              // หา BE ล่าสุดจาก allYearData แล้ว +1
              const currentBE = new Date().getFullYear() + 543;
              const years = Object.keys(allYearData).map(y => parseInt(y) + 543);
              if (years.length > 0) {
                const maxBE = Math.max(...years);
                setNewYear((maxBE + 1).toString());
              } else {
                setNewYear(currentBE.toString());
              }
            }
          }}
          className={BTN_PRIMARY}
        >
          + เพิ่มปีใหม่
        </button>
        <button type="button" onClick={handleSyncFromSalary} className={BTN_SECONDARY}>
          ซิงค์จากเงินเดือน
        </button>
        <button type="button" onClick={() => handleDelete(selectedYear)} className={BTN_DANGER}>
          ลบข้อมูลปี พ.ศ. {parseInt(selectedYear) + 543}
        </button>
      </div>

      {showAddForm && (
        <div className="mb-space-4 rounded-md border border-border-subtle bg-surface-2 p-space-4">
          <h4 className="mb-space-3 text-sm font-semibold text-primary">เพิ่มปีใหม่</h4>
          <div className="flex flex-wrap items-center gap-space-2">
            <label className="text-sm text-secondary">ปี พ.ศ.:</label>
            <input
              type="text"
              inputMode="numeric"
              value={newYear}
              onChange={(e) => setNewYear(e.target.value)}
              placeholder="เช่น 2568"
              className={`${INPUT} max-w-[140px]`}
            />
            <button
              type="button"
              onClick={() => {
                const yearAD = (parseInt(newYear) - 543).toString();
                setNewYear('');
                handleAddNewYear(yearAD);
              }}
              className={BTN_PRIMARY}
            >
              เพิ่ม
            </button>
            <button
              type="button"
              onClick={() => {
                setShowAddForm(false);
                setNewYear('');
              }}
              className={BTN_SECONDARY}
            >
              ยกเลิก
            </button>
          </div>
        </div>
      )}

      {/* md+: C5 table */}
      <div className="hidden md:block">
        <h3 className="mb-space-3 text-sm font-medium text-secondary">ภาษีสะสมรายเดือน พ.ศ. {parseInt(selectedYear) + 543}</h3>
        <div className="overflow-x-auto rounded-md border border-border-default">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-border-subtle bg-surface-2">
                <th className="p-space-3 text-left text-xs font-medium text-secondary">เดือน</th>
                <th className="p-space-3 text-right text-xs font-medium text-secondary">รายรับ (บาท)</th>
                <th className="p-space-3 text-right text-xs font-medium text-secondary">รายได้สะสม (บาท)</th>
                <th className="p-space-3 text-right text-xs font-medium text-secondary">กองทุนสำรองเลี้ยงชีพ (บาท)</th>
                <th className="p-space-3 text-right text-xs font-medium text-secondary">{taxKeyThaiMapping['monthly_tax']} (บาท)</th>
                <th className="p-space-3 text-right text-xs font-medium text-secondary">{taxKeyThaiMapping['accumulated_tax']} (บาท)</th>
              </tr>
            </thead>
            <tbody>
              {MONTHS.map(({ month, name }) => {
                const accumulatedTaxVal = calculateAccumulatedTax(month);
                const accumulatedIncomeVal = calculateAccumulatedIncome(month);
                const income = monthlyIncome[month] || '0.00';
                const provident = monthlyProvident?.[month] || '0.00';
                const monthlyTaxVal = monthlyTax[month] || '0.00';
                return (
                  <tr key={month} className="border-b border-border-subtle last:border-b-0">
                    <td className="p-space-3 align-middle text-secondary">{name}</td>
                    <td className="p-space-3 align-middle">
                      <input
                        type="text"
                        value={income}
                        onChange={e => handleNumberInput(e.target.value, setMonthlyIncome, month)}
                        onBlur={e => handleNumberBlur(e.target.value, setMonthlyIncome, month)}
                        onFocus={handleAmountInputFocus}
                        placeholder="รายรับ"
                        className={`${INPUT} text-right font-[family-name:var(--font-numeric)] tabular-nums`}
                      />
                    </td>
                    <td className="p-space-3 text-right align-middle font-[family-name:var(--font-numeric)] tabular-nums text-secondary">
                      {formatCurrency(accumulatedIncomeVal)}
                    </td>
                    <td className="p-space-3 align-middle">
                      <input
                        type="text"
                        value={provident}
                        onChange={e => handleNumberInput(e.target.value, setMonthlyProvident, month)}
                        onBlur={e => handleNumberBlur(e.target.value, setMonthlyProvident, month)}
                        onFocus={handleAmountInputFocus}
                        placeholder="กองทุนสำรองเลี้ยงชีพ"
                        className={`${INPUT} text-right font-[family-name:var(--font-numeric)] tabular-nums`}
                      />
                    </td>
                    <td className="p-space-3 align-middle">
                      <input
                        type="text"
                        value={monthlyTaxVal}
                        onChange={e => handleNumberInput(e.target.value, setMonthlyTax, month)}
                        onBlur={e => handleNumberBlur(e.target.value, setMonthlyTax, month)}
                        onFocus={handleAmountInputFocus}
                        placeholder={taxKeyThaiMapping['monthly_tax']}
                        className={`${INPUT} text-right font-[family-name:var(--font-numeric)] tabular-nums`}
                      />
                    </td>
                    <td className="p-space-3 text-right align-middle font-[family-name:var(--font-numeric)] font-semibold tabular-nums text-primary">
                      {formatCurrency(accumulatedTaxVal)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="bg-surface-2">
                <td className="p-space-3 text-sm font-semibold text-primary">รวมทั้งปี</td>
                <td className="p-space-3 text-right font-[family-name:var(--font-numeric)] text-sm font-semibold tabular-nums text-primary">{getSumDisplay(monthlyIncome)}</td>
                <td className="p-space-3 text-right font-[family-name:var(--font-numeric)] text-sm font-semibold tabular-nums text-primary">{getSumDisplay(monthlyIncome)}</td>
                <td className="p-space-3 text-right font-[family-name:var(--font-numeric)] text-sm font-semibold tabular-nums text-primary">{getSumDisplay(monthlyProvident)}</td>
                <td className="p-space-3 text-right font-[family-name:var(--font-numeric)] text-sm font-semibold tabular-nums text-primary">{getSumDisplay(monthlyTax)}</td>
                <td className="p-space-3 text-right font-[family-name:var(--font-numeric)] text-sm font-semibold tabular-nums text-primary">{getSumDisplay(monthlyTax)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* base tier: C4 cards */}
      <div className="flex flex-col gap-space-3 md:hidden">
        {MONTHS.map(({ month, name }) => {
          const accumulatedTaxVal = calculateAccumulatedTax(month);
          const accumulatedIncomeVal = calculateAccumulatedIncome(month);
          const income = monthlyIncome[month] || '0.00';
          const provident = monthlyProvident?.[month] || '0.00';
          const monthlyTaxVal = monthlyTax[month] || '0.00';
          return (
            <div className="rounded-md border border-border-default bg-surface-2 p-space-4" key={month}>
              <div className="mb-space-2 text-sm font-semibold text-primary">{name}</div>
              <div className="flex flex-col gap-space-2">
                <label className="flex flex-col gap-space-1">
                  <span className="text-xs text-secondary">รายรับ</span>
                  <input
                    type="text"
                    value={income}
                    onChange={e => handleNumberInput(e.target.value, setMonthlyIncome, month)}
                    onBlur={e => handleNumberBlur(e.target.value, setMonthlyIncome, month)}
                    onFocus={handleAmountInputFocus}
                    placeholder="รายรับ"
                    className={`${INPUT} text-right font-[family-name:var(--font-numeric)] tabular-nums`}
                  />
                </label>
                <div className="flex items-center justify-between text-xs text-tertiary">
                  <span>รายได้สะสม</span>
                  <span className="font-[family-name:var(--font-numeric)] tabular-nums">{formatCurrency(accumulatedIncomeVal)}</span>
                </div>
                <label className="flex flex-col gap-space-1">
                  <span className="text-xs text-secondary">กองทุนสำรองเลี้ยงชีพ</span>
                  <input
                    type="text"
                    value={provident}
                    onChange={e => handleNumberInput(e.target.value, setMonthlyProvident, month)}
                    onBlur={e => handleNumberBlur(e.target.value, setMonthlyProvident, month)}
                    onFocus={handleAmountInputFocus}
                    placeholder="กองทุนสำรองเลี้ยงชีพ"
                    className={`${INPUT} text-right font-[family-name:var(--font-numeric)] tabular-nums`}
                  />
                </label>
                <label className="flex flex-col gap-space-1">
                  <span className="text-xs text-secondary">{taxKeyThaiMapping['monthly_tax']}</span>
                  <input
                    type="text"
                    value={monthlyTaxVal}
                    onChange={e => handleNumberInput(e.target.value, setMonthlyTax, month)}
                    onBlur={e => handleNumberBlur(e.target.value, setMonthlyTax, month)}
                    onFocus={handleAmountInputFocus}
                    placeholder={taxKeyThaiMapping['monthly_tax']}
                    className={`${INPUT} text-right font-[family-name:var(--font-numeric)] tabular-nums`}
                  />
                </label>
                <div className="flex items-center justify-between text-xs text-tertiary">
                  <span>{taxKeyThaiMapping['accumulated_tax']}</span>
                  <span className="font-[family-name:var(--font-numeric)] font-semibold tabular-nums text-primary">{formatCurrency(accumulatedTaxVal)}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
