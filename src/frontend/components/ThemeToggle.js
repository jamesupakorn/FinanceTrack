
import { useRouter } from 'next/router';
import { ENCODED_EDIT_PASSWORD } from '../config/password.enc';
import { decodePassword } from '../../shared/utils/authUtils';
import { useState } from 'react';

import styles from '../styles/ThemeToggle.module.css';
import homeStyles from '../styles/Home.module.css';
import ModePasswordModal from './ModePasswordModal';

const EDIT_PASSWORD = decodePassword(ENCODED_EDIT_PASSWORD); // base64 decode

const ThemeToggle = ({ mode, setMode }) => {
  const router = useRouter();
  const [showModal, setShowModal] = useState(false);

  // เปิด modal สำหรับกรอกรหัสผ่าน
  const handleEditClick = () => setShowModal(true);

  // ปิด modal
  const handleModalClose = () => setShowModal(false);

  // ตรวจสอบรหัสผ่านและเปลี่ยนโหมด
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
        className={homeStyles.normalModeButton}
        onClick={handleEditClick}
        disabled={mode === 'edit'}
        type="button"
      >
        เข้าสู่โหมดแก้ไข
      </button>
      <ModePasswordModal 
        open={showModal} 
        onClose={handleModalClose} 
        onSubmit={handleModalSubmit} 
      />
    </div>
  );
};

export default ThemeToggle;