/**
 * หน้า: /settings — P4 · reports-settings
 * เกณฑ์สุขภาพงบประมาณ 5 ค่า editable ต่อผู้ใช้ persist เป็น budgetThresholds บน user document เดียวกับ
 * bankAccounts (ผ่าน /api/user-bank-accounts ตัวเดิม ไม่มี endpoint ใหม่ — ADR-016)
 *
 * Save-per-action พร้อม toast (ไม่มี Save All เพราะหน้านี้ไม่ผูกกับเดือน — ตาม ADR-008)
 * เมื่อบันทึกสำเร็จ ตั้ง localStorage signal ให้ Dashboard toast รับทราบครั้งเดียวตอนโหลดครั้งถัดไป
 * (§Threshold-change signal, AC-RS-31) — ปิดความกำกวมว่าแถบสีที่เปลี่ยนบน Dashboard มาจาก "เปลี่ยนเกณฑ์
 * เอง" ไม่ใช่ "พฤติกรรมใช้จ่ายเปลี่ยน" (UX Review)
 */

import { useCallback, useEffect, useState } from 'react';
import Layout from '../src/frontend/components/Layout';
import BudgetThresholdForm from '../src/frontend/components/BudgetThresholdForm';
import { useSession } from '../src/frontend/contexts/SessionContext';
import { userSettingsAPI } from '../src/shared/utils/frontend/apiUtils';
import { DEFAULT_BUDGET_THRESHOLDS } from '../src/shared/utils/frontend/monthlySummary';
import { showToast } from '../src/shared/utils/frontend/toast';
import styles from '../src/frontend/styles/Settings.module.css';

export default function SettingsPage() {
  const { currentUser } = useSession();
  const [thresholds, setThresholds] = useState(DEFAULT_BUDGET_THRESHOLDS);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saving, setSaving] = useState(false);

  const loadThresholds = useCallback(async () => {
    if (!currentUser) return;
    setLoading(true);
    setLoadFailed(false);
    try {
      const data = await userSettingsAPI.get();
      setThresholds(data?.budgetThresholds || DEFAULT_BUDGET_THRESHOLDS);
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

  return (
    <Layout activeNav="settings" title="ตั้งค่า">
      <section className={styles.settingsSection}>
        <h2 className={styles.sectionTitle}>เกณฑ์สุขภาพงบประมาณ</h2>
        <p className={styles.sectionHint}>เมื่อยอดใช้จ่ายหรือเงินออมของเดือนข้ามเกณฑ์ที่ตั้งไว้ แถบสถานะในหน้าภาพรวมจะเปลี่ยนสี เพื่อเตือนให้คุณรู้ทันที</p>
        <p className={styles.sectionHint}>เงินเหลือของเดือนยืนยันเพิ่มเข้าเงินออมได้จากหน้าภาพรวมเช่นกัน</p>

        <BudgetThresholdForm
          values={thresholds}
          loading={loading}
          loadFailed={loadFailed}
          saving={saving}
          onSave={handleSave}
          onRetryLoad={loadThresholds}
        />
      </section>
    </Layout>
  );
}
