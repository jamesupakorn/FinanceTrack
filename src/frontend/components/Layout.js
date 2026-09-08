/**
 * คอมโพเนนต์: Layout
 * เชลล์กลางของทุกหน้า — sidebar (desktop) / top bar + bottom nav (mobile) / session guard /
 * inactivity timeout / เมนูผู้ใช้ / โมดัลปฏิทินรวมค่าใช้จ่ายหนึ่งเดียว (P1 · shell-navigation)
 *
 * รวมสิ่งที่เคยซ้ำกันอยู่ 2 จุด (edit.js, credit-cards.js) มาไว้ที่เดียว:
 * - session guard (isReady && !currentUser → /profiles) — ย้ายมาจาก edit.js/credit-cards.js
 * - inactivity timeout 60 นาที — ย้ายมาจาก edit.js:168-212 "คำต่อคำ" ใช้ localStorage key เดิม
 *   (edit_last_activity_<userId>) เพื่อไม่ให้ session ที่ล็อกอินอยู่แล้วหลุดตอน deploy
 * - เมนูผู้ใช้ (เปลี่ยนรหัสผ่าน / สลับผู้ใช้ / ออกจากระบบ) + ChangePasswordModal — ย้ายมาจาก edit.js
 * - ExpenseCalendarModal หนึ่งอินสแตนซ์เดียวในทั้งแอป (AC-SH-13)
 *
 * ปุ่ม "เพิ่มเติม" บนมือถือเปิด bottom sheet ที่มี focus trap ของตัวเอง — ใช้
 * getTabbableElements จาก shared/utils/frontend/focusTrap.js (ของกลางที่สกัดจาก
 * ExpenseCalendarModal.js หลัง TD-M06 — เดิมไฟล์นี้คัดลอกมาเป็นสำเนาของตัวเอง ตอนนี้เปลี่ยนมาใช้
 * ของกลางแล้วระหว่าง Graphite pass นี้ ตาม UX_SPEC ที่กำกับไว้ ห้ามใช้รูปแบบเก่าที่ CreditCardForm.js:87)
 *
 * Graphite redesign (shell-graphite pass) — ทั้งไฟล์ migrate เป็น Tailwind ครบแล้ว
 * (income-expense-graphite pass เคย migrate ไว้ก่อน 3 บริเวณ: เมนูผู้ใช้/guard overlay/action toast —
 * pass นี้ทำส่วนที่เหลือทั้งหมด: skip link, sidebar, top bar, main wrapper, bottom nav, bottom sheet)
 * Layout.module.css ถูกลบแล้ว — 4 ตัวแปร geometry (--nav-sidebar-width ฯลฯ) ย้ายไปอยู่ globals.css
 * แทน (ยังมีไฟล์อื่นนอก Layout.js อ่านผ่าน inline var(name, fallback) อยู่ 4 ไฟล์ — ดูหมายเหตุที่
 * globals.css เอง)
 *
 * props ที่นอกเหนือจากที่ spec ระบุไว้ (calendarTrigger, onCalendarClose): เพิ่มเพื่อคงพฤติกรรมเดิมที่
 * edit.js/credit-cards.js มีอยู่แล้วก่อนรวมโมดัลเป็นหนึ่งเดียว — ทั้งสองหน้าเคย refresh ข้อมูลของตัวเอง
 * เมื่อปิดปฏิทินแล้วมีการเปลี่ยนแปลง (edit.js:868-871, credit-cards.js:416-419) และ credit-cards.js
 * เคยเปิดปฏิทินจาก legacy deep link (`?view=calendar`) ได้เอง — ไม่มี prop นี้ทั้งสองพฤติกรรมจะหายไป
 * ใช้แพทเทิร์น counter เดียวกับ triggerSave (ADR-003) ที่โปรเจกต์นี้ใช้อยู่แล้ว ไม่ได้คิดรูปแบบใหม่
 *
 * prop เพิ่มเติมอีกตัว (onBeforeNavigate, เดิม P3 · monthly-workspace, UX Review): optional, ไม่มีผลใดๆ
 * ถ้าไม่ส่งมา — handleNavClick ยังเรียก router.push(item.href) ตรงๆ เหมือนเดิมทุกประการ (หน้า index.js/
 * credit-cards.js ไม่ได้ส่ง prop นี้ จึงไม่ได้รับผลกระทบเลย) ถ้าส่งมา (มีแค่ WorkspaceShell.js เท่านั้น
 * ที่ส่ง — ทุก route ใน /workspace/* ใช้เชลล์เดียวกัน) จะ await ก่อน push เสมอ
 * ความหมายเปลี่ยนไปจาก P3 (Amendment A5, ADR-018 §6): เดิมคือ "auto-save ก่อนออก แล้วไปต่อเสมอ" ตอนนี้
 * คืนค่า false ได้ (แปลว่า "ยังไปไม่ได้ — ผู้เรียกเปิด dialog เองแล้วและจะ push เองตอนผู้ใช้ยืนยัน")
 * เพราะ Save All (ที่ auto-save เคยเรียก) ถูกถอดออกจาก /workspace/* ทั้งฟีเจอร์แล้ว — เหลือแค่ถามแทนที่
 * จะเซฟให้เงียบๆ ปิดช่องโหว่ข้อมูลหายเงียบๆ ตอนกดเมนูนำทางออกจากหน้า (เดิม E4) ด้วยกลไกเดียวกับ
 * UnsavedChangesDialog ที่คุมการนำทางจุดอื่นทั้งหมดของ /workspace/*
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import { useSession } from '../contexts/SessionContext';
import { Icons } from './Icons';
import ChangePasswordModal from './ChangePasswordModal';
import ExpenseCalendarModal from './ExpenseCalendarModal';
import { withApiTokenHeaders } from '../../shared/utils/frontend/apiToken';
import { getTabbableElements } from '../../shared/utils/frontend/focusTrap';

const FOCUS_RING = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2';

const SESSION_KEY = 'edit_last_activity';
const SESSION_TIMEOUT = 60 * 60 * 1000; // 1 ชั่วโมง — ค่าเดิมจาก edit.js

// รายการนำทางหลัก — sidebar (desktop) ใช้ทั้งหมด, bottom nav (mobile) ใช้ 4 ตัวแรก + "เพิ่มเติม"
const NAV_ITEMS = [
  { id: 'dashboard', label: 'ภาพรวม', mobileLabel: 'ภาพรวม', href: '/', Icon: Icons.BarChart },
  { id: 'workspace', label: 'แผนการเงินรายเดือน', mobileLabel: 'แผนรายเดือน', href: '/workspace/income', Icon: Icons.Edit },
  { id: 'credit-cards', label: 'บัตรเครดิต', mobileLabel: 'บัตรเครดิต', href: '/credit-cards', Icon: Icons.CreditCard },
  { id: 'calendar', label: 'ปฏิทิน', mobileLabel: 'ปฏิทิน', action: 'calendar', Icon: Icons.Calendar },
  { id: 'reports', label: 'รายงาน', mobileLabel: 'รายงาน', href: '/reports', Icon: Icons.TrendingUp },
  { id: 'settings', label: 'ตั้งค่า', mobileLabel: 'ตั้งค่า', href: '/settings', Icon: Icons.Settings }
];
const MOBILE_PRIMARY_IDS = ['dashboard', 'workspace', 'credit-cards', 'calendar'];
const MOBILE_SHEET_NAV_IDS = ['reports', 'settings'];

/** ไอคอนจุดสามจุดสำหรับปุ่ม "เพิ่มเติม" — ไม่มีในชุด Icons.js เดิม จึงวาด inline ด้วยสไตล์เดียวกัน (stroke 2, 24x24) */
function MoreIcon({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="5" cy="12" r="1.5" />
      <circle cx="12" cy="12" r="1.5" />
      <circle cx="19" cy="12" r="1.5" />
    </svg>
  );
}

export default function Layout({
  activeNav,
  title,
  headerActions,
  onCalendarNavClick,
  calendarTrigger,
  onCalendarClose,
  onBeforeNavigate,
  contentClassName,
  children
}) {
  const router = useRouter();
  const { currentUser, isReady, logout } = useSession();
  const isLocked = !isReady || !currentUser;

  const sessionKey = useMemo(
    () => (currentUser ? `${SESSION_KEY}_${currentUser.id}` : SESSION_KEY),
    [currentUser?.id]
  );

  // ---------------------------------------------------------------- session guard + timeout
  useEffect(() => {
    if (isReady && !currentUser) {
      router.replace('/profiles');
    }
  }, [isReady, currentUser, router]);

  const updateActivity = useCallback(() => {
    if (!currentUser) return;
    localStorage.setItem(sessionKey, Date.now().toString());
  }, [currentUser, sessionKey]);

  useEffect(() => {
    if (!currentUser) return undefined;
    updateActivity();
    const events = ['mousemove', 'keydown', 'click', 'scroll'];
    events.forEach(event => window.addEventListener(event, updateActivity));
    return () => {
      events.forEach(event => window.removeEventListener(event, updateActivity));
    };
  }, [currentUser, updateActivity]);

  useEffect(() => {
    if (!currentUser) return undefined;
    const checkTimeout = () => {
      const last = parseInt(localStorage.getItem(sessionKey), 10);
      if (!last || Date.now() - last > SESSION_TIMEOUT) {
        localStorage.removeItem(sessionKey);
        logout();
        router.replace('/profiles');
      }
    };
    const interval = setInterval(checkTimeout, 60 * 1000);
    checkTimeout();
    return () => clearInterval(interval);
  }, [router, currentUser, sessionKey, logout]);

  // -------------------------------------------------------------------- เมนูผู้ใช้
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);
  const [changePasswordError, setChangePasswordError] = useState('');
  const [changePasswordSubmitting, setChangePasswordSubmitting] = useState(false);
  const [passwordToast, setPasswordToast] = useState(null);
  const userMenuRef = useRef(null);

  useEffect(() => {
    if (!userMenuOpen) return undefined;
    const handleClickOutside = (event) => {
      if (userMenuRef.current && !userMenuRef.current.contains(event.target)) {
        setUserMenuOpen(false);
      }
    };
    const handleEsc = (event) => {
      if (event.key === 'Escape') setUserMenuOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEsc);
    };
  }, [userMenuOpen]);

  useEffect(() => {
    if (!passwordToast) return undefined;
    const timer = setTimeout(() => setPasswordToast(null), 4000);
    return () => clearTimeout(timer);
  }, [passwordToast]);

  const handleSwitchProfile = () => {
    setUserMenuOpen(false);
    logout();
    router.replace('/profiles');
  };

  const handleLogoutClick = () => {
    setUserMenuOpen(false);
    logout();
    router.replace('/profiles');
  };

  const handleOpenChangePassword = () => {
    setUserMenuOpen(false);
    setChangePasswordError('');
    setChangePasswordOpen(true);
  };

  const handleCloseChangePassword = () => {
    setChangePasswordError('');
    setChangePasswordOpen(false);
  };

  const handleChangePasswordSubmit = async ({ currentPassword, newPassword }) => {
    setChangePasswordSubmitting(true);
    setChangePasswordError('');
    try {
      const response = await fetch('/api/change_password', {
        method: 'POST',
        headers: withApiTokenHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ currentPassword, newPassword, userId: currentUser?.id })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setChangePasswordError(data?.error || 'ไม่สามารถเปลี่ยนรหัสได้');
        return;
      }
      setChangePasswordOpen(false);
      setPasswordToast({ type: 'success', message: 'เปลี่ยนรหัสผ่านเรียบร้อยแล้ว' });
    } catch (error) {
      setChangePasswordError('เกิดข้อผิดพลาด กรุณาลองใหม่');
    } finally {
      setChangePasswordSubmitting(false);
    }
  };

  // -------------------------------------------------------------------- ปฏิทินรวม (AC-SH-13)
  const [calendarOpen, setCalendarOpen] = useState(false);

  useEffect(() => {
    if (calendarTrigger) setCalendarOpen(true);
  }, [calendarTrigger]);

  const handleCalendarModalClose = ({ changed } = {}) => {
    setCalendarOpen(false);
    if (typeof onCalendarClose === 'function') onCalendarClose({ changed });
  };

  // -------------------------------------------------------------------- bottom sheet "เพิ่มเติม"
  const [moreSheetOpen, setMoreSheetOpen] = useState(false);
  const moreButtonRef = useRef(null);
  const sheetRef = useRef(null);
  const firstSheetRowRef = useRef(null);

  useEffect(() => {
    if (!moreSheetOpen) return undefined;
    const timer = setTimeout(() => firstSheetRowRef.current?.focus(), 40);
    return () => clearTimeout(timer);
  }, [moreSheetOpen]);

  useEffect(() => {
    if (!moreSheetOpen) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        setMoreSheetOpen(false);
        return;
      }
      if (event.key !== 'Tab' || !sheetRef.current) return;
      const focusable = getTabbableElements(sheetRef.current);
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
      document.removeEventListener('keydown', handleKeyDown);
      moreButtonRef.current?.focus?.();
    };
  }, [moreSheetOpen]);

  // -------------------------------------------------------------------- นำทาง
  const handleNavClick = async (item) => {
    setMoreSheetOpen(false);
    if (item.action === 'calendar') {
      if (typeof onCalendarNavClick === 'function') {
        onCalendarNavClick();
      } else {
        setCalendarOpen(true);
      }
      return;
    }
    // onBeforeNavigate: optional, additive (P3 · monthly-workspace, UX Review — E4/AC-WS-15/16)
    // คืนค่า false ได้ (Amendment A5, ADR-018 §6) แปลว่า "ยังไปไม่ได้ — เปิด dialog เองแล้ว" Layout
    // จะไม่ push ต่อ ปล่อยให้ dialog ของผู้เรียกเป็นคน push เองตอนผู้ใช้กด "ออกโดยไม่บันทึก" ยังคง
    // backward-compatible เพราะ implementation เดิมของ prop นี้ resolve เป็น undefined เสมอ
    // (undefined !== false) — pages/index.js และ pages/credit-cards.js ที่ไม่ส่ง prop นี้จึงไม่กระทบ
    if (typeof onBeforeNavigate === 'function') {
      const proceed = await onBeforeNavigate(item.href);
      if (proceed === false) return;
    }
    router.push(item.href);
  };

  // ไอคอนใน nav item — currentColor ตาม Icons.js เดิม จึงกำหนดสีผ่าน text-* ของ span ห่อ ไม่ต้องส่ง
  // prop สีเข้าไปใน Icon เอง; active ต้องเป็น "สี accent + องค์ประกอบ 2px + น้ำหนักตัวอักษร" เสมอ
  // (WCAG 1.4.1 "ห้ามสื่อความหมายด้วยสีอย่างเดียว" — §6.1/§6.2)
  const renderNavIcon = (Icon, active) => (
    <span className={`inline-flex shrink-0 ${active ? 'text-accent' : 'text-secondary'}`}>
      <Icon size={20} />
    </span>
  );

  const sheetNavItems = NAV_ITEMS.filter(item => MOBILE_SHEET_NAV_IDS.includes(item.id));

  return (
    <div className="flex min-h-screen w-full">
      <a
        href="#main"
        className={`fixed left-space-3 top-[-60px] z-[200] rounded-md bg-accent px-space-5 py-space-3 text-sm font-semibold text-on-accent no-underline transition-[top] duration-base ease-graphite focus-visible:top-space-3 focus:top-space-3 ${FOCUS_RING}`}
      >
        ข้ามไปยังเนื้อหา
      </a>

      {/* ------------------------------------------------------------ sidebar (desktop, lg+) — §6.2 */}
      <nav
        className="sticky top-0 hidden h-screen w-[var(--nav-sidebar-width,240px)] shrink-0 flex-col border-r border-border-default bg-surface-1 px-space-4 py-space-5 lg:flex"
        aria-label="เมนูหลัก"
      >
        <div className="px-space-3 pb-space-5 text-lg font-bold text-primary">FinanceTrack</div>
        <div className="flex flex-1 flex-col gap-space-1">
          {NAV_ITEMS.map((item) => {
            const active = activeNav === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleNavClick(item)}
                aria-current={active ? 'page' : undefined}
                className={`flex min-h-11 w-full items-center gap-space-3 rounded-md border-l-2 px-space-3 py-space-2 text-left text-sm font-medium transition-colors duration-fast ease-graphite ${FOCUS_RING} ${
                  active
                    ? 'border-accent bg-accent-muted font-semibold text-primary'
                    : 'border-transparent text-secondary hover:bg-surface-2 hover:text-primary'
                }`}
              >
                {renderNavIcon(item.Icon, active)}
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>
        <div className="mt-space-3 border-t border-border-subtle pt-space-3">
          <button
            type="button"
            onClick={handleLogoutClick}
            className={`flex min-h-11 w-full items-center gap-space-2 rounded-md px-space-3 py-space-2 text-sm font-semibold text-neg transition-colors duration-fast ease-graphite hover:bg-neg/10 ${FOCUS_RING}`}
          >
            <Icons.Lock size={18} />
            <span>ออกจากระบบ</span>
          </button>
        </div>
      </nav>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* ------------------------------------------------------------ top bar — §6.1/§6.2 */}
        <header className="sticky top-0 z-30 border-b border-border-subtle bg-surface-1 px-space-4 py-space-3 lg:px-space-6">
          <div className="flex min-h-9 items-center justify-between gap-space-4">
            <h1 className="truncate text-2xl font-semibold text-primary">{title}</h1>
            <div className="relative shrink-0" ref={userMenuRef}>
              <button
                type="button"
                className={`flex items-center gap-space-2 rounded-full border border-border-default bg-surface-2 px-space-4 py-space-2 text-sm font-medium text-primary transition-colors duration-fast ease-graphite hover:bg-surface-3 ${FOCUS_RING} [&[data-open=true]_svg]:rotate-180 [&_svg]:transition-transform [&_svg]:duration-fast`}
                onClick={() => setUserMenuOpen(prev => !prev)}
                aria-haspopup="true"
                aria-expanded={userMenuOpen}
                data-open={userMenuOpen}
              >
                ผู้ใช้
                <Icons.ChevronDown size={16} />
              </button>
              {userMenuOpen && (
                <div
                  role="menu"
                  className="absolute right-0 top-[calc(100%+8px)] z-20 flex min-w-[240px] flex-col gap-space-1 rounded-lg border border-border-default bg-surface-3 p-space-3 shadow-elev-2 md:min-w-[260px]"
                >
                  <button
                    type="button"
                    className={`flex items-start gap-space-3 rounded-md p-space-3 text-left text-info transition-colors duration-fast ease-graphite hover:bg-accent-muted ${FOCUS_RING}`}
                    onClick={handleOpenChangePassword}
                  >
                    <span className="mt-[2px] shrink-0"><Icons.Edit size={16} color="var(--info)" /></span>
                    <div className="flex flex-col gap-[2px]">
                      <p className="text-sm font-semibold text-primary">เปลี่ยนรหัสผ่าน</p>
                      <span className="text-xs text-secondary">อัปเดตรหัสเพื่อความปลอดภัย</span>
                    </div>
                  </button>
                  <button
                    type="button"
                    className={`flex items-start gap-space-3 rounded-md p-space-3 text-left transition-colors duration-fast ease-graphite hover:bg-surface-2 ${FOCUS_RING}`}
                    onClick={handleSwitchProfile}
                  >
                    <span className="mt-[2px] shrink-0 text-secondary"><Icons.Settings size={16} /></span>
                    <div className="flex flex-col gap-[2px]">
                      <p className="text-sm font-semibold text-primary">สลับผู้ใช้</p>
                      <span className="text-xs text-secondary">กลับไปหน้าเลือกโปรไฟล์</span>
                    </div>
                  </button>
                  <button
                    type="button"
                    className={`flex items-start gap-space-3 rounded-md p-space-3 text-left transition-colors duration-fast ease-graphite hover:bg-neg/10 ${FOCUS_RING}`}
                    onClick={handleLogoutClick}
                  >
                    <span className="mt-[2px] shrink-0"><Icons.Lock size={16} color="var(--neg)" /></span>
                    <div className="flex flex-col gap-[2px]">
                      <p className="text-sm font-semibold text-neg">ออกจากระบบ</p>
                      <span className="text-xs text-secondary">ปิดเซสชันและล็อกระบบ</span>
                    </div>
                  </button>
                </div>
              )}
            </div>
          </div>
          {headerActions && (
            <div className="mt-space-3 flex items-center gap-space-2 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden [&>*]:shrink-0">
              {headerActions}
            </div>
          )}
        </header>

        {/* ------------------------------------------------------------ เนื้อหาหลัก — content, gutter =
            clamp(16px…32px) ทั้งสองฝั่ง (§6.1) max-width 1280px คงไว้ (ไม่ใช้ 1200px ตาม §6.2 ตัวหนังสือ —
            การตัดสินใจนี้ทำไว้แล้วก่อนเริ่ม pass นี้ เพื่อไม่ให้ 4 หน้าที่ปล่อยแล้วขยับความกว้างเนื้อหา) */}
        <main
          id="main"
          className={`mx-auto w-full max-w-[1280px] flex-1 p-[var(--gutter,clamp(1rem,0.5rem+2vw,2rem))] pb-[calc(var(--nav-safe-bottom,56px)+24px)] lg:pb-[var(--gutter,clamp(1rem,0.5rem+2vw,2rem))] ${contentClassName || ''}`}
        >
          {isLocked ? (
            <div className="flex min-h-screen flex-col items-center justify-center gap-space-4 text-secondary">
              <Icons.Lock size={48} color="var(--accent)" />
              <p>กำลังตรวจสอบสิทธิ์ผู้ใช้...</p>
            </div>
          ) : children}
        </main>
      </div>

      {/* ------------------------------------------------------------ bottom nav (mobile, < lg) — §6.1
          active = สี accent + เส้นขอบบนหนา 2px + น้ำหนัก 600 เสมอ (WCAG 1.4.1 "ห้ามใช้สีสื่อความหมาย
          อย่างเดียว") — เทคนิคเดียวกับ border-left ของ sidebar ด้านบน เปลี่ยนทิศเป็นแนวนอน */}
      <nav
        className="fixed inset-x-0 bottom-0 z-[100] flex items-stretch border-t border-border-subtle bg-surface-1 lg:hidden [height:var(--nav-safe-bottom,56px)] [padding-bottom:env(safe-area-inset-bottom,0px)]"
        aria-label="เมนูหลัก"
      >
        {NAV_ITEMS.filter(item => MOBILE_PRIMARY_IDS.includes(item.id)).map((item) => {
          const active = activeNav === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => handleNavClick(item)}
              aria-current={active ? 'page' : undefined}
              className={`flex min-h-11 min-w-11 flex-1 flex-col items-center justify-center gap-[2px] border-t-2 font-medium ${FOCUS_RING} ${
                active ? 'border-accent font-semibold text-accent' : 'border-transparent text-tertiary'
              }`}
            >
              {renderNavIcon(item.Icon, active)}
              <span className="text-xs">{item.mobileLabel}</span>
            </button>
          );
        })}
        <button
          ref={moreButtonRef}
          type="button"
          onClick={() => setMoreSheetOpen(true)}
          aria-haspopup="dialog"
          aria-expanded={moreSheetOpen}
          className={`flex min-h-11 min-w-11 flex-1 flex-col items-center justify-center gap-[2px] border-t-2 border-transparent font-medium text-tertiary ${FOCUS_RING}`}
        >
          <span className="inline-flex shrink-0 text-secondary"><MoreIcon size={20} /></span>
          <span className="text-xs">เพิ่มเติม</span>
        </button>
      </nav>

      {/* ------------------------------------------------------------ bottom sheet "เพิ่มเติม" (C9) */}
      {moreSheetOpen && (
        <div
          className="fixed inset-0 z-[150] flex items-end bg-[rgba(2,6,23,0.62)]"
          role="presentation"
          onMouseDown={(event) => { if (event.target === event.currentTarget) setMoreSheetOpen(false); }}
        >
          <div
            ref={sheetRef}
            role="dialog"
            aria-modal="true"
            aria-label="เมนูเพิ่มเติม"
            className="flex w-full animate-[sheetSlideUp_180ms_cubic-bezier(0.22,1,0.36,1)] flex-col gap-[2px] rounded-t-lg border border-b-0 border-border-default bg-surface-3 p-space-3 pb-[calc(env(safe-area-inset-bottom,0px)+16px)]"
          >
            <div className="mx-auto mb-space-3 mt-space-1 h-1 w-10 rounded-full bg-border-interactive" aria-hidden="true" />
            {sheetNavItems.map((item, index) => (
              <button
                key={item.id}
                ref={index === 0 ? firstSheetRowRef : undefined}
                type="button"
                onClick={() => handleNavClick(item)}
                className={`flex min-h-12 w-full items-center gap-space-3 rounded-md px-space-3 py-space-2 text-left text-sm font-medium text-primary transition-colors duration-fast ease-graphite hover:bg-surface-2 ${FOCUS_RING}`}
              >
                <item.Icon size={18} />
                <span>{item.label}</span>
              </button>
            ))}
            <div className="mx-space-1 my-space-2 h-px bg-border-subtle" />
            <button
              type="button"
              onClick={handleOpenChangePassword}
              className={`flex min-h-12 w-full items-center gap-space-3 rounded-md px-space-3 py-space-2 text-left text-sm font-medium text-primary transition-colors duration-fast ease-graphite hover:bg-surface-2 ${FOCUS_RING}`}
            >
              <Icons.Edit size={18} />
              <span>เปลี่ยนรหัสผ่าน</span>
            </button>
            <button
              type="button"
              onClick={handleSwitchProfile}
              className={`flex min-h-12 w-full items-center gap-space-3 rounded-md px-space-3 py-space-2 text-left text-sm font-medium text-primary transition-colors duration-fast ease-graphite hover:bg-surface-2 ${FOCUS_RING}`}
            >
              <Icons.Settings size={18} />
              <span>สลับผู้ใช้</span>
            </button>
            <button
              type="button"
              onClick={handleLogoutClick}
              className={`flex min-h-12 w-full items-center gap-space-3 rounded-md px-space-3 py-space-2 text-left text-sm font-medium text-neg transition-colors duration-fast ease-graphite hover:bg-surface-2 ${FOCUS_RING}`}
            >
              <Icons.Lock size={18} />
              <span>ออกจากระบบ</span>
            </button>
          </div>
        </div>
      )}

      {passwordToast && (
        <div
          role="status"
          aria-live="polite"
          className={`fixed right-space-4 top-space-4 z-[60] flex items-center gap-space-3 rounded-lg border bg-surface-3 px-space-4 py-space-3 text-primary shadow-elev-2 ${
            passwordToast.type === 'success' ? 'border-pos/50 text-pos' : 'border-border-default'
          }`}
        >
          <Icons.Check size={20} />
          <span className="text-sm font-semibold text-primary">{passwordToast.message}</span>
        </div>
      )}

      <ChangePasswordModal
        open={changePasswordOpen}
        onClose={handleCloseChangePassword}
        onSubmit={handleChangePasswordSubmit}
        errorMessage={changePasswordError}
        isSubmitting={changePasswordSubmitting}
      />

      <ExpenseCalendarModal open={calendarOpen} onClose={handleCalendarModalClose} />
    </div>
  );
}
