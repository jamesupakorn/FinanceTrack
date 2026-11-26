import { useState } from 'react';
import WorkspaceShell from '../../../src/frontend/components/WorkspaceShell';
import SavingsTable from '../../../src/frontend/components/SavingsTable';
import SavingsLedgerPanel from '../../../src/frontend/components/SavingsLedgerPanel';

// /workspace/savings แสดงแค่ SavingsTable — เป้าหมาย (SavingsGoalTracker) และการลงทุน (InvestmentTable)
// ที่เคยซ้อนอยู่ในแท็บ "ออมและเป้าหมาย" เดียวกัน (P3) ตอนนี้แยกเป็น /workspace/savings/goals และ
// /workspace/savings/investment คนละหน้า (AC-A5-16)
//
// SavingsLedgerPanel (ยอดกลาง + ยืมเงิน/ถอนเงินออม, spec-savings-loan-withdrawal S4) อยู่ใต้ SavingsTable
// เสมอ — ไม่ใช่ปุ่มบันทึกที่สอง (BR-017, C-S4-5) จึงไม่รับ registerSave/markDirty แต่ต้องรีเฟรชเงียบ ๆ
// ทุกครั้งที่ SavingsTable บันทึกสำเร็จ (UX_SPEC-savings-loan-withdrawal.md §3.2 "Refresh", C-S4-4) — ทำผ่าน
// panelReloadKey ที่เพิ่มขึ้นในตัว wrapper ของ onSaved นี้ ไม่ใช่ remount ทั้งแผง (ไม่งั้น <details> ที่เปิดไว้จะปิด)
export default function WorkspaceSavingsPage() {
  const [panelReloadKey, setPanelReloadKey] = useState(0);

  return (
    <WorkspaceShell section="savings">
      {({ selectedMonth, refreshTrigger, registerSave, markClean, markDirty }) => (
        <>
          <SavingsTable
            selectedMonth={selectedMonth}
            onRegisterSave={registerSave}
            onSaved={() => { markClean(); setPanelReloadKey(key => key + 1); }}
            markDirty={markDirty}
            key={`savings-${refreshTrigger}`}
          />
          <SavingsLedgerPanel reloadKey={panelReloadKey} />
        </>
      )}
    </WorkspaceShell>
  );
}
