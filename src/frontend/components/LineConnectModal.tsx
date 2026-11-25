/**
 * คอมโพเนนต์: LineConnectModal
 * โมดัลสำหรับเชื่อมต่อ LINE userId และ token
 */
import { useState } from 'react';
import styles from '../styles/ModePasswordModal.module.css';
import { useBackToClose } from '../../shared/utils/frontend/useBackToClose';

interface LineConnectionPayload {
  userId: string;
  token: string;
}

interface LineConnectModalProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (payload: LineConnectionPayload) => void | Promise<void>;
}

/**
 * โมดัลเชื่อมต่อ LINE
 */
export default function LineConnectModal({ open, onClose, onSubmit }: LineConnectModalProps) {
  const [userId, setUserId] = useState('');
  const [token, setToken] = useState('');
  const [error, setError] = useState('');

  // ไม่มี live import path ของคอมโพเนนต์นี้ (D-SBC-6) — ใส่ hook ไว้เพื่อความครบของ inventory (AC-SBC-58)
  // ไม่เพิ่ม role="dialog"/aria-modal/Escape ที่นี่ — เป็น a11y gap ที่แยกไปแก้ต่างหาก (เหมือน D5's ChangePasswordModal)
  useBackToClose(open, onClose);

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
          onChange={event => setUserId(event.target.value)}
        />
        <input
          className={styles.modalInput}
          type="text"
          placeholder="LINE Channel Access Token"
          value={token}
          onChange={event => setToken(event.target.value)}
        />
        <div className={styles.modalActions}>
          <button className={styles.cancelButton} onClick={onClose}>ยกเลิก</button>
          <button className={styles.confirmButton} onClick={handleSubmit}>บันทึก</button>
        </div>
      </div>
    </div>
  );
}