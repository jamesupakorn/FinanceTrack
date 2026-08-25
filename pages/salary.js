import { useEffect } from 'react';
import { useRouter } from 'next/router';
import { showToast } from '../src/shared/utils/frontend/toast';

// pages/salary.js — redirect shim. คำนวณเงินเดือนย้ายกลับไปอยู่ในแท็บ "รายรับ" ของ /workspace แล้ว
// (Amendment A3, ยกเลิกแผนหน้าแยก /salary ของ Amendment A1) คงเส้นทางนี้ไว้ (ไม่ลบ) เพื่อให้ bookmark
// เดิม/ลิงก์เก่าที่ค้างอยู่ยังพาไปถูกที่ — แพทเทิร์นเดียวกับ pages/edit.js
export default function SalaryRedirect() {
  const router = useRouter();

  useEffect(() => {
    if (!router.isReady) return;
    showToast('ย้ายไปอยู่ในแท็บรายรับแล้ว', 'info');
    router.replace({ pathname: '/workspace', query: { tab: 'income', salary: 'open' } });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router.isReady]);

  return null;
}
