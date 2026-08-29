import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import WorkspaceShell from '../../src/frontend/components/WorkspaceShell';
import IncomeTable from '../../src/frontend/components/IncomeTable';
import SalaryModal from '../../src/frontend/components/SalaryModal';

// ข้อความ guard เฉพาะของหน้านี้ — คนละชุดกับตอนออกจากหน้า (leaveCopy ทั่วไปของ WorkspaceShell) เพราะ
// สาเหตุที่ข้อมูลหายต่างกัน: ที่นี่ modal เงินเดือนจะเขียนทับแถวรายรับอื่นที่พิมพ์ค้างไว้ ไม่ใช่แค่ "ออกจากหน้า"
// (E26, สืบทอดมาจาก A3's E9 — modal บันทึกสำเร็จแล้วจะยิง salaryUpdateTrigger ให้ IncomeTable รีเฟรชค่าทั้งแถว)
const SALARY_MODAL_GUARD_COPY = 'ข้อมูลรายรับที่แก้ไว้ยังไม่ได้บันทึก ถ้าเปิดเครื่องคำนวณเงินเดือนตอนนี้ ค่าที่พิมพ์ค้างไว้จะถูกเขียนทับ';

export default function WorkspaceIncomePage() {
  const router = useRouter();
  const [salaryModalOpen, setSalaryModalOpen] = useState(false);
  // salaryUpdateTrigger กลับมาเป็น local ของหน้านี้ล้วน ๆ (A5) — เดิม P3/A3 อยู่ที่ pages/workspace.js
  // เพราะ IncomeTable กับ TaxTable share หน้าเดียวกัน ตอนนี้แยกคนละ route แล้ว TaxTable ไม่มีทางผลิต/รับ
  // ค่านี้ได้อีก (ดู pages/workspace/tax.js — ไม่ส่ง prop นี้ให้ TaxTable เลย)
  const [salaryUpdateTrigger, setSalaryUpdateTrigger] = useState(0);

  const handleSalaryModalSaved = () => {
    setSalaryUpdateTrigger(prev => prev + 1);
    setSalaryModalOpen(false);
  };

  // ทางเข้า modal เงินเดือนจากลิงก์ภายนอก (Dashboard Quick Action, ลิงก์ท้าย /reports) ผ่าน
  // ?salary=open — ตัดออกจาก URL "ตอนเปิด" ทันที ไม่ใช่ตอนปิด (E25/เดิม E16) กัน reload ระหว่าง modal
  // เปิดอยู่แล้วเปิดซ้ำ — อ่าน window.location.search สด ๆ แทน router.query ตอนตัด param เพราะ
  // WorkspaceShell (child ในทรีนี้) อาจกำลัง resolve ?month= ในจังหวะเดียวกันอยู่ (คนละ effect, คนละ
  // component) การอ่าน URL จริงจากเบราว์เซอร์ตรง ๆ กันสองฝั่งเขียนทับกันเอง — effect ของ child (เชลล์)
  // commit ก่อน effect ของ parent (หน้านี้) เสมอตามลำดับของ React เสมอ ไม่ว่า fetch เดือนจะช้าแค่ไหน
  useEffect(() => {
    if (!router.isReady) return;
    if (router.query.salary !== 'open') return;
    setSalaryModalOpen(true);
    const params = new URLSearchParams(window.location.search);
    params.delete('salary');
    router.replace(
      { pathname: router.pathname, query: Object.fromEntries(params) },
      undefined,
      { shallow: true }
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router.isReady, router.query.salary]);

  return (
    <WorkspaceShell
      section="income"
      overlay={({ selectedMonth }) => (
        <SalaryModal
          open={salaryModalOpen}
          selectedMonth={selectedMonth}
          onClose={() => setSalaryModalOpen(false)}
          onSaved={handleSalaryModalSaved}
        />
      )}
    >
      {({ selectedMonth, refreshTrigger, registerSave, markClean, guard }) => (
        <IncomeTable
          selectedMonth={selectedMonth}
          salaryUpdateTrigger={salaryUpdateTrigger}
          onRegisterSave={registerSave}
          onSaved={markClean}
          onOpenSalaryModal={() => guard(() => setSalaryModalOpen(true), SALARY_MODAL_GUARD_COPY)}
          key={`income-${refreshTrigger}`}
        />
      )}
    </WorkspaceShell>
  );
}
