/**
 * คอมโพเนนต์: NotificationBell
 * กระดิ่งแจ้งเตือน + dropdown — badge = collectUpcomingPayments().total (เกินกำหนด+วันนี้+ภายใน 7 วัน)
 * เลือกรายการใน dropdown แล้ว "เลื่อนไปเน้น" รายการเดียวกันในการ์ด "รายการที่จะครบกำหนด" — ไม่เปิด UI ที่สอง
 *
 * รูปแบบ dropdown (click-outside/Escape ปิด, คืน focus ให้กระดิ่ง) คัดลอกมาจากเมนูผู้ใช้ใน Layout.js/
 * edit.js เดิม (ไม่ได้คิดรูปแบบใหม่) — ไอคอนกระดิ่งไม่มีใน Icons.js จึงวาด inline เฉพาะที่นี่ เหมือนที่
 * Layout.js วาด MoreIcon เอง (ไม่แตะ Icons.js ตามกติกา "แก้เฉพาะไฟล์ที่ spec ระบุ")
 */

import { useEffect, useRef, useState } from 'react';
import { formatCurrency } from '../../shared/utils/frontend/numberUtils';
import { describeDueDistance } from '../../shared/utils/creditCardUtils';
import styles from '../styles/Dashboard.module.css';

function BellIcon({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </svg>
  );
}

export default function NotificationBell({ upcoming, onSelectItem }) {
  const [open, setOpen] = useState(false);
  const bellRef = useRef(null);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const handleClickOutside = (event) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target)) setOpen(false);
    };
    const handleEsc = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEsc);
      bellRef.current?.focus(); // คืน focus ให้กระดิ่งเสมอเมื่อปิด (AC-DB-25)
    };
  }, [open]);

  const items = [...(upcoming?.overdue || []), ...(upcoming?.dueToday || []), ...(upcoming?.dueSoon || [])];
  const total = upcoming?.total || 0;
  const badgeText = total > 9 ? '9+' : String(total);

  return (
    <div className={styles.bellWrap} ref={wrapRef}>
      <button
        ref={bellRef}
        type="button"
        className={styles.bellButton}
        onClick={() => setOpen((prev) => !prev)}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={total > 0 ? `การแจ้งเตือน มี ${total} รายการ` : 'การแจ้งเตือน'}
      >
        <BellIcon size={20} />
        {total > 0 && <span className={styles.bellBadge} aria-hidden="true">{badgeText}</span>}
      </button>

      {open && (
        <div className={styles.bellDropdown} role="menu">
          <p className={styles.bellDropdownTitle}>การแจ้งเตือน</p>
          {items.length === 0 ? (
            <p className={styles.bellEmpty}>ไม่มีรายการที่ต้องจัดการ</p>
          ) : (
            items.map((event) => (
              <button
                key={event.key}
                type="button"
                role="menuitem"
                className={styles.bellItem}
                onClick={() => { setOpen(false); onSelectItem?.(event.key); }}
              >
                <span className={styles.bellItemName}>{event.name}</span>
                <span className={styles.bellItemMeta}>
                  {`${formatCurrency(event.amount)} บาท · ${describeDueDistance(event.daysDiff)}`}
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
