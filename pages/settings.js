/**
 * หน้า: /settings — P4 · reports-settings
 * เกณฑ์สุขภาพงบประมาณ 4 ค่า editable ต่อผู้ใช้ persist เป็น budgetThresholds บน user document เดียวกับ
 * bankAccounts (ผ่าน /api/user-bank-accounts ตัวเดิม ไม่มี endpoint ใหม่ — ADR-016) — เงินออมเป็นค่า
 * derived ไม่ใช่ editable อีกต่อไป (ADR-017 §2, ดูรายละเอียดที่ BudgetThresholdForm.js)
 *
 * Save-per-action พร้อม toast (ไม่มี Save All เพราะหน้านี้ไม่ผูกกับเดือน — ตาม ADR-008)
 * เมื่อบันทึกสำเร็จ ตั้ง localStorage signal ให้ Dashboard toast รับทราบครั้งเดียวตอนโหลดครั้งถัดไป
 * (§Threshold-change signal, AC-RS-31) — ปิดความกำกวมว่าแถบสีที่เปลี่ยนบน Dashboard มาจาก "เปลี่ยนเกณฑ์
 * เอง" ไม่ใช่ "พฤติกรรมใช้จ่ายเปลี่ยน" (UX Review)
 *
 * Graphite redesign (/settings pass) — Tailwind only, ไม่ import Settings.module.css อีกต่อไป (ลบไฟล์
 * นั้นในพาสนี้ — task-size-settings-graphite.md §Effort Estimate Step 2/3) ไม่มี padding/max-width ของ
 * ตัวเอง — Layout.js's <main> ให้ทั้งสองอย่างอยู่แล้ว (เหมือนที่ pages/reports.js ทำ) ฟอร์มสั้น
 * จึงจำกัด max-width ไว้ที่ 2xl เอง (UX_SPEC §9 "อินพุตสั้น จับคู่กับแถบที่อัปเดตสด")
 */

import { useCallback, useEffect, useState } from 'react';
import Layout from '../src/frontend/components/Layout';
import BudgetThresholdForm from '../src/frontend/components/BudgetThresholdForm';
import { useSession } from '../src/frontend/contexts/SessionContext';
import { userSettingsAPI } from '../src/shared/utils/frontend/apiUtils';
import { DEFAULT_BUDGET_THRESHOLDS } from '../src/shared/utils/frontend/monthlySummary';
import { showToast } from '../src/shared/utils/frontend/toast';

const CARD = 'rounded-md border border-border-default bg-surface-1 p-space-4 shadow-elev-1 md:p-space-5';

export default function SettingsPage() {
  const { currentUser } = useSession();
  const [thresholds, setThresholds] = useState(DEFAULT_BUDGET_THRESHOLDS);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [monthlySummaryEnabled, setMonthlySummaryEnabled] = useState(true);
  const [savingNotification, setSavingNotification] = useState(false);

  // ยังไม่ได้บันทึกแล้วกดออกจากหน้า — เตือนด้วย native confirm (ฟอร์มเดียว ค่าเดียว ไม่คุ้มสร้างโมดัล
  // เต็มรูปแบบแบบ UnsavedChangesDialog ของ /workspace ที่ออกแบบมาสำหรับ 7 section พร้อมกัน)
  const handleBeforeNavigate = useCallback(() => {
    if (!isDirty) return true;
    return window.confirm('เกณฑ์ที่แก้ไว้ยังไม่ได้บันทึก ถ้าออกตอนนี้การแก้ไขจะหายไป ต้องการออกหรือไม่?');
  }, [isDirty]);

  const loadThresholds = useCallback(async () => {
    if (!currentUser) return;
    setLoading(true);
    setLoadFailed(false);
    try {
      const data = await userSettingsAPI.get();
      setThresholds(data?.budgetThresholds || DEFAULT_BUDGET_THRESHOLDS);
      setMonthlySummaryEnabled(data?.monthlySummaryEnabled !== false);
    } catch (error) {
      console.error('Failed to load budget thresholds:', error);
      setThresholds(DEFAULT_BUDGET_THRESHOLDS);
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, [currentUser]);

  useEffect(() => {
    loadThresholds();
  }, [loadThresholds]);

  const handleSave = async (nextThresholds) => {
    setSaving(true);
    try {
      await userSettingsAPI.saveThresholds(nextThresholds);
      setThresholds(nextThresholds);
      showToast('บันทึกเกณฑ์แล้ว');
      // one-time signal — Dashboard toast ครั้งเดียวตอนโหลดครั้งถัดไป แล้วลบตัวเองทิ้ง (E16/E17)
      if (typeof window !== 'undefined' && currentUser?.id) {
        localStorage.setItem(`budgetThresholds_justUpdated_${currentUser.id}`, '1');
      }
      return true;
    } catch (error) {
      console.error('Failed to save budget thresholds:', error);
      showToast('บันทึกเกณฑ์ไม่สำเร็จ', 'error');
      return false;
    } finally {
      setSaving(false);
    }
  };

  const handleMonthlySummaryToggle = async (event) => {
    const enabled = event.target.checked;
    setMonthlySummaryEnabled(enabled);
    setSavingNotification(true);
    try {
      await userSettingsAPI.saveMonthlySummaryEnabled(enabled);
      showToast('บันทึกการตั้งค่าแล้ว');
    } catch (error) {
      setMonthlySummaryEnabled(!enabled);
      showToast('บันทึกไม่สำเร็จ', 'error');
    } finally {
      setSavingNotification(false);
    }
  };

  return (
    <Layout activeNav="settings" title="ตั้งค่า" onBeforeNavigate={handleBeforeNavigate}>
      <div className="flex w-full max-w-2xl flex-col gap-space-5">
        <section className={CARD}>
          <h2 className="m-0 text-xl font-semibold text-primary">เกณฑ์สุขภาพงบประมาณ</h2>
          <p className="m-0 mt-space-2 text-sm text-secondary">เมื่อยอดใช้จ่ายหรือเงินออมของเดือนข้ามเกณฑ์ที่ตั้งไว้ แถบสถานะในหน้าภาพรวมจะเปลี่ยนสี เพื่อเตือนให้คุณรู้ทันที</p>
          <p className="m-0 mb-space-4 mt-space-1 text-sm text-secondary">เงินเหลือของเดือนยืนยันเพิ่มเข้าเงินออมได้จากหน้าภาพรวมเช่นกัน</p>

          <BudgetThresholdForm
            values={thresholds}
            loading={loading}
            loadFailed={loadFailed}
            saving={saving}
            onSave={handleSave}
            onRetryLoad={loadThresholds}
            onDirtyChange={setIsDirty}
          />
        </section>

        <section className={CARD}>
          <h2 className="m-0 text-xl font-semibold text-primary">สรุปการเงินทาง LINE</h2>
          <label className="mt-space-4 flex min-h-16 cursor-pointer items-center gap-space-3 rounded-sm border border-border-default bg-surface-2 p-space-3">
            <input
              className="peer sr-only"
              type="checkbox"
              checked={monthlySummaryEnabled}
              onChange={handleMonthlySummaryToggle}
              disabled={savingNotification || loading}
            />
            <span
              aria-hidden="true"
              className="relative inline-flex h-[26px] w-11 shrink-0 items-center rounded-full bg-border-default transition-colors duration-base peer-checked:bg-accent peer-checked:[&>span]:translate-x-[21px] peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-accent peer-focus-visible:outline-offset-2"
            >
              <span className="h-5 w-5 translate-x-[3px] rounded-full bg-primary transition-transform duration-base" />
            </span>
            <span className="flex flex-col">
              <strong className="text-sm font-semibold text-primary">ส่งสรุปการเงินอัตโนมัติทุกสิ้นเดือน</strong>
              <small className="text-xs text-secondary">{monthlySummaryEnabled ? 'เปิดใช้งานอยู่' : 'ปิดใช้งานอยู่'}</small>
            </span>
          </label>
          <p className="m-0 mt-space-3 text-sm text-secondary">ส่งวันสุดท้ายของเดือน เวลา 20:00 น. ให้ LINE ที่เชื่อมกับโปรไฟล์นี้ (ตั้งค่าแยกตามผู้ใช้)</p>
        </section>
      </div>
    </Layout>
  );
}
