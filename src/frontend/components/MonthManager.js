/**
 * คอมโพเนนต์: MonthManager
 * จัดการการเลือกเดือนและการเพิ่มเดือนใหม่
 * รายชื่อเดือนสำหรับ <select> รับมาจาก props.months (ค้นพบแล้วโดย WorkspaceShell) แทนการ fetch เอง
 * (Amendment A5 / AC-A5-9 — ดูคอมเมนต์ที่ประกาศ monthOptions ด้านล่าง)
 * @param {object} props
 * @param {string} props.selectedMonth - เดือนที่เลือก (YYYY-MM)
 * @param {function} props.onMonthSelected - callback เมื่อเลือกเดือน
 * @param {function} props.onDataRefresh - callback เมื่อข้อมูลเปลี่ยน
 * @param {string[]} props.months - รายชื่อเดือน (YYYY-MM) ที่ WorkspaceShell ค้นพบแล้ว เรียงใหม่ -> เก่า
 */

import React, { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { getNextMonth } from '../../shared/utils/frontend/numberUtils';
import { getMonthData, getPrevMonth, formatMonthLabelTH } from '../../shared/utils/frontend/monthUtils';
import { showToast } from '../../shared/utils/frontend/toast';
import styles from '../styles/MonthManager.module.css';

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
const MonthManager = ({ selectedMonth, onMonthSelected, onDataRefresh, months }) => {
  const [showAddForm, setShowAddForm] = useState(false);
  const [newMonthName, setNewMonthName] = useState('');

  // ตัวเลือกเดือนของ <select> — มาจาก props.months (WorkspaceShell ค้นพบแล้วครั้งเดียวต่อ session ผ่าน
  // fetchMonths + monthsCache ของมันเอง) ไม่ fetch 5-endpoint union ซ้ำเองอีกต่อไป (AC-A5-9 fix)
  // เดิม MonthManager มี fetch อิสระของตัวเองตรงนี้ สมัย P3 (หน้าเดียวหลายแท็บ) ไม่มีปัญหาเพราะ
  // MonthManager mount ครั้งเดียวต่อการเข้าหน้า แต่ภายใต้สถาปัตยกรรม per-route ของ A5 คอมโพเนนต์นี้เป็นลูก
  // ของ WorkspaceShell ซึ่ง mount ใหม่ทุกครั้งที่สลับ section — fetch คู่ขนานนี้จึงยิงซ้ำทุกครั้งที่นำทาง
  // (16 request ส่วนเกินจาก 6 การนำทางที่วัดได้จริง) ใช้เดือนที่พ่อแม่ค้นพบแล้วแทน ไม่มี fetch ของตัวเอง
  const monthOptions = useMemo(
    () => (months || []).map(month => ({ value: month, label: formatMonthLabelTH(month) })),
    [months]
  );

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

  useEffect(() => {
    if (!showAddForm || typeof document === 'undefined') {
      return undefined;
    }

    const { body } = document;
    const previousOverflow = body.style.overflow;
    body.style.overflow = 'hidden';

    return () => {
      body.style.overflow = previousOverflow;
    };
  }, [showAddForm]);

  // สร้างเดือนใหม่ (ข้อมูลเปล่า)
  const handleAddNewMonth = async () => {
    const nextMonth = getNextMonth(selectedMonth);
    try {
      const { expenseAPI, incomeAPI, salaryAPI, savingsAPI, investmentAPI } = await import('../../shared/utils/frontend/apiUtils');
      // Save new month data
      await Promise.all([
        expenseAPI.save(nextMonth, {}),
        incomeAPI.save(nextMonth, {}),
        salaryAPI.save(nextMonth, {}, {}, ''),
        savingsAPI.saveList ? savingsAPI.saveList(nextMonth, []) : Promise.resolve(),
        investmentAPI.saveList ? investmentAPI.saveList(nextMonth, []) : Promise.resolve()
      ]);

      // หมายเหตุ: เดิมมีขั้นตอนดึงรายชื่อเดือนทั้งหมดแล้วลบเดือนเก่าสุดถ้าเกิน 15 เดือนอยู่ตรงนี้
      // แต่ expenseAPI/incomeAPI/savingsAPI/investmentAPI ไม่มี .delete() จริง (มีแค่ salaryAPI.delete)
      // จึงไม่เคยลบข้อมูล 4 ใน 5 อย่างได้จริงมาก่อน — เอาออกเพราะตอนนี้ฝั่ง server (POST ของแต่ละ
      // collection) บังคับหน้าต่าง 15 เดือนร่วมกันให้แล้วโดยอัตโนมัติทุกครั้งที่ save ด้านบน
      // (ดู sharedMonthWindow.js) การเก็บ logic นี้ไว้จะกลายเป็น enforcement คู่ขนานที่อาจไม่ตรงกัน

      onMonthSelected(nextMonth);
      onDataRefresh();
      setShowAddForm(false);
      setNewMonthName('');
    } catch (err) {
      showToast(err?.message || 'สร้างเดือนใหม่ไม่สำเร็จ', 'error');
    }
  };

  // คัดลอกข้อมูลจากเดือนก่อนหน้า
  const handleCopyPrevMonth = async () => {
    if (!selectedMonth || !/^\d{4}-\d{2}$/.test(selectedMonth)) {
      showToast('กรุณาเลือกเดือนที่ต้องการก่อน', 'info');
      return;
    }
    try {
      const prevMonth = getPrevMonth(selectedMonth);
      const { expenseAPI, incomeAPI, salaryAPI, savingsAPI, investmentAPI, dailyExpenseAPI } = await import('../../shared/utils/frontend/apiUtils');
      const [expenseAll, incomeAll, salaryPrevDoc, savingsAll, investmentAll, dailyExpensePrevDoc] = await Promise.all([
        expenseAPI.getAll(),
        incomeAPI.getAll(),
        // ใช้ endpoint เดียวกับที่ SalaryCalculator ใช้แสดงผล เพื่อให้ได้ค่าที่ "carry-forward" มาแล้วจริง ๆ
        // (ไม่ใช้ getAll() + getMonthData() เพราะจะได้แค่ record ที่ persist จริง ไม่รวม carry-forward)
        salaryAPI.getByMonth(prevMonth),
        savingsAPI.getAll ? savingsAPI.getAll() : Promise.resolve({}),
        investmentAPI.getAll ? investmentAPI.getAll() : Promise.resolve({}),
        dailyExpenseAPI.getByMonth(prevMonth)
      ]);
      // ดึงข้อมูลเดือนก่อนหน้า
      const expensePrevRaw = getMonthData(expenseAll, prevMonth);
      const expensePrev = resetCopiedExpensePaidStatus(expensePrevRaw);
      const incomePrev = getMonthData(incomeAll, prevMonth);
      let savingsPrev = [];
      if (savingsAll && savingsAll.savings_list && savingsAll.savings_list[prevMonth]) {
        savingsPrev = JSON.parse(JSON.stringify(savingsAll.savings_list[prevMonth]));
      }
      let investmentPrev = [];
      if (investmentAll && investmentAll[prevMonth]) {
        investmentPrev = JSON.parse(JSON.stringify(investmentAll[prevMonth]));
      }
      const dailyExpensePrev = dailyExpensePrevDoc?.items || [];
      await Promise.all([
        expenseAPI.save(selectedMonth, expensePrev),
        incomeAPI.save(selectedMonth, incomePrev),
        salaryAPI.save(
          selectedMonth,
          salaryPrevDoc?.income || {},
          salaryPrevDoc?.deduct || {},
          salaryPrevDoc?.note || ''
        ),
        savingsAPI.saveList ? savingsAPI.saveList(selectedMonth, savingsPrev) : Promise.resolve(),
        investmentAPI.saveList ? investmentAPI.saveList(selectedMonth, investmentPrev) : Promise.resolve(),
        dailyExpenseAPI.save(selectedMonth, dailyExpensePrev)
      ]);
      onMonthSelected(selectedMonth);
      onDataRefresh();
    } catch (err) {
      showToast(err?.message || 'คัดลอกข้อมูลจากเดือนก่อนหน้าไม่สำเร็จ', 'error');
    }
  };

  const handleCustomMonth = () => {
    if (newMonthName.trim()) {
      // สร้างเดือนใหม่จากที่กรอก (format: YYYY-MM)
      if (/^\d{4}-\d{2}$/.test(newMonthName)) {
          onMonthSelected(newMonthName);
        setShowAddForm(false);
        setNewMonthName('');
      } else {
        showToast('รูปแบบไม่ถูกต้อง กรุณากรอก YYYY-MM เช่น 2025-10', 'error');
      }
    }
  };

  // Debug log
  return (
    <div className={styles.monthManager}>
      {/* แสดงเดือนปัจจุบันและ dropdown เลือกเดือน */}
      <div className={styles.currentMonthDisplay}>
        <div className={styles.monthSelectionRow}>
          <div className={styles.monthLabelGroup}>
            <span className={styles.monthLabel}>เดือนที่กำลังวางแผน</span>
            <span className={styles.monthHint}>เลือกเดือนเพื่อดูและวางแผนการเงิน</span>
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
          <span className={styles.monthLabel}>เริ่มต้นแผนของเดือน</span>
          <span className={styles.monthHint}>สร้างเดือนใหม่หรือใช้ข้อมูลเดือนก่อนหน้าเป็นจุดเริ่มต้น</span>
        </div>
        <div className={styles.monthActionButtons}>
          <button
            onClick={() => setShowAddForm(!showAddForm)}
            className={`${styles.addMonthBtn} ${styles.actionButton}`}
            aria-label="เพิ่มเดือนใหม่"
            tabIndex={0}
          >
            <span className={styles.actionButtonTitle}>+ เพิ่มเดือนใหม่</span>
            <span className={styles.actionButtonHint}>สร้างเดือนถัดไปพร้อมหน้ากระดาษว่าง</span>
          </button>
          <button
            onClick={handleCopyPrevMonth}
            className={`${styles.addMonthBtn} ${styles.addMonthBtnMargin} ${styles.actionButton}`}
            aria-label="คัดลอกข้อมูลจากเดือนก่อนหน้า"
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

    </div>
  );
};

export default MonthManager;