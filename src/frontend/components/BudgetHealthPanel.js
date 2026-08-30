/**
 * คอมโพเนนต์: BudgetHealthPanel
 * 4 แถวสุขภาพงบประมาณ + rollup — อ่านจาก evaluateBudgetHealth() ล้วน ไม่คำนวณเกณฑ์เอง (BR-DASH-005)
 *
 * Collapsible ตาม §UX Review ของ spec-dashboard.md — พับเก็บเป็นค่าเริ่มต้นเสมอทั้งมือถือและเดสก์ท็อป
 * ใช้แพทเทิร์น header+chevron+aria-expanded เดียวกับ SalaryCalculator/SummaryReport ใน pages/edit.js
 * (ไม่ได้คิดรูปแบบใหม่) รายบรรทัด rollup ยังโผล่ในหัวข้อตอนพับอยู่เสมอ (AC-DB-29)
 *
 * ข้อความ/label ของแต่ละแถวอ่านจาก row.statusLabel / health.rollupMessage ที่โมเดลคำนวณมาให้ตรง ๆ
 * (ไม่ re-derive ข้อความเอง) — ไอคอน/สีเลือกจาก row.status (คีย์ภาษาอังกฤษ) ตามตาราง UX_SPEC §Budget health
 */

import { useEffect, useState } from 'react';
import { evaluateBudgetHealth } from '../../shared/utils/frontend/monthlySummary';
import { formatCurrency } from '../../shared/utils/frontend/numberUtils';
import { Icons } from './Icons';
import styles from '../styles/Dashboard.module.css';

const STATUS_META = {
  ok: { Icon: Icons.Check, color: 'var(--secondary-color)' },
  near: { Icon: Icons.AlertTriangle, color: 'var(--warning-color)' },
  over: { Icon: Icons.TrendingUp, color: 'var(--danger-color)' },
  critical: { Icon: Icons.AlertTriangle, color: 'var(--danger-color)' },
  'on-target': { Icon: Icons.Check, color: 'var(--secondary-color)' },
  'below-target': { Icon: Icons.TrendingDown, color: 'var(--warning-color)' }
};

function sanitizeNumber(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return num === 0 ? 0 : num;
}

function BudgetRow({ row }) {
  const meta = STATUS_META[row.status] || STATUS_META.ok;
  const { Icon } = meta;
  const thresholdText = row.kind === 'max' ? `เกณฑ์ ≤ ${row.threshold}%` : `เกณฑ์ ≥ ${row.threshold}%`;
  const isOver = row.status === 'over' || row.status === 'critical';
  const barPercent = sanitizeNumber(row.barPercent);

  return (
    <div className={styles.budgetRow}>
      <div className={styles.budgetRowTop}>
        <span className={styles.budgetRowLabel}>{row.label}</span>
        <span className={styles.budgetRowAmount}>{`${formatCurrency(sanitizeNumber(row.amount))} ฿`}</span>
        <span className={styles.budgetRowPercent}>{`${sanitizeNumber(row.ratio).toFixed(1)}%`}</span>
      </div>
      <span className={styles.budgetRowThreshold}>{thresholdText}</span>
      <div className={`${styles.budgetBarTrack} ${isOver ? styles.budgetBarTrackOver : ''}`}>
        <div className={styles.budgetBarFill} style={{ width: `${barPercent}%`, background: meta.color }} />
        <span className={styles.budgetBarMarker} aria-hidden="true" />
      </div>
      <span className={styles.budgetRowStatus} style={{ color: meta.color }}>
        <Icon size={16} color={meta.color} />
        {row.statusLabel}
      </span>
      <a href={`/settings#${row.id}`} className={styles.budgetThresholdLink}>แก้ไขเกณฑ์</a>
    </div>
  );
}

function TransferableSavingsAction({ amount, onConfirm, isConfirming }) {
  const available = amount > 0;
  return (
    <div className={styles.transferableSavings} aria-live="polite">
      <div>
        <p className={styles.transferableSavingsLabel}>เงินออมที่โอนได้</p>
        <p className={styles.transferableSavingsAmount}>{`${formatCurrency(Math.max(0, amount))} ฿`}</p>
      </div>
      {available ? (
        <button type="button" className={styles.transferableSavingsButton} onClick={onConfirm} disabled={isConfirming}>
          {isConfirming ? 'กำลังเพิ่มเข้าเงินออม...' : 'เพิ่มเข้าเงินออม'}
        </button>
      ) : (
        <p className={styles.transferableSavingsUnavailable}>เดือนนี้ยังไม่มีเงินเหลือพร้อมออม</p>
      )}
    </div>
  );
}

export default function BudgetHealthPanel({ model, thresholds, onConfirmTransfer, isConfirmingTransfer }) {
  const [collapsed, setCollapsed] = useState(true); // พับเป็นค่าเริ่มต้นเสมอ ทั้งมือถือและเดสก์ท็อป (AC-DB-29)
  const [userToggled, setUserToggled] = useState(false);
  const health = evaluateBudgetHealth(model, thresholds);
  const rollupIcon = !health.available ? null : (health.attentionCount > 0 ? '⚠ ' : '✓ ');

  // ยกเว้นจาก AC-DB-29 เพียงจุดเดียว: ถ้ามีหมวดที่ต้องระวัง เปิดให้อัตโนมัติครั้งแรก เพราะนี่คือ
  // ข้อมูลที่มีความเสี่ยงสูงสุดในหน้านี้ ไม่ควรซ่อนไว้หลังการแตะแม้แต่บน desktop ที่มีพื้นที่พอ —
  // ไม่ทับค่าที่ผู้ใช้กดเปลี่ยนเองแล้ว (userToggled)
  useEffect(() => {
    if (!userToggled && health.available && health.attentionCount > 0) {
      setCollapsed(false);
    }
  }, [health.available, health.attentionCount, userToggled]);

  return (
    <section className={styles.panelCard}>
      <h2 className={styles.collapsibleHeadingReset}>
        <button
          type="button"
          className={styles.collapsibleHeader}
          onClick={() => {
            setUserToggled(true);
            setCollapsed((prev) => !prev);
          }}
          aria-expanded={!collapsed}
        >
          <span className={styles.collapsibleTitle}>
            <Icons.BarChart size={18} />
            สุขภาพงบประมาณ
          </span>
          <span className={styles.rollupInline}>{`${rollupIcon || ''}${health.rollupMessage}`}</span>
          <span className={`${styles.collapsibleChevron} ${!collapsed ? styles.collapsibleChevronOpen : ''}`}>
            <Icons.ChevronDown size={18} />
          </span>
        </button>
      </h2>

      {!collapsed && (
        <div className={styles.panelBody}>
          {!health.available ? (
            <div className={styles.budgetUnavailable}>
              <p>{health.rollupMessage}</p>
              <a href="/workspace/income" className={styles.ringEmptyLink}>เพิ่มรายรับ</a>
            </div>
          ) : (
            <>
              {health.rows.map((row) => <BudgetRow key={row.id} row={row} />)}
            </>
          )}
        </div>
      )}
      {health.available && (
        <TransferableSavingsAction
          amount={model.transferableSavings}
          onConfirm={onConfirmTransfer}
          isConfirming={isConfirmingTransfer}
        />
      )}
    </section>
  );
}
