/**
 * คอมโพเนนต์: Layout
 * เชลล์กลางของทุกหน้า — sidebar / mobile navigation / session guard / user menu / calendar modal
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from 'react';
import { useRouter } from 'next/router';
import { useSession } from '../contexts/SessionContext';
import { Icons } from './Icons';
import ChangePasswordModal from './ChangePasswordModal';
import ExpenseCalendarModal from './ExpenseCalendarModal';
import { withCsrfHeaders } from '../../shared/utils/frontend/apiUtils';
import { getTabbableElements } from '../../shared/utils/frontend/focusTrap';

interface NavItemBase {
  id: string;
  label: string;
  mobileLabel: string;
  Icon: ComponentType<{ size?: number }>;
}

type NavItem = (NavItemBase & { action: 'calendar'; href?: never })
  | (NavItemBase & { action?: never; href: string });

interface LayoutProps {
  activeNav: string;
  title: string;
  headerActions?: ReactNode;
  onCalendarNavClick?: () => void;
  calendarTrigger?: number | string;
  onCalendarClose?: (result: { changed: boolean }) => void;
  onBeforeNavigate?: (href: string) => boolean | void | Promise<boolean | void>;
  contentClassName?: string;
  children?: ReactNode;
}

interface PasswordPayload {
  currentPassword: string;
  newPassword: string;
}

interface PasswordToast {
  type: 'success';
  message: string;
}

const FOCUS_RING = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2';

const SESSION_KEY = 'edit_last_activity';
const SESSION_TIMEOUT = 60 * 60 * 1000;

const NAV_ITEMS: NavItem[] = [
  { id: 'dashboard', label: 'ภาพรวม', mobileLabel: 'ภาพรวม', href: '/', Icon: Icons.BarChart },
  { id: 'workspace', label: 'แผนการเงินรายเดือน', mobileLabel: 'แผนรายเดือน', href: '/workspace/income', Icon: Icons.Edit },
  { id: 'credit-cards', label: 'บัตรเครดิต', mobileLabel: 'บัตรเครดิต', href: '/credit-cards', Icon: Icons.CreditCard },
  { id: 'calendar', label: 'ปฏิทิน', mobileLabel: 'ปฏิทิน', action: 'calendar', Icon: Icons.Calendar },
  { id: 'reports', label: 'รายงาน', mobileLabel: 'รายงาน', href: '/reports', Icon: Icons.TrendingUp },
  { id: 'settings', label: 'ตั้งค่า', mobileLabel: 'ตั้งค่า', href: '/settings', Icon: Icons.Settings }
];
const MOBILE_PRIMARY_IDS = ['dashboard', 'workspace', 'credit-cards', 'calendar'];
const MOBILE_SHEET_NAV_IDS = ['reports', 'settings'];

function MoreIcon({ size = 20 }: { size?: number }) {
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
}: LayoutProps) {
  const router = useRouter();
  const { currentUser, isReady, logout } = useSession();
  const isLocked = !isReady || !currentUser;
  const mainRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (mainRef.current) mainRef.current.scrollTop = 0;
  }, [router.asPath]);

  const sessionKey = useMemo(
    () => (currentUser ? `${SESSION_KEY}_${currentUser.id}` : SESSION_KEY),
    [currentUser?.id]
  );

  useEffect(() => {
    if (isReady && !currentUser) router.replace('/profiles');
  }, [isReady, currentUser, router]);

  const updateActivity = useCallback(() => {
    if (!currentUser) return;
    localStorage.setItem(sessionKey, Date.now().toString());
  }, [currentUser, sessionKey]);

  useEffect(() => {
    if (!currentUser) return undefined;
    updateActivity();
    const events = ['mousemove', 'keydown', 'click', 'scroll'] as const;
    events.forEach(event => window.addEventListener(event, updateActivity));
    return () => events.forEach(event => window.removeEventListener(event, updateActivity));
  }, [currentUser, updateActivity]);

  useEffect(() => {
    if (!currentUser) return undefined;
    const checkTimeout = () => {
      const last = parseInt(localStorage.getItem(sessionKey) || '', 10);
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

  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);
  const [changePasswordError, setChangePasswordError] = useState('');
  const [changePasswordSubmitting, setChangePasswordSubmitting] = useState(false);
  const [passwordToast, setPasswordToast] = useState<PasswordToast | null>(null);
  const userMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!userMenuOpen) return undefined;
    const handleClickOutside = (event: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(event.target as Node)) setUserMenuOpen(false);
    };
    const handleEsc = (event: KeyboardEvent) => {
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

  const handleChangePasswordSubmit = async ({ currentPassword, newPassword }: PasswordPayload) => {
    setChangePasswordSubmitting(true);
    setChangePasswordError('');
    try {
      const response = await fetch('/api/change_password', {
        method: 'POST',
        headers: withCsrfHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ currentPassword, newPassword })
      });
      const data = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) {
        setChangePasswordError(data?.error || 'ไม่สามารถเปลี่ยนรหัสได้');
        return;
      }
      setChangePasswordOpen(false);
      setPasswordToast({ type: 'success', message: 'เปลี่ยนรหัสผ่านเรียบร้อยแล้ว' });
    } catch {
      setChangePasswordError('เกิดข้อผิดพลาด กรุณาลองใหม่');
    } finally {
      setChangePasswordSubmitting(false);
    }
  };

  const [calendarOpen, setCalendarOpen] = useState(false);

  useEffect(() => {
    if (calendarTrigger) setCalendarOpen(true);
  }, [calendarTrigger]);

  const handleCalendarModalClose = ({ changed }: { changed: boolean }) => {
    setCalendarOpen(false);
    onCalendarClose?.({ changed });
  };

  const [moreSheetOpen, setMoreSheetOpen] = useState(false);
  const moreButtonRef = useRef<HTMLButtonElement | null>(null);
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const firstSheetRowRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!moreSheetOpen) return undefined;
    const timer = setTimeout(() => firstSheetRowRef.current?.focus(), 40);
    return () => clearTimeout(timer);
  }, [moreSheetOpen]);

  useEffect(() => {
    if (!moreSheetOpen) return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
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
      moreButtonRef.current?.focus();
    };
  }, [moreSheetOpen]);

  const handleNavClick = async (item: NavItem) => {
    setMoreSheetOpen(false);
    if (item.action === 'calendar') {
      if (typeof onCalendarNavClick === 'function') onCalendarNavClick();
      else setCalendarOpen(true);
      return;
    }
    if (typeof onBeforeNavigate === 'function') {
      const proceed = await onBeforeNavigate(item.href);
      if (proceed === false) return;
    }
    router.push(item.href);
  };

  const renderNavIcon = (Icon: NavItem['Icon'], active: boolean) => (
    <span className={`inline-flex shrink-0 ${active ? 'text-accent' : 'text-secondary'}`}>
      <Icon size={20} />
    </span>
  );

  const sheetNavItems = NAV_ITEMS.filter(item => MOBILE_SHEET_NAV_IDS.includes(item.id));

  return (
    <div className="flex h-dvh w-full">
      <a href="#main" className={`fixed left-space-3 top-[-60px] z-[200] rounded-md bg-accent px-space-5 py-space-3 text-sm font-semibold text-on-accent no-underline transition-[top] duration-base ease-graphite focus-visible:top-space-3 focus:top-space-3 ${FOCUS_RING}`}>
        ข้ามไปยังเนื้อหา
      </a>

      <nav className="sticky top-0 hidden h-dvh w-[var(--nav-sidebar-width,240px)] shrink-0 flex-col border-r border-border-default bg-surface-1 px-space-4 py-space-5 lg:flex" aria-label="เมนูหลัก">
        <div className="px-space-3 pb-space-5 text-lg font-bold text-primary">FinanceTrack</div>
        <div className="flex flex-1 flex-col gap-space-1">
          {NAV_ITEMS.map(item => {
            const active = activeNav === item.id;
            return (
              <button key={item.id} type="button" onClick={() => handleNavClick(item)} aria-current={active ? 'page' : undefined} className={`flex min-h-11 w-full items-center gap-space-3 rounded-md border-l-2 px-space-3 py-space-2 text-left text-sm font-medium transition-colors duration-fast ease-graphite ${FOCUS_RING} ${active ? 'border-accent bg-accent-muted font-semibold text-primary' : 'border-transparent text-secondary hover:bg-surface-2 hover:text-primary'}`}>
                {renderNavIcon(item.Icon, active)}<span>{item.label}</span>
              </button>
            );
          })}
        </div>
        <div className="mt-space-3 border-t border-border-subtle pt-space-3">
          <button type="button" onClick={handleLogoutClick} className={`flex min-h-11 w-full items-center gap-space-2 rounded-md px-space-3 py-space-2 text-sm font-semibold text-neg transition-colors duration-fast ease-graphite hover:bg-neg/10 ${FOCUS_RING}`}>
            <Icons.Lock size={18} /><span>ออกจากระบบ</span>
          </button>
        </div>
      </nav>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 border-b border-border-subtle bg-surface-1 px-space-4 py-space-3 lg:px-space-6">
          <div className="flex min-h-9 items-center justify-between gap-space-4">
            <h1 className="truncate text-2xl font-semibold text-primary">{title}</h1>
            <div className="relative shrink-0" ref={userMenuRef}>
              <button type="button" className={`flex items-center gap-space-2 rounded-full border border-border-default bg-surface-2 px-space-4 py-space-2 text-sm font-medium text-primary transition-colors duration-fast ease-graphite hover:bg-surface-3 ${FOCUS_RING} [&[data-open=true]_svg]:rotate-180 [&_svg]:transition-transform [&_svg]:duration-fast`} onClick={() => setUserMenuOpen(prev => !prev)} aria-haspopup="true" aria-expanded={userMenuOpen} data-open={userMenuOpen}>
                ผู้ใช้<Icons.ChevronDown size={16} />
              </button>
              {userMenuOpen && (
                <div role="menu" className="absolute right-0 top-[calc(100%+8px)] z-20 flex min-w-[240px] flex-col gap-space-1 rounded-lg border border-border-default bg-surface-3 p-space-3 shadow-elev-2 md:min-w-[260px]">
                  <button type="button" className={`flex items-start gap-space-3 rounded-md p-space-3 text-left text-info transition-colors duration-fast ease-graphite hover:bg-accent-muted ${FOCUS_RING}`} onClick={handleOpenChangePassword}>
                    <span className="mt-[2px] shrink-0"><Icons.Edit size={16} color="var(--info)" /></span><div className="flex flex-col gap-[2px]"><p className="text-sm font-semibold text-primary">เปลี่ยนรหัสผ่าน</p><span className="text-xs text-secondary">อัปเดตรหัสเพื่อความปลอดภัย</span></div>
                  </button>
                  <button type="button" className={`flex items-start gap-space-3 rounded-md p-space-3 text-left transition-colors duration-fast ease-graphite hover:bg-surface-2 ${FOCUS_RING}`} onClick={handleSwitchProfile}>
                    <span className="mt-[2px] shrink-0 text-secondary"><Icons.Settings size={16} /></span><div className="flex flex-col gap-[2px]"><p className="text-sm font-semibold text-primary">สลับผู้ใช้</p><span className="text-xs text-secondary">กลับไปหน้าเลือกโปรไฟล์</span></div>
                  </button>
                  <button type="button" className={`flex items-start gap-space-3 rounded-md p-space-3 text-left transition-colors duration-fast ease-graphite hover:bg-neg/10 ${FOCUS_RING}`} onClick={handleLogoutClick}>
                    <span className="mt-[2px] shrink-0"><Icons.Lock size={16} color="var(--neg)" /></span><div className="flex flex-col gap-[2px]"><p className="text-sm font-semibold text-neg">ออกจากระบบ</p><span className="text-xs text-secondary">ปิดเซสชันและล็อกระบบ</span></div>
                  </button>
                </div>
              )}
            </div>
          </div>
          {headerActions && <div className="mt-space-3 flex items-center gap-space-2 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden [&>*]:shrink-0">{headerActions}</div>}
        </header>

        <main ref={mainRef} id="main" className={`relative mx-auto min-h-0 w-full max-w-[1280px] flex-1 overflow-y-auto overscroll-y-contain p-[var(--gutter,clamp(1rem,0.5rem+2vw,2rem))] pb-[calc(var(--nav-safe-bottom,56px)+24px)] lg:pb-[var(--gutter,clamp(1rem,0.5rem+2vw,2rem))] ${contentClassName || ''}`}>
          {isLocked ? (
            <div className="flex min-h-full flex-col items-center justify-center gap-space-4 text-secondary"><Icons.Lock size={48} color="var(--accent)" /><p>กำลังตรวจสอบสิทธิ์ผู้ใช้...</p></div>
          ) : children}
        </main>
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-[100] flex items-stretch border-t border-border-subtle bg-surface-1 lg:hidden [height:var(--nav-safe-bottom,56px)] [padding-bottom:env(safe-area-inset-bottom,0px)]" aria-label="เมนูหลัก">
        {NAV_ITEMS.filter(item => MOBILE_PRIMARY_IDS.includes(item.id)).map(item => {
          const active = activeNav === item.id;
          return (
            <button key={item.id} type="button" onClick={() => handleNavClick(item)} aria-current={active ? 'page' : undefined} className={`flex min-h-11 min-w-11 flex-1 flex-col items-center justify-center gap-[2px] border-t-2 font-medium ${FOCUS_RING} ${active ? 'border-accent font-semibold text-accent' : 'border-transparent text-tertiary'}`}>
              {renderNavIcon(item.Icon, active)}<span className="text-xs">{item.mobileLabel}</span>
            </button>
          );
        })}
        <button ref={moreButtonRef} type="button" onClick={() => setMoreSheetOpen(true)} aria-haspopup="dialog" aria-expanded={moreSheetOpen} className={`flex min-h-11 min-w-11 flex-1 flex-col items-center justify-center gap-[2px] border-t-2 border-transparent font-medium text-tertiary ${FOCUS_RING}`}>
          <span className="inline-flex shrink-0 text-secondary"><MoreIcon size={20} /></span><span className="text-xs">เพิ่มเติม</span>
        </button>
      </nav>

      {moreSheetOpen && (
        <div className="fixed inset-0 z-[150] flex items-end bg-[rgba(2,6,23,0.62)]" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setMoreSheetOpen(false); }}>
          <div ref={sheetRef} role="dialog" aria-modal="true" aria-label="เมนูเพิ่มเติม" className="flex w-full animate-[sheetSlideUp_180ms_cubic-bezier(0.22,1,0.36,1)] flex-col gap-[2px] rounded-t-lg border border-b-0 border-border-default bg-surface-3 p-space-3 pb-[calc(env(safe-area-inset-bottom,0px)+16px)]">
            <div className="mx-auto mb-space-3 mt-space-1 h-1 w-10 rounded-full bg-border-interactive" aria-hidden="true" />
            {sheetNavItems.map((item, index) => (
              <button key={item.id} ref={index === 0 ? firstSheetRowRef : undefined} type="button" onClick={() => handleNavClick(item)} className={`flex min-h-12 w-full items-center gap-space-3 rounded-md px-space-3 py-space-2 text-left text-sm font-medium text-primary transition-colors duration-fast ease-graphite hover:bg-surface-2 ${FOCUS_RING}`}>
                <item.Icon size={18} /><span>{item.label}</span>
              </button>
            ))}
            <div className="mx-space-1 my-space-2 h-px bg-border-subtle" />
            <button type="button" onClick={handleOpenChangePassword} className={`flex min-h-12 w-full items-center gap-space-3 rounded-md px-space-3 py-space-2 text-left text-sm font-medium text-primary transition-colors duration-fast ease-graphite hover:bg-surface-2 ${FOCUS_RING}`}><Icons.Edit size={18} /><span>เปลี่ยนรหัสผ่าน</span></button>
            <button type="button" onClick={handleSwitchProfile} className={`flex min-h-12 w-full items-center gap-space-3 rounded-md px-space-3 py-space-2 text-left text-sm font-medium text-primary transition-colors duration-fast ease-graphite hover:bg-surface-2 ${FOCUS_RING}`}><Icons.Settings size={18} /><span>สลับผู้ใช้</span></button>
            <button type="button" onClick={handleLogoutClick} className={`flex min-h-12 w-full items-center gap-space-3 rounded-md px-space-3 py-space-2 text-left text-sm font-medium text-neg transition-colors duration-fast ease-graphite hover:bg-surface-2 ${FOCUS_RING}`}><Icons.Lock size={18} /><span>ออกจากระบบ</span></button>
          </div>
        </div>
      )}

      {passwordToast && (
        <div role="status" aria-live="polite" className={`fixed right-space-4 top-space-4 z-[60] flex items-center gap-space-3 rounded-lg border bg-surface-3 px-space-4 py-space-3 text-primary shadow-elev-2 ${passwordToast.type === 'success' ? 'border-pos/50 text-pos' : 'border-border-default'}`}>
          <Icons.Check size={20} /><span className="text-sm font-semibold text-primary">{passwordToast.message}</span>
        </div>
      )}

      <ChangePasswordModal open={changePasswordOpen} onClose={handleCloseChangePassword} onSubmit={handleChangePasswordSubmit} errorMessage={changePasswordError} isSubmitting={changePasswordSubmitting} />
      <ExpenseCalendarModal open={calendarOpen} onClose={handleCalendarModalClose} />
    </div>
  );
}