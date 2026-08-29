import WorkspaceShell from '../../src/frontend/components/WorkspaceShell';
import TaxTable from '../../src/frontend/components/TaxTable';

// TaxTable ไม่ได้รับ salaryUpdateTrigger อีกต่อไป — ไม่มีอะไรบน /workspace/tax ผลิตค่านี้ได้ (ผู้ผลิต
// ตัวเดียวคือ modal เงินเดือนที่อยู่บน /workspace/income คนละ route แล้ว) ปล่อย prop ว่างไว้เฉย ๆ ก็พอ:
// effect ของ TaxTable ที่ dep เป็น salaryUpdateTrigger (TaxTable.js:194) จะได้ undefined ที่เสถียร
// (ไม่เปลี่ยนค่า) effect จึงรันแค่ตอน mount เท่านั้น ซึ่งเป็นการรีเฟรชที่มันต้องการอยู่แล้วพอดี — ไม่ต้อง
// แก้ TaxTable.js เพิ่มนอกเหนือจาก 3 hunks มาตรฐาน (spec §The seven-component edit — TaxTable note)
export default function WorkspaceTaxPage() {
  return (
    <WorkspaceShell section="tax">
      {({ selectedMonth, refreshTrigger, registerSave, markClean }) => (
        <TaxTable
          selectedMonth={selectedMonth}
          onRegisterSave={registerSave}
          onSaved={markClean}
          key={`tax-${refreshTrigger}`}
        />
      )}
    </WorkspaceShell>
  );
}
