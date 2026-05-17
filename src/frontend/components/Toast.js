import { useState, useEffect } from 'react';
import styles from '../styles/Toast.module.css';

const ICONS = {
  success: '✓',
  error: '✕',
  info: 'ℹ',
};

const DURATION_MS = 3000;

export default function Toast() {
  const [toasts, setToasts] = useState([]);

  useEffect(() => {
    const handler = (e) => {
      const toast = e.detail;
      setToasts((prev) => [...prev, toast]);
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== toast.id));
      }, DURATION_MS);
    };
    window.addEventListener('app:toast', handler);
    return () => window.removeEventListener('app:toast', handler);
  }, []);

  if (!toasts.length) return null;

  return (
    <div className={styles.container} role="status" aria-live="polite" aria-atomic="false">
      {toasts.map((toast) => (
        <div key={toast.id} className={`${styles.toast} ${styles[toast.type] || styles.info}`}>
          <span className={styles.icon} aria-hidden="true">{ICONS[toast.type] || ICONS.info}</span>
          {toast.message}
        </div>
      ))}
    </div>
  );
}
