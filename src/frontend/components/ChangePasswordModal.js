/**
 * คอมโพเนนต์: ChangePasswordModal
 * โมดัลสำหรับเปลี่ยนรหัสผ่าน พร้อมตรวจสอบความถูกต้องของฟอร์ม
 * @param {object} props
 * @param {boolean} props.open - เปิด/ปิดโมดัล
 * @param {function} props.onClose - ปิดโมดัล
 * @param {function} props.onSubmit - ส่งข้อมูลรหัสผ่าน
 * @param {string} props.errorMessage - ข้อความผิดพลาดจากภายนอก
 * @param {boolean} props.isSubmitting - สถานะกำลังส่งข้อมูล
 */

import React, { useEffect, useState } from 'react';
import styles from '../styles/ModePasswordModal.module.css';

/**
 * โมดัลเปลี่ยนรหัสผ่าน
 */
const ChangePasswordModal = ({
  open,
  onClose,
  onSubmit,
  errorMessage,
  isSubmitting = false
}) => {
  const initialState = {
    currentPassword: '',
    newPassword: '',
    confirmPassword: ''
  };
  const [formValues, setFormValues] = useState(initialState);
  const [internalError, setInternalError] = useState('');
  const [showPasswords, setShowPasswords] = useState({
    current: false,
    next: false,
    confirm: false
  });

  useEffect(() => {
    if (!open) {
      setFormValues(initialState);
      setInternalError('');
      setShowPasswords({ current: false, next: false, confirm: false });
    }
  }, [open]);

  const handleSubmit = (event) => {
    event.preventDefault();
    const { currentPassword, newPassword, confirmPassword } = formValues;
    if (!currentPassword || !newPassword || !confirmPassword) {
      setInternalError('กรุณากรอกข้อมูลให้ครบ');
      return;
    }
    if (newPassword.length < 6) {
      setInternalError('รหัสผ่านใหม่ควรมีอย่างน้อย 6 ตัวอักษร');
      return;
    }
    if (newPassword !== confirmPassword) {
      setInternalError('รหัสผ่านใหม่และยืนยันไม่ตรงกัน');
      return;
    }
    setInternalError('');
    onSubmit({ currentPassword, newPassword });
  };

  if (!open) return null;

  const displayError = errorMessage || internalError;

  const renderInput = ({ name, label, placeholder, autoComplete, field }) => (
    <div>
      <label className={styles.modalLabel} htmlFor={name}>{label}</label>
      <div className={styles.inputWrapper}>
        <input
          id={name}
          name={name}
          type={showPasswords[field] ? 'text' : 'password'}
          value={formValues[name]}
          onChange={event => setFormValues(prev => ({ ...prev, [name]: event.target.value }))}
          placeholder={placeholder}
          className={styles.modalInput}
          autoComplete={autoComplete}
          disabled={isSubmitting}
        />
        <button
          type="button"
          className={styles.eyeToggleButton}
          onClick={() => setShowPasswords(prev => ({ ...prev, [field]: !prev[field] }))}
          aria-label={showPasswords[field] ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน'}
        >
          {showPasswords[field]
            ? <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#0969da" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.06 10.06 0 0 1 12 20c-5.05 0-9.29-3.14-11-8 1.06-2.81 2.99-5.12 5.47-6.53M9.53 3.47A9.94 9.94 0 0 1 12 4c5.05 0 9.29 3.14 11 8a10.05 10.05 0 0 1-4.17 5.19M1 1l22 22"/><circle cx="12" cy="12" r="3"/></svg>
            : <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#0969da" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12C2.71 7.14 6.95 4 12 4s9.29 3.14 11 8c-1.71 4.86-5.95 8-11 8S2.71 16.86 1 12z"/><circle cx="12" cy="12" r="3"/></svg>
          }
        </button>
      </div>
    </div>
  );

  return (
    <div className={styles.modalOverlay}>
      <form onSubmit={handleSubmit} className={styles.modalForm}>
        <h3 className={styles.modalTitle}>เปลี่ยนรหัสผ่าน</h3>
        <p className={styles.modalDescription}>เพิ่มความปลอดภัยด้วยการตั้งรหัสใหม่</p>
        {renderInput({
          name: 'currentPassword',
          label: 'รหัสผ่านปัจจุบัน',
          placeholder: '••••••••',
          autoComplete: 'current-password',
          field: 'current'
        })}
        {renderInput({
          name: 'newPassword',
          label: 'รหัสผ่านใหม่',
          placeholder: 'ตั้งรหัสผ่านใหม่',
          autoComplete: 'new-password',
          field: 'next'
        })}
        {renderInput({
          name: 'confirmPassword',
          label: 'ยืนยันรหัสผ่านใหม่',
          placeholder: 'กรอกรหัสอีกครั้ง',
          autoComplete: 'new-password',
          field: 'confirm'
        })}
        <p className={styles.modalHint}>แนะนำให้ผสมตัวเลข อักษร และสัญลักษณ์</p>
        {displayError && <div className={styles.modalError}>{displayError}</div>}
        <div className={styles.modalActions}>
          <button type="button" className={styles.cancelButton} onClick={onClose} disabled={isSubmitting}>
            ยกเลิก
          </button>
          <button type="submit" className={styles.confirmButton} disabled={isSubmitting}>
            {isSubmitting ? 'กำลังบันทึก...' : 'บันทึกรหัสใหม่'}
          </button>
        </div>
      </form>
    </div>
  );
};

export default ChangePasswordModal;
