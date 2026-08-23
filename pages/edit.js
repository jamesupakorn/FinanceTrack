import { useEffect } from 'react';
import { useRouter } from 'next/router';
import { showToast } from '../src/shared/utils/frontend/toast';

// pages/edit.js — redirect shim. /edit ย้ายไปที่ /workspace แล้ว (ADR-014, P3 · monthly-workspace)
// คงหน้านี้ไว้ (ไม่ลบเส้นทาง) เพื่อให้ bookmark เดิม, ทางลัด PWA และลิงก์เก่าที่ค้างอยู่ยังใช้งานได้
export default function EditRedirect() {
  const router = useRouter();

  useEffect(() => {
    if (!router.isReady) return;
    // แจ้งเตือนครั้งเดียวก่อนพาไป /workspace กันผู้ใช้ที่ bookmark หน้านี้ไว้งงว่า URL เปลี่ยนไปเอง
    // (UX Review — effect นี้ทำงานแค่ตอน router.isReady เปลี่ยนสถานะ ไม่ใช่ทุก render)
    showToast('ย้ายไปหน้าบันทึกรายเดือน', 'info');
    router.replace({ pathname: '/workspace', query: router.query });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router.isReady]);

  return null;
}
