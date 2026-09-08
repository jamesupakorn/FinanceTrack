/**
 * คอมโพเนนต์: ModePasswordModal
 * โมดัลสำหรับยืนยันรหัสผ่านก่อนเข้าโหมดแก้ไข
 * @param {object} props
 * @param {boolean} props.open - เปิด/ปิดโมดัล
 * @param {function} props.onClose - ปิดโมดัล
 * @param {function} props.onSubmit - ส่งรหัสผ่าน
 * @param {string} props.title - หัวข้อโมดัล
 * @param {string} props.description - คำอธิบายเพิ่มเติม
 *
 * dialog role/aria-modal/focus-trap/Escape+backdrop-close/accessible label ทั้งหมดเพิ่มมาให้ตรงกับ
 * แพทเทิร์นที่ใช้ใน CreditCardForm/InstallmentPlanForm/UnsavedChangesDialog อยู่แล้ว — เดิมโมดัลนี้
 * (จุดเข้าแรกสุดของทั้งแอป) เป็นข้อยกเว้นเดียวที่ไม่มี (critique 2026-08-29 P2)
 */

import React, { useEffect, useRef, useState } from 'react';
import styles from '../styles/ModePasswordModal.module.css';

const defaultTitle = 'ใส่รหัสผ่านเพื่อเข้าโหมดแก้ไข';

/**
 * โมดัลยืนยันรหัสผ่านเพื่อเข้าโหมดแก้ไข
 */
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
  const dialogRef = useRef(null);
  const inputRef = useRef(null);
  const triggerRef = useRef(null);

  useEffect(() => {
    if (!open) {
      setPassword('');
      setInternalError('');
      setShowPassword(false);
      return undefined;
    }
    triggerRef.current = typeof document !== 'undefined' ? document.activeElement : null;
    const timer = setTimeout(() => inputRef.current?.focus(), 40);
    return () => clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        onClose?.();
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = dialogRef.current.querySelectorAll(
        'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      triggerRef.current?.focus?.();
    };
  }, [open, onClose]);

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
    <div
      className={styles.modalOverlay}
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose?.();
      }}
    >
      <form
        ref={dialogRef}
        onSubmit={handleSubmit}
        className={styles.modalForm}
        role="dialog"
        aria-modal="true"
        aria-labelledby="mode-password-modal-title"
      >
        <h3 id="mode-password-modal-title" className={styles.modalTitle}>{title}</h3>
        {description && <p className={styles.modalDescription}>{description}</p>}
        <div className={styles.inputWrapper}>
          <label htmlFor="mode-password-modal-input" className={styles.srOnly}>รหัส PIN</label>
          <input
            id="mode-password-modal-input"
            ref={inputRef}
            type={showPassword ? 'text' : 'password'}
            inputMode="numeric"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="รหัสผ่าน"
            className={styles.modalInput}
            aria-invalid={displayError ? 'true' : undefined}
            aria-describedby={displayError ? 'mode-password-modal-error' : undefined}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                handleSubmit(e);
              }
            }}
          />
          <button
            type="button"
            onClick={() => setShowPassword(s => !s)}
            className={styles.eyeToggleButton}
            aria-label={showPassword ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน'}
          >
            {showPassword
              ? <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--primary-color, #5d5bff)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.06 10.06 0 0 1 12 20c-5.05 0-9.29-3.14-11-8 1.06-2.81 2.99-5.12 5.47-6.53M9.53 3.47A9.94 9.94 0 0 1 12 4c5.05 0 9.29 3.14 11 8a10.05 10.05 0 0 1-4.17 5.19M1 1l22 22"/><circle cx="12" cy="12" r="3"/></svg>
              : <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--primary-color, #5d5bff)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12C2.71 7.14 6.95 4 12 4s9.29 3.14 11 8c-1.71 4.86-5.95 8-11 8S2.71 16.86 1 12z"/><circle cx="12" cy="12" r="3"/></svg>
            }
          </button>
        </div>
        {displayError && <div id="mode-password-modal-error" role="alert" className={styles.modalError}>{displayError}</div>}
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
