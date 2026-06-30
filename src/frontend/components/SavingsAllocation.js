/**
 * คอมโพเนนต์: SavingsAllocation
 * กำหนดสัดส่วนการแบ่งเงินออมเป็น % ต่อถัง
 * @param {object} props
 * @param {number} props.monthlySavingsTotal - ยอดรวมเงินออมเดือนนี้ จาก SavingsTable
 * @param {number} props.triggerSave         - counter เพิ่มขึ้นทุกครั้งที่ Save All ถูกกด
 */

import { useState, useEffect, useMemo } from 'react';
import { savingsAllocationAPI } from '../../shared/utils/frontend/apiUtils';
import { formatCurrency } from '../../shared/utils/frontend/numberUtils';
import { showToast } from '../../shared/utils/frontend/toast';
import { Icons } from './Icons';
import styles from '../styles/SavingsAllocation.module.css';

const MAX_BUCKETS = 20;

export default function SavingsAllocation({ monthlySavingsTotal = 0, triggerSave }) {
  const [buckets, setBuckets] = useState([]);
  const [loading, setLoading] = useState(false);

  // โหลดข้อมูลเมื่อ mount
  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const data = await savingsAllocationAPI.get();
        if (!cancelled) {
          setBuckets(Array.isArray(data?.buckets) ? data.buckets : []);
        }
      } catch (err) {
        console.error('[SavingsAllocation] load error:', err);
        if (!cancelled) setBuckets([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  // triggerSave pattern — เหมือน SavingsTable.js:167-171
  useEffect(() => {
    if (triggerSave) {
      handleSave();
    }
  }, [triggerSave]);

  // คำนวณ read-only (ไม่ store)
  const totalPercent = useMemo(
    () => buckets.reduce((s, b) => s + (Number(b.percentage) || 0), 0),
    [buckets]
  );
  const isBalanced = Math.abs(totalPercent - 100) < 0.01;

  const computedBuckets = useMemo(
    () => buckets.map(b => ({
      ...b,
      amount: monthlySavingsTotal * ((Number(b.percentage) || 0) / 100)
    })),
    [buckets, monthlySavingsTotal]
  );

  // ────────────────────────────────────────────────────────
  // Handlers
  // ────────────────────────────────────────────────────────

  function handleAddBucket() {
    if (buckets.length >= MAX_BUCKETS) return;
    setBuckets(prev => [
      ...prev,
      {
        id: `new-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        name: '',
        percentage: 0
      }
    ]);
  }

  function handleBucketChange(index, field, value) {
    setBuckets(prev => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  }

  function handleDeleteBucket(index) {
    setBuckets(prev => prev.filter((_, i) => i !== index));
  }

  async function handleSave() {
    // Validate ก่อนบันทึก
    for (let i = 0; i < buckets.length; i++) {
      const name = typeof buckets[i].name === 'string' ? buckets[i].name.trim() : '';
      if (!name) {
        showToast('กรุณากรอกชื่อถังให้ครบ', 'error');
        return;
      }
      const pct = Number(buckets[i].percentage);
      if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
        showToast(`% ต้องอยู่ระหว่าง 0–100 (ถัง "${buckets[i].name || i + 1}")`, 'error');
        return;
      }
    }

    try {
      await savingsAllocationAPI.save(buckets);
      showToast('บันทึกสัดส่วนการออมสำเร็จ');
    } catch (err) {
      console.error('[SavingsAllocation] save error:', err);
      showToast('บันทึกสัดส่วนการออมไม่สำเร็จ', 'error');
    }
  }

  // ────────────────────────────────────────────────────────
  // Render helpers
  // ────────────────────────────────────────────────────────

  const percentSummary = isBalanced
    ? <span className={styles.percentOk}>{totalPercent.toFixed(2)}% ✓</span>
    : (
      <span className={totalPercent > 100 ? styles.percentOver : styles.percentWarn}>
        {totalPercent.toFixed(2)}% ⚠ ควรรวมได้ 100%
      </span>
    );

  return (
    <div className={styles.allocationSection}>
      {/* Header */}
      <div className={styles.sectionTitle}>
        <h4 className={styles.titleText}>
          <Icons.Target size={20} color="var(--secondary-color)" />
          สัดส่วนการออม
        </h4>
        <button
          onClick={handleAddBucket}
          className={styles.addButton}
          disabled={buckets.length >= MAX_BUCKETS}
          title={buckets.length >= MAX_BUCKETS ? `สูงสุด ${MAX_BUCKETS} ถัง` : 'เพิ่มถัง'}
        >
          <Icons.Plus size={16} color="white" />
          {buckets.length >= MAX_BUCKETS ? `เพิ่มถัง (${buckets.length}/${MAX_BUCKETS})` : 'เพิ่มถัง'}
        </button>
      </div>

      {/* Meta row */}
      <div className={styles.metaRow}>
        <span className={styles.metaLabel}>ยอดออมเดือนนี้:</span>
        <span className={styles.metaValue}>{formatCurrency(monthlySavingsTotal)}</span>
        <span className={styles.metaLabel}>ผลรวม:</span>
        <span className={styles.metaValue}>{percentSummary}</span>
      </div>

      {/* Warning banner when unbalanced */}
      {buckets.length > 0 && !isBalanced && (
        <div
          className={totalPercent > 100 ? styles.bannerOver : styles.bannerWarn}
          role="alert"
          aria-live="polite"
        >
          {totalPercent > 100
            ? `ผลรวมสัดส่วน ${totalPercent.toFixed(2)}% เกิน 100% — ยอดที่คำนวณจะเกินจริง`
            : `ผลรวมสัดส่วน ${totalPercent.toFixed(2)}% (ควรรวมได้ 100%)`}
        </div>
      )}

      {loading && <div className={styles.loadingState}>กำลังโหลด...</div>}

      {/* Empty state */}
      {!loading && buckets.length === 0 && (
        <div className={styles.emptyState}>
          ยังไม่มีสัดส่วนการออม กดเพิ่มถังเพื่อเริ่มต้น
        </div>
      )}

      {/* Progress bar */}
      {buckets.length > 0 && (
        <div
          className={styles.progressTrack}
          role="progressbar"
          aria-valuenow={Math.min(100, totalPercent)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`ผลรวมสัดส่วน ${totalPercent.toFixed(2)}%`}
        >
          <div
            className={`${styles.progressFill} ${totalPercent > 100 ? styles.progressOver : isBalanced ? styles.progressOk : ''}`}
            style={{ width: `${Math.min(100, totalPercent)}%` }}
          />
        </div>
      )}

      {/* Desktop table */}
      {buckets.length > 0 && (
        <div className={`${styles.tableContainer} ${styles.hideOnMobile}`}>
          <table className={styles.table}>
            <thead className={styles.tableHeader}>
              <tr>
                <th className={styles.tableHeaderCell}>ชื่อถัง</th>
                <th className={styles.tableHeaderCell}>% สัดส่วน</th>
                <th className={styles.tableHeaderCell}>ยอดที่ได้</th>
                <th className={styles.tableHeaderCell}>การจัดการ</th>
              </tr>
            </thead>
            <tbody>
              {computedBuckets.map((b, index) => (
                <tr key={b.id} className={styles.tableRow}>
                  <td className={styles.tableCell}>
                    <input
                      type="text"
                      value={b.name}
                      onChange={e => handleBucketChange(index, 'name', e.target.value)}
                      placeholder="ชื่อถัง เช่น Wedding"
                      className={styles.bucketInput}
                    />
                  </td>
                  <td className={styles.tableCell}>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={b.percentage}
                      onChange={e => handleBucketChange(index, 'percentage', e.target.value)}
                      placeholder="0"
                      className={`${styles.bucketInput} ${styles.percentInput}`}
                    />
                  </td>
                  <td className={`${styles.tableCell} ${styles.amountCell}`}>
                    {formatCurrency(b.amount)}
                  </td>
                  <td className={`${styles.tableCell} ${styles.center}`}>
                    <button
                      onClick={() => handleDeleteBucket(index)}
                      className={styles.deleteButton}
                      aria-label={`ลบถัง ${b.name || index + 1}`}
                    >
                      <Icons.Trash size={14} color="white" />
                      ลบ
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Mobile cards */}
      {buckets.length > 0 && (
        <div className={`${styles.mobileCardList} ${styles.hideOnDesktop}`}>
          {computedBuckets.map((b, index) => (
            <div key={b.id} className={styles.bucketCard}>
              <div className={styles.cardTopRow}>
                <input
                  type="text"
                  value={b.name}
                  onChange={e => handleBucketChange(index, 'name', e.target.value)}
                  placeholder="ชื่อถัง เช่น Wedding"
                  className={styles.bucketInput}
                />
                <button
                  onClick={() => handleDeleteBucket(index)}
                  className={styles.deleteButtonSmall}
                  aria-label={`ลบถัง ${b.name || index + 1}`}
                >
                  ✕
                </button>
              </div>
              <div className={styles.cardMeta}>
                <label className={styles.cardLabel}>% สัดส่วน</label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={b.percentage}
                  onChange={e => handleBucketChange(index, 'percentage', e.target.value)}
                  placeholder="0"
                  className={`${styles.bucketInput} ${styles.percentInput}`}
                />
              </div>
              <div className={styles.cardAmount}>
                <span className={styles.cardLabel}>ยอดที่ได้:</span>
                <span className={styles.amountValue}>{formatCurrency(b.amount)}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
