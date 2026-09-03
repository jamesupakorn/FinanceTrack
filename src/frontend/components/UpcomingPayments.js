/**
 * คอมโพเนนต์: UpcomingPayments
 * รายการ "ครบกำหนด" 3 กลุ่ม (เกินกำหนด/วันนี้/ใน 7 วัน) จาก collectUpcomingPayments() — ไม่ derive เอง
 * ปุ่มการทำรายการ (ผ่อนชำระ/ยอดหมุนเวียน) ใช้ handler ชุดเดียวกับ DashboardCalendarSection ที่ pages/index.js
 * เป็นเจ้าของ — ไม่มีสำเนาที่สาม (ดูหมายเหตุใน DashboardCalendarSection.js)
 *
 * ตัวกรอง (ring legend/arc) กรองด้วย source: รายจ่ายทั่วไป = 'plain', บัตรเครดิต = 'installment'|'revolving'
 * รายจ่ายประจำวัน/เงินออม ไม่มีวันครบกำหนดโดยออกแบบ — กรองแล้วว่างเปล่าเสมอ พร้อมลิงก์ไปหน้าที่เกี่ยวข้อง (BR-DASH-012)
 *
 * Graphite redesign (Dashboard pass) — Tailwind only ไม่ import Dashboard.module.css/CreditCard.module.css
 * อีกต่อไป (~10 คลาสที่เคยยืมจาก CreditCard.module.css — upcomingItem/paidPill/ฯลฯ — reimplement เป็น
 * Tailwind utility ตรง ๆ ในไฟล์นี้เอง architecture-review-dashboard-graphite.md Finding 1) นี่คือ "การ์ด
 * ครบกำหนด" ที่ตาม UX_SPEC §6.3 ย้ายมาเป็นองค์ประกอบแรกของหน้า (journey J1) — ลำดับ DOM จริงจัดที่
 * pages/index.js ไม่ใช่ที่นี่
 */

import { useEffect } from 'react';
import { formatCurrency } from '../../shared/utils/frontend/numberUtils';
import { formatIsoDateTH, describeDueDistance } from '../../shared/utils/creditCardUtils';

const FOCUS_RING = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2';
const PAID_PILL = `w-full min-h-11 rounded-sm border border-border-interactive bg-surface-2 px-space-3 py-space-2 text-center text-sm font-semibold text-secondary tabular-nums ${FOCUS_RING}`;

const FILTER_EMPTY_COPY = {
  generalExpense: { text: 'ไม่มีรายจ่ายทั่วไปที่ครบกำหนดในช่วงนี้' },
  creditCard: { text: 'ไม่มีรายการบัตรเครดิตที่ครบกำหนดในช่วงนี้' },
  dailyExpense: { text: 'รายจ่ายประจำวันไม่มีวันครบกำหนด ดูรายละเอียดในหน้ารายจ่ายรายวัน', href: '/workspace/daily' },
  savings: { text: 'เงินออมไม่มีวันครบกำหนด', href: '/workspace/savings' }
};

function matchesFilter(event, filter) {
  if (!filter) return true;
  if (filter === 'generalExpense') return event.source === 'plain';
  if (filter === 'creditCard') return event.source === 'installment' || event.source === 'revolving';
  return false; // dailyExpense / เงินออม ไม่มีเหตุการณ์ครบกำหนดโดยออกแบบ
}

function UpcomingItem({ event, pendingKeys, onToggleInstallment, onRevolvingFull, onRevolvingMinimum, highlighted }) {
  const busy = pendingKeys.includes(event.key);
  const typeLabel = event.source === 'installment' ? 'ผ่อนชำระ' : (event.source === 'revolving' ? 'ยอดหมุนเวียน' : 'รายจ่าย');
  const isOverdue = event.daysDiff < 0;

  return (
    <div
      id={`upcoming-item-${event.key}`}
      // bg-surface-2, not bg-surface-1 — this row sits inside the section's own bg-surface-1 card, so
      // the surface step needs to actually step up (C1: "nested grouping uses --surface-2 with a border
      // and no shadow") to read as distinct from the parent, not just repeat the same fill (Stage 4 finding)
      className={`flex flex-col gap-space-2 rounded-md border border-border-default border-l-4 bg-surface-2 p-space-4 ${
        isOverdue && !event.card?.color ? 'border-l-neg' : 'border-l-border-default'
      } ${highlighted ? 'outline outline-2 outline-accent outline-offset-2' : ''}`}
      style={event.card?.color ? { borderLeftColor: event.card.color } : undefined}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-space-3">
        <span className="inline-flex items-center gap-space-2 font-semibold text-primary">
          {isOverdue && <span aria-hidden="true">⚠ </span>}
          {event.card && (
            <span
              className="h-3 w-3 shrink-0 rounded-xs"
              style={{ backgroundColor: event.card.color }}
              aria-hidden="true"
            />
          )}
          {event.name}
        </span>
        <span className="whitespace-nowrap text-lg font-bold text-primary tabular-nums">{`${formatCurrency(event.amount)} บาท`}</span>
      </div>
      <span className="text-sm text-secondary">
        {[event.account, typeLabel].filter(Boolean).join(' · ')}
      </span>
      <span className="text-sm text-secondary">
        {`${formatIsoDateTH(event.isoDate)} · ${describeDueDistance(event.daysDiff)}`}
      </span>

      {event.source === 'installment' && (
        <button
          type="button"
          className={`${PAID_PILL} ${busy ? 'opacity-60' : ''}`}
          disabled={busy}
          onClick={() => onToggleInstallment?.(event)}
        >
          {busy ? 'กำลังบันทึก...' : 'ยังไม่ชำระ — แตะเพื่อยืนยัน'}
        </button>
      )}

      {event.source === 'revolving' && (
        <div className="flex flex-col gap-space-2">
          <button
            type="button"
            className={`${PAID_PILL} ${busy ? 'opacity-60' : ''}`}
            disabled={busy}
            onClick={() => onRevolvingFull?.(event)}
          >
            {busy ? 'กำลังบันทึก...' : `จ่ายเต็มจำนวน ${formatCurrency(event.amount)}`}
          </button>
          <button
            type="button"
            className={`${PAID_PILL} ${busy ? 'opacity-60' : ''}`}
            disabled={busy}
            onClick={() => onRevolvingMinimum?.(event)}
          >
            จ่ายขั้นต่ำ
          </button>
        </div>
      )}
    </div>
  );
}

function Group({ title, events, highlightedKey, ...itemProps }) {
  if (!events.length) return null;
  return (
    <div>
      <h3 className="mb-space-2 text-sm font-bold text-secondary">{`${title} (${events.length})`}</h3>
      <div className="flex flex-col gap-space-3">
        {events.map((event) => (
          <UpcomingItem key={event.key} event={event} highlighted={highlightedKey === event.key} {...itemProps} />
        ))}
      </div>
    </div>
  );
}

export default function UpcomingPayments({
  upcoming,
  filter,
  onClearFilter,
  onViewCalendar,
  pendingKeys = [],
  onToggleInstallment,
  onRevolvingFull,
  onRevolvingMinimum,
  highlightedKey
}) {
  // Escape ล้างตัวกรองเมื่อมีตัวกรองใช้งานอยู่ (spec §5)
  useEffect(() => {
    if (!filter) return undefined;
    const handleEsc = (event) => {
      if (event.key === 'Escape') onClearFilter?.();
    };
    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, [filter, onClearFilter]);

  const overdue = (upcoming?.overdue || []).filter((event) => matchesFilter(event, filter));
  const dueToday = (upcoming?.dueToday || []).filter((event) => matchesFilter(event, filter));
  const dueSoon = (upcoming?.dueSoon || []).filter((event) => matchesFilter(event, filter));
  const itemProps = { pendingKeys, onToggleInstallment, onRevolvingFull, onRevolvingMinimum };

  const totalAfterFilter = overdue.length + dueToday.length + dueSoon.length;
  const filterCopy = filter ? FILTER_EMPTY_COPY[filter] : null;

  return (
    <section className="rounded-md border border-border-default bg-surface-1 p-space-4 shadow-elev-1 md:p-space-5">
      <div className="mb-space-4 flex flex-wrap items-center justify-between gap-space-3">
        <div>
          <h2 className="text-xl font-semibold text-primary">รายการที่จะครบกำหนด</h2>
          <p className="mt-space-1 text-xs text-tertiary">แสดงเฉพาะรายการที่ยังไม่ชำระภายใน 7 วันนับจากวันนี้</p>
        </div>
        {filter && (
          <button
            type="button"
            className={`min-h-11 rounded-full border border-border-interactive bg-transparent px-space-4 font-semibold text-primary ${FOCUS_RING}`}
            onClick={onClearFilter}
          >
            ล้างตัวกรอง
          </button>
        )}
      </div>

      {/* ประกาศให้ screen reader ทราบทุกครั้งที่ตัวกรองเปลี่ยนผลลัพธ์ (ข้อเสนอแนะจาก UX Review, ต้นทุนต่ำ) */}
      <div aria-live="polite" className="sr-only">
        {filter ? `กรองแล้ว พบ ${totalAfterFilter} รายการ` : ''}
      </div>

      {totalAfterFilter === 0 ? (
        <div className="py-space-5 text-center text-secondary">
          {filterCopy ? (
            <>
              <p>{filterCopy.text}</p>
              {filterCopy.href && (
                <a
                  href={filterCopy.href}
                  className={`mt-space-3 inline-flex min-h-11 items-center rounded-full bg-accent px-space-4 font-semibold text-on-accent no-underline ${FOCUS_RING}`}
                >
                  เปิดบันทึกรายเดือน
                </a>
              )}
            </>
          ) : (
            <>
              <p>ไม่มีรายการที่ครบกำหนดใน 7 วันข้างหน้า</p>
              <button
                type="button"
                className={`mt-space-2 min-h-11 cursor-pointer border-none bg-transparent px-space-2 font-semibold text-accent underline ${FOCUS_RING}`}
                onClick={onViewCalendar}
              >
                ดูทั้งเดือนในปฏิทิน
              </button>
            </>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-space-5">
          <Group title="เกินกำหนด" events={overdue} highlightedKey={highlightedKey} {...itemProps} />
          <Group title="ครบกำหนดวันนี้" events={dueToday} highlightedKey={highlightedKey} {...itemProps} />
          <Group title="ครบกำหนดใน 7 วัน" events={dueSoon} highlightedKey={highlightedKey} {...itemProps} />
        </div>
      )}
    </section>
  );
}
