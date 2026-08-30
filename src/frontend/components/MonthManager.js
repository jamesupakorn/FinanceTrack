/**
 * คอมโพเนนต์: MonthManager
 * จัดการการเลือกเดือนและการเพิ่มเดือนใหม่
 * รวมเดือนจากหลายแหล่งข้อมูล (รายรับ/รายจ่าย/เงินเดือน/ลงทุน)
 * @param {object} props
 * @param {string} props.selectedMonth - เดือนที่เลือก (YYYY-MM)
 * @param {function} props.onMonthSelected - callback เมื่อเลือกเดือน
 * @param {function} props.onDataRefresh - callback เมื่อข้อมูลเปลี่ยน
 */

import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { getNextMonth } from '../../shared/utils/frontend/numberUtils';
import { getMonthData, getPrevMonth, formatMonthLabelTH } from '../../shared/utils/frontend/monthUtils';
import { showToast } from '../../shared/utils/frontend/toast';
import styles from '../styles/MonthManager.module.css';

// หาค่าเดือนปัจจุบัน (YYYY-MM)
const getCurrentMonth = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
};

const isValidMonth = (month) => {
  if (!/^\d{4}-\d{2}$/.test(month)) return false;
  const [, monthNumber] = month.split('-').map(Number);
  return monthNumber >= 1 && monthNumber <= 12;
};

// รีเซ็ตสถานะ paid ของข้อมูลรายจ่ายให้เป็น false ทั้งหมด
const resetCopiedExpensePaidStatus = (expenseData) => {
  if (!expenseData || typeof expenseData !== 'object') return {};
  const normalized = {};
  Object.entries(expenseData).forEach(([key, value]) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      normalized[key] = value;
      return;
    }
    normalized[key] = {
      ...value,
      paid: false
    };
  });
  return normalized;
};


/**
 * ตัวจัดการเลือกเดือน
 */
const MonthManager = ({ selectedMonth, onMonthSelected, onDataRefresh }) => {
  const [showAddForm, setShowAddForm] = useState(false);
  const [showCopyConfirmation, setShowCopyConfirmation] = useState(false);
  const [newMonthName, setNewMonthName] = useState('');
  const [monthOptions, setMonthOptions] = useState([]);
  const [pendingAction, setPendingAction] = useState('');

  // ถ้า selectedMonth ไม่มีใน monthOptions ให้เลือกเดือนล่าสุดอัตโนมัติ
  useEffect(() => {
    if (monthOptions.length > 0) {
      const monthValues = monthOptions.map(opt => opt.value);
      if (!selectedMonth || !monthValues.includes(selectedMonth)) {
        // เลือกเดือนล่าสุด (ตัวแรกใน options เพราะเรียงใหม่ -> เก่า)
        onMonthSelected(monthOptions[0].value);
      }
    }
  }, [monthOptions, selectedMonth, onMonthSelected]);

  // ดึงและรวมเดือนจากทุกแหล่งข้อมูล
  useEffect(() => {
    let isMounted = true;
    const fetchMonths = async () => {
      const { expenseAPI, incomeAPI, salaryAPI, investmentAPI } = await import('../../shared/utils/frontend/apiUtils');
      const [expenseData, incomeData, salaryData, investmentData] = await Promise.all([
        expenseAPI.getAll(),
        incomeAPI.getAll(),
        salaryAPI.getAll(),
        investmentAPI.getAll()
      ]);
      // รวมเดือนจากทุกแหล่ง
      const getMonths = data => (data?.months ? Object.keys(data.months) : []);
      const getSalaryMonths = data => (data?.months
        ? Object.entries(data.months)
          .filter(([, doc]) => {
            if (!doc || typeof doc !== 'object') return false;
            const note = typeof doc.note === 'string' ? doc.note.trim() : '';
            const summary = doc.summary || {};
            const hasSummary = [summary.total_income, summary.total_deduct, summary.net_income]
              .some(value => Number(value) > 0);
            const income = doc.income || {};
            const deduct = doc.deduct || {};
            const hasIncome = Object.values(income).some(value => Number(value) > 0);
            const hasDeduct = Object.values(deduct).some(value => Number(value) > 0);
            return hasSummary || hasIncome || hasDeduct || note.length > 0;
          })
          .map(([month]) => month)
        : []);
      const getInvestmentMonths = data => (data && typeof data === 'object'
        ? Object.keys(data).filter(key => key !== 'months')
        : []);
      const allMonthsSet = new Set([
        ...getMonths(expenseData),
        ...getMonths(incomeData),
        ...getSalaryMonths(salaryData),
        ...getInvestmentMonths(investmentData)
      ]);
      const validMonthRegex = /^\d{4}-\d{2}$/;
      const allMonths = Array.from(allMonthsSet)
        .filter(month => validMonthRegex.test(month))
        .sort((a, b) => b.localeCompare(a));
      const monthsToUse = allMonths.length ? allMonths : [getCurrentMonth()];
      const options = monthsToUse.map(month => ({
        value: month,
        label: formatMonthLabelTH(month)
      }));
      if (isMounted) setMonthOptions(options);
    };
    fetchMonths();
    return () => { isMounted = false; };
  }, [showAddForm, onDataRefresh]);

  useEffect(() => {
    if ((!showAddForm && !showCopyConfirmation) || typeof document === 'undefined') {
      return undefined;
    }

    const { body } = document;
    const previousOverflow = body.style.overflow;
    body.style.overflow = 'hidden';

    return () => {
      body.style.overflow = previousOverflow;
    };
  }, [showAddForm, showCopyConfirmation]);

  const createEmptyMonth = async (month) => {
    if (!isValidMonth(month)) {
      showToast('รูปแบบเดือนไม่ถูกต้อง กรุณาเลือกเดือนที่ถูกต้อง', 'error');
      return false;
    }

    if (monthOptions.some(option => option.value === month)) {
      showToast(`มีข้อมูลเดือน ${formatMonthLabelTH(month)} อยู่แล้ว`, 'info');
      return false;
    }

    setPendingAction('create');
    const { expenseAPI, incomeAPI, salaryAPI, savingsAPI, investmentAPI } = await import('../../shared/utils/frontend/apiUtils');
    try {
      await Promise.all([
        expenseAPI.save(month, {}),
        incomeAPI.save(month, {}),
        salaryAPI.save(month, {}, {}, ''),
        savingsAPI.saveList ? savingsAPI.saveList(month, []) : Promise.resolve(),
        investmentAPI.saveList ? investmentAPI.saveList(month, []) : Promise.resolve()
      ]);

      onMonthSelected(month);
      onDataRefresh();
      setShowAddForm(false);
      setNewMonthName('');
      showToast(`เพิ่มเดือน ${formatMonthLabelTH(month)} แล้ว`, 'success');
      return true;
    } catch (error) {
      showToast(error.message || 'ไม่สามารถเพิ่มเดือนได้', 'error');
      return false;
    } finally {
      setPendingAction('');
    }
  };

  // สร้างเดือนใหม่ (ข้อมูลเปล่า)
  const handleAddNewMonth = () => createEmptyMonth(getNextMonth(selectedMonth));

  const handleCopyPrevMonth = () => {
    if (!isValidMonth(selectedMonth)) {
      showToast('กรุณาเลือกเดือนที่ต้องการก่อน', 'info');
      return;
    }

    setShowCopyConfirmation(true);
  };

  const confirmCopyPrevMonth = async () => {
    setShowCopyConfirmation(false);
    setPendingAction('copy');
    try {
      const prevMonth = getPrevMonth(selectedMonth);
      const { expenseAPI, incomeAPI, salaryAPI, savingsAPI, investmentAPI, dailyExpenseAPI } = await import('../../shared/utils/frontend/apiUtils');
      const [expenseAll, incomeAll, salaryPrevDoc, savingsAll, investmentAll, dailyExpensePrevDoc] = await Promise.all([
        expenseAPI.getAll(),
        incomeAPI.getAll(),
        salaryAPI.getByMonth(prevMonth),
        savingsAPI.getAll ? savingsAPI.getAll() : Promise.resolve({}),
        investmentAPI.getAll ? investmentAPI.getAll() : Promise.resolve({}),
        dailyExpenseAPI.getByMonth(prevMonth)
      ]);
      const expensePrev = resetCopiedExpensePaidStatus(getMonthData(expenseAll, prevMonth));
      const incomePrev = getMonthData(incomeAll, prevMonth);
      const savingsPrev = savingsAll?.savings_list?.[prevMonth]
        ? JSON.parse(JSON.stringify(savingsAll.savings_list[prevMonth]))
        : [];
      const investmentPrev = investmentAll?.[prevMonth]
        ? JSON.parse(JSON.stringify(investmentAll[prevMonth]))
        : [];
      const dailyExpensePrev = dailyExpensePrevDoc?.items || [];
      await Promise.all([
        expenseAPI.save(selectedMonth, expensePrev),
        incomeAPI.save(selectedMonth, incomePrev),
        salaryAPI.save(selectedMonth, salaryPrevDoc?.income || {}, salaryPrevDoc?.deduct || {}, salaryPrevDoc?.note || ''),
        savingsAPI.saveList ? savingsAPI.saveList(selectedMonth, savingsPrev) : Promise.resolve(),
        investmentAPI.saveList ? investmentAPI.saveList(selectedMonth, investmentPrev) : Promise.resolve(),
        dailyExpenseAPI.save(selectedMonth, dailyExpensePrev)
      ]);
      onMonthSelected(selectedMonth);
      onDataRefresh();
      showToast(`คัดลอกข้อมูลจาก ${formatMonthLabelTH(prevMonth)} แล้ว`, 'success');
    } catch (error) {
      showToast(error.message || 'ไม่สามารถคัดลอกข้อมูลได้', 'error');
    } finally {
      setPendingAction('');
    }
  };

  const handleCustomMonth = () => {
    const month = newMonthName.trim();
    if (!isValidMonth(month)) {
      showToast('รูปแบบไม่ถูกต้อง กรุณากรอก YYYY-MM เช่น 2025-10', 'error');
      return;
    }
    return createEmptyMonth(month);
  };

  // Debug log
  return (
    <div className={styles.monthManager}>
      {/* แสดงเดือนปัจจุบันและ dropdown เลือกเดือน */}
      <div className={styles.currentMonthDisplay}>
        <div className={styles.monthSelectionRow}>
          <div className={styles.monthLabelGroup}>
            <span className={styles.monthLabel}>เดือนที่กำลังดู</span>
            <span className={styles.monthHint}>บันทึกไว้ตามบัญชีของคุณ</span>
          </div>
          <div className={styles.monthSelectWrapper}>
            <div className={styles.monthDisplayValue}>
              {selectedMonth ? formatMonthLabelTH(selectedMonth) : 'เลือกเดือน'}
            </div>
            <select 
              value={selectedMonth ?? ''} 
              onChange={(e) => onMonthSelected(e.target.value)}
              className={styles.monthSelect}
            >
              {monthOptions.map(option => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className={styles.monthActions}>
        <div className={styles.monthLabelGroup}>
          <span className={styles.monthLabel}>การจัดการเดือน</span>
          <span className={styles.monthHint}>เตรียมข้อมูลก่อนเริ่มบันทึกหรือแก้ไขรายการ</span>
        </div>
        <div className={styles.monthActionButtons}>
          <button
            onClick={() => setShowAddForm(!showAddForm)}
            className={`${styles.addMonthBtn} ${styles.actionButton}`}
            aria-label="เพิ่มเดือนใหม่"
            disabled={Boolean(pendingAction)}
            aria-busy={pendingAction === 'create'}
            tabIndex={0}
          >
            <span className={styles.actionButtonTitle}>+ เพิ่มเดือนใหม่</span>
            <span className={styles.actionButtonHint}>สร้างเดือนถัดไปพร้อมหน้ากระดาษว่าง</span>
          </button>
          <button
            onClick={handleCopyPrevMonth}
            className={`${styles.addMonthBtn} ${styles.addMonthBtnMargin} ${styles.actionButton}`}
            aria-label="คัดลอกข้อมูลจากเดือนก่อนหน้า"
            disabled={Boolean(pendingAction)}
            aria-busy={pendingAction === 'copy'}
            tabIndex={0}
          >
            <span className={styles.actionButtonTitle}>ดึงข้อมูลจากเดือนก่อนหน้า</span>
            <span className={styles.actionButtonHint}>คัดลอกทุกรายการมาแก้ไขต่อได้ทันที</span>
          </button>
        </div>
      </div>

      {showAddForm && typeof document !== 'undefined' && createPortal(
        <div className={styles.addMonthForm} tabIndex={-1} aria-modal="true" role="dialog">
          <div className={styles.formContent}>
            <button
              className={styles.closeModalBtn}
              aria-label="ปิดหน้าต่าง"
              onClick={() => setShowAddForm(false)}
              tabIndex={0}
            >
              ×
            </button>
            <h4>เพิ่มเดือนใหม่</h4>
            <button
              onClick={handleAddNewMonth}
              className={styles.quickAddBtn}
              aria-label={`เพิ่มเดือนถัดไป (${getNextMonth(selectedMonth)})`}
              disabled={Boolean(pendingAction)}
              tabIndex={0}
            >
              เดือนถัดไป ({getNextMonth(selectedMonth)})
            </button>
            <div className={styles.customMonth}>
              <input
                type="text"
                placeholder="YYYY-MM (เช่น 2025-10)"
                value={newMonthName}
                onChange={(e) => setNewMonthName(e.target.value)}
                className={styles.monthInput}
                aria-label="กรอกเดือนใหม่ (YYYY-MM)"
                tabIndex={0}
              />
              <button
                onClick={handleCustomMonth}
                className={styles.customAddBtn}
                aria-label="เพิ่มเดือนที่กรอกเอง"
                disabled={Boolean(pendingAction)}
                tabIndex={0}
              >
                เพิ่ม
              </button>
            </div>
            <button
              onClick={() => setShowAddForm(false)}
              className={styles.cancelBtn}
              aria-label="ยกเลิก"
              tabIndex={0}
            >
              ยกเลิก
            </button>
          </div>
        </div>,
        document.body
      )}

      {showCopyConfirmation && typeof document !== 'undefined' && createPortal(
        <div className={styles.addMonthForm} aria-modal="true" aria-describedby="copy-month-description" aria-labelledby="copy-month-title" role="alertdialog">
          <div className={`${styles.formContent} ${styles.copyConfirmContent}`}>
            <h4 id="copy-month-title">เขียนทับข้อมูลเดือนนี้?</h4>
            <p id="copy-month-description">
              ข้อมูลของ {formatMonthLabelTH(selectedMonth)} จะถูกแทนที่ด้วยข้อมูลจาก {formatMonthLabelTH(getPrevMonth(selectedMonth))}
            </p>
            <div className={styles.copyConfirmActions}>
              <button
                className={styles.cancelBtn}
                onClick={() => setShowCopyConfirmation(false)}
                type="button"
              >
                ยกเลิก
              </button>
              <button
                className={styles.quickAddBtn}
                onClick={confirmCopyPrevMonth}
                type="button"
              >
                เขียนทับและคัดลอก
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

    </div>
  );
};

export default MonthManager;