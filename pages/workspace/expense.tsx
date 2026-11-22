import { useState } from 'react';
import { useRouter } from 'next/router';
import WorkspaceShell from '../../src/frontend/components/WorkspaceShell';
import ExpenseTable from '../../src/frontend/components/ExpenseTable';

export default function WorkspaceExpensePage() {
  const router = useRouter();
  // S1 (dashboard-upcoming-click-to-view): ?focus=<key>&month=<M> มาจาก dashboard (ต่อใน S3) — รอ router.isReady
  // ก่อนอ่าน query เพื่อไม่ให้ token คำนวณจาก query ที่ยังไม่พร้อม (ค่า undefined ชั่วคราวระหว่าง hydrate)
  const focusParam = router.isReady && typeof router.query.focus === 'string' ? router.query.focus : null;
  const monthParam = router.isReady && typeof router.query.month === 'string' ? router.query.month : null;
  // marker ระดับหน้า: กัน remount ของ ExpenseTable (refreshTrigger) ขณะ ?focus= ยังอยู่ใน URL ไม่ให้ scroll ซ้ำ (E-5)
  const [consumed, setConsumed] = useState<string | null>(null);
  const token = focusParam && monthParam ? `${monthParam}|${focusParam}` : null;

  return (
    <WorkspaceShell section="expense">
      {({ selectedMonth, refreshTrigger, registerSave, markClean, markDirty }) => (
        <ExpenseTable
          selectedMonth={selectedMonth}
          onRegisterSave={registerSave}
          onSaved={markClean}
          markDirty={markDirty}
          focusKey={token && token !== consumed ? focusParam : null}
          focusMonth={monthParam}
          onFocusHandled={() => setConsumed(token)}
          key={`expense-${refreshTrigger}`}
        />
      )}
    </WorkspaceShell>
  );
}
