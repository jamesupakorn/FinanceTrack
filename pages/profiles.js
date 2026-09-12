/**
 * หน้า: /profiles — the login gate, renders outside `Layout` (UX_SPEC §8 row 12, §9 `/profiles` entry)
 * Graphite redesign pass (8th/8th per-page pass) — Tailwind only, ไม่ import ProfileGallery.module.css
 * อีกต่อไป (ลบไฟล์นั้นในพาสนี้ — task-size-profiles-graphite.md §Effort Estimate Step 5)
 *
 * Behavioural change (§9, Interpretation A per architecture-review-profiles-graphite.md): password
 * entry moves from `ModePasswordModal` (a modal) to an in-place reveal directly on the selected
 * profile's own C1 card. `ModePasswordModal.js` is left on disk, unmodified, orphaned — same
 * precedent as the Credit Cards pass leaving `CreditCard.module.css`/`CreditCardForm.module.css` on
 * disk when they stopped being imported.
 *
 * Five accessibility behaviours re-implemented inline (previously in `ModePasswordModal.js`):
 * 1. Escape dismisses the reveal, returns focus to the profile's own trigger.
 * 2. Outside-interaction (mousedown outside the revealed card, or selecting a different profile —
 *    which is inherently exclusive since only one `revealedProfileId` can be set at a time) closes it.
 * 3. Focus management: password input auto-focuses on reveal; focus returns to the card's own trigger
 *    on Escape/outside-close. No full modal focus-trap — this is not a modal (AC-20 does not apply,
 *    same reasoning as the /settings pass's own "no modal on this page" finding).
 * 4. `<label htmlFor>` associates with the password input (unique per profile id).
 * 5. `inputMode="numeric"` on the password field (matches the original modal's PIN-entry hint).
 *
 * Three `critique 2026-08-29` fixes carried forward as behaviour, not just comments — see inline notes
 * at the demo-unshift, SSR-refetch-error-suppression and conditional-refetch sites below.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import { useSession } from '../src/frontend/contexts/SessionContext';
import { loadUsers } from '../lib/userStore';

const DEFAULT_DESCRIPTION = 'เลือกรูปโปรไฟล์ที่ต้องการใช้งาน แล้วกรอกรหัส PIN ของแต่ละผู้ใช้';
const DEMO_PROFILE = {
  id: 'demo',
  displayName: 'บัญชีสาธิต (Demo)',
  avatar: '',
  isDemo: true,
  tagline: 'ไม่ต้องใช้รหัสผ่าน',
  description: 'มีข้อมูลปลอมจำลองครบทุกหมวดหมู่ สามารถลองแก้ไขได้ทันที'
};

const FOCUS_RING = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2';
// Direction/alignment/text-align are deliberately NOT here — they differ between a demo card
// (horizontal) and a regular card (vertical), and appending an override on top of a base that
// already sets the opposite value left both flex-col/flex-row (and items-*/text-*) present in the
// same class list at once, with Tailwind's generated-CSS source order — not JSX order — silently
// deciding the winner. Each card site supplies its own complete, mutually-exclusive triplet.
const CARD_BASE = `flex gap-space-3 rounded-md border border-border-default bg-surface-1 p-space-4 shadow-elev-1 transition-transform duration-fast ease-graphite hover:-translate-y-0.5 hover:border-border-interactive hover:shadow-elev-2 md:p-space-5 ${FOCUS_RING}`;
const PRIMARY_BUTTON = `inline-flex h-11 items-center justify-center rounded-sm bg-accent px-space-5 text-sm font-semibold text-on-accent transition-opacity duration-fast ease-graphite disabled:cursor-not-allowed disabled:opacity-60 ${FOCUS_RING}`;
const SECONDARY_BUTTON = `inline-flex h-11 items-center justify-center rounded-sm border border-border-interactive bg-surface-2 px-space-5 text-sm font-medium text-primary transition-colors duration-fast ease-graphite hover:bg-surface-3 disabled:cursor-not-allowed disabled:opacity-60 ${FOCUS_RING}`;
const CHIP_BASE = 'inline-flex items-center gap-space-1 rounded-full px-space-3 py-space-1 text-xs font-medium whitespace-nowrap';

function Avatar({ profile }) {
  const initials = profile.displayName?.charAt(0)?.toUpperCase() || '?';
  return (
    <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-md bg-surface-2 text-xl font-semibold text-primary">
      {profile.avatar ? (
        <img src={profile.avatar} alt={profile.displayName} className="h-full w-full object-cover" />
      ) : (
        initials
      )}
    </div>
  );
}

function EyeIcon({ open }) {
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

export default function ProfileGalleryPage({ initialProfiles = [] }) {
  const router = useRouter();
  const { currentUser, isReady, selectUser, logout } = useSession();
  // Demo ขึ้นก่อนเสมอ — เป็นทางเข้าไม่มีความเสี่ยง (ไม่ต้องรหัสผ่าน) ที่ผู้มาเยือนครั้งแรกควรเห็นก่อน
  // บัญชีจริง ไม่ใช่หลังสุดที่ต้องเลื่อนผ่านทุกบัญชีก่อน (critique 2026-08-29 P2)
  const [profiles, setProfiles] = useState(() => [
    DEMO_PROFILE,
    ...initialProfiles.filter(profile => profile.id !== DEMO_PROFILE.id)
  ]);
  const [loading, setLoading] = useState(() => initialProfiles.length === 0);
  const [error, setError] = useState('');

  // In-place password reveal state — replaces ModePasswordModal's open/selectedProfile pair. Only one
  // profile's password field can be revealed at a time, so switching profiles is inherently exclusive
  // (selecting a different card closes the previously-open one, no extra bookkeeping required).
  const [revealedProfileId, setRevealedProfileId] = useState(null);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [formError, setFormError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const inputRef = useRef(null);
  // Keyed by profile id — points at whichever DOM node currently renders for that profile (the
  // collapsed trigger button, or the revealed card container). Used both for focus-return (Escape/
  // outside-close) and as the "is this click outside the revealed card" boundary check.
  const cardRefs = useRef({});

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/users?ts=${Date.now()}`, { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || 'ไม่สามารถโหลดรายชื่อผู้ใช้');
      }
      let nextProfiles = Array.isArray(data.users) ? [...data.users] : [];
      if (!nextProfiles.length) {
        throw new Error('ไม่พบรายชื่อผู้ใช้');
      }
      // /api/users strips isDemo (public projection, TD-H09 M-1) ทำให้แถว 'demo' จาก server เป็นแค่
      // profile ธรรมดาไม่มี isDemo/tagline/description — ถ้าปล่อยผ่านจะไปเข้า handleProfileClick ปกติ
      // (เปิด PIN reveal) แทนที่จะเป็น handleDemoLogin() การ์ดพิเศษ ตัดแถวดิบทิ้งแล้ว unshift
      // DEMO_PROFILE เดียวกับ initial state เสมอ เพื่อให้การ์ด demo คงพฤติกรรม/ตำแหน่งเดิมทุกครั้ง
      nextProfiles = nextProfiles.filter(user => user.id !== DEMO_PROFILE.id);
      nextProfiles.unshift(DEMO_PROFILE);
      setProfiles(nextProfiles);
      setError('');
    } catch (err) {
      console.error('โหลดผู้ใช้ไม่สำเร็จ', err);
      // ถ้า SSR โหลดรายชื่อจริงมาได้แล้ว (initialProfiles ไม่ว่าง) ไม่แสดง error banner ทับหน้าที่
      // ใช้งานได้จริง — เคยเกิด "โหลดสำเร็จ" + "error" พร้อมกันเมื่อ background refetch ล้มเหลวแต่
      // ข้อมูลจาก SSR มีอยู่แล้ว (critique 2026-08-29 P1) log ไว้พอ ไม่ต้องเตือนผู้ใช้
      if (initialProfiles.length === 0) {
        setError(err.message === 'unauthorized' ? 'ไม่สามารถยืนยันตัวตนกับระบบได้' : 'ไม่สามารถโหลดรายชื่อผู้ใช้');
      }
      setProfiles((currentProfiles) => currentProfiles.length ? currentProfiles : [DEMO_PROFILE]);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // SSR (getServerSideProps) ให้ initialProfiles ที่สดใหม่ทุกครั้งอยู่แล้ว — ยิง fetch ซ้ำเฉพาะตอน
    // SSR เองล้มเหลว/ว่างเปล่า ไม่ใช่ยิงทุกครั้งไม่มีเงื่อนไข (เดิมยิงซ้ำเสมอ แม้ SSR สำเร็จแล้ว ทำให้
    // เกิด error banner ทับ grid ที่ใช้งานได้จริงเมื่อ background refetch ล้ม — critique 2026-08-29 P1)
    if (initialProfiles.length === 0) {
      fetchUsers();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-focus the password field the moment a profile's reveal opens.
  useEffect(() => {
    if (!revealedProfileId) return undefined;
    const timer = setTimeout(() => inputRef.current?.focus(), 40);
    return () => clearTimeout(timer);
  }, [revealedProfileId]);

  // Escape-to-dismiss + outside-interaction dismiss (the inline-reveal equivalent of a modal's
  // backdrop-click-to-close — clicking anywhere outside the revealed card, including another profile
  // card, collapses the open reveal).
  useEffect(() => {
    if (!revealedProfileId) return undefined;
    const closingId = revealedProfileId;
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeReveal(closingId);
      }
    };
    const handlePointerDown = (event) => {
      const node = cardRefs.current[closingId];
      if (node && node.contains(event.target)) return;
      // Don't pre-empt a click landing on another profile's own trigger — that card's own
      // click handler (`handleProfileClick`) already owns the "close the old one, open this
      // one" transition as a single atomic state update. If this `mousedown` closes the reveal
      // first, the grid reflows under the pointer before the browser resolves the subsequent
      // `click` event's target, and the click frequently misses the now-shifted button
      // (BUG-PG-1). Only true outside-all-cards clicks should dismiss here.
      const clickedAnotherCard = Object.entries(cardRefs.current).some(
        ([id, cardNode]) => id !== closingId && cardNode && cardNode.contains(event.target)
      );
      if (clickedAnotherCard) return;
      closeReveal(closingId);
    };
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('mousedown', handlePointerDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('mousedown', handlePointerDown);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealedProfileId]);

  const closeReveal = (focusBackId) => {
    setRevealedProfileId(null);
    setPassword('');
    setFormError('');
    setShowPassword(false);
    if (focusBackId) {
      setTimeout(() => cardRefs.current[focusBackId]?.focus(), 0);
    }
  };

  const handleProfileClick = (profile) => {
    if (profile.isDemo) {
      handleDemoLogin();
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

  // TD-H09: routes the demo login through the same session-cookie-issuing path as every other
  // profile (previously called `selectUser()` directly — no ft_session/ft_csrf cookie was ever
  // issued, so the demo account's first API call 401'd). Password is a fixed, never-checked
  // placeholder — see spec-demo-profile-login-fix.md §2/§4; the passwordless bypass is gated
  // server-side on `user.isDemo`, not on anything sent from here.
  const handleDemoLogin = async () => {
    setIsSubmitting(true);
    try {
      const res = await fetch('/api/auth/profile-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: DEMO_PROFILE.id, password: 'demo' })
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setError(data?.error || 'ไม่สามารถเข้าสู่ระบบสาธิตได้');
        return;
      }
      selectUser(data.user);
      router.replace('/');
    } catch (err) {
      console.error('เข้าสู่ระบบสาธิตไม่สำเร็จ', err);
      setError('ไม่สามารถเข้าสู่ระบบสาธิตได้ กรุณาลองใหม่');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleLogin = async (event, profile) => {
    event.preventDefault();
    if (!password.trim()) {
      setFormError('กรุณากรอกรหัสผ่าน');
      return;
    }
    setIsSubmitting(true);
    setFormError('');
    try {
      const res = await fetch('/api/auth/profile-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: profile.id, password })
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setFormError(data?.error || 'เข้าสู่ระบบไม่สำเร็จ');
        setTimeout(() => inputRef.current?.focus(), 0);
        return;
      }
      selectUser(data.user);
      router.replace('/');
    } catch (err) {
      console.error('เข้าสู่ระบบไม่สำเร็จ', err);
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
        <div className="flex flex-col gap-space-2 text-center">
          <h1 className="text-2xl font-semibold text-primary md:text-3xl">เลือกโปรไฟล์ผู้ใช้</h1>
          <p className="text-sm text-secondary">{DEFAULT_DESCRIPTION}</p>
        </div>

        {loading && (
          <div className="rounded-md border border-border-default bg-surface-1 py-space-6 text-center text-sm text-secondary shadow-elev-1">
            กำลังโหลดรายชื่อผู้ใช้...
          </div>
        )}

        {!loading && error && (
          <div
            role="alert"
            className="flex flex-col items-center gap-space-3 rounded-md border border-neg/40 bg-surface-1 py-space-6 text-center shadow-elev-1"
          >
            <p className="text-sm text-neg">{error}</p>
            <button type="button" onClick={fetchUsers} className={SECONDARY_BUTTON}>
              ลองใหม่
            </button>
          </div>
        )}

        {showProfileGrid && (
          <div className="grid grid-cols-1 gap-space-4 sm:grid-cols-2">
            {profiles.map((profile) => {
              const isRevealed = revealedProfileId === profile.id;
              const isCurrent = currentUserId === profile.id;
              // Demo/placeholder cards span the full grid width — the existing fix, carried forward
              // (critique 2026-08-29, UX_SPEC §9 "the existing fix"). Must stay scoped to `sm:` only:
              // the grid itself is `grid-cols-1 sm:grid-cols-2`, so an unconditional `col-span-2` below
              // 640px spans a grid that only has 1 explicit column, forcing CSS Grid to invent a narrow
              // *implicit* 2nd column sized by content — which the next real card then gets auto-placed
              // into, rendering squeezed instead of stacked full-width (found live on a real phone).
              const spanClass = profile.isDemo ? 'sm:col-span-2' : '';

              if (isRevealed) {
                return (
                  <div
                    key={profile.id}
                    ref={(el) => { cardRefs.current[profile.id] = el; }}
                    tabIndex={-1}
                    className={`col-span-2 flex flex-col gap-space-4 rounded-md border border-accent/60 bg-surface-1 p-space-4 text-left shadow-elev-2 outline-none md:p-space-5`}
                  >
                    <div className="flex items-center gap-space-3">
                      <Avatar profile={profile} />
                      <p className="text-base font-semibold text-primary">{profile.displayName}</p>
                    </div>
                    <form onSubmit={(event) => handleLogin(event, profile)} className="flex flex-col gap-space-3">
                      <div className="flex flex-col gap-space-1">
                        <label htmlFor={`profile-password-${profile.id}`} className="text-sm text-secondary">
                          รหัส PIN
                        </label>
                        <div className="relative">
                          <input
                            id={`profile-password-${profile.id}`}
                            ref={inputRef}
                            type={showPassword ? 'text' : 'password'}
                            inputMode="numeric"
                            value={password}
                            onChange={(event) => setPassword(event.target.value)}
                            placeholder="รหัสผ่าน"
                            className={`h-11 w-full rounded-sm border border-border-interactive bg-surface-2 px-space-3 pr-11 text-base text-primary outline-none ${FOCUS_RING}`}
                            aria-invalid={formError ? 'true' : undefined}
                            aria-describedby={formError ? `profile-password-error-${profile.id}` : undefined}
                          />
                          <button
                            type="button"
                            onClick={() => setShowPassword((s) => !s)}
                            aria-label={showPassword ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน'}
                            className={`absolute right-1 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-sm text-secondary hover:bg-surface-3 ${FOCUS_RING}`}
                          >
                            <EyeIcon open={showPassword} />
                          </button>
                        </div>
                      </div>
                      {formError && (
                        <div id={`profile-password-error-${profile.id}`} role="alert" className="text-sm text-neg">
                          {formError}
                        </div>
                      )}
                      <div className="flex gap-space-3">
                        <button
                          type="button"
                          onClick={() => closeReveal(profile.id)}
                          disabled={isSubmitting}
                          className={`${SECONDARY_BUTTON} flex-1`}
                        >
                          ยกเลิก
                        </button>
                        <button type="submit" disabled={isSubmitting} className={`${PRIMARY_BUTTON} flex-1`}>
                          {isSubmitting ? 'กำลังตรวจสอบ...' : 'เข้าสู่ระบบ'}
                        </button>
                      </div>
                    </form>
                  </div>
                );
              }

              return (
                <button
                  key={profile.id}
                  ref={(el) => { cardRefs.current[profile.id] = el; }}
                  type="button"
                  onClick={() => handleProfileClick(profile)}
                  className={`${CARD_BASE} ${spanClass} ${profile.isDemo ? 'flex-row items-center text-left' : 'flex-col items-center text-center'}`}
                >
                  <Avatar profile={profile} />
                  <div className={`flex flex-col gap-space-2 ${profile.isDemo ? 'items-start' : 'items-center'}`}>
                    <p className="text-base font-semibold text-primary">{profile.displayName}</p>
                    {profile.tagline && (
                      <span className={`${CHIP_BASE} bg-accent-muted text-accent`}>{profile.tagline}</span>
                    )}
                    {profile.description && (
                      <p className="text-sm text-secondary">{profile.description}</p>
                    )}
                    {isCurrent && (
                      <span className={`${CHIP_BASE} bg-pos/15 text-pos`}>กำลังใช้งานอยู่</span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        )}

        <div className="flex flex-wrap justify-center gap-space-3">
          {currentUser && isReady && (
            <button type="button" className={SECONDARY_BUTTON} onClick={() => router.push('/')}>
              กลับหน้าหลัก
            </button>
          )}
          {currentUser && (
            <button type="button" className={SECONDARY_BUTTON} onClick={() => logout()}>
              ออกจากบัญชีปัจจุบัน
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export async function getServerSideProps() {
  try {
    const allUsers = await loadUsers();
    const profiles = allUsers
      .filter(user => user && user.id && user.displayName)
      .map(user => ({
        id: user.id,
        displayName: user.displayName,
        avatar: user.avatar || ''
      }));
    return { props: { initialProfiles: profiles } };
  } catch (error) {
    console.error('โหลดรายชื่อผู้ใช้ฝั่งเซิร์ฟเวอร์ไม่สำเร็จ', error);
    return { props: { initialProfiles: [] } };
  }
}
