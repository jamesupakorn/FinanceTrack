/**
 * workspaceRoutes.js
 * ตารางแมป "section ↔ path" เดียวของทั้งฟีเจอร์ /workspace (Amendment A5 · monthly-workspace)
 * ผู้ใช้: pages/workspace/index.js, pages/edit.js และ WorkspaceShell.js — ห้ามมีสำเนาที่สอง
 * (spec-monthly-workspace.md §Amendment A5 §Files: "หนึ่งตาราง สามจุดเรียกใช้ — สำเนาที่สองที่ไหน
 * ก็ตามถือว่า review ไม่ผ่าน")
 */

// เจ็ด section ที่มีจริง — path/หัวข้อ/ป้ายปุ่มบันทึกของแต่ละหน้า
export const WORKSPACE_SECTIONS = {
  income: { path: '/workspace/income', heading: 'รายได้ของเดือน', saveLabel: 'บันทึกรายรับ' },
  expense: { path: '/workspace/expense', heading: 'บิลและรายจ่ายของเดือน', saveLabel: 'บันทึกรายจ่าย' },
  savings: { path: '/workspace/savings', heading: 'เงินออมของเดือน', saveLabel: 'บันทึกเงินออม' },
  goals: { path: '/workspace/savings/goals', heading: 'เป้าหมายเงินออม', saveLabel: 'บันทึกสัดส่วนเงินออม' },
  investment: { path: '/workspace/savings/investment', heading: 'การลงทุนของเดือน', saveLabel: 'บันทึกการลงทุน' },
  daily: { path: '/workspace/daily', heading: 'ค่าใช้จ่ายรายวัน', saveLabel: 'บันทึกรายจ่ายรายวัน' },
  tax: { path: '/workspace/tax', heading: 'ภาษีรายเดือน', saveLabel: 'บันทึกภาษี' }
};

// เดิม TAB_IDS ของ P3 มีแค่ 5 ค่า ไม่มี 'investment'/'goals' เลย (verified: workspace.js:30 ก่อนแก้)
// ตารางแมป ?tab= (เก่า) → section (ใหม่) จึงมีแค่ 5 แถว ไม่มี orphan case
const LEGACY_TAB_TO_SECTION = {
  income: 'income',
  expense: 'expense',
  savings: 'savings',
  daily: 'daily',
  tax: 'tax'
};

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * สร้าง href ของ section หนึ่ง พร้อม ?month= (ถ้ามี) — ทุกลิงก์นำทางในฟีเจอร์นี้พก ?month= ติดไปด้วยเสมอ
 * เพื่อให้เปลี่ยน section ไม่เปลี่ยนเดือน (spec §Interaction notes — A5)
 */
export function sectionHref(section, month) {
  const entry = WORKSPACE_SECTIONS[section] || WORKSPACE_SECTIONS.income;
  if (month && MONTH_RE.test(month)) {
    return `${entry.path}?month=${encodeURIComponent(month)}`;
  }
  return entry.path;
}

/**
 * แปลง query แบบเก่า (?tab=, ?salary=open, ?month=) ให้เป็น path ใหม่ในฟีเจอร์นี้ — ใช้โดย
 * pages/workspace/index.js (คืน path เดียวกัน แค่ canonicalize, ไม่มี toast) และ pages/edit.js
 * (toast แล้วค่อย redirect) กติกาตามตาราง §Shims and legacy compatibility ของสเปก:
 * - salary=open มาก่อนเสมอ ไม่ว่า tab จะเป็นอะไร (E17/D-4 เดิม)
 * - tab ที่รู้จัก → section ที่ตรงกัน, ไม่รู้จัก/ไม่มี → 'income' (fallback เดิมของ E3)
 * - month=YYYY-MM (ถ้ามี) ติดไปกับ path ที่ resolve ได้เสมอ
 */
export function resolveLegacyWorkspaceHref(query = {}) {
  const { tab, salary, month } = query || {};
  const params = new URLSearchParams();
  if (typeof month === 'string' && MONTH_RE.test(month)) {
    params.set('month', month);
  }

  if (salary === 'open') {
    params.set('salary', 'open');
    const qs = params.toString();
    return `${WORKSPACE_SECTIONS.income.path}${qs ? `?${qs}` : ''}`;
  }

  const section = LEGACY_TAB_TO_SECTION[tab] || 'income';
  const qs = params.toString();
  return `${WORKSPACE_SECTIONS[section].path}${qs ? `?${qs}` : ''}`;
}
