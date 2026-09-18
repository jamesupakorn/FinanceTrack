/**
 * คอมโพเนนต์: LoadingSkeleton / SkeletonBlock
 * โครงร่าง (skeleton) ระหว่างโหลดสำหรับ 5 จุดที่เคยเป็นข้อความเปล่า ๆ ไม่มี role/aria เลย
 * (Pattern C ใน task-context-td-m05.md — profiles, BudgetThresholdForm, MonthComparison,
 * SavingsGoalTracker, RevolvingBalanceSection) — TD-M05
 *
 * แชร์กันแค่ 2 อย่างเท่านั้นโดยตั้งใจ:
 *   1) กล่องประกาศสถานะ role="status" aria-busy="true" + ข้อความ sr-only (เดิมก๊อปเหมือนกัน 5 ที่)
 *   2) โทเคนของบล็อกวิบวับ (animate-pulse + สีพื้น)
 * **ไม่แชร์รูปทรง** — รูปทรงต้องอิงเนื้อหาจริงของแต่ละจุด จึงอยู่ที่ call site เสมอ
 * (UX_SPEC-td-m05-pattern-c.md §3.1 "structural reuse, leaf replacement")
 *
 * ไม่เกี่ยวข้องกับ Pattern A (pages/index.js, DashboardCalendarSection.js, CreditCardDashboard.js,
 * ExpenseCalendarModal.js) — สี่ไฟล์นั้นมีสเกเลตันที่วัดพิกเซลมาเองและ "ห้ามรวม" โดยมติที่บันทึกไว้
 * ใน task-type-td-m05.md §Non-Goals และคอมเมนต์สด pages/index.js:576-586 ห้าม retrofit เข้าไฟล์นั้น
 * และไม่เกี่ยวกับ LoadingNotice.js (Pattern B) ซึ่งเป็นคนละสถานการณ์: LoadingNotice ใช้เมื่อ "มีเนื้อหา
 * อยู่แล้ว กำลังโหลดเพิ่ม" ส่วน LoadingSkeleton ใช้เมื่อ "ยังไม่มีอะไรเลย แสดงรูปทรงที่กำลังจะมา"
 */

// สีพื้นของบล็อก = ขยับขึ้นจากพื้นผิวของ "พ่อแม่" หนึ่งขั้นเสมอ (surface-1 → surface-2,
// surface-2 → surface-3) เป็น prop ที่เลือกได้ทางเดียว ไม่ใช่การเติม class ทับ เพราะ utility
// property เดียวกันสองตัวในลิสต์เดียว Tailwind ตัดสินด้วยลำดับใน CSS ที่ generate ไม่ใช่ลำดับใน JSX
// (บทเรียนที่บันทึกไว้แล้วใน pages/profiles.js:44-48)
const FILL = {
  'surface-1': 'bg-surface-2',
  'surface-2': 'bg-surface-3'
};

export function SkeletonBlock({ className = '', on = 'surface-1' }) {
  return <div aria-hidden="true" className={`animate-pulse rounded-sm ${FILL[on]} ${className}`} />;
}

export default function LoadingSkeleton({ label, className = '', children }) {
  return (
    <div role="status" aria-busy="true" className={className}>
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}
