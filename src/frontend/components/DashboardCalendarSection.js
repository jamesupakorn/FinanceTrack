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
 *
 * Graphite redesign (Dashboard pass) — Tailwind wrapper chrome เท่านั้น ExpenseCalendar.js/
 * ExpenseCalendar.module.css เองยังคง CSS Modules ตามเดิม (นอก scope, เป็น pass แยกในอนาคต — §8 shared
 * overlay carve-out) ส่วน collapse toggle เป็นของใหม่ตาม UX_SPEC §6.3/§6.4: พับเป็นค่าเริ่มต้นที่ base
 * tier เท่านั้น (7×6 grid ไม่พอใช้ที่ 375px — การ์ด "ครบกำหนด" ที่ขึ้นก่อนแล้วให้ข้อมูลเดียวกันอยู่แล้ว)
 * และขยายเสมอที่ lg โดยไม่มี toggle chrome เลย (สลับด้วย CSS responsive class ล้วน ๆ ผ่าน
 * CollapsibleHeading's toggleHiddenAtLg — ไม่มี JS matchMedia ใหม่, N7) เป็น state client-only ล้วน ๆ
 * ไม่มี persistence/API (architecture-review-dashboard-graphite.md Finding 5 — ประเมินแล้วว่าอยู่ใน scope)
 */

import { useState } from 'react';
import ExpenseCalendar from './ExpenseCalendar';
import CollapsibleHeading from './CollapsibleHeading';
import { Icons } from './Icons';

const FOCUS_RING = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2';

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
  // พับเป็นค่าเริ่มต้นที่ base tier เท่านั้น — ที่ lg CollapsibleHeading บังคับขยายเสมอด้วย CSS
  // responsive class (ดู toggleHiddenAtLg ด้านล่าง) โดยไม่สนใจ state ตัวนี้เลย (Finding 5)
  const [collapsed, setCollapsed] = useState(true);

  return (
    <section
      aria-labelledby="dashboard-calendar-heading"
      className="rounded-md border border-border-default bg-surface-1 py-space-4 shadow-elev-1 md:p-space-5"
    >
      <CollapsibleHeading
        headingId="dashboard-calendar-heading"
        headingRef={headingRef}
        expanded={!collapsed}
        onToggle={() => setCollapsed((prev) => !prev)}
        icon={Icons.Calendar}
        title="ปฏิทินค่าใช้จ่าย"
        toggleHiddenAtLg
        className="px-space-4 md:px-0"
      />

      {/* collapsed=true ⇒ ซ่อนที่ < lg, บังคับโชว์เสมอที่ lg+ (lg:block ทับ hidden) — ไม่ใช่ conditional
          render ตาม breakpoint ด้วย JS (N7: media query เปลี่ยนโครงสร้างได้ ไม่ใช่ค่า token/ไม่ใช้ JS) */}
      <div className={collapsed ? 'hidden lg:block' : 'block'}>
        {loading && (
          <div role="status" aria-busy="true" className="px-space-4 pt-space-4 md:px-0">
            <span className="sr-only">กำลังโหลดภาพรวม...</span>
            <div className="grid grid-cols-7 gap-1">
              {Array.from({ length: 42 }).map((_, index) => (
                // eslint-disable-next-line react/no-array-index-key
                <div key={index} className="aspect-square animate-pulse rounded-sm bg-surface-2" />
              ))}
            </div>
          </div>
        )}

        {!loading && error && (
          <div
            role="alert"
            className="mx-space-4 flex flex-wrap items-center justify-between gap-space-3 rounded-md border border-neg/35 bg-neg/10 p-space-4 text-neg md:mx-0"
          >
            <span>{error}</span>
            <button
              type="button"
              className={`min-h-11 rounded-sm border border-border-interactive bg-surface-2 px-space-4 text-sm font-semibold text-primary ${FOCUS_RING}`}
              onClick={onRetry}
            >
              ลองอีกครั้ง
            </button>
          </div>
        )}

        {!loading && !error && calendarData && (
          <div className="overflow-x-auto pt-space-4 [&_button:focus-visible]:outline [&_button:focus-visible]:outline-2 [&_button:focus-visible]:outline-accent [&_button:focus-visible]:outline-offset-2">
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
          </div>
        )}
      </div>
    </section>
  );
}
