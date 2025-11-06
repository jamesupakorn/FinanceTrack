import React, { useState } from 'react';
import styles from '../styles/ModePasswordModal.module.css';

const ModePasswordModal = ({ open, onClose, onSubmit }) => {
  const [password, setPassword] = useState('');
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
        <input
          type="password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          placeholder="รหัสผ่าน"
          className={styles.modalInput}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              handleSubmit(e);
            }
          }}
        />
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
