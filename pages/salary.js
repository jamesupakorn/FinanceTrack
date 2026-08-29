import { useEffect } from 'react';
import { useRouter } from 'next/router';
import { showToast } from '../src/shared/utils/frontend/toast';

// pages/salary.js — redirect shim. คำนวณเงินเดือนย้ายกลับไปอยู่ในแท็บ "รายรับ" ของ /workspace แล้ว
// (Amendment A3, ยกเลิกแผนหน้าแยก /salary ของ Amendment A1) คงเส้นทางนี้ไว้ (ไม่ลบ) เพื่อให้ bookmark
// เดิม/ลิงก์เก่าที่ค้างอยู่ยังพาไปถูกที่ — แพทเทิร์นเดียวกับ pages/edit.js
// ปลายทางย้ายจาก /workspace?tab=income&salary=open ไปเป็น /workspace/income?salary=open โดยตรงแล้ว
// (Amendment A5 — เส้นทางเดียว ไม่ต้องเด้งผ่าน pages/workspace/index.js อีกต่อ) ข้อความ toast คงเดิม
// ("แท็บ" ไม่ตรงกับ UI ใหม่แล้วก็จริง แต่จงใจไม่แก้คำ — ดู spec-monthly-workspace.md §Shims)
export default function SalaryRedirect() {
  const router = useRouter();

  useEffect(() => {
    if (!router.isReady) return;
    showToast('ย้ายไปอยู่ในแท็บรายรับแล้ว', 'info');
    router.replace('/workspace/income?salary=open');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router.isReady]);

  return null;
}
