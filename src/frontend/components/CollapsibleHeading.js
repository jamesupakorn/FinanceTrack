/**
 * คอมโพเนนต์: CollapsibleHeading
 * แพทเทิร์น <h2><button aria-expanded>...chevron</button></h2> ที่ใช้ร่วมกันระหว่าง BudgetHealthPanel
 * และ DashboardCalendarSection (Graphite redesign, Dashboard pass) — เดิมมีแค่ตัวเดียวใน
 * Dashboard.module.css (.collapsibleHeadingReset/.collapsibleHeader/.collapsibleChevron) ตอนนี้ต้องใช้
 * ซ้ำสองที่ (architecture-review-dashboard-graphite.md Finding 3) จึงแยกออกมาเป็นคอมโพเนนต์เดียว
 * แทนที่จะ implement สองรอบอิสระต่อกัน — คง contract aria-expanded ให้ตรงกันโดยโครงสร้าง
 *
 * id/ref/tabIndex อยู่ที่ <h2> เอง (ตามแพทเทิร์นเดิมของ DashboardCalendarSection ก่อนหน้านี้) ไม่ใช่ที่
 * <button> ข้างใน — ทำให้มี id เดียว ไม่ซ้ำ และเป็นเป้าหมาย scrollIntoView()/focus() ที่ใช้ได้ทุก tier
 * เสมอ (h2 เองไม่เคย display:none) ต่างจากลูกข้างในซึ่งสลับได้อย่างอิสระด้วย CSS responsive class ล้วน ๆ
 *
 * toggleHiddenAtLg: ใช้กับ DashboardCalendarSection เท่านั้น (UX_SPEC §6.4 — ปฏิทินขยายเสมอที่ lg
 * ไม่มี chevron/toggle chrome ที่นั่น) — เมื่อ true ปุ่ม toggle (พร้อม chevron) จะซ่อนที่ lg+ แล้วโชว์
 * ป้ายหัวข้อเฉย ๆ (ไม่มี chevron) แทน — สลับด้วย className responsive ล้วน ๆ ไม่มี JS matchMedia (N7)
 * BudgetHealthPanel ไม่ใช้ prop นี้ (พับได้ทุก tier รวม lg ตาม AC-DB-29/§6.4)
 */

import { Icons } from './Icons';

const FOCUS_RING = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2';

export default function CollapsibleHeading({
  headingId,
  headingRef,
  expanded,
  onToggle,
  icon: Icon,
  title,
  trailing,
  toggleHiddenAtLg = false,
  className = ''
}) {
  return (
    <h2 id={headingId} ref={headingRef} tabIndex={-1} className={`m-0 rounded-xs font-sans text-inherit ${FOCUS_RING} ${className}`}>
      <button
        type="button"
        className={`flex min-h-11 w-full items-center gap-space-2 rounded-xs bg-transparent p-0 py-space-1 text-left font-sans text-primary ${FOCUS_RING} ${toggleHiddenAtLg ? 'lg:hidden' : ''}`}
        onClick={onToggle}
        aria-expanded={expanded}
      >
        {/* text-xl font-semibold (22px/600) at every tier, not text-lg (18px) below lg — this is the
            same logical heading as the lg-only static label below, which already renders text-xl.
            §3.2/AC-14 assigns --text-xl to "section headings" and forbids a breakpoint changing a
            font-size; text-lg here was a leftover from before the fontSize scale existed (the previous
            fix pass unified the *weight* to font-semibold but missed the *size*) (Stage 4 round-2
            finding A-2). 700 (font-bold) stays reserved for the hero money figure only (§3.2). */}
        <span className="flex shrink-0 items-center gap-space-2 text-xl font-semibold">
          {Icon && <Icon size={18} />}
          {title}
        </span>
        {trailing && (
          <span className="min-w-0 flex-1 truncate text-right text-sm text-secondary">{trailing}</span>
        )}
        <span
          className={`flex shrink-0 items-center opacity-60 transition-transform duration-base ${expanded ? 'rotate-180' : ''}`}
          aria-hidden="true"
        >
          <Icons.ChevronDown size={18} />
        </span>
      </button>

      {/* lg-only static label, ไม่มี chevron/toggle chrome — render เฉพาะตอน toggleHiddenAtLg */}
      {toggleHiddenAtLg && (
        <span className="hidden items-center gap-space-2 text-xl font-semibold text-primary lg:flex">
          {Icon && <Icon size={18} />}
          {title}
        </span>
      )}
    </h2>
  );
}
