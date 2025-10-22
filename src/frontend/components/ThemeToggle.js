
import { useRouter } from 'next/router';
import { ENCODED_EDIT_PASSWORD } from '../config/password.enc';
import { useState } from 'react';

import styles from '../styles/ThemeToggle.module.css';
import ModePasswordModal from './ModePasswordModal';

function decodePassword(encoded) {
  if (typeof window !== 'undefined' && window.atob) {
    return window.atob(encoded);
  }
  // fallback for Node.js (SSR)
  return Buffer.from(encoded, 'base64').toString('utf-8');
}

const EDIT_PASSWORD = decodePassword(ENCODED_EDIT_PASSWORD); // base64 decode

const ThemeToggle = ({ mode, setMode = () => {} }) => {
  const router = useRouter();
  const [showModal, setShowModal] = useState(false);

  const handleEditClick = () => {
    setShowModal(true);
  };

  const handleModalClose = () => {
    setShowModal(false);
  };

  const handleModalSubmit = (password) => {
    if (password === EDIT_PASSWORD) {
      setMode('edit');
      setShowModal(false);
      router.push('/edit');
    } else {
      alert('รหัสผ่านไม่ถูกต้อง');
    }
  };

  return (
    <div className={styles.themeToggle}>
      <button
        className={styles.editButton}
        onClick={handleEditClick}
        disabled={mode === 'edit'}
      >
        เข้าสู่โหมดแก้ไข
      </button>
      <ModePasswordModal open={showModal} onClose={handleModalClose} onSubmit={handleModalSubmit} />
    </div>
  );
};

export default ThemeToggle;