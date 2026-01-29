import React, { useEffect, useState } from 'react';
import styles from '../styles/ModePasswordModal.module.css';

const defaultTitle = 'ใส่รหัสผ่านเพื่อเข้าโหมดแก้ไข';

const ModePasswordModal = ({
  open,
  onClose,
  onSubmit,
  title = defaultTitle,
  description,
  confirmLabel = 'ยืนยัน',
  cancelLabel = 'ยกเลิก',
  errorMessage,
  isSubmitting = false,
}) => {
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [internalError, setInternalError] = useState('');

  useEffect(() => {
    if (!open) {
      setPassword('');
      setInternalError('');
      setShowPassword(false);
    }
  }, [open]);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (password.trim() === '') {
      setInternalError('กรุณากรอกรหัสผ่าน');
      return;
    }
    setInternalError('');
    onSubmit(password);
  };

  if (!open) return null;

  const displayError = errorMessage || internalError;

  return (
    <div className={styles.modalOverlay}>
      <form onSubmit={handleSubmit} className={styles.modalForm}>
        <h3 className={styles.modalTitle}>{title}</h3>
        {description && <p className={styles.modalDescription}>{description}</p>}
        <div className={styles.inputWrapper}>
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
            autoFocus
          />
          <button
            type="button"
            onClick={() => setShowPassword(s => !s)}
            className={styles.eyeToggleButton}
            aria-label={showPassword ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน'}
          >
            {showPassword
              ? <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#0969da" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.06 10.06 0 0 1 12 20c-5.05 0-9.29-3.14-11-8 1.06-2.81 2.99-5.12 5.47-6.53M9.53 3.47A9.94 9.94 0 0 1 12 4c5.05 0 9.29 3.14 11 8a10.05 10.05 0 0 1-4.17 5.19M1 1l22 22"/><circle cx="12" cy="12" r="3"/></svg>
              : <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#0969da" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12C2.71 7.14 6.95 4 12 4s9.29 3.14 11 8c-1.71 4.86-5.95 8-11 8S2.71 16.86 1 12z"/><circle cx="12" cy="12" r="3"/></svg>
            }
          </button>
        </div>
        {displayError && <div className={styles.modalError}>{displayError}</div>}
        <div className={styles.modalActions}>
          <button type="button" onClick={onClose} className={styles.cancelButton} disabled={isSubmitting}>
            {cancelLabel}
          </button>
          <button type="submit" className={styles.confirmButton} disabled={isSubmitting}>
            {isSubmitting ? 'กำลังตรวจสอบ...' : confirmLabel}
          </button>
        </div>
      </form>
    </div>
  );
};

export default ModePasswordModal;
