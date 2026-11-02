/**
 * คอมโพเนนต์: RowActionMenu
 * เมนู ⋯ ที่ใช้ร่วมกันของแถวแผนผ่อน / แถวรายการไม่ผ่อน / เมนูบัตร (spec-credit-card-detail-redesign §5.5)
 *
 * - role="menu" + role="menuitem"; เปิดแล้ว focus รายการแรก; ArrowUp/Down/Home/End วน; Escape ปิดแล้วคืน focus
 *   ให้ trigger (จัดการที่ onKeyDown ของเมนูเอง + stopPropagation ไม่ใช้ document listener จึงไม่ปิด dialog ด้านหลัง)
 * - รายการที่ disabled ใช้ aria-disabled (ยัง focus ได้) + เหตุผลที่มองเห็นและอ้างด้วย aria-describedby
 * - run(): focus trigger → ปิดเมนู → เรียก action (ลำดับเดียวกับ CardMenu.run) เพื่อให้ dialog ที่เปิดต่อจับ trigger เป็น opener
 * - เมนูเปิดลงด้านล่าง ถ้าที่ว่างไม่พอ (หัก nav + แถบเพิ่มรายจ่าย) พลิกขึ้นด้านบน
 */

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Icons } from './Icons';

export interface RowActionMenuItem {
  key: string;
  label: string;
  icon?: ReactNode;
  onSelect?: () => void;
  disabled?: boolean;
  /** แสดงเป็นบรรทัดที่สองเมื่อ disabled (อ้างด้วย aria-describedby) */
  disabledReason?: string;
  danger?: boolean;
}

const FOCUS_RING = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2';
const ICON_BTN = `flex h-11 w-11 shrink-0 items-center justify-center rounded-sm border border-border-default bg-surface-2 text-secondary transition-colors duration-fast ease-graphite hover:bg-surface-3 ${FOCUS_RING}`;

const FALLBACK_NAV_SAFE_BOTTOM = 56;

function readNavSafeBottom(): number {
  if (typeof window === 'undefined') return 0;
  const raw = window.getComputedStyle(document.documentElement).getPropertyValue('--nav-safe-bottom');
  const parsed = parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : FALLBACK_NAV_SAFE_BOTTOM;
}

export default function RowActionMenu({
  triggerLabel,
  items,
  bottomInset = 0,
  triggerDataId
}: {
  triggerLabel: string;
  items: RowActionMenuItem[];
  /** ความสูงที่ถูกบังด้านล่างนอกเหนือจาก nav (เช่น ADD_BAR_HEIGHT_PX บนมือถือ) */
  bottomInset?: number;
  /** ใส่ data-menu-trigger ไว้ให้ที่อื่นหา trigger เพื่อย้าย focus */
  triggerDataId?: string;
}) {
  const [open, setOpen] = useState(false);
  const [placeAbove, setPlaceAbove] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const menuId = useId();

  const itemElements = useCallback(
    () => Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []),
    []
  );

  useEffect(() => {
    if (!open) return undefined;
    const handleClickOutside = (event: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  // วัดหลัง render ก่อน paint: เมนูต้องไม่อยู่ใต้ nav/แถบเพิ่มรายจ่าย (I-24)
  useLayoutEffect(() => {
    if (!open) { setPlaceAbove(false); return; }
    const trigger = triggerRef.current;
    const menu = menuRef.current;
    if (!trigger || !menu) return;
    const available = window.innerHeight - readNavSafeBottom() - bottomInset;
    const spaceBelow = available - trigger.getBoundingClientRect().bottom;
    setPlaceAbove(spaceBelow < menu.offsetHeight);
  }, [open, bottomInset]);

  useEffect(() => {
    if (open) itemElements()[0]?.focus();
  }, [open, itemElements]);

  const closeAndFocusTrigger = () => {
    triggerRef.current?.focus();
    setOpen(false);
  };

  const run = (item: RowActionMenuItem) => {
    if (item.disabled) return;
    closeAndFocusTrigger();
    item.onSelect?.();
  };

  const handleMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const elements = itemElements();
    const index = elements.indexOf(document.activeElement as HTMLElement);
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        elements[(index + 1) % elements.length]?.focus();
        break;
      case 'ArrowUp':
        event.preventDefault();
        elements[(index <= 0 ? elements.length : index) - 1]?.focus();
        break;
      case 'Home':
        event.preventDefault();
        elements[0]?.focus();
        break;
      case 'End':
        event.preventDefault();
        elements[elements.length - 1]?.focus();
        break;
      case 'Escape':
        event.preventDefault();
        event.stopPropagation();
        closeAndFocusTrigger();
        break;
      case 'Tab':
        // ปิดเมนูแล้วปล่อยให้ Tab เดินต่อตามธรรมชาติ (โฟกัสกลับ trigger ก่อนเพื่อไม่ให้ค้างบน element ที่ถูก unmount)
        closeAndFocusTrigger();
        break;
      default:
    }
  };

  return (
    <div className="relative shrink-0" ref={wrapperRef}>
      <button
        ref={triggerRef}
        type="button"
        className={ICON_BTN}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={triggerLabel}
        data-menu-trigger={triggerDataId}
        onClick={() => setOpen(value => !value)}
        onKeyDown={event => {
          if (event.key === 'ArrowDown' && !open) {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        <Icons.MoreHorizontal size={18} />
      </button>
      {open && (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label={triggerLabel}
          onKeyDown={handleMenuKeyDown}
          className={`absolute right-0 z-30 flex min-w-[240px] flex-col gap-[2px] rounded-md border border-border-default bg-surface-3 p-space-2 shadow-elev-3 ${placeAbove ? 'bottom-[calc(100%+6px)]' : 'top-[calc(100%+6px)]'}`}
        >
          {items.map(item => {
            const reasonId = item.disabled && item.disabledReason ? `${menuId}-${item.key}-reason` : undefined;
            const labelId = `${menuId}-${item.key}-label`;
            return (
              <button
                key={item.key}
                type="button"
                role="menuitem"
                tabIndex={-1}
                aria-disabled={item.disabled ? 'true' : undefined}
                aria-labelledby={labelId}
                aria-describedby={reasonId}
                className={`flex min-h-11 flex-col items-start justify-center rounded-sm px-space-3 py-space-1 text-left text-sm hover:bg-surface-2 ${item.danger ? 'text-neg' : 'text-primary'} ${item.disabled ? 'cursor-not-allowed opacity-70' : ''} ${FOCUS_RING}`}
                onClick={() => run(item)}
              >
                <span className="flex items-center gap-space-2">{item.icon}<span id={labelId}>{item.label}</span></span>
                {reasonId && <span id={reasonId} className="text-xs leading-relaxed text-tertiary">{item.disabledReason}</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
