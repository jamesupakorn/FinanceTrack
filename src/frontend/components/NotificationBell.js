/**
 * คอมโพเนนต์: NotificationBell
 * กระดิ่งแจ้งเตือน + dropdown — badge = collectUpcomingPayments().total (เกินกำหนด+วันนี้+ภายใน 7 วัน)
 * เลือกรายการใน dropdown แล้ว "เลื่อนไปเน้น" รายการเดียวกันในการ์ด "รายการที่จะครบกำหนด" — ไม่เปิด UI ที่สอง
 *
 * รูปแบบ dropdown (click-outside/Escape ปิด, คืน focus ให้กระดิ่ง) คัดลอกมาจากเมนูผู้ใช้ใน Layout.js/
 * edit.js เดิม (ไม่ได้คิดรูปแบบใหม่) — ไอคอนกระดิ่งไม่มีใน Icons.js จึงวาด inline เฉพาะที่นี่ เหมือนที่
 * Layout.js วาด MoreIcon เอง (ไม่แตะ Icons.js ตามกติกา "แก้เฉพาะไฟล์ที่ spec ระบุ")
 *
 * Graphite redesign (Dashboard pass) — Tailwind only, ไม่มี Dashboard.module.css/CreditCard.module.css
 * ไฟล์นี้ไม่เคยยืม CreditCard.module.css อยู่แล้ว (ยืนยันแล้วใน architecture review)
 */

import { useEffect, useRef, useState } from 'react';
import { formatCurrency } from '../../shared/utils/frontend/numberUtils';
import { describeDueDistance } from '../../shared/utils/creditCardUtils';

const FOCUS_RING = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2';

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
    <div className="relative" ref={wrapRef}>
      <button
        ref={bellRef}
        type="button"
        className={`relative inline-flex h-11 w-11 items-center justify-center rounded-full border border-border-default bg-surface-2 text-primary ${FOCUS_RING}`}
        onClick={() => setOpen((prev) => !prev)}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={total > 0 ? `การแจ้งเตือน มี ${total} รายการ` : 'การแจ้งเตือน'}
      >
        <BellIcon size={20} />
        {total > 0 && (
          // text-xs (12px, N6 floor) + text-on-accent (#0A0A0B ≈ 7.16:1 on --neg) — not text-[11px]
          // text-white (11px violates N6; white-on-#F87171 is 2.77:1, fails the 4.5:1 AA floor).
          // Carried over verbatim from the old .bellBadge CSS Module rule; not caught live because the
          // demo fixture has zero notifications (Stage 4 finding).
          <span
            className="absolute -right-0.5 -top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-neg px-1 text-xs font-bold text-on-accent"
            aria-hidden="true"
          >
            {badgeText}
          </span>
        )}
      </button>

      {open && (
        <div
          role="menu"
          className="fixed left-3 right-3 top-16 z-[120] max-h-[70vh] w-auto overflow-y-auto rounded-lg border border-border-default bg-surface-3 p-space-2 shadow-elev-2 md:absolute md:left-auto md:right-0 md:top-[calc(100%+8px)] md:max-h-[360px] md:w-[300px]"
        >
          <p className="mx-space-2 mb-space-2 mt-space-1 font-bold text-primary">การแจ้งเตือน</p>
          {items.length === 0 ? (
            <p className="p-space-3 text-secondary">ไม่มีรายการที่ต้องจัดการ</p>
          ) : (
            items.map((event) => (
              <button
                key={event.key}
                type="button"
                role="menuitem"
                className={`flex min-h-11 w-full flex-col gap-0.5 rounded-sm border-none bg-transparent p-space-2 text-left hover:bg-surface-2 ${FOCUS_RING}`}
                onClick={() => { setOpen(false); onSelectItem?.(event.key); }}
              >
                <span className="font-semibold text-primary">{event.name}</span>
                <span className="text-xs text-tertiary tabular-nums">
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
