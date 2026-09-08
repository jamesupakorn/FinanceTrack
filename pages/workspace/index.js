import { useEffect } from 'react';
import { useRouter } from 'next/router';
import { resolveLegacyWorkspaceHref } from '../../src/shared/utils/frontend/workspaceRoutes';

// pages/workspace/index.js — redirect shim. /workspace เฉย ๆ (ไม่ระบุ section) พาไป /workspace/income
// เสมอ (Amendment A5) นี่คือ canonicalization ภายในฟีเจอร์เดียวกัน ไม่ใช่การย้ายที่อยู่ข้ามฟีเจอร์แบบ
// /edit หรือ /salary — ชื่อหน้ายังเป็น "บันทึกรายเดือน" เหมือนเดิม จึงไม่มี toast (ต่างจาก /edit, /salary
// ที่ toast เพราะฟีเจอร์ย้ายที่อยู่จริง ๆ) — AC-A5-6
export default function WorkspaceIndexRedirect() {
  const router = useRouter();

  useEffect(() => {
    if (!router.isReady) return;
    router.replace(resolveLegacyWorkspaceHref(router.query));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router.isReady]);

  return null;
}
