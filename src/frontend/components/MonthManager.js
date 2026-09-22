/**
 * คอมโพเนนต์: MonthManager
 * จัดการการเลือกเดือนและการเพิ่มเดือนใหม่
 * รายชื่อเดือนสำหรับ <select> รับมาจาก props.months (ค้นพบแล้วโดย WorkspaceShell) แทนการ fetch เอง
 * (Amendment A5 / AC-A5-9 — ดูคอมเมนต์ที่ประกาศ monthOptions ด้านล่าง)
 *
 * Graphite redesign (income-expense-graphite pass, architecture-review Finding 4) — decomposition,
 * not a restyle: เดิมคอมโพเนนต์นี้เรนเดอร์เป็นการ์ดใหญ่ที่แสดงตลอดเวลาอยู่ใน .tabContent ตอนนี้ทั้งก้อน
 * (select + คำอธิบาย + ปุ่มเพิ่ม/คัดลอกเดือน + โมดัลทั้งสอง) กลายเป็น "ตัวเลือกเดือนแบบเต็ม" ที่ซ่อนอยู่
 * เบื้องหลัง tap-to-open — เปิด/ปิดคุมโดย WorkspaceShell ผ่าน props `open`/`onRequestClose` (แถบสั้น
 * [◀ label ▶] ที่ sticky ในเฮดเดอร์ยังอยู่ที่ WorkspaceShell เอง เพราะ handler เดิม
 * (guardedMonthChange/handlePrevMonth/handleNextMonth) ก็อยู่ที่นั่นอยู่แล้ว — "ย้ายที่แสดงผล ไม่ย้าย
 * logic" ตามที่ architecture review กำหนดไว้ (UX_SPEC §6.5 "tap the label to open the month picker")
 *
 * ทุก handler ภายใน (createEmptyMonth/handleAddNewMonth/handleCopyPrevMonth/confirmCopyPrevMonth/
 * handleCustomMonth), 15-month window (บังคับฝั่ง server ใน sharedMonthWindow.js — ไม่แตะที่นี่),
 * กล่องยืนยันเขียนทับ (role="alertdialog" + focus trap, ห้ามใช้ window.confirm — DECISIONS/006
 * Decision 2) และ pendingRef double-tap guard ย้ายมาแบบคำต่อคำ ไม่ได้เขียนใหม่
 *
 * @param {object} props
 * @param {string} props.selectedMonth - เดือนที่เลือก (YYYY-MM)
 * @param {function} props.onMonthSelected - callback เมื่อเลือกเดือน (WorkspaceShell ส่ง guardedMonthChange มา)
 * @param {function} props.onDataRefresh - callback เมื่อข้อมูลเปลี่ยน
 * @param {string[]} props.months - รายชื่อเดือน (YYYY-MM) ที่ WorkspaceShell ค้นพบแล้ว เรียงใหม่ -> เก่า
 * @param {boolean} props.open - ตัวเลือกเดือนแบบเต็มเปิดอยู่หรือไม่ (คุมโดย WorkspaceShell)
 * @param {function} props.onRequestClose - ปิดตัวเลือกเดือนแบบเต็ม
 */

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { getNextMonth } from '../../shared/utils/frontend/numberUtils';
import { getMonthData, getPrevMonth, formatMonthLabelTH } from '../../shared/utils/frontend/monthUtils';
import { showToast } from '../../shared/utils/frontend/toast';
import { getTabbableElements } from '../../shared/utils/frontend/focusTrap';
import { stripLegacyOvertimeKeys } from '../../shared/utils/overtimeUtils';
import { Icons } from './Icons';

const FOCUS_RING = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2';
const INPUT = `h-11 w-full rounded-sm border border-border-interactive bg-surface-2 px-space-3 text-base text-primary outline-none ${FOCUS_RING}`;
const GHOST_BTN = `min-h-11 rounded-sm border border-border-interactive bg-surface-2 px-space-4 py-space-3 text-left disabled:opacity-50 disabled:cursor-not-allowed ${FOCUS_RING}`;
const SECONDARY_BTN = `min-h-11 rounded-sm border border-border-interactive bg-surface-2 px-space-4 text-sm font-medium text-primary disabled:opacity-50 ${FOCUS_RING}`;
const PRIMARY_BTN = `min-h-11 rounded-sm bg-accent px-space-4 text-sm font-medium text-on-accent disabled:opacity-60 ${FOCUS_RING}`;

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
 * ตัวจัดการเลือกเดือน — เนื้อหา "ตัวเลือกเดือนแบบเต็ม" ที่ซ่อนอยู่หลัง tap-to-open (Finding 4)
 */
const MonthManager = ({ selectedMonth, onMonthSelected, onDataRefresh, months, open, onRequestClose }) => {
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

  // โมดัล "เพิ่มเดือนใหม่" ที่ซ้อนทับ picker (z-50 บน z-40) — ต้องมี trap/Esc/focus-move เป็นของตัวเอง
  // แยกจาก picker (BUG-2/BUG-3 fix) มิฉะนั้น trap ของ picker จะยังจับ Tab ไว้อยู่เบื้องหลัง overlay
  const addFormDialogRef = useRef(null);
  const addFormCloseButtonRef = useRef(null);
  const addFormTriggerRef = useRef(null);

  // ตัวเลือกเดือนแบบเต็ม (picker) เอง — role="dialog" ไม่ใช่ alertdialog (ไม่ได้บล็อกด้วยการเตือนภัย)
  const pickerDialogRef = useRef(null);
  const pickerCloseButtonRef = useRef(null);
  const pickerTriggerRef = useRef(null);

  // ตัวเลือกเดือนของ <select> — มาจาก props.months (WorkspaceShell ค้นพบแล้วครั้งเดียวต่อ session ผ่าน
  // fetchMonths + monthsCache ของมันเอง) ไม่ fetch 5-endpoint union ซ้ำเองอีกต่อไป (AC-A5-9 fix)
  const monthOptions = useMemo(
    () => (months || []).map(month => ({ value: month, label: formatMonthLabelTH(month) })),
    [months]
  );

  // ถ้า selectedMonth ไม่มีใน monthOptions ให้เลือกเดือนล่าสุดอัตโนมัติ — รันเสมอไม่ว่า picker จะเปิดอยู่
  // หรือไม่ (hook นี้ประกาศก่อนเงื่อนไข `if (!open) return null;` ด้านล่างเสมอ ตามกติกา hooks ของ React)
  useEffect(() => {
    if (monthOptions.length > 0) {
      const monthValues = monthOptions.map(opt => opt.value);
      if (!selectedMonth || !monthValues.includes(selectedMonth)) {
        // เลือกเดือนล่าสุด (ตัวแรกใน options เพราะเรียงใหม่ -> เก่า)
        onMonthSelected(monthOptions[0].value);
      }
    }
  }, [monthOptions, selectedMonth, onMonthSelected]);

  // BUG-1 fix: `if (!open) return null` ด้านล่างหยุดแค่การ render — ไม่ unmount และไม่ล้าง state ของ
  // โมดัลลูก ถ้าไม่รีเซ็ตตรงนี้ showAddForm/showCopyConfirmation ที่เหลือค้างจาก session ก่อนหน้าจะทำให้
  // เปิด picker รอบถัดไปแล้วเจอโมดัลลูกผุดขึ้นมาแทนที่จะเป็น picker เอง
  useEffect(() => {
    if (!open) {
      setShowAddForm(false);
      setShowCopyConfirmation(false);
    }
  }, [open]);

  // ล็อก scroll พื้นหลังตอนมีชั้นใดชั้นหนึ่งเปิดอยู่ (picker เอง หรือโมดัลลูกสองอัน)
  useEffect(() => {
    if ((!open && !showAddForm && !showCopyConfirmation) || typeof document === 'undefined') {
      return undefined;
    }

    const { body } = document;
    const previousOverflow = body.style.overflow;
    body.style.overflow = 'hidden';

    return () => {
      body.style.overflow = previousOverflow;
    };
  }, [open, showAddForm, showCopyConfirmation]);

  // ย้าย focus เข้าตัวเลือกเดือนทันทีที่เปิด แล้วคืน focus ให้ปุ่มที่เปิดตอนปิด (เดียวกับรูปแบบของ
  // UnsavedChangesDialog.js:48-56 / โมดัลคัดลอกด้านล่าง — ดีเลย์ 40ms ให้ผ่านช่วง mount)
  useEffect(() => {
    if (!open || typeof document === 'undefined') return undefined;
    pickerTriggerRef.current = document.activeElement;
    const timer = setTimeout(() => pickerCloseButtonRef.current?.focus(), 40);
    return () => {
      clearTimeout(timer);
      const opener = pickerTriggerRef.current;
      if (opener?.isConnected) opener.focus?.();
    };
  }, [open]);

  // focus trap + Esc ของตัวเลือกเดือนเอง — ใช้ getTabbableElements() ร่วมจาก focusTrap.js (K2)
  // BUG-2/BUG-3 fix: ต้องปลดชั่วคราวเมื่อมีโมดัลลูก (showAddForm/showCopyConfirmation) ซ้อนอยู่ด้านบน
  // มิฉะนั้น trap นี้ยังจับ Tab/Escape ไว้อยู่เบื้องหลัง overlay ทำให้โมดัลลูกใช้คีย์บอร์ดไม่ได้เลย —
  // ให้ trap ของโมดัลลูกเป็นเจ้าของ Tab/Escape แต่เพียงผู้เดียวตอนที่มันเปิดอยู่ (เหลือ surface บนสุด
  // ชั้นเดียวที่มี trap ทำงานพร้อมกัน)
  useEffect(() => {
    if (!open || showAddForm || showCopyConfirmation || typeof document === 'undefined') return undefined;
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onRequestClose?.();
        return;
      }
      if (event.key !== 'Tab' || !pickerDialogRef.current) return;
      const focusable = getTabbableElements(pickerDialogRef.current);
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
  }, [open, showAddForm, showCopyConfirmation, onRequestClose]);

  // ย้าย focus เข้าโมดัล "เพิ่มเดือนใหม่" ทันทีที่เปิด แล้วคืน focus ให้ปุ่มที่เปิดตอนปิด — รูปแบบเดียวกับ
  // โมดัลคัดลอกด้านบน / UnsavedChangesDialog.js:48-56 (หน่วง 40ms ให้ผ่านช่วง mount)
  useEffect(() => {
    if (!showAddForm || typeof document === 'undefined') return undefined;
    addFormTriggerRef.current = document.activeElement;
    const timer = setTimeout(() => addFormCloseButtonRef.current?.focus(), 40);
    return () => {
      clearTimeout(timer);
      const opener = addFormTriggerRef.current;
      if (opener?.isConnected) opener.focus?.();
    };
  }, [showAddForm]);

  // focus trap + Esc ของโมดัล "เพิ่มเดือนใหม่" — เจ้าของ Tab/Escape แต่เพียงผู้เดียวขณะเปิดอยู่ (BUG-2/BUG-3)
  useEffect(() => {
    if (!showAddForm || typeof document === 'undefined') return undefined;
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        setShowAddForm(false);
        return;
      }
      if (event.key !== 'Tab' || !addFormDialogRef.current) return;
      const focusable = getTabbableElements(addFormDialogRef.current);
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
  }, [showAddForm]);

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
        // เดือนที่สร้างใหม่ไม่มีแถว OT ให้คัดลอก — ไม่ส่งอาร์กิวเมนต์ที่ 5 โดยตั้งใจ เพราะค่า default ของ
        // salaryAPI.save คือ [] อยู่แล้ว ผลลัพธ์ที่บันทึกจึงเป็น overtime: [] เท่ากับส่งเองทุกประการ
        // (spec §MonthManager / AC-OT-23 ระบุว่า call site นี้ต้องไม่ถูกแก้)
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
        dailyExpenseAPI.getByMonth(prevMonth, { raw: true })
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
        // OT: คัดลอก "แถวชั่วโมง" มาด้วย แต่ไม่คัดลอก "ยอด OT แบบคงที่ของเดิม" (BR-OT-007/008, AC-OT-15)
        // ความไม่สมมาตรนี้ตั้งใจ: การคัดลอกเป็นคำสั่งที่ผู้ใช้กดยืนยันเอง การคัดชั่วโมง OT มาแก้ต่อจึงคือ
        // สิ่งที่ผู้ใช้ขอ ส่วนยอดคงที่ของเดิมเป็นประวัติที่ผูกกับเดือนนั้นเดือนเดียว คัดลอกมาเท่ากับติดป้าย
        // OT ของอีกเดือนว่าเป็นของเดือนนี้ (ต่างจาก carry-forward ที่เป็นการคัดลอกโดยปริยาย ห้ามคัดทั้งคู่)
        // ตำแหน่งที่ 5 เท่านั้น — ตำแหน่งที่ 4 เป็นของ note (A-6/V-6) และการไม่ส่งเลยจะล้างแถว OT ทิ้ง (A-9)
        salaryAPI.save(
          selectedMonth,
          stripLegacyOvertimeKeys(salaryPrevDoc?.income || {}),
          salaryPrevDoc?.deduct || {},
          salaryPrevDoc?.note || '',
          salaryPrevDoc?.overtime || []
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

  // เลือกเดือนจาก <select> โดยตรง — ปิดตัวเลือกเดือนไปด้วยเลย (เลือกเสร็จ = ปิด เหมือน picker มือถือทั่วไป)
  // guardedMonthChange (ที่ WorkspaceShell ส่งมาเป็น onMonthSelected) เป็นคนตัดสินเองว่าจะเปลี่ยนทันที
  // หรือเปิด dialog ยืนยันก่อน (K11) — ปิด picker ไปก่อนไม่กระทบ เพราะ dialog นั้นเป็นคนละชั้นกัน
  const handleSelectChange = (event) => {
    onMonthSelected(event.target.value);
    onRequestClose?.();
  };

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <>
      <div
        className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-canvas/70 px-space-4 py-space-6"
        role="presentation"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) onRequestClose?.();
        }}
      >
        <div
          ref={pickerDialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="month-picker-title"
          className="mt-[calc(var(--topbar-safe-top,90px)+8px)] w-full max-w-sm rounded-lg border border-border-default bg-surface-3 p-space-4 shadow-elev-3"
        >
          <div className="mb-space-4 flex items-center justify-between">
            <h2 id="month-picker-title" className="text-lg font-medium text-primary">เลือกเดือน</h2>
            <button
              ref={pickerCloseButtonRef}
              type="button"
              onClick={onRequestClose}
              aria-label="ปิดตัวเลือกเดือน"
              className={`flex h-11 w-11 items-center justify-center rounded-full text-secondary hover:bg-surface-2 ${FOCUS_RING}`}
            >
              <Icons.X size={18} />
            </button>
          </div>

          <div className="mb-space-5">
            <label htmlFor="month-picker-select" className="mb-space-2 block text-sm text-secondary">
              เดือนที่กำลังวางแผน
            </label>
            <select
              id="month-picker-select"
              value={selectedMonth ?? ''}
              onChange={handleSelectChange}
              className={INPUT}
            >
              {monthOptions.map(option => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
            <p className="mt-space-2 text-xs text-tertiary">เลือกเดือนเพื่อดูและวางแผนการเงิน</p>
          </div>

          <div>
            <p className="text-sm font-medium text-primary">เริ่มต้นแผนของเดือน</p>
            <p className="mb-space-3 text-xs text-tertiary">สร้างเดือนใหม่หรือใช้ข้อมูลเดือนก่อนหน้าเป็นจุดเริ่มต้น</p>
            <div className="flex flex-col gap-space-2">
              <button
                type="button"
                onClick={() => setShowAddForm(true)}
                className={GHOST_BTN}
                aria-label="เพิ่มเดือนใหม่"
                disabled={Boolean(pendingAction)}
                aria-busy={pendingAction === 'create'}
              >
                <span className="block text-sm font-medium text-primary">+ เพิ่มเดือนใหม่</span>
                <span className="block text-xs text-tertiary">สร้างเดือนถัดไปพร้อมหน้ากระดาษว่าง</span>
              </button>
              <button
                type="button"
                onClick={handleCopyPrevMonth}
                className={GHOST_BTN}
                aria-label="คัดลอกข้อมูลจากเดือนก่อนหน้า"
                disabled={Boolean(pendingAction)}
                aria-busy={pendingAction === 'copy'}
              >
                <span className="block text-sm font-medium text-primary">ดึงข้อมูลจากเดือนก่อนหน้า</span>
                <span className="block text-xs text-tertiary">คัดลอกทุกรายการมาแก้ไขต่อได้ทันที</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {showAddForm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-canvas/70 px-space-4"
          role="presentation"
        >
          <div
            ref={addFormDialogRef}
            className="w-full max-w-sm rounded-lg border border-border-default bg-surface-3 p-space-4 shadow-elev-3"
            tabIndex={-1}
            aria-modal="true"
            role="dialog"
            aria-label="เพิ่มเดือนใหม่"
          >
            <div className="mb-space-3 flex items-center justify-between">
              <h4 className="text-lg font-medium text-primary">เพิ่มเดือนใหม่</h4>
              <button
                ref={addFormCloseButtonRef}
                className={`flex h-11 w-11 items-center justify-center rounded-full text-secondary hover:bg-surface-2 ${FOCUS_RING}`}
                aria-label="ปิดหน้าต่าง"
                onClick={() => setShowAddForm(false)}
                type="button"
                tabIndex={0}
              >
                <Icons.X size={18} />
              </button>
            </div>
            <button
              onClick={handleAddNewMonth}
              className={`${SECONDARY_BTN} mb-space-3 w-full`}
              aria-label={`เพิ่มเดือนถัดไป (${getNextMonth(selectedMonth)})`}
              disabled={Boolean(pendingAction)}
              type="button"
              tabIndex={0}
            >
              เดือนถัดไป ({getNextMonth(selectedMonth)})
            </button>
            <div className="mb-space-3 flex gap-space-2">
              <input
                type="text"
                placeholder="YYYY-MM (เช่น 2025-10)"
                value={newMonthName}
                onChange={(e) => setNewMonthName(e.target.value)}
                className={INPUT}
                aria-label="กรอกเดือนใหม่ (YYYY-MM)"
                tabIndex={0}
              />
              <button
                onClick={handleCustomMonth}
                className={`${PRIMARY_BTN} shrink-0`}
                aria-label="เพิ่มเดือนที่กรอกเอง"
                disabled={Boolean(pendingAction)}
                type="button"
                tabIndex={0}
              >
                เพิ่ม
              </button>
            </div>
            <button
              onClick={() => setShowAddForm(false)}
              className={`${SECONDARY_BTN} w-full`}
              aria-label="ยกเลิก"
              type="button"
              tabIndex={0}
            >
              ยกเลิก
            </button>
          </div>
        </div>
      )}

      {/* กล่องยืนยันก่อนเขียนทับ — role="alertdialog" พร้อม focus trap ตามแบบ UnsavedChangesDialog.js
          (ห้ามใช้ window.confirm — DECISIONS/006 Decision 2) */}
      {showCopyConfirmation && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-canvas/70 px-space-4"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setShowCopyConfirmation(false);
          }}
        >
          <div
            ref={copyDialogRef}
            className="w-full max-w-sm rounded-lg border border-border-default bg-surface-3 p-space-4 shadow-elev-3"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="copy-month-title"
            aria-describedby="copy-month-description"
          >
            <h4 id="copy-month-title" className="mb-space-2 text-lg font-medium text-primary">เขียนทับข้อมูลเดือนนี้?</h4>
            <p id="copy-month-description" className="mb-space-4 text-sm text-secondary">
              ข้อมูลของ {formatMonthLabelTH(selectedMonth)} จะถูกแทนที่ด้วยข้อมูลจาก {formatMonthLabelTH(getPrevMonth(selectedMonth))}
            </p>
            <div className="flex justify-end gap-space-2">
              <button
                ref={copyCancelButtonRef}
                type="button"
                className={SECONDARY_BTN}
                onClick={() => setShowCopyConfirmation(false)}
                tabIndex={0}
              >
                ยกเลิก
              </button>
              <button
                type="button"
                className={PRIMARY_BTN}
                onClick={confirmCopyPrevMonth}
                tabIndex={0}
              >
                เขียนทับและคัดลอก
              </button>
            </div>
          </div>
        </div>
      )}
    </>,
    document.body
  );
};

export default MonthManager;
