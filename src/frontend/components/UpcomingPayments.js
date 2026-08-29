/**
 * คอมโพเนนต์: UpcomingPayments
 * รายการ "ครบกำหนด" 3 กลุ่ม (เกินกำหนด/วันนี้/ใน 7 วัน) จาก collectUpcomingPayments() — ไม่ derive เอง
 * ปุ่มการทำรายการ (ผ่อนชำระ/ยอดหมุนเวียน) ใช้ handler ชุดเดียวกับ DashboardCalendarSection ที่ pages/index.js
 * เป็นเจ้าของ — ไม่มีสำเนาที่สาม (ดูหมายเหตุใน DashboardCalendarSection.js)
 *
 * ตัวกรอง (ring legend/arc) กรองด้วย source: รายจ่ายทั่วไป = 'plain', บัตรเครดิต = 'installment'|'revolving'
 * รายจ่ายประจำวัน/เงินออม ไม่มีวันครบกำหนดโดยออกแบบ — กรองแล้วว่างเปล่าเสมอ พร้อมลิงก์ไปหน้าที่เกี่ยวข้อง (BR-DASH-012)
 */

import { useEffect } from 'react';
import { formatCurrency } from '../../shared/utils/frontend/numberUtils';
import { formatIsoDateTH, describeDueDistance } from '../../shared/utils/creditCardUtils';
import cardStyles from '../styles/CreditCard.module.css';
import styles from '../styles/Dashboard.module.css';

const FILTER_EMPTY_COPY = {
  generalExpense: { text: 'ไม่มีรายจ่ายทั่วไปที่ครบกำหนดในช่วงนี้' },
  creditCard: { text: 'ไม่มีรายการบัตรเครดิตที่ครบกำหนดในช่วงนี้' },
  dailyExpense: { text: 'รายจ่ายประจำวันไม่มีวันครบกำหนด ดูรายละเอียดในบันทึกรายเดือน แท็บรายวัน', href: '/workspace?tab=daily' },
  savings: { text: 'เงินออมไม่มีวันครบกำหนด', href: '/workspace?tab=savings' }
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
      className={`${cardStyles.upcomingItem} ${isOverdue ? cardStyles.upcomingOverdue : ''} ${highlighted ? styles.upcomingItemHighlighted : ''}`}
      style={event.card?.color ? { borderLeftColor: event.card.color } : undefined}
    >
      <div className={cardStyles.upcomingTopRow}>
        <span className={cardStyles.upcomingName}>
          {isOverdue && <span aria-hidden="true">⚠ </span>}
          {event.card && (
            <span className={cardStyles.colorChip} style={{ '--card-accent': event.card.color }} aria-hidden="true" />
          )}
          {event.name}
        </span>
        <span className={cardStyles.upcomingAmount}>{`${formatCurrency(event.amount)} บาท`}</span>
      </div>
      <span className={cardStyles.upcomingMeta}>
        {[event.account, typeLabel].filter(Boolean).join(' · ')}
      </span>
      <span className={cardStyles.upcomingMeta}>
        {`${formatIsoDateTH(event.isoDate)} · ${describeDueDistance(event.daysDiff)}`}
      </span>

      {event.source === 'installment' && (
        <button
          type="button"
          className={`${cardStyles.paidPill} ${busy ? cardStyles.paidPillBusy : ''}`}
          disabled={busy}
          onClick={() => onToggleInstallment?.(event)}
        >
          {busy ? 'กำลังบันทึก...' : 'ยังไม่ชำระ — แตะเพื่อยืนยัน'}
        </button>
      )}

      {event.source === 'revolving' && (
        <div className={styles.revolvingActions}>
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
    </div>
  );
}

function Group({ title, events, highlightedKey, ...itemProps }) {
  if (!events.length) return null;
  return (
    <div className={styles.upcomingGroup}>
      <h3 className={styles.upcomingGroupTitle}>{`${title} (${events.length})`}</h3>
      <div className={cardStyles.upcomingList}>
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
    <section className={styles.upcomingSection}>
      <div className={styles.upcomingHeaderRow}>
        <div>
          <h2 className={styles.sectionTitle}>รายการที่จะครบกำหนด</h2>
          <p className={styles.upcomingScope}>แสดงเฉพาะรายการที่ยังไม่ชำระภายใน 7 วันนับจากวันนี้</p>
        </div>
        {filter && (
          <button type="button" className={styles.clearFilterButton} onClick={onClearFilter}>
            ล้างตัวกรอง
          </button>
        )}
      </div>

      {/* ประกาศให้ screen reader ทราบทุกครั้งที่ตัวกรองเปลี่ยนผลลัพธ์ (ข้อเสนอแนะจาก UX Review, ต้นทุนต่ำ) */}
      <div aria-live="polite" className={styles.srOnlyStatus}>
        {filter ? `กรองแล้ว พบ ${totalAfterFilter} รายการ` : ''}
      </div>

      {totalAfterFilter === 0 ? (
        <div className={styles.upcomingEmpty}>
          {filterCopy ? (
            <>
              <p>{filterCopy.text}</p>
              {filterCopy.href && <a href={filterCopy.href} className={styles.ringEmptyLink}>เปิดบันทึกรายเดือน</a>}
            </>
          ) : (
            <>
              <p>ไม่มีรายการที่ครบกำหนดใน 7 วันข้างหน้า</p>
              <button type="button" className={styles.viewCalendarLink} onClick={onViewCalendar}>ดูทั้งเดือนในปฏิทิน</button>
            </>
          )}
        </div>
      ) : (
        <>
          <Group title="เกินกำหนด" events={overdue} highlightedKey={highlightedKey} {...itemProps} />
          <Group title="ครบกำหนดวันนี้" events={dueToday} highlightedKey={highlightedKey} {...itemProps} />
          <Group title="ครบกำหนดใน 7 วัน" events={dueSoon} highlightedKey={highlightedKey} {...itemProps} />
        </>
      )}
    </section>
  );
}
