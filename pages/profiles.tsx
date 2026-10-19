/**
 * หน้า: /profiles — login gate, renders outside Layout.
 * Password entry is revealed inline on the selected profile card.
 */

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/router';
import { useSession } from '../src/frontend/contexts/SessionContext';
import { loadUsers } from '../lib/userStore';
import LoadingSkeleton, { SkeletonBlock } from '../src/frontend/components/LoadingSkeleton';

interface Profile {
  id: string;
  displayName: string;
  avatar?: string;
  isDemo?: boolean;
  tagline?: string;
  description?: string;
}

interface ProfileGalleryPageProps {
  initialProfiles?: Profile[];
}

interface ProfileResponse {
  users?: Profile[];
  user?: unknown;
  success?: boolean;
  error?: string;
}

const DEFAULT_DESCRIPTION = 'เลือกรูปโปรไฟล์ที่ต้องการใช้งาน แล้วกรอกรหัสผ่านของแต่ละผู้ใช้';
const DEMO_PROFILE: Profile = {
  id: 'demo',
  displayName: 'บัญชีสาธิต (Demo)',
  avatar: '',
  isDemo: true,
  tagline: 'ไม่ต้องใช้รหัสผ่าน',
  description: 'มีข้อมูลปลอมจำลองครบทุกหมวดหมู่ สามารถลองแก้ไขได้ทันที'
};

const FOCUS_RING = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2';
const CARD_BASE = `flex gap-space-3 rounded-md border border-border-default bg-surface-1 p-space-4 shadow-elev-1 transition-transform duration-fast ease-graphite hover:-translate-y-0.5 hover:border-border-interactive hover:shadow-elev-2 md:p-space-5 ${FOCUS_RING}`;
const CARD_SKELETON = 'flex gap-space-3 rounded-md border border-border-default bg-surface-1 p-space-4 shadow-elev-1 md:p-space-5';
const PRIMARY_BUTTON = `inline-flex h-11 items-center justify-center rounded-sm bg-accent px-space-5 text-sm font-semibold text-on-accent transition-opacity duration-fast ease-graphite disabled:cursor-not-allowed disabled:opacity-60 ${FOCUS_RING}`;
const SECONDARY_BUTTON = `inline-flex h-11 items-center justify-center rounded-sm border border-border-interactive bg-surface-2 px-space-5 text-sm font-medium text-primary transition-colors duration-fast ease-graphite hover:bg-surface-3 disabled:cursor-not-allowed disabled:opacity-60 ${FOCUS_RING}`;
const CHIP_BASE = 'inline-flex items-center gap-space-1 rounded-full px-space-3 py-space-1 text-xs font-medium whitespace-nowrap';

function Avatar({ profile }: { profile: Profile }) {
  const initials = profile.displayName?.charAt(0)?.toUpperCase() || '?';
  return (
    <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-md bg-surface-2 text-xl font-semibold text-primary">
      {profile.avatar ? <img src={profile.avatar} alt={profile.displayName} className="h-full w-full object-cover" /> : initials}
    </div>
  );
}

function EyeIcon({ open }: { open: boolean }) {
  return open ? (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17.94 17.94A10.06 10.06 0 0 1 12 20c-5.05 0-9.29-3.14-11-8 1.06-2.81 2.99-5.12 5.47-6.53M9.53 3.47A9.94 9.94 0 0 1 12 4c5.05 0 9.29 3.14 11 8a10.05 10.05 0 0 1-4.17 5.19M1 1l22 22" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  ) : (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12C2.71 7.14 6.95 4 12 4s9.29 3.14 11 8c-1.71 4.86-5.95 8-11 8S2.71 16.86 1 12z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

export default function ProfileGalleryPage({ initialProfiles = [] }: ProfileGalleryPageProps) {
  const router = useRouter();
  const { currentUser, isReady, selectUser, logout } = useSession();
  const [profiles, setProfiles] = useState<Profile[]>([
    DEMO_PROFILE,
    ...initialProfiles.filter(profile => profile.id !== DEMO_PROFILE.id)
  ]);
  const [loading, setLoading] = useState(() => initialProfiles.length === 0);
  const [error, setError] = useState('');
  const [revealedProfileId, setRevealedProfileId] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [formError, setFormError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const cardRefs = useRef<Record<string, HTMLElement | null>>({});

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/users?ts=${Date.now()}`, { cache: 'no-store' });
      const data = await response.json() as ProfileResponse;
      if (!response.ok) throw new Error(data?.error || 'ไม่สามารถโหลดรายชื่อผู้ใช้');
      let nextProfiles = Array.isArray(data.users) ? [...data.users] : [];
      if (!nextProfiles.length) throw new Error('ไม่พบรายชื่อผู้ใช้');
      nextProfiles = nextProfiles.filter(user => user.id !== DEMO_PROFILE.id);
      nextProfiles.unshift(DEMO_PROFILE);
      setProfiles(nextProfiles);
      setError('');
    } catch (caughtError) {
      const message = (caughtError as Error).message;
      console.error('โหลดผู้ใช้ไม่สำเร็จ', caughtError);
      if (initialProfiles.length === 0) {
        setError(message === 'unauthorized' ? 'ไม่สามารถยืนยันตัวตนกับระบบได้' : 'ไม่สามารถโหลดรายชื่อผู้ใช้');
      }
      setProfiles(currentProfiles => currentProfiles.length ? currentProfiles : [DEMO_PROFILE]);
    } finally {
      setLoading(false);
    }
    // initialProfiles is intentionally captured from the initial SSR render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (initialProfiles.length === 0) void fetchUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!revealedProfileId) return undefined;
    const timer = setTimeout(() => inputRef.current?.focus(), 40);
    return () => clearTimeout(timer);
  }, [revealedProfileId]);

  const closeReveal = (focusBackId?: string) => {
    setRevealedProfileId(null);
    setPassword('');
    setFormError('');
    setShowPassword(false);
    if (focusBackId) setTimeout(() => cardRefs.current[focusBackId]?.focus(), 0);
  };

  useEffect(() => {
    if (!revealedProfileId) return undefined;
    const closingId = revealedProfileId;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeReveal(closingId);
      }
    };
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      const node = cardRefs.current[closingId];
      if (node && node.contains(target)) return;
      const clickedAnotherCard = Object.entries(cardRefs.current).some(([id, cardNode]) => id !== closingId && cardNode?.contains(target));
      if (!clickedAnotherCard) closeReveal(closingId);
    };
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('mousedown', handlePointerDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('mousedown', handlePointerDown);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealedProfileId]);

  const handleProfileClick = (profile: Profile) => {
    if (profile.isDemo) {
      void handleDemoLogin();
      return;
    }
    if (revealedProfileId === profile.id) {
      closeReveal(profile.id);
      return;
    }
    setRevealedProfileId(profile.id);
    setPassword('');
    setFormError('');
    setShowPassword(false);
  };

  const handleDemoLogin = async () => {
    setIsSubmitting(true);
    try {
      const response = await fetch('/api/auth/profile-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: DEMO_PROFILE.id, password: 'demo' })
      });
      const data = await response.json() as ProfileResponse;
      if (!response.ok || !data.success) {
        setError(data?.error || 'ไม่สามารถเข้าสู่ระบบสาธิตได้');
        return;
      }
      selectUser(data.user as Parameters<typeof selectUser>[0]);
      await router.replace('/');
    } catch (caughtError) {
      console.error('เข้าสู่ระบบสาธิตไม่สำเร็จ', caughtError);
      setError('ไม่สามารถเข้าสู่ระบบสาธิตได้ กรุณาลองใหม่');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleLogin = async (event: FormEvent<HTMLFormElement>, profile: Profile) => {
    event.preventDefault();
    if (!password.trim()) {
      setFormError('กรุณากรอกรหัสผ่าน');
      return;
    }
    setIsSubmitting(true);
    setFormError('');
    try {
      const response = await fetch('/api/auth/profile-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: profile.id, password })
      });
      const data = await response.json() as ProfileResponse;
      if (!response.ok || !data.success) {
        setFormError(data?.error || 'เข้าสู่ระบบไม่สำเร็จ');
        setTimeout(() => inputRef.current?.focus(), 0);
        return;
      }
      selectUser(data.user as Parameters<typeof selectUser>[0]);
      await router.replace('/');
    } catch (caughtError) {
      console.error('เข้าสู่ระบบไม่สำเร็จ', caughtError);
      setFormError('ไม่สามารถเข้าสู่ระบบได้ กรุณาลองใหม่');
    } finally {
      setIsSubmitting(false);
    }
  };

  const currentUserId = currentUser?.id;
  const showProfileGrid = !loading && profiles.length > 0;

  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-space-4 py-space-7 md:py-space-8">
      <div className="flex w-full max-w-[480px] flex-col gap-space-6">
        <div className="flex flex-col gap-space-2 text-center"><h1 className="text-2xl font-semibold text-primary md:text-3xl">เลือกโปรไฟล์ผู้ใช้</h1><p className="text-sm text-secondary">{DEFAULT_DESCRIPTION}</p></div>

        {loading && (
          <LoadingSkeleton label="กำลังโหลดรายชื่อผู้ใช้..." className="grid grid-cols-1 gap-space-4 sm:grid-cols-2">
            <div className={`${CARD_SKELETON} flex-row items-center sm:col-span-2`}><SkeletonBlock className="h-16 w-16 shrink-0 rounded-md" /><div className="flex min-w-0 flex-1 flex-col gap-space-2"><SkeletonBlock className="h-[26px] w-[180px]" /><SkeletonBlock className="h-[26px] w-[120px] rounded-full" /><SkeletonBlock className="h-[22px] w-full max-w-[280px]" /></div></div>
            {[0, 1].map(index => <div key={index} className={`${CARD_SKELETON} flex-col items-center`}><SkeletonBlock className="h-16 w-16 rounded-md" /><SkeletonBlock className="h-[26px] w-[120px]" /></div>)}
          </LoadingSkeleton>
        )}

        {!loading && error && <div role="alert" className="flex flex-col items-center gap-space-3 rounded-md border border-neg/40 bg-surface-1 py-space-6 text-center shadow-elev-1"><p className="text-sm text-neg">{error}</p><button type="button" onClick={() => void fetchUsers()} className={SECONDARY_BUTTON}>ลองใหม่</button></div>}

        {showProfileGrid && (
          <div className="grid grid-cols-1 gap-space-4 sm:grid-cols-2">
            {profiles.map(profile => {
              const isRevealed = revealedProfileId === profile.id;
              const isCurrent = currentUserId === profile.id;
              const spanClass = profile.isDemo ? 'sm:col-span-2' : '';
              if (isRevealed) {
                return (
                  <div key={profile.id} ref={element => { cardRefs.current[profile.id] = element; }} tabIndex={-1} className="col-span-2 flex flex-col gap-space-4 rounded-md border border-accent/60 bg-surface-1 p-space-4 text-left shadow-elev-2 outline-none md:p-space-5">
                    <div className="flex items-center gap-space-3"><Avatar profile={profile} /><p className="text-base font-semibold text-primary">{profile.displayName}</p></div>
                    <form onSubmit={event => handleLogin(event, profile)} className="flex flex-col gap-space-3">
                      <div className="flex flex-col gap-space-1"><label htmlFor={`profile-password-${profile.id}`} className="text-sm text-secondary">รหัสผ่าน</label><div className="relative">
                        <input id={`profile-password-${profile.id}`} ref={inputRef} type={showPassword ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} placeholder="รหัสผ่าน" className={`h-11 w-full rounded-sm border border-border-interactive bg-surface-2 px-space-3 pr-11 text-base text-primary outline-none ${FOCUS_RING}`} aria-invalid={formError ? 'true' : undefined} aria-describedby={formError ? `profile-password-error-${profile.id}` : undefined} />
                        <button type="button" onClick={() => setShowPassword(value => !value)} aria-label={showPassword ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน'} className={`absolute right-1 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-sm text-secondary hover:bg-surface-3 ${FOCUS_RING}`}><EyeIcon open={showPassword} /></button>
                      </div></div>
                      {formError && <div id={`profile-password-error-${profile.id}`} role="alert" className="text-sm text-neg">{formError}</div>}
                      <div className="flex gap-space-3"><button type="button" onClick={() => closeReveal(profile.id)} disabled={isSubmitting} className={`${SECONDARY_BUTTON} flex-1`}>ยกเลิก</button><button type="submit" disabled={isSubmitting} className={`${PRIMARY_BUTTON} flex-1`}>{isSubmitting ? 'กำลังตรวจสอบ...' : 'เข้าสู่ระบบ'}</button></div>
                    </form>
                  </div>
                );
              }
              return (
                <button key={profile.id} ref={element => { cardRefs.current[profile.id] = element; }} type="button" onClick={() => handleProfileClick(profile)} className={`${CARD_BASE} ${spanClass} ${profile.isDemo ? 'flex-row items-center text-left' : 'flex-col items-center text-center'}`}>
                  <Avatar profile={profile} />
                  <div className={`flex flex-col gap-space-2 ${profile.isDemo ? 'items-start' : 'items-center'}`}>
                    <p className="text-base font-semibold text-primary">{profile.displayName}</p>
                    {profile.tagline && <span className={`${CHIP_BASE} bg-accent-muted text-accent`}>{profile.tagline}</span>}
                    {profile.description && <p className="text-sm text-secondary">{profile.description}</p>}
                    {isCurrent && <span className={`${CHIP_BASE} bg-pos/15 text-pos`}>กำลังใช้งานอยู่</span>}
                  </div>
                </button>
              );
            })}
          </div>
        )}

        <div className="flex flex-wrap justify-center gap-space-3">
          {currentUser && isReady && <button type="button" className={SECONDARY_BUTTON} onClick={() => void router.push('/')}>กลับหน้าหลัก</button>}
          {currentUser && <button type="button" className={SECONDARY_BUTTON} onClick={() => void logout()}>ออกจากบัญชีปัจจุบัน</button>}
        </div>
      </div>
    </div>
  );
}

export async function getServerSideProps() {
  try {
    const allUsers = await loadUsers();
    const profiles: Profile[] = allUsers
      .filter(user => user && user.id && user.displayName)
      .map(user => ({ id: user.id, displayName: user.displayName, avatar: user.avatar || '' }));
    return { props: { initialProfiles: profiles } };
  } catch (error) {
    console.error('โหลดรายชื่อผู้ใช้ฝั่งเซิร์ฟเวอร์ไม่สำเร็จ', error);
    return { props: { initialProfiles: [] as Profile[] } };
  }
}