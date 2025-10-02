
import { useRouter } from 'next/router';
import { useState } from 'react';
import styles from '../styles/ThemeToggle.module.css';
import ModePasswordModal from './ModePasswordModal';


const MODE_OPTIONS = [
  { value: 'view', label: 'ดูข้อมูล' },
  { value: 'edit', label: 'แก้ไขข้อมูล' },
];

const EDIT_PASSWORD = 'financepro2025'; // สามารถเปลี่ยนทีหลังหรือย้ายไป env ได้

const ThemeToggle = ({ mode, setMode }) => {
  const router = useRouter();
  const [showModal, setShowModal] = useState(false);
  const [pendingMode, setPendingMode] = useState(null);

  const handleModeChange = (e) => {
    const selected = e.target.value;
    if (selected === 'edit') {
      setPendingMode('edit');
      setShowModal(true);
    } else {
      setMode('view');
      router.push('/');
    }
  };

  const handleModalClose = () => {
    setShowModal(false);
    setPendingMode(null);
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
      <select
        value={mode}
        onChange={handleModeChange}
        className={styles.themeSelector}
      >
        {MODE_OPTIONS.map(opt => (
          <option key={opt.value} value={opt.value} className={styles.themeOption}>
            {opt.label}
          </option>
        ))}
      </select>
      <ModePasswordModal open={showModal} onClose={handleModalClose} onSubmit={handleModalSubmit} />
    </div>
  );
};

export default ThemeToggle;