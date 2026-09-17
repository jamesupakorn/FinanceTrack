/**
 * คอมโพเนนต์: LoadingNotice
 * กล่องแจ้งสถานะ "กำลังโหลด" แบบ dashed-border ที่ใช้ซ้ำกันเกือบทุกตัวอักษรใน ExpenseTable,
 * SavingsTable, DailyExpenseTable, IncomeTable (Pattern B ใน task-context-td-m05.md) — แยกออกมา
 * เป็นคอมโพเนนต์เดียวแทนการ copy-paste ต่อไป และรวม role="status" aria-live="polite" ให้ครบ
 * ทุกจุดเรียกใช้ (IncomeTable.js เดิมขาดสองattribute นี้ — TD-M05).
 *
 * ไม่เกี่ยวข้องกับ Pattern A (animate-pulse/shimmer skeleton ใน pages/index.js,
 * DashboardCalendarSection.js, CreditCardDashboard.js, ExpenseCalendarModal.js) — ตัวนั้นเป็นคนละ
 * แพทเทิร์นโดยเจตนา (เนื้อหาแบบ grid/dashboard ต้องคง layout ไว้ระหว่างโหลด) ห้ามรวมกัน
 * (task-type-td-m05.md §Non-Goals).
 */
export default function LoadingNotice({ message = 'กำลังโหลดข้อมูล...', className = '' }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={`rounded-md border border-dashed border-border-default bg-sunken p-space-4 text-sm text-secondary${className ? ` ${className}` : ''}`}
    >
      {message}
    </div>
  );
}
