/**
 * breakpoints.js
 * แหล่งข้อมูล breakpoint เดียวที่ทั้ง JS และ Tailwind config อ่านค่าเดียวกัน
 * (ADR-019 rule 4 — "JS and CSS read the same breakpoint constants")
 *
 * ต้องมีค่าเท่ากับ theme.screens ใน tailwind.config.js เสมอ (sm/md/lg เท่านั้น — ไม่มี xl/2xl)
 * ตัวอย่างจุดที่ควร import ค่านี้ในอนาคต (ยังไม่แก้ในรอบนี้ — อยู่นอก scope ของ Foundation pass):
 *   - CreditCardDetail.js:292 `window.innerWidth < 768` → ควรใช้ BP.md
 *   - CreditCardDetail.js:297 `matchMedia('(max-width: 767px)')` → ควรใช้ `BP.md - 1`
 */

export const BP: Readonly<{ sm: number; md: number; lg: number }> = {
  sm: 640,
  md: 768,
  lg: 1024
};
