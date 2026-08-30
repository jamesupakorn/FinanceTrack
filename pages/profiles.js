import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import ModePasswordModal from '../src/frontend/components/ModePasswordModal';
import { useSession } from '../src/frontend/contexts/SessionContext';
import { withApiTokenHeaders } from '../src/shared/utils/frontend/apiToken';
import styles from '../src/frontend/styles/ProfileGallery.module.css';
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

function Avatar({ profile }) {
  if (profile.avatar) {
    return (
      <div className={styles.profileAvatar}>
        <img src={profile.avatar} alt={profile.displayName} />
      </div>
    );
  }
  const initials = profile.displayName?.charAt(0)?.toUpperCase() || '?';
  return (
    <div className={styles.profileAvatar}>
      {initials}
    </div>
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
  const [selectedProfile, setSelectedProfile] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalError, setModalError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    const fetchUsers = async () => {
      if (profiles.length === 0) setLoading(true);
      try {
        const res = await fetch(`/api/users?ts=${Date.now()}`, {
          cache: 'no-store',
          headers: withApiTokenHeaders()
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data?.error || 'ไม่สามารถโหลดรายชื่อผู้ใช้');
        }
        const nextProfiles = Array.isArray(data.users) ? [...data.users] : [];
        if (!nextProfiles.length) {
          throw new Error('ไม่พบรายชื่อผู้ใช้');
        }
        const hasDemo = nextProfiles.some(user => user.id === DEMO_PROFILE.id);
        if (!hasDemo) {
          nextProfiles.unshift(DEMO_PROFILE);
        }
        setProfiles(nextProfiles);
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
    };
    // SSR (getServerSideProps) ให้ initialProfiles ที่สดใหม่ทุกครั้งอยู่แล้ว — ยิง fetch ซ้ำเฉพาะตอน
    // SSR เองล้มเหลว/ว่างเปล่า ไม่ใช่ยิงทุกครั้งไม่มีเงื่อนไข (เดิมยิงซ้ำเสมอ แม้ SSR สำเร็จแล้ว ทำให้
        // เกิด error banner ทับ grid ที่ใช้งานได้จริงเมื่อ background refetch ล้ม — critique 2026-08-29 P1)
    if (initialProfiles.length === 0) {
      fetchUsers();
    }
  }, []);

  const handleProfileClick = (profile) => {
    if (profile.isDemo) {
      handleDemoLogin();
      return;
    }
    setSelectedProfile(profile);
    setModalError('');
    setModalOpen(true);
  };

  const handleDemoLogin = () => {
    selectUser({
      id: DEMO_PROFILE.id,
      displayName: DEMO_PROFILE.displayName,
      avatar: DEMO_PROFILE.avatar,
      role: 'demo',
      isDemo: true
    });
    setModalOpen(false);
    router.replace('/');
  };

  const handleLogin = async (password) => {
    if (!selectedProfile) return;
    setIsSubmitting(true);
    setModalError('');
    try {
      const res = await fetch('/api/auth/profile-login', {
        method: 'POST',
        headers: withApiTokenHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ userId: selectedProfile.id, password })
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setModalError(data?.error || 'เข้าสู่ระบบไม่สำเร็จ');
        return;
      }
      selectUser(data.user);
      setModalOpen(false);
      router.replace('/');
    } catch (err) {
      console.error('เข้าสู่ระบบไม่สำเร็จ', err);
      setModalError('ไม่สามารถเข้าสู่ระบบได้ กรุณาลองใหม่');
    } finally {
      setIsSubmitting(false);
    }
  };

  const closeModal = () => {
    setModalOpen(false);
    setModalError('');
  };

  const currentUserId = currentUser?.id;
  const showProfileGrid = !loading && profiles.length > 0;

  return (
    <div className={styles.galleryPage}>
      <div className={styles.panel}>
        <div className={styles.header}>
          <h1 className={styles.title}>เลือกโปรไฟล์ผู้ใช้</h1>
          <p className={styles.subtitle}>{DEFAULT_DESCRIPTION}</p>
        </div>

        {loading && (
          <div className={styles.loadingState}>กำลังโหลดรายชื่อผู้ใช้...</div>
        )}
        {!loading && error && (
          <div className={styles.errorState}>{error}</div>
        )}

        {showProfileGrid && (
          <div className={styles.profileGrid}>
            {profiles.map(profile => (
              <button
                key={profile.id}
                className={`${styles.profileCard} ${profile.isDemo ? styles.demoCard : ''}`}
                type="button"
                onClick={() => handleProfileClick(profile)}
              >
                <Avatar profile={profile} />
                <p className={styles.profileName}>{profile.displayName}</p>
                {profile.tagline && (
                  <div className={styles.badgeRow}>
                    <span className={`${styles.statusBadge} ${styles.demoBadge}`}>
                      {profile.tagline}
                    </span>
                  </div>
                )}
                {profile.description && (
                  <p className={styles.demoDescription}>{profile.description}</p>
                )}
                {currentUserId === profile.id && (
                  <span className={styles.currentUserNote}>
                    กำลังใช้งานอยู่
                  </span>
                )}
              </button>
            ))}
          </div>
        )}

        <div className={styles.footerActions}>
          {currentUser && isReady && (
            <button
              type="button"
              className={styles.secondaryAction}
              onClick={() => router.push('/')}
            >
              กลับหน้าหลัก
            </button>
          )}
          {currentUser && (
            <button
              type="button"
              className={styles.secondaryAction}
              onClick={() => logout()}
            >
              ออกจากบัญชีปัจจุบัน
            </button>
          )}
        </div>
      </div>

      <ModePasswordModal
        open={modalOpen}
        onClose={closeModal}
        onSubmit={handleLogin}
        isSubmitting={isSubmitting}
        errorMessage={modalError}
        title={selectedProfile ? `PIN ของ ${selectedProfile.displayName}` : 'ใส่รหัสผ่าน'}
        description="เพื่อความปลอดภัย กรุณากรอกรหัส PIN ของโปรไฟล์นี้"
        confirmLabel="เข้าสู่ระบบ"
        cancelLabel="ยกเลิก"
      />
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
