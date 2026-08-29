import WorkspaceShell from '../../../src/frontend/components/WorkspaceShell';
import SavingsTable from '../../../src/frontend/components/SavingsTable';

// /workspace/savings แสดงแค่ SavingsTable — เป้าหมาย (SavingsGoalTracker) และการลงทุน (InvestmentTable)
// ที่เคยซ้อนอยู่ในแท็บ "ออมและเป้าหมาย" เดียวกัน (P3) ตอนนี้แยกเป็น /workspace/savings/goals และ
// /workspace/savings/investment คนละหน้า (AC-A5-16)
export default function WorkspaceSavingsPage() {
  return (
    <WorkspaceShell section="savings">
      {({ selectedMonth, refreshTrigger, registerSave, markClean }) => (
        <SavingsTable
          selectedMonth={selectedMonth}
          onRegisterSave={registerSave}
          onSaved={markClean}
          key={`savings-${refreshTrigger}`}
        />
      )}
    </WorkspaceShell>
  );
}
