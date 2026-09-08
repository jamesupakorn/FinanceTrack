/**
 * คอมโพเนนต์: ExpenseCalendar
 * ปฏิทินรวมค่าใช้จ่ายทุกประเภท (plain / cci_ / ccr_) + วันสรุปยอดบัตร — presentational ล้วน
 *
 * เหตุการณ์ 2 แบบ แยกด้วย "รูปทรง" ไม่ใช่แค่สี:
 *   ● ครบกำหนดชำระ (จุดทึบ) · ○ วันสรุปยอด (วงแหวน)
 * วันที่มาจาก resolveDueDayForMonth() ตัวเดียวกับแถวใน ExpenseTable และข้อความ LINE
 * ทั้งสามที่จึงไม่มีทางไม่ตรงกันเรื่อง EOM (BR-CC-003 / BR-003)
 *
 * grid/keyboard nav/day-detail ถูก "ย้าย" มาจากปฏิทินบัตรเครดิตเดิมของ /credit-cards (ไม่ได้เขียนใหม่)
 * ไฟล์นี้ไม่ fetch ข้อมูลเอง — เดือน/เหตุการณ์/ตัวจัดการ toggle ทั้งหมดมาจาก props
 * (ExpenseCalendarModal.js เป็นเจ้าของ monthKey + การดึงข้อมูล — ADR-012)
 *
 * พร็อพ:
 * - monthKey {string} เดือนที่กำลังแสดง (YYYY-MM) — เป็นของ modal ไม่ใช่ของ component นี้
 * - onNavigateMonth {function(delta)} เปลี่ยนเดือน (ปุ่มลูกศร / PageUp/PageDown / ชนขอบเดือน)
 * - eventsByDay {Map<number, Event[]>} เหตุการณ์ของเดือนนี้ จัดกลุ่มตามวันที่
 * - unscheduledEvents {Event[]} รายการที่ไม่มี/resolve วันครบกำหนดไม่ได้
 * - cards {array} ใช้ทำ legend สี
 * - monthTotals {{ total, paid, remaining }}
 * - windowState {'in-window'|'pruned'|'future'} สถานะเทียบกับหน้าต่างข้อมูล 15 เดือน (KL-1)
 * - pendingKeys {array} คีย์ที่กำลังบันทึกอยู่ (ปุ่มที่เกี่ยวข้อง disabled)
 * - onToggleInstallment / onRevolvingFull / onRevolvingMinimum / onRevolvingCancel {function(event)}
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  getCurrentMonthKey,
  getDaysInMonthKey,
  diffDaysFromToday,
  formatIsoDateTH,
  describeDueDistance,
  PLAN_STATUS
} from '../../shared/utils/creditCardUtils';
import { formatMonthKeyTH } from '../../shared/utils/dateUtils';
import { formatCurrency } from '../../shared/utils/frontend/numberUtils';
import { Icons } from './Icons';
import cardStyles from '../styles/CreditCard.module.css';
import styles from '../styles/ExpenseCalendar.module.css';

const WEEKDAY_LABELS = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];
const MAX_INLINE_CHIPS = 2;

/** unpaid ก่อน paid แล้วค่อยเรียง revolving → installment → plain (สิ่งที่ต้องทำก่อนอยู่บนสุดเสมอ) */
const SOURCE_ORDER = { revolving: 0, installment: 1, plain: 2, statement: 3 };
function compareEvents(a, b) {
  const aPaid = a.type === 'expense' ? (a.paid ? 1 : 0) : 0;
  const bPaid = b.type === 'expense' ? (b.paid ? 1 : 0) : 0;
  if (aPaid !== bPaid) return aPaid - bPaid;
  return (SOURCE_ORDER[a.source] ?? 9) - (SOURCE_ORDER[b.source] ?? 9);
}

const OUT_OF_WINDOW_COPY = {
  pruned: {
    title: 'เดือนนี้เกินช่วงข้อมูล 15 เดือนที่ระบบเก็บไว้',
    detail: 'แสดงเฉพาะรายการบัตรเครดิตและวันสรุปยอด'
  },
  future: {
    title: 'ยังไม่มีข้อมูลรายจ่ายของเดือนนี้',
    detail: 'รายการผ่อนและยอดหมุนเวียนแสดงล่วงหน้าให้แล้ว'
  }
};

export default function ExpenseCalendar({
  monthKey,
  onNavigateMonth,
  eventsByDay,
  unscheduledEvents = [],
  cards = [],
  monthTotals = { total: 0, paid: 0, remaining: 0 },
  windowState = 'in-window',
  pendingKeys = [],
  onToggleInstallment,
  onRevolvingFull,
  onRevolvingMinimum,
  onRevolvingCancel
}) {
  const [selectedDay, setSelectedDay] = useState(null);
  const [unscheduledOpen, setUnscheduledOpen] = useState(false);
  const gridRef = useRef(null);
  const pendingFocusDay = useRef(null);

  const daysInMonth = getDaysInMonthKey(monthKey);
  const [yearStr, monthStr] = monthKey.split('-');
  const firstWeekday = new Date(Number(yearStr), Number(monthStr) - 1, 1).getDay();
  const todayKey = useMemo(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  }, []);

  // เปิดมาให้เลือกวันที่มีเหตุการณ์ถัดไปโดยอัตโนมัติ (ย้ายมาจากปฏิทินบัตรเครดิตเดิม)
  useEffect(() => {
    const daysWithEvents = Array.from(eventsByDay.keys()).sort((a, b) => a - b);
    if (!daysWithEvents.length) {
      setSelectedDay(null);
      return;
    }
    const today = new Date();
    const isCurrentMonth = monthKey === getCurrentMonthKey();
    const upcoming = isCurrentMonth
      ? daysWithEvents.find(day => day >= today.getDate())
      : daysWithEvents[0];
    setSelectedDay(upcoming || daysWithEvents[0]);
  }, [eventsByDay, monthKey]);

  useEffect(() => {
    if (!pendingFocusDay.current || !gridRef.current) return;
    const target = gridRef.current.querySelector(`[data-day="${pendingFocusDay.current}"]`);
    target?.focus();
    pendingFocusDay.current = null;
  }, [selectedDay, monthKey]);

  // ย้ายมาจากปฏิทินบัตรเครดิตเดิม — เปลี่ยน setMonthKey ในไฟล์เดิมเป็น onNavigateMonth(delta)
  // เพราะ monthKey ย้ายไปอยู่ที่ ExpenseCalendarModal.js แล้ว (ADR-012 §2)
  const moveSelection = (delta) => {
    const base = selectedDay || 1;
    const next = base + delta;
    if (next < 1) {
      onNavigateMonth(-1);
      return;
    }
    if (next > daysInMonth) {
      onNavigateMonth(1);
      return;
    }
    pendingFocusDay.current = next;
    setSelectedDay(next);
  };

  // ย้ายมาจากปฏิทินบัตรเครดิตเดิม (คงพฤติกรรม roving-tabindex เดิมทุกประการ)
  const handleGridKeyDown = (event) => {
    switch (event.key) {
      case 'ArrowLeft': event.preventDefault(); moveSelection(-1); break;
      case 'ArrowRight': event.preventDefault(); moveSelection(1); break;
      case 'ArrowUp': event.preventDefault(); moveSelection(-7); break;
      case 'ArrowDown': event.preventDefault(); moveSelection(7); break;
      case 'PageUp': event.preventDefault(); onNavigateMonth(-1); break;
      case 'PageDown': event.preventDefault(); onNavigateMonth(1); break;
      default: break;
    }
  };

  const cells = [];
  for (let index = 0; index < firstWeekday; index += 1) cells.push(null);
  for (let day = 1; day <= daysInMonth; day += 1) cells.push(day);
  const rows = [];
  for (let index = 0; index < cells.length; index += 7) rows.push(cells.slice(index, index + 7));

  const selectedEvents = selectedDay
    ? [...(eventsByDay.get(selectedDay) || [])].sort(compareEvents)
    : [];
  const selectedIsoDate = selectedDay
    ? `${monthKey}-${String(selectedDay).padStart(2, '0')}`
    : null;

  // ขยายจากต้นฉบับให้ครอบคลุมแหล่งที่มา plain/revolving ด้วย ไม่ใช่แค่ due ของแผนผ่อน
  const buildCellLabel = (day) => {
    const events = eventsByDay.get(day) || [];
    const isoDate = `${monthKey}-${String(day).padStart(2, '0')}`;
    if (!events.length) return formatIsoDateTH(isoDate);
    const parts = events.map(event => (event.type === 'statement'
      ? `วันสรุปยอด ${event.card?.name || ''}`
      : `ครบกำหนด ${event.name} ${formatCurrency(event.amount)} บาท`));
    return `${formatIsoDateTH(isoDate)}, ${parts.join(', ')}`;
  };

  const outOfWindowCopy = OUT_OF_WINDOW_COPY[windowState] || null;

  return (
    <div className={styles.calendarWrap}>
      <div className={styles.calendarNav}>
        <button
          type="button"
          className={cardStyles.iconButton}
          onClick={() => onNavigateMonth(-1)}
          aria-label="เดือนก่อนหน้า"
        >
          <Icons.ChevronLeft size={18} />
        </button>
        <span className={styles.calendarMonth}>{formatMonthKeyTH(monthKey)}</span>
        <button
          type="button"
          className={cardStyles.iconButton}
          onClick={() => onNavigateMonth(1)}
          aria-label="เดือนถัดไป"
        >
          <Icons.ChevronRight size={18} />
        </button>
      </div>

      {outOfWindowCopy && (
        <div className={styles.outOfWindowNotice} role="status">
          <Icons.AlertTriangle size={16} color="var(--text-light)" />
          <div>
            <p>{outOfWindowCopy.title}</p>
            <p>{outOfWindowCopy.detail}</p>
          </div>
        </div>
      )}

      <div className={styles.calendarLayout}>
        <div>
          <div
            className={styles.calendarGrid}
            role="grid"
            aria-label={`ปฏิทินค่าใช้จ่าย ${formatMonthKeyTH(monthKey)}`}
            ref={gridRef}
            onKeyDown={handleGridKeyDown}
          >
            {WEEKDAY_LABELS.map(label => (
              <div key={label} className={styles.calendarWeekday} role="columnheader">{label}</div>
            ))}
            {rows.map((week, weekIndex) => week.map((day, dayIndex) => {
              if (day === null) {
                return (
                  <div
                    key={`empty-${weekIndex}-${dayIndex}`}
                    className={`${styles.calendarCell} ${styles.calendarCellEmpty}`}
                    role="gridcell"
                    aria-hidden="true"
                  />
                );
              }
              const isoDate = `${monthKey}-${String(day).padStart(2, '0')}`;
              const events = eventsByDay.get(day) || [];
              const dueEvents = events.filter(event => event.type === 'expense');
              const hasOverdueUnpaid = dueEvents.some(event => {
                if (event.paid) return false;
                const diff = diffDaysFromToday(isoDate);
                return diff !== null && diff < 0;
              });
              const isToday = isoDate === todayKey;
              const isSelected = day === selectedDay;
              return (
                <button
                  key={isoDate}
                  type="button"
                  role="gridcell"
                  data-day={day}
                  tabIndex={isSelected ? 0 : -1}
                  aria-current={isSelected ? 'date' : undefined}
                  aria-label={buildCellLabel(day)}
                  className={`${styles.calendarCell} ${isToday ? styles.calendarCellToday : ''} ${isSelected ? styles.calendarCellSelected : ''}`}
                  onClick={() => setSelectedDay(day)}
                >
                  <span className={`${styles.calendarDayNum} ${hasOverdueUnpaid ? styles.calendarDayOverdue : ''}`}>
                    {hasOverdueUnpaid ? `⚠ ${day}` : day}
                  </span>
                  <span className={styles.calendarDots}>
                    {events.map(event => (
                      <span
                        key={event.key}
                        className={event.type === 'expense' ? styles.dotDue : styles.dotStatement}
                        style={{ '--dot-color': event.card?.color || 'var(--color-primary)' }}
                      />
                    ))}
                  </span>
                  {dueEvents.slice(0, MAX_INLINE_CHIPS).map(event => (
                    <span key={`chip-${event.key}`} className={styles.calendarChip}>
                      {`${event.name} · ${formatCurrency(event.amount)}`}
                    </span>
                  ))}
                  {dueEvents.length > MAX_INLINE_CHIPS && (
                    <span className={styles.calendarChip}>{`+${dueEvents.length - MAX_INLINE_CHIPS}`}</span>
                  )}
                </button>
              );
            }))}
          </div>

          <div className={styles.calendarLegend}>
            <span className={styles.legendItem}>
              <span className={styles.dotDue} style={{ '--dot-color': 'var(--color-primary)' }} /> ครบกำหนดชำระ
            </span>
            <span className={styles.legendItem}>
              <span className={styles.dotStatement} style={{ '--dot-color': 'var(--color-primary)' }} /> วันสรุปยอด
            </span>
            {cards.map(card => (
              <span key={card.id} className={styles.legendItem}>
                <span className={cardStyles.colorChip} style={{ '--card-accent': card.color }} /> {card.name}
              </span>
            ))}
          </div>

          <div className={styles.calendarFooter}>
            <div className={styles.calendarFooterTotal}>{`รวมเดือนนี้ ${formatCurrency(monthTotals.total)} บาท`}</div>
            <span>{`ชำระแล้ว ${formatCurrency(monthTotals.paid)} · คงเหลือ ${formatCurrency(monthTotals.remaining)}`}</span>
          </div>
        </div>

        <div className={styles.dayDetail}>
          {selectedIsoDate && (
            <h3 className={styles.dayDetailTitle}>
              {formatIsoDateTH(selectedIsoDate)}
              {selectedEvents.length > 0 && <span> ({selectedEvents.length} รายการ)</span>}
            </h3>
          )}
          {selectedEvents.length === 0 ? (
            <p className={cardStyles.hint}>
              {eventsByDay.size === 0 ? 'ไม่มีรายการครบกำหนดในเดือนนี้' : 'ไม่มีรายการในวันที่เลือก'}
            </p>
          ) : (
            selectedEvents.map(event => {
              const busy = pendingKeys.includes(event.key);

              if (event.type === 'statement') {
                return (
                  <div key={event.key} className={cardStyles.upcomingItem} style={{ borderLeftColor: event.card?.color }}>
                    <span className={cardStyles.upcomingName}>
                      <span className={cardStyles.colorChip} style={{ '--card-accent': event.card?.color }} aria-hidden="true" />
                      {event.card?.name}
                    </span>
                    <span className={cardStyles.upcomingMeta}>วันสรุปยอด</span>
                  </div>
                );
              }

              const diffDays = diffDaysFromToday(selectedIsoDate);
              const wrapperClass = `${cardStyles.upcomingItem} ${event.paid ? styles.calendarEventPaid : ''}`;

              return (
                <div key={event.key} className={wrapperClass} style={{ borderLeftColor: event.card?.color || 'var(--color-primary)' }}>
                  <div className={cardStyles.upcomingTopRow}>
                    <span className={cardStyles.upcomingName}>
                      {event.paid && '✓ '}
                      {event.card && (
                        <span className={cardStyles.colorChip} style={{ '--card-accent': event.card.color }} aria-hidden="true" />
                      )}
                      {event.name}
                    </span>
                    <span className={cardStyles.upcomingAmount}>{`${formatCurrency(event.amount)} บาท`}</span>
                  </div>
                  {event.account && (
                    <span className={cardStyles.upcomingMeta}>{event.account}</span>
                  )}
                  {event.source === 'installment' && event.plan && (
                    <span className={cardStyles.upcomingMeta}>
                      {`${event.plan.itemName} · งวด ${event.installmentNo}/${event.plan.months}`}
                    </span>
                  )}
                  {!event.paid && <span className={cardStyles.upcomingMeta}>{describeDueDistance(diffDays)}</span>}

                  {event.source === 'installment' && (
                    <button
                      type="button"
                      className={`${cardStyles.paidPill} ${event.paid ? cardStyles.paidPillOn : ''} ${busy ? cardStyles.paidPillBusy : ''}`}
                      disabled={busy || event.plan?.status === PLAN_STATUS.CANCELLED}
                      onClick={() => onToggleInstallment?.(event)}
                    >
                      {busy ? 'กำลังบันทึก...' : (event.paid ? '✓ ชำระแล้ว' : 'ยังไม่ชำระ — แตะเพื่อยืนยัน')}
                    </button>
                  )}

                  {event.source === 'revolving' && !event.paid && (
                    <div className={styles.revolvingEventActions}>
                      <button
                        type="button"
                        className={`${cardStyles.paidPill} ${busy ? cardStyles.paidPillBusy : ''}`}
                        disabled={busy}
                        onClick={() => onRevolvingFull?.(event)}
                      >
                        {busy ? 'กำลังบันทึก...' : `จ่ายเต็มจำนวน ${formatCurrency(event.amount)}`}
                      </button>
                      <button
                        type="button"
                        className={`${cardStyles.paidPill} ${busy ? cardStyles.paidPillBusy : ''}`}
                        disabled={busy}
                        onClick={() => onRevolvingMinimum?.(event)}
                      >
                        จ่ายขั้นต่ำ
                      </button>
                    </div>
                  )}

                  {event.source === 'revolving' && event.paid && (
                    <button
                      type="button"
                      className={`${cardStyles.paidPill} ${cardStyles.paidPillOn} ${busy ? cardStyles.paidPillBusy : ''}`}
                      disabled={busy}
                      onClick={() => onRevolvingCancel?.(event)}
                    >
                      {busy ? 'กำลังบันทึก...' : 'ยกเลิกการชำระ'}
                    </button>
                  )}
                </div>
              );
            })
          )}

          {unscheduledEvents.length > 0 && (
            <div className={styles.unscheduledTray}>
              <button
                type="button"
                className={styles.unscheduledToggle}
                onClick={() => setUnscheduledOpen(open => !open)}
                aria-expanded={unscheduledOpen}
              >
                {`${unscheduledOpen ? '▾' : '▸'} ไม่ระบุวันครบกำหนด (${unscheduledEvents.length})`}
              </button>
              {unscheduledOpen && unscheduledEvents.map(event => (
                <div key={event.key} className={cardStyles.upcomingItem} style={{ borderLeftColor: event.card?.color || 'var(--color-primary)' }}>
                  <div className={cardStyles.upcomingTopRow}>
                    <span className={cardStyles.upcomingName}>{event.name}</span>
                    <span className={cardStyles.upcomingAmount}>{`${formatCurrency(event.amount)} บาท`}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
