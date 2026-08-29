/**
 * คอมโพเนนต์: WorkspaceShell
 * เชลล์ของ /workspace/* ทั้งเจ็ดเส้นทาง — เดิมคือเนื้อหาทั้งหมดของ pages/workspace.js (P3/A3) ก่อนที่
 * Amendment A5 จะแยก 5 แท็บ (+ เงินออมที่ซ้อน 3 คอมโพเนนต์) ออกเป็น 7 route จริง คนละไฟล์
 * (spec-monthly-workspace.md §Amendment A5 — "ADR-018, ย้าย ไม่ใช่เขียนใหม่")
 *
 * เจ้าของ: Layout, MonthManager, การ resolve เดือนจาก URL/localStorage, primary nav + savings sub-nav,
 * .tabContent + dirty delegation, floating bar (เหลือแค่ ◀ ▶ เดือน — ปุ่มบันทึกย้ายไปอยู่ใน
 * Layout headerActions แล้ว, F1), UnsavedChangesDialog, beforePopState guard (F2) และ beforeunload
 *
 * ไม่มีตัวนับ Save All / handleSaveAll อีกต่อไป (ADR-018 มาแทน ADR-003 เฉพาะฟีเจอร์นี้) — แต่ละหน้าเนื้อหา
 * (income.js ฯลฯ) ลงทะเบียนฟังก์ชันบันทึกของตัวเองผ่าน registerSave (เขียนลง ref เท่านั้น ห้าม setState
 * ไม่งั้น re-render วนไม่จบ — ดู §2 ของ ADR-018) แล้วเชลล์เป็นคนกดเรียกจากปุ่มเดียวใน header
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import Layout from './Layout';
import MonthManager from './MonthManager';
import UnsavedChangesDialog from './UnsavedChangesDialog';
import { Icons } from './Icons';
import { useSession } from '../contexts/SessionContext';
import { incomeAPI, expenseAPI, savingsAPI, salaryAPI, investmentAPI } from '../../shared/utils/frontend/apiUtils';
import { formatMonthLabelTH, collectMonthKeys } from '../../shared/utils/frontend/monthUtils';
import { WORKSPACE_SECTIONS, sectionHref } from '../../shared/utils/frontend/workspaceRoutes';
import homeStyles from '../styles/Home.module.css';

const SELECTED_MONTH_KEY = 'edit_selected_month';
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

function getCurrentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

const getMonthLabel = (monthKey) => {
  try {
    return formatMonthLabelTH(monthKey);
  } catch (error) {
    return monthKey;
  }
};

// แถวนำทางหลัก — เงินออม/เป้าหมาย/ลงทุน สามหน้ารวมกันเป็นก้อนเดียวของแถวนี้ (เงินออม active ให้ทั้งสาม)
const PRIMARY_NAV = [
  { id: 'income', label: 'รายได้', Icon: Icons.TrendingUp },
  { id: 'expense', label: 'บิลและรายจ่าย', Icon: Icons.CreditCard },
  { id: 'savings', label: 'ออมและเป้าหมาย', Icon: Icons.PiggyBank },
  { id: 'daily', label: 'ค่าใช้จ่ายรายวัน', Icon: Icons.CreditCard },
  { id: 'tax', label: 'ภาษี', Icon: Icons.BarChart }
];
const SAVINGS_GROUP = ['savings', 'goals', 'investment'];
const SUB_NAV = [
  { id: 'savings', label: 'เงินออม' },
  { id: 'goals', label: 'เป้าหมาย' },
  { id: 'investment', label: 'ลงทุน' }
];

// ไอคอน + สีของหัวข้อแต่ละ section — เงินออมเดิม 3 คอมโพเนนต์ในแท็บเดียว ตอนนี้แยกเป็น 3 หัวข้อ
const SECTION_HEADING_META = {
  income: { Icon: Icons.TrendingUp, color: 'var(--color-primary)' },
  expense: { Icon: Icons.CreditCard, color: 'var(--color-danger)' },
  savings: { Icon: Icons.PiggyBank, color: 'var(--color-secondary)' },
  goals: { Icon: Icons.Target, color: 'var(--color-secondary)' },
  investment: { Icon: Icons.TrendingUp, color: 'var(--color-secondary)' },
  daily: { Icon: Icons.CreditCard, color: 'var(--color-primary)' },
  tax: { Icon: Icons.BarChart, color: 'var(--color-warning)' }
};

// เดือนทั้งหมดต่อผู้ใช้ — cache ระดับ module ให้อยู่รอดข้าม remount ของเชลล์ตอนสลับ section (WorkspaceShell
// mount ใหม่ทุกครั้งที่เปลี่ยน route ย่อย ต่างจากแท็บเดิมที่แค่ re-render) กัน 5-API union ยิงซ้ำทุกครั้ง
// ที่สลับหน้า และกันแถบลอย (floating bar) วาบหายแล้วโผล่ใหม่ระหว่างรอ fetch (AC-A5-9)
const monthsCache = new Map();

const buildLeaveCopy = (heading, monthLabel) => (
  `ข้อมูลใน "${heading}" ของเดือน ${monthLabel} ยังไม่ได้บันทึก ถ้าออกตอนนี้ข้อมูลที่แก้ไว้จะหายไป`
);
const buildMonthChangeCopy = (heading, monthLabel) => (
  `ข้อมูลใน "${heading}" ของเดือน ${monthLabel} ยังไม่ได้บันทึก ถ้าเปลี่ยนเดือนตอนนี้ข้อมูลที่แก้ไว้จะหายไป`
);

export default function WorkspaceShell({ section, overlay, children }) {
  const router = useRouter();
  // Next.js ออก router object ใหม่ให้ทุกครั้งที่มีการนำทางจริง (รวม shallow replace) แต่ "ไม่" ออกใหม่
  // ให้เฉยๆ ตอน re-render จาก state ภายในที่ไม่เกี่ยวกับ routing (เช่น isDirty เปลี่ยน) — ถ้า callback
  // ที่ memoize ด้วย useCallback (เช่น applyMonthChange ด้านล่าง) ปิด scope ทับ `router` ตรงๆ โดยไม่ใส่
  // `router` เต็มๆ ไว้ใน dependency array มันจะค้าง reference เก่าไปตลอดอายุการ memoize นั้น แล้วอ่าน
  // router.query ผิดรุ่นได้ (เขียน URL ทับด้วยค่าเก่า) — ใช้ ref ที่อัปเดตทุก render แทนเพื่อให้ callback
  // ไหนก็ตามอ่าน router ล่าสุดได้เสมอโดยไม่ต้องพึ่ง dependency array ให้ถูกต้อง 100%
  const routerRef = useRef(router);
  routerRef.current = router;
  const { currentUser } = useSession();
  const userId = currentUser?.id || null;
  const selectedMonthKey = useMemo(
    () => (userId ? `${SELECTED_MONTH_KEY}_${userId}` : SELECTED_MONTH_KEY),
    [userId]
  );

  const sectionMeta = WORKSPACE_SECTIONS[section] || WORKSPACE_SECTIONS.income;
  const headingMeta = SECTION_HEADING_META[section] || SECTION_HEADING_META.income;

  // ------------------------------------------------------------------ เดือน + รายชื่อเดือน
  // seed แบบ sync จาก URL จริง (window.location.search — ไม่ใช้ router.query ที่ยังไม่พร้อมตอน hard
  // load) แล้วค่อย fallback localStorage — WorkspaceShell mount ได้ก็ต่อเมื่อ Layout ปลดล็อกแล้วเท่านั้น
  // (isLocked=false ต้องมี currentUser พร้อมแล้ว) จึงอ่าน localStorage ตาม userId ได้ทันทีตั้งแต่ render
  // แรกโดยไม่ต้องรอ effect — ทำให้แถบลอย/เนื้อหา section เห็นเดือนถูกต้องตั้งแต่ paint แรก (AC-A5-9)
  const [selectedMonth, setSelectedMonth] = useState(() => {
    if (typeof window === 'undefined') return null;
    try {
      const params = new URLSearchParams(window.location.search);
      const fromUrl = params.get('month');
      if (fromUrl && MONTH_RE.test(fromUrl)) return fromUrl;
      const stored = userId ? localStorage.getItem(`${SELECTED_MONTH_KEY}_${userId}`) : null;
      if (stored && MONTH_RE.test(stored)) return stored;
    } catch (error) {
      // localStorage อาจถูกบล็อก (private mode ฯลฯ) — เดือนจะถูก resolve ใหม่จาก fetchMonths แทน
    }
    return null;
  });

  const [months, setMonths] = useState(() => (userId && monthsCache.has(userId) ? monthsCache.get(userId) : []));
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [dialogState, setDialogState] = useState(null); // { message, onLeave } | null

  const isDirtyRef = useRef(false);
  useEffect(() => { isDirtyRef.current = isDirty; }, [isDirty]);

  const saveRef = useRef(null);
  const registerSave = useCallback((fn) => { saveRef.current = fn; }, []);

  // ดึงเดือนทั้งหมดจากข้อมูลใน DB แล้วรวม key — งานนี้ "ค้นหารายชื่อเดือน" อย่างเดียว ไม่ได้เลือก
  // selectedMonth ให้อีกต่อไป (ต่างจาก P3 เดิม) การเลือกเดือนแยกไปอยู่ใน effect resolve ด้านล่าง
  const fetchMonths = useCallback(async () => {
    try {
      const [expenseRes, incomeRes, savingsRes, salaryRes, investmentRes] = await Promise.all([
        expenseAPI.getAll(),
        incomeAPI.getAll(),
        savingsAPI.getAll(),
        salaryAPI.getAll(),
        investmentAPI.getAll()
      ]);
      const allMonths = collectMonthKeys({
        expense: expenseRes,
        income: incomeRes,
        savings: savingsRes,
        salary: salaryRes,
        investment: investmentRes
      });
      const currentMonth = getCurrentMonth();
      const normalizedMonths = Array.from(new Set([
        currentMonth,
        ...allMonths.filter(month => month <= currentMonth)
      ])).sort((a, b) => b.localeCompare(a));
      setMonths(normalizedMonths);
      if (userId) monthsCache.set(userId, normalizedMonths);
    } catch (err) {
      const currentMonth = getCurrentMonth();
      setMonths([currentMonth]);
      if (userId) monthsCache.set(userId, [currentMonth]);
    }
  }, [userId]);

  // AC-A5-9 fix: เดิม effect นี้เรียก fetchMonths() แบบไม่มีเงื่อนไขทุกครั้งที่ mount — ภายใต้
  // สถาปัตยกรรม per-route ของ A5, WorkspaceShell mount ใหม่ทุกครั้งที่สลับ section ทำให้ยิง fetch
  // 5-endpoint union ซ้ำทุกการนำทาง (วัดได้จริง 16 request ส่วนเกินจาก 6 การนำทาง) เพิ่ม short-circuit
  // ตรงนี้: ถ้า monthsCache มีข้อมูลของ user นี้อยู่แล้ว (fetch ไปแล้วรอบก่อนในเซสชันนี้) ใช้ค่านั้นเลย
  // ไม่ fetch ซ้ำ — cache จะถูกลบล้างเฉพาะตอน handleDataRefresh() เรียกจริง (เพิ่ม/คัดลอกเดือนใหม่ ดู
  // handleDataRefresh ด้านล่าง) ซึ่งลบ entry ออกจาก monthsCache แบบ sync ก่อนที่ effect นี้จะ re-run จาก
  // refreshTrigger ที่เปลี่ยน (setRefreshTrigger เป็น async เสมอ) จึงยังคง "revalidate หลัง refresh จริง" ไว้ได้
  useEffect(() => {
    if (!currentUser) return;
    if (userId && monthsCache.has(userId)) {
      setMonths(monthsCache.get(userId));
      return;
    }
    fetchMonths();
  }, [refreshTrigger, currentUser, userId, fetchMonths]);

  // เขียนเดือนที่เลือกกลับ localStorage + URL (?month=) เสมอ — replace ไม่ใช่ push (E29/AC-A5-8:
  // กด Back ครั้งเดียวต้องออกจาก /workspace ไปเลย ไม่ใช่ไล่ history เดือนทีละก้าว) อ่าน pathname/query
  // ผ่าน routerRef เสมอ (ไม่ใช่ router ตรงๆ) กัน closure ค้าง — deps ของ useCallback นี้ไม่ได้มี router
  // เต็มๆ อยู่ (จะทำให้ memoize ใหม่บ่อยเกินจำเป็นทุกครั้งที่ query เปลี่ยน) แต่ routerRef.current อัปเดต
  // ทุก render อยู่แล้วเสมอ (ดูคอมเมนต์ที่ประกาศ routerRef ด้านบน)
  const applyMonthChange = useCallback((month) => {
    setSelectedMonth(month);
    if (typeof window !== 'undefined' && userId) {
      try { localStorage.setItem(selectedMonthKey, month); } catch (error) { /* private mode ฯลฯ */ }
    }
    const currentRouter = routerRef.current;
    currentRouter.replace(
      { pathname: currentRouter.pathname, query: { ...currentRouter.query, month } },
      undefined,
      { shallow: true }
    );
  }, [selectedMonthKey, userId]);

  // resolve เดือนตามลำดับของสเปก: ?month= (ถ้าถูกฟอร์แมตและอยู่ใน months) → localStorage (เดียวกัน) →
  // เดือนปัจจุบัน แล้วเขียนกลับ URL เสมอ (ต่างจากกติกา ?tab= เดิมที่ค่าผิดจะไม่เขียนกลับ — ADR-018 §4)
  useEffect(() => {
    if (!router.isReady) return;
    if (!months.length) return;

    const queryMonth = typeof router.query.month === 'string' ? router.query.month : null;
    let resolved;
    if (queryMonth && MONTH_RE.test(queryMonth) && months.includes(queryMonth)) {
      resolved = queryMonth;
    } else {
      let stored = null;
      try { stored = userId ? localStorage.getItem(selectedMonthKey) : null; } catch (error) { /* noop */ }
      resolved = (stored && MONTH_RE.test(stored) && months.includes(stored))
        ? stored
        : getCurrentMonth();
    }

    if (resolved !== selectedMonth) {
      setSelectedMonth(resolved);
    }
    if (typeof window !== 'undefined' && userId) {
      try { localStorage.setItem(selectedMonthKey, resolved); } catch (error) { /* noop */ }
    }
    if (queryMonth !== resolved) {
      router.replace(
        { pathname: router.pathname, query: { ...router.query, month: resolved } },
        undefined,
        { shallow: true }
      );
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [months, router.isReady, router.query.month, userId, selectedMonthKey]);

  // useCallback ให้ reference คงที่ข้ามการ re-render — ส่งต่อเป็น onDataRefresh ให้ MonthManager เรียก
  // หลังเพิ่ม/คัดลอกเดือนใหม่สำเร็จ (MonthManager.js's handleAddNewMonth/handleCopyPrevMonth) ลบ entry
  // ของ user นี้ออกจาก monthsCache แล้วเพิ่ม refreshTrigger เพื่อบังคับให้ effect ของ fetchMonths
  // ด้านบนดึงรายชื่อเดือนใหม่จริง (cache miss) — เดิม (ก่อน AC-A5-9 fix) MonthManager มี fetch
  // 5-endpoint union อิสระของตัวเองที่ผูกกับ reference นี้โดยตรง ตอนนี้ MonthManager ไม่ fetch เองแล้ว
  // (รับ months มาทาง props แทน) แต่ยัง useCallback ไว้เหมือนเดิมเพื่อ reference คงที่ทั่วไป
  const handleDataRefresh = useCallback(() => {
    setRefreshTrigger(prev => prev + 1);
    if (userId) monthsCache.delete(userId); // เดือนอาจเปลี่ยน (เพิ่ม/ลบเดือน) — บังคับ fetch ใหม่จริง
  }, [userId]);

  const markClean = useCallback(() => setIsDirty(false), []);

  // guard ทั่วไป — ถ้า dirty เปิด dialog แล้วรอ "ออกโดยไม่บันทึก" ค่อยรัน action, ถ้าไม่ dirty รันทันที
  // ใช้กับ: ลิงก์ nav หลัก/ย่อย, ปุ่มเปิด modal เงินเดือน (income.js) — อ่านผ่าน isDirtyRef เสมอ ไม่ใช่
  // isDirty ตรง ๆ เพราะ handler บางตัว (beforePopState) ผูก effect ครั้งเดียวตอน mount (ดูด้านล่าง)
  const guard = useCallback((action, message) => {
    if (isDirtyRef.current) {
      setDialogState({ message, onLeave: action });
    } else {
      action();
    }
  }, []);

  const monthLabel = selectedMonth ? getMonthLabel(selectedMonth) : '';
  const leaveCopy = buildLeaveCopy(sectionMeta.heading, monthLabel);
  const monthChangeCopy = buildMonthChangeCopy(sectionMeta.heading, monthLabel);

  const currentMonthIndex = months.indexOf(selectedMonth);

  // สองจุดที่เปลี่ยนเดือนได้ (ลูกศร floating bar + <select> ของ MonthManager) ใช้ predicate เดียวกัน —
  // เงื่อนไข 3 ข้อไม่ใช่การป้องกันเกินจำเป็น แต่กันการเด้ง dialog หลอก 3 กรณี (spec §Month resolution):
  // month !== selectedMonth กัน copy-forward ที่เลือกเดือนเดิมซ้ำ (MonthManager.js:181),
  // selectedMonth != null กันตอน resolve เดือนครั้งแรก, months.includes(selectedMonth) กันตอนเดือนที่
  // เลือกอยู่หลุดออกจากลิสต์เอง (MonthManager.js:52-59 auto-correct — ไม่ใช่การนำทางของผู้ใช้)
  const guardedMonthChange = useCallback((month) => {
    if (!month) return;
    const shouldGuard = isDirtyRef.current
      && month !== selectedMonth
      && selectedMonth != null
      && months.includes(selectedMonth);
    if (shouldGuard) {
      setDialogState({ message: monthChangeCopy, onLeave: () => applyMonthChange(month) });
    } else {
      applyMonthChange(month);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedMonth, months, applyMonthChange, monthChangeCopy]);

  const handlePrevMonth = () => {
    if (currentMonthIndex < months.length - 1) guardedMonthChange(months[currentMonthIndex + 1]);
  };
  const handleNextMonth = () => {
    if (currentMonthIndex > 0) guardedMonthChange(months[currentMonthIndex - 1]);
  };

  // ------------------------------------------------------------------ นำทางออกจากหน้า (Layout)
  // Layout.handleNavClick: await onBeforeNavigate(href); if (proceed === false) return; router.push(href)
  // คืน true ทันทีถ้า clean (ให้ Layout push เอง) และคืน false ทันทีถ้า dirty (Layout จะไม่ push — dialog
  // เป็นคนสั่ง push เองตอนกด "ออกโดยไม่บันทึก") — ADR-018 §6
  const handleBeforeNavigate = useCallback((href) => {
    if (!isDirtyRef.current) return true;
    setDialogState({ message: leaveCopy, onLeave: () => router.push(href) });
    return false;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router, leaveCopy]);

  // ------------------------------------------------------------------ นำทางในหน้า (primary/sub nav)
  const handleNavLinkClick = (event, targetId, active) => {
    if (active) return;
    if (!isDirty) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return; // เปิดแท็บใหม่ — ไม่เสียอะไร (E32)
    event.preventDefault();
    guard(() => router.push(sectionHref(targetId, selectedMonth)), leaveCopy);
  };

  // ------------------------------------------------------------------ Back/Forward guard (F2)
  const bypassRef = useRef(false);
  const nextStateRef = useRef(null);
  const leaveCopyRef = useRef(leaveCopy);
  useEffect(() => { leaveCopyRef.current = leaveCopy; }, [leaveCopy]);

  useEffect(() => {
    const captureState = () => { nextStateRef.current = window.history.state; };
    captureState();
    router.events.on('routeChangeComplete', captureState);

    router.beforePopState(() => {
      if (bypassRef.current) {
        bypassRef.current = false;
        return true;
      }
      if (!isDirtyRef.current) return true;

      // ดัน address bar กลับไปที่หน้าที่ "ยังแสดงอยู่จริง" ก่อน — ตอนนี้เบราว์เซอร์ขยับ history ไปแล้ว
      // แต่ Next ยังไม่ได้ render route ที่ pop มา (ADR-018 §3a) pushState จาก index กลางสต็อกจะตัด
      // forward entries ทิ้งแล้วต่อท้ายอันใหม่ — ยาว/เนื้อหา/ตำแหน่งเดิมทุกอย่างถ้าไม่กด "ออกโดยไม่บันทึก"
      window.history.pushState(nextStateRef.current, '', router.asPath);

      setDialogState({
        message: leaveCopyRef.current,
        onLeave: () => {
          bypassRef.current = true;
          window.history.back();
        }
      });
      return false;
    });

    // ต้อง cleanup เสมอ — beforePopState เป็น global ของ router ตัวเดียว ใครลงทะเบียนทีหลังชนะ
    // เชลล์นี้ mount ใหม่ทุกครั้งที่สลับ route ย่อย ถ้าลืม cleanup closure เก่าจะยังคุมทั้งแอปอยู่ต่อ
    // ทั้งที่ section ที่มันอ้างถึงไม่มีอยู่แล้ว (ADR-018 §3a "ต้อง cleanup — ไม่งั้นรั่วทั้งแอปทันที")
    return () => {
      router.events.off('routeChangeComplete', captureState);
      router.beforePopState(() => true);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  // ------------------------------------------------------------------ beforeunload — ปิด tab/reload
  // ลงทะเบียนเฉพาะตอน dirty เท่านั้น ไม่มี custom string (เบราว์เซอร์เพิกเฉยอยู่แล้ว) — ADR-018 §5:
  // เป็น "พื้นล่างสุด" ไม่ใช่ตัวแทน dialog ที่ครอบทุกช่องทางที่ในหน้าเว็บเข้าถึงได้อยู่แล้ว
  useEffect(() => {
    if (!isDirty) return undefined;
    const handler = (event) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty]);

  // ------------------------------------------------------------------ บันทึกจากปุ่มใน header (F1)
  const handleHeaderSave = async () => {
    if (isSaving) return;
    setIsSaving(true);
    try {
      await saveRef.current?.();
    } finally {
      setIsSaving(false);
    }
  };

  const headerActions = (
    <>
      {isDirty && (
        <span className={homeStyles.dirtyChip} role="status" aria-live="polite">ยังไม่ได้บันทึก</span>
      )}
      <button
        type="button"
        className={homeStyles.headerSaveButton}
        onClick={handleHeaderSave}
        disabled={isSaving}
        aria-label={sectionMeta.saveLabel}
      >
        <Icons.Save size={16} />
        <span className={homeStyles.headerSaveButtonFullLabel}>
          {isSaving ? 'กำลังบันทึก...' : sectionMeta.saveLabel}
        </span>
      </button>
    </>
  );

  const payload = { selectedMonth, months, refreshTrigger, isDirty, markClean, guard, registerSave, router };

  const handleDialogStay = () => setDialogState(null);
  const handleDialogLeave = () => {
    const action = dialogState?.onLeave;
    setDialogState(null);
    action?.();
  };

  return (
    <Layout
      activeNav="workspace"
      title="แผนการเงินรายเดือน"
      headerActions={headerActions}
      onCalendarClose={({ changed } = {}) => { if (changed) handleDataRefresh(); }}
      onBeforeNavigate={handleBeforeNavigate}
    >
      <div className={homeStyles.mainContent}>
        <MonthManager
          selectedMonth={selectedMonth}
          onMonthSelected={guardedMonthChange}
          onDataRefresh={handleDataRefresh}
          months={months}
        />

        <nav className={homeStyles.tabNavigation} aria-label="ส่วนของบันทึกรายเดือน">
          {PRIMARY_NAV.map((item) => {
            const active = item.id === section || (item.id === 'savings' && SAVINGS_GROUP.includes(section));
            return (
              <Link
                key={item.id}
                href={sectionHref(item.id, selectedMonth)}
                className={`${homeStyles.tabButton} ${active ? homeStyles.active : ''}`}
                aria-current={active ? 'page' : undefined}
                onClick={(event) => handleNavLinkClick(event, item.id, active)}
              >
                <item.Icon size={20} />
                {item.label}
              </Link>
            );
          })}
        </nav>

        {SAVINGS_GROUP.includes(section) && (
          <nav className={homeStyles.subTabNavigation} aria-label="ส่วนย่อยของเงินออม">
            {SUB_NAV.map((item) => {
              const active = item.id === section;
              return (
                <Link
                  key={item.id}
                  href={sectionHref(item.id, selectedMonth)}
                  className={`${homeStyles.subTabButton} ${active ? homeStyles.active : ''}`}
                  aria-current={active ? 'page' : undefined}
                  onClick={(event) => handleNavLinkClick(event, item.id, active)}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        )}

        <div className={homeStyles.tabContent} onInput={() => setIsDirty(true)} onChange={() => setIsDirty(true)}>
          <div>
            <div className={homeStyles.tabHeader}>
              <h3 className={homeStyles.tabTitle}>
                <headingMeta.Icon size={24} color={headingMeta.color} />
                {sectionMeta.heading}
              </h3>
            </div>
            {typeof children === 'function' ? children(payload) : children}
          </div>
        </div>
      </div>

      {/* overlay (เช่น SalaryModal ของ income.js) เป็น sibling ของ .mainContent/.floatingBar ไม่ใช่ลูก
          ของ .tabContent — .tabContent มี onInput/onChange ที่ตั้ง isDirty=true จากทุก input ข้างใน
          ถ้า modal ซ้อนอยู่ในนั้น การพิมพ์ใน modal จะไปตั้งค่า dirty ปลอมให้ section ที่ไม่ได้แตะ
          (A3 §Component ownership เหตุผลที่ 1 — ยังใช้ได้เหมือนเดิมหลัง A5) */}
      {typeof overlay === 'function' ? overlay(payload) : overlay}

      {selectedMonth && (
        <div className={homeStyles.floatingBar}>
          <button
            type="button"
            className={homeStyles.floatingBarNavBtn}
            onClick={handlePrevMonth}
            disabled={currentMonthIndex >= months.length - 1}
            title="เดือนก่อนหน้า"
            aria-label="เดือนก่อนหน้า"
          >
            <span style={{ display: 'flex', transform: 'rotate(90deg)' }}>
              <Icons.ChevronDown size={16} />
            </span>
          </button>
          <span className={homeStyles.floatingBarMonth}>{monthLabel}</span>
          <button
            type="button"
            className={homeStyles.floatingBarNavBtn}
            onClick={handleNextMonth}
            disabled={currentMonthIndex <= 0}
            title="เดือนถัดไป"
            aria-label="เดือนถัดไป"
          >
            <span style={{ display: 'flex', transform: 'rotate(-90deg)' }}>
              <Icons.ChevronDown size={16} />
            </span>
          </button>
        </div>
      )}

      <UnsavedChangesDialog
        open={!!dialogState}
        message={dialogState?.message || ''}
        onStay={handleDialogStay}
        onLeave={handleDialogLeave}
      />
    </Layout>
  );
}
