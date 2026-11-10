import { useEffect } from 'react';
import { useRouter } from 'next/router';
import { showToast } from '../src/shared/utils/frontend/toast';

// pages/credit-cards.tsx — redirect shim. /credit-cards ย้ายไปที่ /credits แล้ว (ADR-035)
// คงหน้านี้ไว้ (ไม่ลบเส้นทาง) เพื่อให้ bookmark เดิม, ทางลัด PWA และลิงก์เก่าที่ค้างอยู่ยังใช้งานได้
// ต้องไม่ลบออกโดยไม่มีการตัดสินใจแยกต่างหาก
export default function CreditCardsRedirect() {
  const router = useRouter();

  useEffect(() => {
    if (!router.isReady) return;
    showToast('ย้ายไปหน้าบัตร & สินเชื่อ', 'info');
    router.replace({ pathname: '/credits', query: router.query });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router.isReady]);

  return null;
}
