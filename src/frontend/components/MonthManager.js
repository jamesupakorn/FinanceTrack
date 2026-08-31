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

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { getNextMonth } from '../../shared/utils/frontend/numberUtils';
import { getMonthData, getPrevMonth, formatMonthLabelTH } from '../../shared/utils/frontend/monthUtils';
import { showToast } from '../../shared/utils/frontend/toast';
import { getTabbableElements } from '../../shared/utils/frontend/focusTrap';
import styles from '../styles/MonthManager.module.css';

// ตรวจรูปแบบเดือน: ต้องเป็น YYYY-MM และเลขเดือนต้องอยู่ในช่วง 1-12
// (regex อย่างเดียวไม่พอ — '2025-13' / '2025-00' ผ่าน regex แต่ไม่ใช่เดือนจริง)
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
const MonthManager = ({ selectedMonth, onMonthSelected, onDataRefresh, months }) => {
  const [showAddForm, setShowAddForm] = useState(false);
  const [showCopyConfirmation, setShowCopyConfirmation] = useState(false);
  const [newMonthName, setNewMonthName] = useState('');
  // 'create' | 'copy' | '' — งานสร้าง/คัดลอกเดือนที่กำลังทำงานอยู่ ใช้ปิดปุ่มทั้งสามระหว่างรอ
  const [pendingAction, setPendingAction] = useState('');
  // ref คู่ขนานกับ state ด้านบน: state ยังไม่ทันอัปเดตภายใน tick เดียวกัน การกดรัว ๆ (double-tap)
  // จึงเล็ดลอด guard ที่อ่านจาก state ได้ — ref อัปเดตทันทีจึงกัน re-entry ได้จริง
  const pendingRef = useRef('');

  const copyDialogRef = useRef(null);
  const copyCancelButtonRef = useRef(null);
  const copyTriggerRef = useRef(null);

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

  // ย้าย focus เข้ากล่องยืนยันทันทีที่เปิด (ไม่งั้น screen reader ไม่ประกาศ alertdialog) แล้วคืน focus
  // ให้ปุ่มที่เปิดตอนปิด — รูปแบบเดียวกับ UnsavedChangesDialog.js:48-56 (หน่วง 40ms ให้ผ่านช่วง mount)
  useEffect(() => {
    if (!showCopyConfirmation || typeof document === 'undefined') return undefined;
    copyTriggerRef.current = document.activeElement;
    const timer = setTimeout(() => copyCancelButtonRef.current?.focus(), 40);
    return () => {
      clearTimeout(timer);
      const opener = copyTriggerRef.current;
      // ถ้าปุ่มเดิมถูก disable ไปแล้ว (กดยืนยันแล้วกำลังคัดลอก) การ focus จะไม่มีผล — ข้ามไปเงียบ ๆ
      if (opener?.isConnected && !opener.disabled) opener.focus?.();
    };
  }, [showCopyConfirmation]);

  // focus trap + Esc — ใช้ getTabbableElements() ร่วมจาก focusTrap.js ห้ามใช้ raw selector (ต้นตอ BUG-4)
  useEffect(() => {
    if (!showCopyConfirmation || typeof document === 'undefined') return undefined;
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        setShowCopyConfirmation(false);
        return;
      }
      if (event.key !== 'Tab' || !copyDialogRef.current) return;
      const focusable = getTabbableElements(copyDialogRef.current);
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
  }, [showCopyConfirmation]);

  const startPendingAction = (action) => {
    if (pendingRef.current) return false;
    pendingRef.current = action;
    setPendingAction(action);
    return true;
  };

  const clearPendingAction = () => {
    pendingRef.current = '';
    setPendingAction('');
  };

  // สร้างเดือนเปล่า — ใช้ร่วมกันทั้งปุ่ม "เดือนถัดไป" และการกรอกเดือนเอง
  // ปฏิเสธเดือนที่มีอยู่แล้วด้วย toast แทนการ save ทับเงียบ ๆ (ข้อมูลเดิมของเดือนนั้นจะหายทันที)
  const createEmptyMonth = async (month) => {
    if (!isValidMonth(month)) {
      showToast('รูปแบบเดือนไม่ถูกต้อง กรุณาเลือกเดือนที่ถูกต้อง', 'error');
      return false;
    }

    if (monthOptions.some(option => option.value === month)) {
      showToast(`มีข้อมูลเดือน ${formatMonthLabelTH(month)} อยู่แล้ว`, 'info');
      return false;
    }

    if (!startPendingAction('create')) return false;

    try {
      const { expenseAPI, incomeAPI, salaryAPI, savingsAPI, investmentAPI } = await import('../../shared/utils/frontend/apiUtils');
      // Save new month data
      await Promise.all([
        expenseAPI.save(month, {}),
        incomeAPI.save(month, {}),
        salaryAPI.save(month, {}, {}, ''),
        savingsAPI.saveList ? savingsAPI.saveList(month, []) : Promise.resolve(),
        investmentAPI.saveList ? investmentAPI.saveList(month, []) : Promise.resolve()
      ]);

      // หมายเหตุ: เดิมมีขั้นตอนดึงรายชื่อเดือนทั้งหมดแล้วลบเดือนเก่าสุดถ้าเกิน 15 เดือนอยู่ตรงนี้
      // แต่ expenseAPI/incomeAPI/savingsAPI/investmentAPI ไม่มี .delete() จริง (มีแค่ salaryAPI.delete)
      // จึงไม่เคยลบข้อมูล 4 ใน 5 อย่างได้จริงมาก่อน — เอาออกเพราะตอนนี้ฝั่ง server (POST ของแต่ละ
      // collection) บังคับหน้าต่าง 15 เดือนร่วมกันให้แล้วโดยอัตโนมัติทุกครั้งที่ save ด้านบน
      // (ดู sharedMonthWindow.js) การเก็บ logic นี้ไว้จะกลายเป็น enforcement คู่ขนานที่อาจไม่ตรงกัน

      onMonthSelected(month);
      onDataRefresh();
      setShowAddForm(false);
      setNewMonthName('');
      showToast(`เพิ่มเดือน ${formatMonthLabelTH(month)} แล้ว`, 'success');
      return true;
    } catch (err) {
      showToast(err?.message || 'สร้างเดือนใหม่ไม่สำเร็จ', 'error');
      return false;
    } finally {
      clearPendingAction();
    }
  };

  // สร้างเดือนใหม่ (ข้อมูลเปล่า) — เดือนถัดจากเดือนที่เลือกอยู่
  const handleAddNewMonth = () => createEmptyMonth(getNextMonth(selectedMonth));

  // คัดลอกข้อมูลจากเดือนก่อนหน้า — ขั้นนี้แค่ตรวจความถูกต้องแล้วเปิดกล่องยืนยัน
  // การเขียนจริงอยู่ใน confirmCopyPrevMonth() เพราะมันทับข้อมูลของเดือนที่เลือกทั้งหมด
  const handleCopyPrevMonth = () => {
    if (!isValidMonth(selectedMonth)) {
      showToast('กรุณาเลือกเดือนที่ต้องการก่อน', 'info');
      return;
    }
    if (pendingRef.current) return;
    setShowCopyConfirmation(true);
  };

  const confirmCopyPrevMonth = async () => {
    setShowCopyConfirmation(false);
    if (!startPendingAction('copy')) return;
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
      showToast(`คัดลอกข้อมูลจาก ${formatMonthLabelTH(prevMonth)} แล้ว`, 'success');
    } catch (err) {
      showToast(err?.message || 'คัดลอกข้อมูลจากเดือนก่อนหน้าไม่สำเร็จ', 'error');
    } finally {
      clearPendingAction();
    }
  };

  // สร้างเดือนใหม่จากที่กรอกเอง (format: YYYY-MM)
  const handleCustomMonth = () => {
    const month = newMonthName.trim();
    if (!isValidMonth(month)) {
      showToast('รูปแบบไม่ถูกต้อง กรุณากรอก YYYY-MM เช่น 2025-10', 'error');
      return undefined;
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

      {/* กล่องยืนยันก่อนเขียนทับ — ใช้ portal/คลาสชุดเดียวกับโมดัลเพิ่มเดือนด้านบน แต่เป็น role="alertdialog"
          พร้อม focus trap ตามแบบ UnsavedChangesDialog.js (ห้ามใช้ window.confirm — DECISIONS/006 Decision 2) */}
      {showCopyConfirmation && typeof document !== 'undefined' && createPortal(
        <div
          className={styles.addMonthForm}
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setShowCopyConfirmation(false);
          }}
        >
          <div
            ref={copyDialogRef}
            className={`${styles.formContent} ${styles.copyConfirmContent}`}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="copy-month-title"
            aria-describedby="copy-month-description"
          >
            <h4 id="copy-month-title">เขียนทับข้อมูลเดือนนี้?</h4>
            <p id="copy-month-description">
              ข้อมูลของ {formatMonthLabelTH(selectedMonth)} จะถูกแทนที่ด้วยข้อมูลจาก {formatMonthLabelTH(getPrevMonth(selectedMonth))}
            </p>
            <div className={styles.copyConfirmActions}>
              <button
                ref={copyCancelButtonRef}
                type="button"
                className={styles.cancelBtn}
                onClick={() => setShowCopyConfirmation(false)}
                tabIndex={0}
              >
                ยกเลิก
              </button>
              <button
                type="button"
                className={styles.quickAddBtn}
                onClick={confirmCopyPrevMonth}
                tabIndex={0}
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