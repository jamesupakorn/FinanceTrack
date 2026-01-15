import React, { useState } from 'react';
import styles from '../styles/ModePasswordModal.module.css';

const ModePasswordModal = ({ open, onClose, onSubmit }) => {
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');


  const handleSubmit = (e) => {
    e.preventDefault();
    if (password.trim() === '') {
      setError('กรุณากรอกรหัสผ่าน');
      return;
    }
    setError('');
    onSubmit(password, clearPasswordIfFail);
  };

  // Callback for parent to clear password if fail
  const clearPasswordIfFail = (success) => {
    if (success) {
      setPassword('');
    }
  };

  if (!open) return null;

  return (
    <div className={styles.modalOverlay}>
      <form onSubmit={handleSubmit} className={styles.modalForm}>
        <h3 className={styles.modalTitle}>ใส่รหัสผ่านเพื่อเข้าโหมดแก้ไข</h3>
        <div style={{ position: 'relative' }}>
          <input
            type={showPassword ? 'text' : 'password'}
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="รหัสผ่าน"
            className={styles.modalInput}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                handleSubmit(e);
              }
            }}
            style={{ width: '100%', paddingRight: 60 }}
          />
          <button
            type="button"
            onClick={() => setShowPassword(s => !s)}
            style={{
              position: 'absolute',
              right: 8,
              top: '50%',
              transform: 'translateY(-50%)',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              fontSize: 16,
              color: '#0969da',
              padding: 0
            }}
            aria-label={showPassword ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน'}
          >
            {showPassword ? 'ซ่อน' : 'แสดง'}
          </button>
        </div>
        {error && <div className={styles.modalError}>{error}</div>}
        <div className={styles.modalActions}>
          <button type="button" onClick={onClose} className={styles.cancelButton}>ยกเลิก</button>
          <button type="submit" className={styles.confirmButton}>ยืนยัน</button>
        </div>
      </form>
    </div>
  );
};

export default ModePasswordModal;
