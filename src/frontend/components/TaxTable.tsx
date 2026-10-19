/**
 * คอมโพเนนต์: TaxTable
 * จัดการข้อมูลภาษีรายปีและรายเดือน
 * รองรับการเพิ่ม/ลบปีและบันทึกข้อมูลภาษี
 *
 * Graphite redesign (daily-savings-tax-graphite pass) — Tailwind restyle only, ไม่มี
 * TaxTable.module.css อีกต่อไป. ไม่ใช่ C11 (§8 แถว 8) — ตัวเดียวที่เพิ่ม/ลบได้คือ "ปี" ผ่าน
 * handleAddNewYear/handleDelete ไม่ใช่แถวชื่อ+จำนวนเงิน ตาราง 12 เดือนเป็น grid คงที่ ไม่มีแถวให้
 * เพิ่ม/ลบ ไม่ต้อง wire markDirty ที่นี่
 */

import { useState, useEffect, useRef, type Dispatch, type FocusEvent, type SetStateAction } from 'react';
import { formatCurrency, handleNumberInput, handleNumberBlur, parseToNumber } from '../../shared/utils/frontend/numberUtils';
import { createDefault12MonthsObject, sumAccumulated, getSortedYears } from '../../shared/utils/taxUtils';
import { taxAPI, salaryAPI } from '../../shared/utils/frontend/apiUtils';
import { showToast } from '../../shared/utils/frontend/toast';
import { getTabbableElements } from '../../shared/utils/frontend/focusTrap';
import { Icons } from './Icons';
import formStyles from '../styles/CreditCardForm.module.css';
import { useListCriteria } from '../contexts/ListViewContext';
import { compareListValues } from '../../shared/utils/frontend/listView';
import { useListProjection } from '../../shared/utils/frontend/useListProjection';
import ListToolbar from './ListToolbar';

type MonthValues = Record<string, string>;

interface TaxYearData {
  monthly_tax?: MonthValues;
  monthly_income?: MonthValues;
  monthly_provident?: MonthValues;
  [key: string]: unknown;
}

interface TaxTableProps {
  selectedMonth?: string | null;
  salaryUpdateTrigger?: number;
  onRegisterSave?: (handler: (() => Promise<void>) | null) => void;
  onSaved?: () => void;
}

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
export default function TaxTable({ selectedMonth: _selectedMonth, salaryUpdateTrigger, onRegisterSave, onSaved }: TaxTableProps) {
  const handleAmountInputFocus = (event: FocusEvent<HTMLInputElement>) => {
    event.target.select();
  };

  // กล่องยืนยันลบปี (ADR-006 ห้าม window.confirm) — รูปแบบเดียวกับ RevolvingConfirmDialog
  // (ExpenseCalendarModal.js:44-114) แต่เป็น component เดียวกันเลย (เจ้าของทั้งปุ่มเปิดและกล่อง
  // เหมือน UnsavedChangesDialog.js) จึงคืน focus ให้ปุ่มที่เปิดแบบ self-contained ผ่าน document.activeElement
  // แทนที่จะรับ restoreFocusRef จากภายนอก
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const deleteDialogRef = useRef<HTMLDivElement | null>(null);
  const cancelDeleteButtonRef = useRef<HTMLButtonElement | null>(null);
  const deleteTriggerRef = useRef<HTMLElement | null>(null);

  const [monthlyProvident, setMonthlyProvident] = useState<MonthValues>(() => createDefault12MonthsObject('0.00'));
  const taxKeyThaiMapping: Record<'monthly_tax' | 'accumulated_tax', string> = {
    monthly_tax: 'ภาษีรายเดือน',
    accumulated_tax: 'ภาษีสะสม'
  };
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear().toString());
  const [monthlyIncome, setMonthlyIncome] = useState<MonthValues>(() => createDefault12MonthsObject('0.00'));
  const [allYearData, setAllYearData] = useState<Record<string, TaxYearData>>({});
  const [showAddForm, setShowAddForm] = useState(false);
  const [newYear, setNewYear] = useState('');
  const [monthlyTax, setMonthlyTax] = useState<MonthValues>(() => createDefault12MonthsObject('0.00'));
  const [criteria, setCriteria] = useListCriteria('annual-tax');
  const [listLoad, setListLoad] = useState({ loading: true, failed: false, revision: 0 });
  const validCriteria = useRef(criteria);
  const rangeError = Boolean(criteria.filters.start && criteria.filters.end && criteria.filters.start > criteria.filters.end);
  if (!rangeError) validCriteria.current = criteria;
  const applied = validCriteria.current;
  const [field, direction] = applied.order.split(':');
  const projection = useListProjection({
    rows: MONTHS, getId: row => row.month,
    matches: row => {
      const monthKey = `${selectedYear}-${row.month}`;
      const amount = parseToNumber(monthlyTax[row.month] ?? '0');
      return (!applied.filters.start || monthKey >= applied.filters.start) &&
        (!applied.filters.end || monthKey <= applied.filters.end) &&
        (!applied.filters.amount || (applied.filters.amount === 'zero' ? amount === 0 : amount !== 0));
    },
    compare: field ? (a, b) => compareListValues(
      field === 'month' ? a.month : parseToNumber(monthlyTax[a.month] ?? '0'),
      field === 'month' ? b.month : parseToNumber(monthlyTax[b.month] ?? '0'),
      direction === 'desc') : undefined,
    editable: true, criteriaKey: JSON.stringify(applied),
    datasetKey: `${selectedYear}:${listLoad.loading}:${listLoad.revision}`
  });

  // เพิ่มปีใหม่ (เฉพาะโหมด edit)
  const handleAddNewYear = (yearAD: string) => {
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
  };

  // ลบปี (เฉพาะโหมด edit)
  // คืนค่า true/false บอกผลลัพธ์จริง — confirmDeleteYear ด้านล่างใช้ตัดสินใจว่าจะปิดกล่องยืนยันไหม
  // (ลบไม่สำเร็จต้องเปิดกล่องค้างไว้ ไม่ใช่ปิดเงียบๆ ทั้งที่ยังไม่ได้ลบจริง)
  const handleDelete = async (yearAD: string): Promise<boolean> => {
    if (!yearAD || !allYearData[yearAD]) return false;
    // ลบที่ backend ก่อน
    try {
      const result = await taxAPI.deleteYear(yearAD);
      if (!result?.success) {
        showToast(result?.message || 'ลบข้อมูลไม่สำเร็จ', 'error');
        return false;
      }
    } catch (error) {
      showToast('เกิดข้อผิดพลาดในการลบข้อมูล', 'error');
      return false;
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
    return true;
  };

  // เรียก handleDelete จริงหลังผู้ใช้กดยืนยันในกล่อง — handleDelete เองจัด toast/error ให้อยู่แล้ว
  // (ไม่แตะ internals นอกจาก return value) ที่นี่แค่คุม busy state ระหว่างรอ แล้วปิดกล่องเฉพาะตอนลบ
  // สำเร็จจริงเท่านั้น — ลบไม่สำเร็จต้องเปิดกล่องค้างไว้ให้ผู้ใช้กดลองใหม่ได้ ไม่ใช่ปิดเงียบๆ
  const confirmDeleteYear = async () => {
    setDeleteBusy(true);
    const deleted = await handleDelete(selectedYear);
    setDeleteBusy(false);
    if (deleted) setConfirmDeleteOpen(false);
  };

  // เปิดกล่อง: จำปุ่มที่เปิดไว้ก่อน แล้วหน่วง 40ms ค่อยย้าย focus เข้ากล่อง (ให้ผ่านช่วง mount —
  // รูปแบบเดียวกับ RevolvingConfirmDialog/UnsavedChangesDialog) ปิดกล่อง (ทุกทาง): คืน focus ให้ปุ่มเดิม
  useEffect(() => {
    if (!confirmDeleteOpen) return undefined;
    deleteTriggerRef.current = typeof document !== 'undefined' ? document.activeElement as HTMLElement | null : null;
    const timer = setTimeout(() => cancelDeleteButtonRef.current?.focus(), 40);
    return () => {
      clearTimeout(timer);
      deleteTriggerRef.current?.focus?.();
    };
  }, [confirmDeleteOpen]);

  // Escape ปิดกล่องเสมอ (ทางเลือกปลอดภัย ไม่เคยตีความเป็นยืนยัน) · Tab วนอยู่ในกล่องผ่าน getTabbableElements
  // (ไม่ใช่ raw selector — ป้องกัน BUG-4 เช่นเดียวกับที่อื่นในโค้ดฐานนี้)
  useEffect(() => {
    if (!confirmDeleteOpen) return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        setConfirmDeleteOpen(false);
        return;
      }
      if (event.key !== 'Tab' || !deleteDialogRef.current) return;
      const focusable = getTabbableElements(deleteDialogRef.current);
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
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [confirmDeleteOpen]);

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
        const salaryData = data as {
          summary?: Record<string, unknown>;
          deduct?: Record<string, unknown>;
        } | null | undefined;
        const totalIncome = salaryData?.summary?.total_income ?? 0;
        const tax = salaryData?.deduct?.tax ?? 0;
        const provident = salaryData?.deduct?.provident_fund ?? 0;
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
    } catch (error) {
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
  const handleSave = async (): Promise<void> => {
    try {
      await taxAPI.saveYearly(selectedYear, {
        monthly_tax: monthlyTax,
        monthly_income: monthlyIncome,
        monthly_provident: monthlyProvident
      });
      showToast('บันทึกข้อมูลภาษีสำเร็จ');
      if (!document.activeElement?.closest('[data-tax-month-row]')) projection.refresh();
      onSaved?.();
    } catch (error) {
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

  // โหลดข้อมูลภาษีและ provident เมื่อปีที่เลือกเปลี่ยน
  useEffect(() => {
    let cancelled = false;
    const fetchTaxData = async () => {
      setListLoad(previous => ({ ...previous, loading: true, failed: false }));
      try {
        const data = await taxAPI.getByYear(selectedYear);
        if (cancelled) return;
        const targetYear = data ? (data[selectedYear] ? selectedYear : Object.keys(data)[0]) : undefined;
        const yearData = targetYear ? data[targetYear] : undefined;
        const default12 = createDefault12MonthsObject('0.00');
        setMonthlyTax((yearData && yearData.monthly_tax) ? yearData.monthly_tax : { ...default12 });
        setMonthlyIncome((yearData && yearData.monthly_income) ? yearData.monthly_income : { ...default12 });
        setMonthlyProvident((yearData && yearData.monthly_provident) ? yearData.monthly_provident : { ...default12 });
        setListLoad(previous => ({ loading: false, failed: false, revision: previous.revision + 1 }));
      } catch (error) {
        if (cancelled) return;
        const default12 = createDefault12MonthsObject('0.00');
        setMonthlyTax({ ...default12 });
        setMonthlyIncome({ ...default12 });
        setMonthlyProvident({ ...default12 });
        setListLoad(previous => ({ loading: false, failed: true, revision: previous.revision + 1 }));
      }
    };
    fetchTaxData();
    return () => { cancelled = true; };
  }, [selectedYear, salaryUpdateTrigger]);

  const updateMonthlyInput = (value: string, setValues: Dispatch<SetStateAction<MonthValues>>, month: string) => {
    handleNumberInput(value, setValues as (arg: unknown) => void, month);
  };

  const blurMonthlyInput = (value: string, setValues: Dispatch<SetStateAction<MonthValues>>, month: string) => {
    handleNumberBlur(value, setValues as (arg: unknown) => void, month);
  };

  const calculateAccumulatedTax = (upToMonth: string) => sumAccumulated(monthlyTax, upToMonth, parseToNumber);

  // ฟังก์ชันคำนวณรายได้สะสมถึงเดือนที่กำหนด
  const calculateAccumulatedIncome = (upToMonth: string) => sumAccumulated(monthlyIncome, upToMonth, parseToNumber);

  const getSumDisplay = (obj: MonthValues) => {
    const sum = Object.values(obj).reduce((acc, value) => acc + (parseFloat(String(value).replace(/,/g, '')) || 0), 0);
    return formatCurrency(sum);
  };

  return (
    <div>
      <h2 className="mb-space-4 text-xl font-semibold text-primary">ภาษีสะสม</h2>

      <div className="mb-space-4 flex flex-wrap items-center gap-space-2">
        <label className="text-sm text-secondary">เลือกปี:</label>
        <select
          value={selectedYear}
          onChange={(event) => setSelectedYear(event.target.value)}
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
              const years = Object.keys(allYearData).map(year => parseInt(year) + 543);
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
        <button
          type="button"
          onClick={() => {
            if (!selectedYear || !allYearData[selectedYear]) return;
            setConfirmDeleteOpen(true);
          }}
          className={BTN_DANGER}
        >
          ลบข้อมูลปี พ.ศ. {parseInt(selectedYear) + 543}
        </button>
      </div>

      {confirmDeleteOpen && (
        <div
          className={formStyles.backdrop}
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setConfirmDeleteOpen(false);
          }}
        >
          <div
            ref={deleteDialogRef}
            className={`${formStyles.modal} ${formStyles.modalNarrow}`}
            role="alertdialog"
            aria-modal="true"
            aria-label={`ลบข้อมูลปี พ.ศ. ${parseInt(selectedYear) + 543}`}
          >
            <div className={formStyles.modalHeader}>
              <h2 className={formStyles.modalTitle}>{`ลบข้อมูลปี พ.ศ. ${parseInt(selectedYear) + 543}`}</h2>
              <button
                type="button"
                className={formStyles.closeButton}
                onClick={() => setConfirmDeleteOpen(false)}
                aria-label="ปิด"
              >
                <Icons.X size={18} />
              </button>
            </div>
            <div className={formStyles.modalBody}>
              <p className={formStyles.confirmText}>
                {`ข้อมูลภาษี รายรับ และกองทุนสำรองเลี้ยงชีพทั้ง 12 เดือนของปี พ.ศ. ${parseInt(selectedYear) + 543} `
                  + 'จะถูกลบถาวรและไม่สามารถกู้คืนได้'}
              </p>
            </div>
            <div className={formStyles.modalFooter}>
              <button
                ref={cancelDeleteButtonRef}
                type="button"
                className={formStyles.secondaryButton}
                onClick={() => setConfirmDeleteOpen(false)}
              >
                ยกเลิก
              </button>
              <button
                type="button"
                className={formStyles.dangerButton}
                onClick={confirmDeleteYear}
                disabled={deleteBusy}
              >
                {deleteBusy ? 'กำลังลบ...' : 'ลบข้อมูล'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showAddForm && (
        <div className="mb-space-4 rounded-md border border-border-subtle bg-surface-2 p-space-4">
          <h4 className="mb-space-3 text-sm font-semibold text-primary">เพิ่มปีใหม่</h4>
          <div className="flex flex-wrap items-center gap-space-2">
            <label className="text-sm text-secondary">ปี พ.ศ.:</label>
            <input
              type="text"
              inputMode="numeric"
              value={newYear}
              onChange={(event) => setNewYear(event.target.value)}
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

      {listLoad.loading ? <p role="status" className="text-sm text-secondary">กำลังโหลดข้อมูลภาษี...</p>
        : listLoad.failed ? <p role="alert" className="text-sm text-neg">โหลดข้อมูลภาษีไม่สำเร็จ</p>
          : <ListToolbar label="เดือนภาษี" criteria={criteria} onChange={setCriteria} search={false}
            visible={projection.items.length} total={MONTHS.length} changed={projection.changed} onRefresh={projection.refresh}
            helper="ยอดรวมทั้งปีและยอดสะสมคำนวณจากข้อมูลครบทุกเดือนตามลำดับเวลา"
            error={rangeError ? 'เดือนสิ้นสุดต้องไม่ก่อนเดือนเริ่มต้น — ยังคงแสดงผลช่วงล่าสุดที่ถูกต้อง' : undefined}
            filters={[
              { key: 'start', label: 'ตั้งแต่เดือน', type: 'month', min: `${selectedYear}-01`, max: `${selectedYear}-12` },
              { key: 'end', label: 'ถึงเดือน', type: 'month', min: `${selectedYear}-01`, max: `${selectedYear}-12` },
              { key: 'amount', label: 'ภาษีรายเดือน', options: [{ value: 'zero', label: 'ยอดเป็นศูนย์' }, { value: 'nonzero', label: 'ยอดไม่เป็นศูนย์' }] }
            ]}
            orders={[
              { value: 'month:asc', label: 'เดือน: เก่าไปใหม่' }, { value: 'month:desc', label: 'เดือน: ใหม่ไปเก่า' },
              { value: 'tax:asc', label: 'ภาษีรายเดือน: น้อยไปมาก' }, { value: 'tax:desc', label: 'ภาษีรายเดือน: มากไปน้อย' }
            ]} />}

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
                <th className="p-space-3 text-right text-xs font-medium text-secondary">{taxKeyThaiMapping.monthly_tax} (บาท)</th>
                <th className="p-space-3 text-right text-xs font-medium text-secondary">{taxKeyThaiMapping.accumulated_tax} (บาท)</th>
              </tr>
            </thead>
            <tbody>
              {projection.items.map(({ month, name }) => {
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
                        onChange={event => updateMonthlyInput(event.target.value, setMonthlyIncome, month)}
                        onBlur={event => blurMonthlyInput(event.target.value, setMonthlyIncome, month)}
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
                        onChange={event => updateMonthlyInput(event.target.value, setMonthlyProvident, month)}
                        onBlur={event => blurMonthlyInput(event.target.value, setMonthlyProvident, month)}
                        onFocus={handleAmountInputFocus}
                        placeholder="กองทุนสำรองเลี้ยงชีพ"
                        className={`${INPUT} text-right font-[family-name:var(--font-numeric)] tabular-nums`}
                      />
                    </td>
                    <td className="p-space-3 align-middle">
                      <input
                        type="text"
                        value={monthlyTaxVal}
                        onChange={event => updateMonthlyInput(event.target.value, setMonthlyTax, month)}
                        onBlur={event => blurMonthlyInput(event.target.value, setMonthlyTax, month)}
                        onFocus={handleAmountInputFocus}
                        placeholder={taxKeyThaiMapping.monthly_tax}
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
        {projection.items.map(({ month, name }) => {
          const accumulatedTaxVal = calculateAccumulatedTax(month);
          const accumulatedIncomeVal = calculateAccumulatedIncome(month);
          const income = monthlyIncome[month] || '0.00';
          const provident = monthlyProvident?.[month] || '0.00';
          const monthlyTaxVal = monthlyTax[month] || '0.00';
          return (
            <div data-tax-month-row className="rounded-md border border-border-default bg-surface-2 p-space-4" key={month}>
              <div className="mb-space-2 text-sm font-semibold text-primary">{name}</div>
              <div className="flex flex-col gap-space-2">
                <label className="flex flex-col gap-space-1">
                  <span className="text-xs text-secondary">รายรับ</span>
                  <input
                    type="text"
                    value={income}
                    onChange={event => updateMonthlyInput(event.target.value, setMonthlyIncome, month)}
                    onBlur={event => blurMonthlyInput(event.target.value, setMonthlyIncome, month)}
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
                    onChange={event => updateMonthlyInput(event.target.value, setMonthlyProvident, month)}
                    onBlur={event => blurMonthlyInput(event.target.value, setMonthlyProvident, month)}
                    onFocus={handleAmountInputFocus}
                    placeholder="กองทุนสำรองเลี้ยงชีพ"
                    className={`${INPUT} text-right font-[family-name:var(--font-numeric)] tabular-nums`}
                  />
                </label>
                <label className="flex flex-col gap-space-1">
                  <span className="text-xs text-secondary">{taxKeyThaiMapping.monthly_tax}</span>
                  <input
                    type="text"
                    value={monthlyTaxVal}
                    onChange={event => updateMonthlyInput(event.target.value, setMonthlyTax, month)}
                    onBlur={event => blurMonthlyInput(event.target.value, setMonthlyTax, month)}
                    onFocus={handleAmountInputFocus}
                    placeholder={taxKeyThaiMapping.monthly_tax}
                    className={`${INPUT} text-right font-[family-name:var(--font-numeric)] tabular-nums`}
                  />
                </label>
                <div className="flex items-center justify-between text-xs text-tertiary">
                  <span>{taxKeyThaiMapping.accumulated_tax}</span>
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