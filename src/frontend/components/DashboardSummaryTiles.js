/**
 * คอมโพเนนต์: DashboardSummaryTiles
 * 6 การ์ดสรุปยอดของหน้าภาพรวม — อ่านจาก getMonthlySummaryModel() ล้วน ไม่คำนวณเงินเอง (BR-DASH-005)
 * รายรับไม่มีเปอร์เซ็นต์ (มันคือฐาน 100% เอง) การ์ดอื่นแสดง "N% ของรายรับ" เมื่อมีรายรับ (ratios !== null)
 * กระแสเงินสดสุทธิ มีเครื่องหมาย +/− กำกับชัดเจนนอกเหนือจากสี (AC-DB-21 หลักการเดียวกัน)
 */

import { formatCurrency } from '../../shared/utils/frontend/numberUtils';
import styles from '../styles/Dashboard.module.css';

// -0/NaN/Infinity ต้องไม่ไปถึง DOM (AC-DB-5) — round2() ของโมเดลบางครั้งให้ -0 ตอนผลต่างเท่ากับ 0 พอดี
function sanitizeNumber(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return num === 0 ? 0 : num; // ทั้ง +0 และ -0 ตกเงื่อนไข === 0 เป็น true → คืน literal 0 เสมอ
}

const TILE_DEFS = [
  { id: 'totalIncome', label: 'รายได้', pick: (m) => m.totalIncome, ratioKey: null },
  { id: 'generalExpense', label: 'บิลและรายจ่าย', pick: (m) => m.generalExpense, ratioKey: 'generalExpense' },
  { id: 'dailyExpense', label: 'ค่าใช้จ่ายรายวัน', pick: (m) => m.dailyExpense, ratioKey: 'dailyExpense' },
  { id: 'savings', label: 'เงินออม', pick: (m) => m.savings, ratioKey: 'savings' },
  { id: 'creditCard', label: 'บัตรเครดิต', pick: (m) => m.creditCard, ratioKey: 'creditCard' },
  { id: 'netCashFlow', label: 'กระแสเงินสดสุทธิ', pick: (m) => m.netCashFlow, ratioKey: 'netCashFlow', isNet: true }
];

export default function DashboardSummaryTiles({ model }) {
  return (
    <div className={styles.tileGrid}>
      {TILE_DEFS.map(({ id, label, pick, ratioKey, isNet }) => {
        const amount = sanitizeNumber(pick(model));
        const ratio = ratioKey && model.ratios ? sanitizeNumber(model.ratios[ratioKey]) : null;
        const isNegative = isNet && amount < 0;
        return (
          <div key={id} className={styles.tile}>
            <span className={styles.tileLabel}>{label}</span>
            <span className={`${styles.tileAmount} ${isNet ? (isNegative ? styles.tileAmountDanger : styles.tileAmountPositive) : ''}`}>
              {isNet && `${isNegative ? '−' : '+'} `}
              {formatCurrency(Math.abs(amount))} บาท
            </span>
            {ratio !== null && (
              <span className={styles.tileRatio}>{`${ratio.toFixed(1)}% ของรายรับ`}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}
