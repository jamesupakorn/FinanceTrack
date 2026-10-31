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
 */

import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
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
import { buildMonthEvents } from '../../shared/utils/frontend/expenseEvents';
import { Icons } from './Icons';
import styles from '../styles/ExpenseCalendar.module.css';

type CalendarData = ReturnType<typeof buildMonthEvents>;
type CalendarEvent = CalendarData['unscheduledEvents'][number];
type CalendarCard = NonNullable<Parameters<typeof buildMonthEvents>[0]['cards']>[number];
type CalendarAction = (event: CalendarEvent) => void | Promise<void>;
type WindowState = CalendarData['windowState'];

interface ExpenseCalendarProps {
  monthKey: string;
  onNavigateMonth: (delta: number) => void;
  eventsByDay: CalendarData['eventsByDay'];
  unscheduledEvents?: CalendarData['unscheduledEvents'];
  cards?: CalendarCard[];
  monthTotals?: CalendarData['monthTotals'];
  windowState?: WindowState;
  pendingKeys?: string[];
  onToggleInstallment?: CalendarAction;
  onRevolvingFull?: CalendarAction;
  onRevolvingMinimum?: CalendarAction;
  onRevolvingCancel?: CalendarAction;
  /** false = ไม่แสดงรายการของวันที่เลือก (หน้าภาพรวมมี UpcomingPayments แสดงรายการเดียวกันอยู่แล้ว) */
  showDayDetail?: boolean;
}

interface CalendarPlan extends NonNullable<CalendarEvent['plan']> {
  itemName?: string;
  months?: number;
  status?: string;
}

const WEEKDAY_LABELS = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];
const MAX_INLINE_CHIPS = 2;

// Graphite class constants (ไฟล์นี้ถือของตัวเอง — รูปแบบเดียวกับ UpcomingPayments.tsx)
const FOCUS_RING = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2';
const MOTION = 'transition-colors duration-fast ease-graphite motion-reduce:transition-none';
const NAV_BUTTON = `inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-sm border border-border-interactive bg-transparent p-0 text-secondary hover:bg-surface-2 ${MOTION} ${FOCUS_RING}`;
// ring-tertiary = เส้นขอบกลาง ๆ 1px กันสีบัตรเข้มกลืนพื้น (D-7)
const CHIP = 'h-3 w-3 shrink-0 rounded-xs ring-1 ring-tertiary';
const EVENT_CARD = 'flex flex-col gap-space-2 rounded-md border border-border-default border-l-4 bg-surface-2 p-space-4';
const PILL_BASE = `w-full min-h-11 rounded-sm border px-space-3 py-space-2 text-center text-sm font-semibold tabular-nums disabled:cursor-not-allowed ${MOTION} ${FOCUS_RING}`;
// สองสตริงแยกกัน ไม่ต่อท้ายกัน: utility สีที่ชนกันตัดสินด้วยลำดับ stylesheet ไม่ใช่ลำดับในสตริง
const PAID_PILL = `${PILL_BASE} border-border-interactive bg-surface-2 text-secondary`;
const PAID_PILL_ON = `${PILL_BASE} border-pos/60 bg-pos/10 text-pos`;
const BUSY = 'opacity-60';

function eventCardClass(color: string | undefined): string {
  return color ? EVENT_CARD : `${EVENT_CARD} border-l-border-default`;
}

function pillClass(on: boolean, busy: boolean): string {
  return `${on ? PAID_PILL_ON : PAID_PILL} ${busy ? BUSY : ''}`;
}

/** unpaid ก่อน paid แล้วค่อยเรียง revolving → installment → plain (สิ่งที่ต้องทำก่อนอยู่บนสุดเสมอ) */
const SOURCE_ORDER: Record<CalendarEvent['source'], number> = { revolving: 0, installment: 1, plain: 2, statement: 3 };

function compareEvents(a: CalendarEvent, b: CalendarEvent): number {
  const aPaid = a.type === 'expense' ? (a.paid ? 1 : 0) : 0;
  const bPaid = b.type === 'expense' ? (b.paid ? 1 : 0) : 0;
  if (aPaid !== bPaid) return aPaid - bPaid;
  return (SOURCE_ORDER[a.source] ?? 9) - (SOURCE_ORDER[b.source] ?? 9);
}

const OUT_OF_WINDOW_COPY: Record<'pruned' | 'future', { title: string; detail: string }> = {
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
  onRevolvingCancel,
  showDayDetail = true
}: ExpenseCalendarProps) {
  const [selectedDay, setSelectedDay] = useState<number | null>(null);
  const [unscheduledOpen, setUnscheduledOpen] = useState(false);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const pendingFocusDay = useRef<number | null>(null);

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
    const target = gridRef.current.querySelector<HTMLElement>(`[data-day="${pendingFocusDay.current}"]`);
    target?.focus();
    pendingFocusDay.current = null;
  }, [selectedDay, monthKey]);

  // ย้ายมาจากปฏิทินบัตรเครดิตเดิม — เปลี่ยน setMonthKey ในไฟล์เดิมเป็น onNavigateMonth(delta)
  // เพราะ monthKey ย้ายไปอยู่ที่ ExpenseCalendarModal.js แล้ว (ADR-012 §2)
  const moveSelection = (delta: number) => {
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
  const handleGridKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
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

  const cells: Array<number | null> = [];
  for (let index = 0; index < firstWeekday; index += 1) cells.push(null);
  for (let day = 1; day <= daysInMonth; day += 1) cells.push(day);
  const rows: Array<Array<number | null>> = [];
  for (let index = 0; index < cells.length; index += 7) rows.push(cells.slice(index, index + 7));

  const selectedEvents: CalendarEvent[] = selectedDay
    ? [...(eventsByDay.get(selectedDay) || [])].sort(compareEvents)
    : [];
  const selectedIsoDate = selectedDay
    ? `${monthKey}-${String(selectedDay).padStart(2, '0')}`
    : null;

  // ขยายจากต้นฉบับให้ครอบคลุมแหล่งที่มา plain/revolving ด้วย ไม่ใช่แค่ due ของแผนผ่อน
  const buildCellLabel = (day: number): string => {
    const events = eventsByDay.get(day) || [];
    const isoDate = `${monthKey}-${String(day).padStart(2, '0')}`;
    if (!events.length) return formatIsoDateTH(isoDate);
    const parts = events.map(event => (event.type === 'statement'
      ? `วันสรุปยอด ${event.card?.name || ''}`
      : `ครบกำหนด ${event.name} ${formatCurrency(event.amount ?? 0)} บาท`));
    return `${formatIsoDateTH(isoDate)}, ${parts.join(', ')}`;
  };

  const outOfWindowCopy = windowState === 'in-window' ? null : OUT_OF_WINDOW_COPY[windowState];

  return (
    <div className={styles.calendarWrap}>
      <div className={styles.calendarNav}>
        <button
          type="button"
          className={NAV_BUTTON}
          onClick={() => onNavigateMonth(-1)}
          aria-label="เดือนก่อนหน้า"
        >
          <Icons.ChevronLeft size={18} />
        </button>
        <span className={styles.calendarMonth}>{formatMonthKeyTH(monthKey)}</span>
        <button
          type="button"
          className={NAV_BUTTON}
          onClick={() => onNavigateMonth(1)}
          aria-label="เดือนถัดไป"
        >
          <Icons.ChevronRight size={18} />
        </button>
      </div>

      {outOfWindowCopy && (
        <div className={styles.outOfWindowNotice} role="status">
          <span aria-hidden="true"><Icons.AlertTriangle size={16} color="var(--info)" /></span>
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
                  className={`${styles.calendarCell} ${isToday ? styles.calendarCellToday : ''} ${isSelected ? styles.calendarCellSelected : ''} ${FOCUS_RING}`}
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
                        style={{ '--dot-color': String(event.card?.color || 'var(--accent)') } as CSSProperties}
                      />
                    ))}
                  </span>
                  {dueEvents.slice(0, MAX_INLINE_CHIPS).map(event => (
                    <span key={`chip-${event.key}`} className={styles.calendarChip}>
                      {`${event.name} · ${formatCurrency(event.amount ?? 0)}`}
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
              <span className={styles.dotDue} style={{ '--dot-color': 'var(--accent)' } as CSSProperties} /> ครบกำหนดชำระ
            </span>
            <span className={styles.legendItem}>
              <span className={styles.dotStatement} style={{ '--dot-color': 'var(--accent)' } as CSSProperties} /> วันสรุปยอด
            </span>
            {cards.map(card => (
              <span key={card.id} className={styles.legendItem}>
                <span className={CHIP} style={{ backgroundColor: String(card.color || 'var(--accent)') }} aria-hidden="true" /> {card.name}
              </span>
            ))}
          </div>

          <div className={styles.calendarFooter}>
            <div className={styles.calendarFooterTotal}>{`รวมเดือนนี้ ${formatCurrency(monthTotals.total)} บาท`}</div>
            <span>{`ชำระแล้ว ${formatCurrency(monthTotals.paid)} · คงเหลือ ${formatCurrency(monthTotals.remaining)}`}</span>
          </div>
        </div>

        {(showDayDetail || unscheduledEvents.length > 0) && (
        <div className={styles.dayDetail}>
          {showDayDetail && selectedIsoDate && (
            <h3 className={styles.dayDetailTitle}>
              {formatIsoDateTH(selectedIsoDate)}
              {selectedEvents.length > 0 && <span> ({selectedEvents.length} รายการ)</span>}
            </h3>
          )}
          {!showDayDetail ? null : selectedEvents.length === 0 ? (
            <p className="m-0 mt-space-2 text-sm text-tertiary">
              {eventsByDay.size === 0 ? 'ไม่มีรายการครบกำหนดในเดือนนี้' : 'ไม่มีรายการในวันที่เลือก'}
            </p>
          ) : (
            selectedEvents.map(event => {
              if (!selectedIsoDate) return null;
              const busy = pendingKeys.includes(event.key);
              const eventCardColor = event.card?.color as string | undefined;
              const plan = event.plan as CalendarPlan | null | undefined;

              if (event.type === 'statement') {
                return (
                  <div key={event.key} className={eventCardClass(eventCardColor)} style={eventCardColor ? { borderLeftColor: eventCardColor } : undefined}>
                    <span className="inline-flex items-center gap-space-2 font-semibold text-primary">
                      <span className={CHIP} style={{ backgroundColor: eventCardColor || 'var(--accent)' }} aria-hidden="true" />
                      {event.card?.name}
                    </span>
                    <span className="text-sm text-secondary">วันสรุปยอด</span>
                  </div>
                );
              }

              const diffDays = diffDaysFromToday(selectedIsoDate);
              const wrapperClass = eventCardClass(eventCardColor);
              // ชำระแล้ว: ลดความเด่นด้วย text token ไม่ใช้ opacity (opacity ทำ contrast ต่ำกว่า AA) — ยังมี ✓ กำกับ (ADR-006)
              const strongText = event.paid ? 'text-secondary' : 'text-primary';
              const metaText = `text-sm ${event.paid ? 'text-tertiary' : 'text-secondary'}`;

              return (
                <div key={event.key} className={wrapperClass} style={eventCardColor ? { borderLeftColor: eventCardColor } : undefined}>
                  <div className="flex flex-wrap items-baseline justify-between gap-space-3">
                    <span className={`inline-flex items-center gap-space-2 font-semibold ${strongText}`}>
                      {event.paid && '✓ '}
                      {event.card && (
                        <span className={CHIP} style={{ backgroundColor: eventCardColor || 'var(--accent)' }} aria-hidden="true" />
                      )}
                      {event.name}
                    </span>
                    <span className={`whitespace-nowrap text-lg font-bold tabular-nums ${strongText}`}>{`${formatCurrency(event.amount ?? 0)} บาท`}</span>
                  </div>
                  {event.account && (
                    <span className={metaText}>{event.account}</span>
                  )}
                  {event.source === 'installment' && event.plan && (
                    <span className={metaText}>
                      {`${plan?.itemName} · งวด ${event.installmentNo}/${plan?.months}`}
                    </span>
                  )}
                  {!event.paid && <span className={metaText}>{describeDueDistance(diffDays)}</span>}

                  {event.source === 'installment' && (
                    <button
                      type="button"
                      className={pillClass(Boolean(event.paid), busy)}
                      disabled={busy || plan?.status === PLAN_STATUS.CANCELLED}
                      onClick={() => onToggleInstallment?.(event)}
                    >
                      {busy ? 'กำลังบันทึก...' : (event.paid ? '✓ ชำระแล้ว' : 'ยังไม่ชำระ — แตะเพื่อยืนยัน')}
                    </button>
                  )}

                  {event.source === 'revolving' && !event.paid && (
                    <div className={styles.revolvingEventActions}>
                      <button
                        type="button"
                        className={pillClass(false, busy)}
                        disabled={busy}
                        onClick={() => onRevolvingFull?.(event)}
                      >
                        {busy ? 'กำลังบันทึก...' : `จ่ายเต็มจำนวน ${formatCurrency(event.amount ?? 0)}`}
                      </button>
                      <button
                        type="button"
                        className={pillClass(false, busy)}
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
                      className={pillClass(true, busy)}
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
                className={`${styles.unscheduledToggle} ${FOCUS_RING}`}
                onClick={() => setUnscheduledOpen(open => !open)}
                aria-expanded={unscheduledOpen}
              >
                {`${unscheduledOpen ? '▾' : '▸'} ไม่ระบุวันครบกำหนด (${unscheduledEvents.length})`}
              </button>
              {unscheduledOpen && unscheduledEvents.map(event => (
                <div key={event.key} className={eventCardClass(event.card?.color as string | undefined)} style={event.card?.color ? { borderLeftColor: event.card.color as string } : undefined}>
                  <div className="flex flex-wrap items-baseline justify-between gap-space-3">
                    <span className="inline-flex items-center gap-space-2 font-semibold text-primary">{event.name}</span>
                    <span className="whitespace-nowrap text-lg font-bold tabular-nums text-primary">{`${formatCurrency(event.amount ?? 0)} บาท`}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        )}
      </div>
    </div>
  );
}