// LineConnectModal.js
// UI สำหรับกรอกหรือเชื่อมต่อ LINE userId/token
import { useState } from 'react';
import styles from '../styles/ModePasswordModal.module.css';

export default function LineConnectModal({ open, onClose, onSubmit }) {
  const [userId, setUserId] = useState('');
  const [token, setToken] = useState('');
  const [error, setError] = useState('');

  if (!open) return null;

  const handleSubmit = () => {
    if (!userId || !token) {
      setError('กรุณากรอก userId และ token');
      return;
    }
    setError('');
    onSubmit({ userId, token });
  };

  return (
    <div className={styles.modalOverlay}>
      <div className={styles.modalForm}>
        <h3 className={styles.modalTitle}>เชื่อมต่อ LINE</h3>
        {error && <div className={styles.modalError}>{error}</div>}
        <input
          className={styles.modalInput}
          type="text"
          placeholder="LINE userId"
          value={userId}
          onChange={e => setUserId(e.target.value)}
        />
        <input
          className={styles.modalInput}
          type="text"
          placeholder="LINE Channel Access Token"
          value={token}
          onChange={e => setToken(e.target.value)}
        />
        <div className={styles.modalActions}>
          <button className={styles.cancelButton} onClick={onClose}>ยกเลิก</button>
          <button className={styles.confirmButton} onClick={handleSubmit}>บันทึก</button>
        </div>
      </div>
    </div>
  );
}
