/**
 * คอมโพเนนต์: DashboardCalendarSection
 * ห่อ ExpenseCalendar แบบฝังตรงในหน้าภาพรวม (ไม่ผ่าน ExpenseCalendarModal — ตามมติ ADR-012)
 * เป็น thin wrapper ตาม §Files ของ spec-dashboard.md: ไม่ fetch เอง ไม่มี state ของ handler เอง —
 * รับ calendarData (จาก buildMonthEvents ตัวเดียวกับปฏิทิน/รายการครบกำหนด) และ handler ทั้งสี่ตัวมาจาก
 * pages/index.js ซึ่งเป็นเจ้าของ "แหล่งข้อมูลเดียว" ของทั้งหน้า (tiles/ring/budget/ปฏิทิน/รายการครบกำหนด
 * ต้องขยับพร้อมกันหลังทำรายการสำเร็จ — "One refresh function, one source" ตาม spec §4) เดียวกับที่
 * UpcomingPayments.js ใช้ปุ่มการทำรายการชุดเดียวกันนี้ — จึงมีตรรกะทำรายการอยู่ที่เดียวในหน้านี้
 * (ไม่ใช่สำเนาที่สองซ้อนสำเนาที่สาม) ส่วน ExpenseCalendarModal ยังคงมีสำเนาของตัวเองแยกต่างหาก
 * เพราะเป็นอินสแตนซ์อิสระที่ mount แยกกันจริง (ตามที่ architecture review ยอมรับไว้แล้ว)
 *
 * เดือนของปฏิทินผูกกับ selectedMonth ของทั้งหน้า — ลูกศรในปฏิทินกับลูกศรบน header จึงขยับพร้อมกันเสมอ
 */

import ExpenseCalendar from './ExpenseCalendar';
import cardStyles from '../styles/CreditCard.module.css';
import calStyles from '../styles/ExpenseCalendar.module.css';
import styles from '../styles/Dashboard.module.css';

export default function DashboardCalendarSection({
  headingRef,
  monthKey,
  onNavigateMonth,
  calendarData,
  cards,
  loading,
  error,
  onRetry,
  pendingKeys,
  onToggleInstallment,
  onRevolvingFull,
  onRevolvingMinimum,
  onRevolvingCancel
}) {
  return (
    <section className={styles.calendarSection} aria-labelledby="dashboard-calendar-heading">
      <h2 id="dashboard-calendar-heading" ref={headingRef} tabIndex={-1} className={styles.sectionTitle}>
        ปฏิทินค่าใช้จ่าย
      </h2>

      {loading && (
        <div role="status" aria-busy="true">
          <span className={cardStyles.srOnly}>กำลังโหลดภาพรวม...</span>
          <div className={calStyles.calendarSkeletonGrid}>
            {Array.from({ length: 42 }).map((_, index) => (
              // eslint-disable-next-line react/no-array-index-key
              <div key={index} className={cardStyles.skeleton} />
            ))}
          </div>
        </div>
      )}

      {!loading && error && (
        <div className={cardStyles.errorState} role="alert">
          <span>{error}</span>
          <button type="button" className={cardStyles.ghostButton} onClick={onRetry}>ลองอีกครั้ง</button>
        </div>
      )}

      {!loading && !error && calendarData && (
        <ExpenseCalendar
          monthKey={monthKey}
          onNavigateMonth={onNavigateMonth}
          eventsByDay={calendarData.eventsByDay}
          unscheduledEvents={calendarData.unscheduledEvents}
          cards={cards}
          monthTotals={calendarData.monthTotals}
          windowState={calendarData.windowState}
          pendingKeys={pendingKeys}
          onToggleInstallment={onToggleInstallment}
          onRevolvingFull={onRevolvingFull}
          onRevolvingMinimum={onRevolvingMinimum}
          onRevolvingCancel={onRevolvingCancel}
        />
      )}
    </section>
  );
}
