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
 * ปุ่ม "เพิ่มเติม" บนมือถือเปิด bottom sheet ที่มี focus trap ของตัวเอง — คัดลอกรูปแบบ
 * getTabbableElements/FOCUSABLE_SELECTOR ("ตัวจริง" ที่แก้บั๊กแล้ว) มาจาก
 * ExpenseCalendarModal.js:49-74 ตรงตามที่ UX_SPEC กำกับไว้ (ห้ามใช้รูปแบบเก่าที่ CreditCardForm.js:87)
 *
 * props ที่นอกเหนือจากที่ spec ระบุไว้ (calendarTrigger, onCalendarClose): เพิ่มเพื่อคงพฤติกรรมเดิมที่
 * edit.js/credit-cards.js มีอยู่แล้วก่อนรวมโมดัลเป็นหนึ่งเดียว — ทั้งสองหน้าเคย refresh ข้อมูลของตัวเอง
 * เมื่อปิดปฏิทินแล้วมีการเปลี่ยนแปลง (edit.js:868-871, credit-cards.js:416-419) และ credit-cards.js
 * เคยเปิดปฏิทินจาก legacy deep link (`?view=calendar`) ได้เอง — ไม่มี prop นี้ทั้งสองพฤติกรรมจะหายไป
 * ใช้แพทเทิร์น counter เดียวกับ triggerSave (ADR-003) ที่โปรเจกต์นี้ใช้อยู่แล้ว ไม่ได้คิดรูปแบบใหม่
 *
 * prop เพิ่มเติมอีกตัว (onBeforeNavigate, P3 · monthly-workspace, UX Review): optional, ไม่มีผลใดๆ
 * ถ้าไม่ส่งมา — handleNavClick ยังเรียก router.push(item.href) ตรงๆ เหมือนเดิมทุกประการ (หน้า index.js/
 * credit-cards.js ไม่ได้ส่ง prop นี้ จึงไม่ได้รับผลกระทบเลย) ถ้าส่งมา (มีแค่ pages/workspace.js เท่านั้น
 * ที่ส่ง) จะ await ก่อน push เพื่อให้หน้าที่มีข้อมูลยังไม่ได้บันทึกเซฟก่อนออกจากหน้า — ปิดช่องโหว่ข้อมูล
 * หายเงียบๆ ตอนกดเมนูนำทางออกจากหน้า (E4) ด้วยแพทเทิร์นเดียวกับ auto-save ตอนเปลี่ยนเดือน (ADR-006
 * Decision 6) ไม่ใช่แพทเทิร์นใหม่
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import { useSession } from '../contexts/SessionContext';
import { Icons } from './Icons';
import ChangePasswordModal from './ChangePasswordModal';
import ExpenseCalendarModal from './ExpenseCalendarModal';
import { withApiTokenHeaders } from '../../shared/utils/frontend/apiToken';
import homeStyles from '../styles/Home.module.css';
import styles from '../styles/Layout.module.css';

const SESSION_KEY = 'edit_last_activity';
const SESSION_TIMEOUT = 60 * 60 * 1000; // 1 ชั่วโมง — ค่าเดิมจาก edit.js

// รายการนำทางหลัก — sidebar (desktop) ใช้ทั้งหมด, bottom nav (mobile) ใช้ 4 ตัวแรก + "เพิ่มเติม"
const NAV_ITEMS = [
  { id: 'dashboard', label: 'ภาพรวม', mobileLabel: 'ภาพรวม', href: '/', Icon: Icons.BarChart },
  { id: 'workspace', label: 'บันทึกรายเดือน', mobileLabel: 'รายเดือน', href: '/workspace', Icon: Icons.Edit },
  { id: 'credit-cards', label: 'บัตรเครดิต', mobileLabel: 'บัตรเครดิต', href: '/credit-cards', Icon: Icons.CreditCard },
  { id: 'calendar', label: 'ปฏิทิน', mobileLabel: 'ปฏิทิน', action: 'calendar', Icon: Icons.Calendar },
  { id: 'reports', label: 'รายงาน', mobileLabel: 'รายงาน', href: '/reports', Icon: Icons.TrendingUp },
  { id: 'settings', label: 'ตั้งค่า', mobileLabel: 'ตั้งค่า', href: '/settings', Icon: Icons.Settings }
];
const MOBILE_PRIMARY_IDS = ['dashboard', 'workspace', 'credit-cards', 'calendar'];
const MOBILE_SHEET_NAV_IDS = ['reports', 'settings'];

// selector กว้างไว้ก่อนแล้วกรองด้วยความจริงของ element ทีหลัง — คัดลอกจาก ExpenseCalendarModal.js:49-74
const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'a[href]',
  '[tabindex]'
].join(', ');

function getTabbableElements(root) {
  return Array.from(root.querySelectorAll(FOCUSABLE_SELECTOR)).filter(element => (
    !element.disabled
    && element.tabIndex >= 0
    && (element.offsetParent !== null || element.getClientRects().length > 0)
  ));
}

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
    if (typeof onBeforeNavigate === 'function') {
      await onBeforeNavigate(item.href);
    }
    router.push(item.href);
  };

  const renderNavIcon = (Icon, active) => (
    <span className={`${styles.navIcon} ${active ? styles.navIconActive : ''}`}>
      <Icon size={20} />
    </span>
  );

  const sheetNavItems = NAV_ITEMS.filter(item => MOBILE_SHEET_NAV_IDS.includes(item.id));

  return (
    <div className={styles.shell}>
      <a href="#main" className={styles.skipLink}>ข้ามไปยังเนื้อหา</a>

      {/* ------------------------------------------------------------ sidebar (desktop) */}
      <nav className={styles.sidebar} aria-label="เมนูหลัก">
        <div className={styles.sidebarBrand}>FinanceTrack</div>
        <div className={styles.sidebarNavList}>
          {NAV_ITEMS.map((item) => {
            const active = activeNav === item.id;
            return (
              <button
                key={item.id}
                type="button"
                className={`${styles.sidebarNavItem} ${active ? styles.sidebarNavItemActive : ''}`}
                onClick={() => handleNavClick(item)}
                aria-current={active ? 'page' : undefined}
              >
                {renderNavIcon(item.Icon, active)}
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>
        <div className={styles.sidebarFooter}>
          <button type="button" className={styles.sidebarLogout} onClick={handleLogoutClick}>
            <Icons.Lock size={18} />
            <span>ออกจากระบบ</span>
          </button>
        </div>
      </nav>

      <div className={styles.main}>
        {/* ------------------------------------------------------------ top bar */}
        <header className={styles.topBar}>
          <div className={styles.topBarTitleRow}>
            <h1 className={styles.topBarTitle}>{title}</h1>
            <div className={styles.userMenuWrapper} ref={userMenuRef}>
              <button
                type="button"
                className={homeStyles.userMenuButton}
                onClick={() => setUserMenuOpen(prev => !prev)}
                aria-haspopup="true"
                aria-expanded={userMenuOpen}
                data-open={userMenuOpen}
              >
                ผู้ใช้
                <Icons.ChevronDown size={16} />
              </button>
              {userMenuOpen && (
                <div className={homeStyles.userDropdown} role="menu">
                  <button type="button" className={`${homeStyles.userMenuItem} ${homeStyles.userMenuAccent}`} onClick={handleOpenChangePassword}>
                    <Icons.Edit size={16} />
                    <div>
                      <p>เปลี่ยนรหัสผ่าน</p>
                      <span>อัปเดตรหัสเพื่อความปลอดภัย</span>
                    </div>
                  </button>
                  <button type="button" className={homeStyles.userMenuItem} onClick={handleSwitchProfile}>
                    <Icons.Settings size={16} />
                    <div>
                      <p>สลับผู้ใช้</p>
                      <span>กลับไปหน้าเลือกโปรไฟล์</span>
                    </div>
                  </button>
                  <button
                    type="button"
                    className={`${homeStyles.userMenuItem} ${homeStyles.userMenuDanger}`}
                    onClick={handleLogoutClick}
                  >
                    <Icons.Lock size={16} />
                    <div>
                      <p>ออกจากระบบ</p>
                      <span>ปิดเซสชันและล็อกระบบ</span>
                    </div>
                  </button>
                </div>
              )}
            </div>
          </div>
          {headerActions && (
            <div className={styles.headerActionsRow}>
              {headerActions}
            </div>
          )}
        </header>

        {/* ------------------------------------------------------------ เนื้อหาหลัก */}
        <main id="main" className={`${styles.content} ${contentClassName || ''}`}>
          {isLocked ? (
            <div className={homeStyles.guardContainer}>
              <Icons.Lock size={48} color="var(--color-primary)" />
              <p>กำลังตรวจสอบสิทธิ์ผู้ใช้...</p>
            </div>
          ) : children}
        </main>
      </div>

      {/* ------------------------------------------------------------ bottom nav (mobile) */}
      <nav className={styles.bottomNav} aria-label="เมนูหลัก">
        {NAV_ITEMS.filter(item => MOBILE_PRIMARY_IDS.includes(item.id)).map((item) => {
          const active = activeNav === item.id;
          return (
            <button
              key={item.id}
              type="button"
              className={`${styles.bottomNavItem} ${active ? styles.bottomNavItemActive : ''}`}
              onClick={() => handleNavClick(item)}
              aria-current={active ? 'page' : undefined}
            >
              {renderNavIcon(item.Icon, active)}
              <span className={styles.bottomNavLabel}>{item.mobileLabel}</span>
            </button>
          );
        })}
        <button
          ref={moreButtonRef}
          type="button"
          className={styles.bottomNavItem}
          onClick={() => setMoreSheetOpen(true)}
          aria-haspopup="dialog"
          aria-expanded={moreSheetOpen}
        >
          <span className={styles.navIcon}><MoreIcon size={20} /></span>
          <span className={styles.bottomNavLabel}>เพิ่มเติม</span>
        </button>
      </nav>

      {/* ------------------------------------------------------------ bottom sheet "เพิ่มเติม" */}
      {moreSheetOpen && (
        <div
          className={styles.sheetBackdrop}
          role="presentation"
          onMouseDown={(event) => { if (event.target === event.currentTarget) setMoreSheetOpen(false); }}
        >
          <div
            ref={sheetRef}
            className={styles.sheet}
            role="dialog"
            aria-modal="true"
            aria-label="เมนูเพิ่มเติม"
          >
            <div className={styles.sheetHandle} aria-hidden="true" />
            {sheetNavItems.map((item, index) => (
              <button
                key={item.id}
                ref={index === 0 ? firstSheetRowRef : undefined}
                type="button"
                className={styles.sheetRow}
                onClick={() => handleNavClick(item)}
              >
                <item.Icon size={18} />
                <span>{item.label}</span>
              </button>
            ))}
            <div className={styles.sheetDivider} />
            <button type="button" className={styles.sheetRow} onClick={handleOpenChangePassword}>
              <Icons.Edit size={18} />
              <span>เปลี่ยนรหัสผ่าน</span>
            </button>
            <button type="button" className={styles.sheetRow} onClick={handleSwitchProfile}>
              <Icons.Settings size={18} />
              <span>สลับผู้ใช้</span>
            </button>
            <button type="button" className={`${styles.sheetRow} ${styles.sheetRowDanger}`} onClick={handleLogoutClick}>
              <Icons.Lock size={18} />
              <span>ออกจากระบบ</span>
            </button>
          </div>
        </div>
      )}

      {passwordToast && (
        <div className={`${homeStyles.actionToast} ${passwordToast.type === 'success' ? homeStyles.actionToastSuccess : ''}`}>
          <Icons.Check size={20} />
          <span>{passwordToast.message}</span>
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
