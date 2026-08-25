/**
 * คอมโพเนนต์: CashFlowRing
 * วงแหวนกระแสเงินสด — SVG มือวาดเอง ตาม ADR-015 (รายรับเป็นวงอ้างอิงรอบนอก ไม่ใช่เสี้ยวที่ 5)
 * เทคนิค stroke-dasharray/dashoffset + rotate สืบทอดมาจาก PieChart เดิมใน SummaryReport.js
 * (ลบไปแล้วตอน A2 — /reports ใช้คอมโพเนนต์นี้เองแทน ผ่าน interactive=false)
 *
 * ตัวเลขทั้งหมดมาจาก getMonthlySummaryModel() — ไฟล์นี้ไม่คำนวณเงินเอง (BR-DASH-005)
 * legend เป็นส่วนหนึ่งของคอมโพเนนต์นี้ (ring + legend อยู่ด้วยกันเสมอตาม §2 ของ spec)
 * ปุ่ม legend 4 แถว (รายจ่ายทั่วไป/รายจ่ายประจำวัน/เงินออม/บัตรเครดิต) เป็นตัวกรองรายการ "ครบกำหนด"
 * แถวรายรับเป็นแค่ตัวบอก ไม่ใช่ปุ่ม (มันคือฐาน 100% ของกราฟเอง)
 */

import { formatCurrency } from '../../shared/utils/frontend/numberUtils';
import styles from '../styles/Dashboard.module.css';
import cardStyles from '../styles/CreditCard.module.css';

const RADIUS_OUTER = 104;
const RADIUS_INNER = 84;
const STROKE_INNER = 26;
const GAP_PX = 2;
const MIN_ARC_RATIO = 0.015; // เสี้ยวที่มียอด > 0 วาดอย่างน้อย 1.5% เสมอ ไม่งั้นมองไม่เห็นเลย (ADR-015)

const SEGMENT_DEFS = [
  { id: 'generalExpense', label: 'รายจ่ายทั่วไป', ratioKey: 'generalExpense', color: 'var(--danger-color)' },
  { id: 'dailyExpense', label: 'รายจ่ายประจำวัน', ratioKey: 'dailyExpense', color: 'var(--warning-color)' },
  { id: 'savings', label: 'เงินออม', ratioKey: 'savings', color: 'var(--secondary-color)' },
  { id: 'creditCard', label: 'บัตรเครดิต', ratioKey: 'creditCard', color: 'var(--info-color)' }
];

function sanitizeNumber(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return num === 0 ? 0 : num;
}

export default function CashFlowRing({ model, selected, onSelect, monthLabel, interactive = true }) {
  if (!model || !model.hasIncome) {
    return (
      <section className={styles.ringSection} aria-label="โครงสร้างกระแสเงินสดเดือนนี้">
        <h2 className={styles.sectionTitle}>โครงสร้างกระแสเงินสดเดือนนี้</h2>
        <div className={styles.ringEmpty}>
          <p>ยังคำนวณสัดส่วนไม่ได้</p>
          <p className={styles.ringEmptyDetail}>ยังไม่มีรายรับในเดือนนี้</p>
          <a href="/workspace?tab=income" className={styles.ringEmptyLink}>เพิ่มรายรับ</a>
        </div>
      </section>
    );
  }

  const totalIncome = sanitizeNumber(model.totalIncome);
  const totalOutflow = sanitizeNumber(model.totalOutflow);
  const netCashFlow = sanitizeNumber(model.netCashFlow);
  const overIncome = totalOutflow > totalIncome;
  const arcDenominator = overIncome ? totalOutflow : totalIncome;

  // trueRatio = เปอร์เซ็นต์จริงเทียบรายรับเสมอ (สำหรับ legend/แถบสถานะ — AC-DB-3)
  // arcRatio = สัดส่วนที่ใช้ "วาด" เสี้ยว (re-normalise เทียบ totalOutflow เมื่อเกินรายรับ — E8/E9)
  const segments = SEGMENT_DEFS.map((def) => {
    const amount = sanitizeNumber(model[def.ratioKey]);
    const trueRatio = model.ratios ? sanitizeNumber(model.ratios[def.ratioKey]) / 100 : 0;
    const rawArcRatio = arcDenominator > 0 ? amount / arcDenominator : 0;
    const arcRatio = amount > 0 ? Math.max(rawArcRatio, MIN_ARC_RATIO) : 0;
    return { ...def, amount, trueRatio, arcRatio };
  });

  const circumference = 2 * Math.PI * RADIUS_INNER;
  let cursorRatio = 0;
  const arcs = segments.map((segment) => {
    const rawLen = segment.arcRatio * circumference;
    const dashLen = rawLen > 0 ? Math.max(0, rawLen - GAP_PX) : 0;
    const dasharray = `${dashLen} ${Math.max(0, circumference - dashLen)}`;
    const rotateDeg = cursorRatio * 360 - 90;
    cursorRatio += segment.arcRatio;
    return { ...segment, dasharray, rotateDeg };
  });

  const isSelected = (id) => selected === id;
  const anySelected = Boolean(selected);
  const handleToggle = (id) => onSelect?.(isSelected(id) ? null : id);

  const overAmount = overIncome ? sanitizeNumber(totalOutflow - totalIncome) : 0;

  const ariaLabel = `โครงสร้างกระแสเงินสดเดือน${monthLabel || ''}: รายรับ ${formatCurrency(totalIncome)} บาท, `
    + segments.map((s) => `${s.label} ${formatCurrency(s.amount)} บาท คิดเป็น ${(s.trueRatio * 100).toFixed(1)}% ของรายรับ`).join(', ')
    + `, กระแสเงินสดสุทธิ ${netCashFlow >= 0 ? 'บวก' : 'ลบ'} ${formatCurrency(Math.abs(netCashFlow))} บาท`;

  return (
    <section className={styles.ringSection}>
      <h2 className={styles.sectionTitle}>โครงสร้างกระแสเงินสดเดือนนี้</h2>

      <div className={styles.ringWrap}>
        <svg
          width="220"
          height="220"
          viewBox="0 0 240 240"
          role="img"
          aria-label={ariaLabel}
        >
          {/* วงอ้างอิงรอบนอก = รายรับ (100% เสมอ) — เปลี่ยนสีเป็นแดงเมื่อรายจ่ายรวมเกินรายรับ */}
          <circle
            cx="120" cy="120" r={RADIUS_OUTER}
            fill="none"
            stroke={overIncome ? 'var(--danger-color)' : 'var(--border-color)'}
            strokeWidth="6"
          />
          {/* รางด้านใน */}
          <circle cx="120" cy="120" r={RADIUS_INNER} fill="none" stroke="var(--border-light)" strokeWidth={STROKE_INNER} />

          <g aria-hidden="true">
            {arcs.map((arc) => (
              <g key={arc.id}>
                {/* hit ring โปร่งใสกว้างกว่าเส้นจริง — ให้แตะง่ายขึ้นบนมือถือ ไม่ใช่ทางเข้าถึงหลัก (legend คือทางเข้าถึงหลัก) */}
                {/* interactive=false (เช่น /reports) ต้องไม่วาด hit ring เลย ไม่งั้นจะเหลือวงที่คลิกได้แต่มองไม่เห็น (AC-DB-32) */}
                {interactive && arc.arcRatio > 0 && (
                  <circle
                    cx="120" cy="120" r={RADIUS_INNER}
                    fill="none"
                    stroke="transparent"
                    strokeWidth={STROKE_INNER + 14}
                    strokeDasharray={arc.dasharray}
                    transform={`rotate(${arc.rotateDeg} 120 120)`}
                    style={{ cursor: 'pointer', pointerEvents: 'auto' }}
                    onClick={() => handleToggle(arc.id)}
                  />
                )}
                <circle
                  cx="120" cy="120" r={RADIUS_INNER}
                  fill="none"
                  stroke={arc.color}
                  strokeWidth={STROKE_INNER}
                  strokeLinecap="butt"
                  strokeDasharray={arc.dasharray}
                  transform={`rotate(${arc.rotateDeg} 120 120)`}
                  opacity={anySelected && !isSelected(arc.id) ? 0.45 : 1}
                  style={{ transition: 'stroke-dasharray 200ms ease, opacity 150ms ease', pointerEvents: 'none' }}
                />
              </g>
            ))}
          </g>

          <text x="120" y="112" textAnchor="middle" fontSize="13" fill="var(--text-secondary)">กระแสเงินสดเดือนนี้</text>
          <text
            x="120" y="138" textAnchor="middle" fontSize="26" fontWeight="600"
            fill={netCashFlow >= 0 ? 'var(--secondary-color)' : 'var(--danger-color)'}
          >
            {`${netCashFlow >= 0 ? '+' : '−'}${formatCurrency(Math.abs(netCashFlow))} ฿`}
          </text>
          {overIncome && (
            <text x="120" y="156" textAnchor="middle" fontSize="12" fill="var(--danger-color)">
              {`เกินรายรับ ${formatCurrency(overAmount)} ฿`}
            </text>
          )}
        </svg>

        {/* รายการตัวเลข 5 ค่าเดียวกันสำหรับ screen reader อ่านทีละตัว (AC-DB-22) */}
        <ul className={cardStyles.srOnly}>
          <li>{`รายรับ ${formatCurrency(totalIncome)} บาท`}</li>
          {segments.map((s) => (
            <li key={s.id}>{`${s.label} ${formatCurrency(s.amount)} บาท คิดเป็น ${(s.trueRatio * 100).toFixed(1)}% ของรายรับ`}</li>
          ))}
          <li>{`กระแสเงินสดสุทธิ ${netCashFlow >= 0 ? 'บวก' : 'ลบ'} ${formatCurrency(Math.abs(netCashFlow))} บาท`}</li>
        </ul>
      </div>

      <div className={styles.ringLegend}>
        <div className={styles.legendRow}>
          <span className={styles.legendMarkerStatic} aria-hidden="true" style={{ '--legend-color': 'var(--text-secondary)' }} />
          <span className={styles.legendLabel}>รายรับ</span>
          <span className={styles.legendAmount}>{`${formatCurrency(totalIncome)} บาท`}</span>
          <span className={styles.legendPercent}>100%</span>
          <span className={styles.legendType}>รับเข้า</span>
        </div>
        {segments.map((segment) => {
          const active = isSelected(segment.id);
          // interactive=false (/reports): แถวเป็น <div> ธรรมดา ไม่มี onClick/aria-pressed — ใช้ class เดียวกับแถวรายรับที่ไม่ใช่ปุ่มอยู่แล้ว
          if (!interactive) {
            return (
              <div key={segment.id} className={styles.legendRow}>
                <span className={styles.legendMarker} aria-hidden="true" style={{ '--legend-color': segment.color }} />
                <span className={styles.legendLabel}>{segment.label}</span>
                <span className={styles.legendAmount}>{`${formatCurrency(segment.amount)} บาท`}</span>
                <span className={styles.legendPercent}>{`${(segment.trueRatio * 100).toFixed(1)}%`}</span>
                <span className={styles.legendType}>จ่ายออก</span>
              </div>
            );
          }
          return (
            <button
              key={segment.id}
              type="button"
              className={`${styles.legendRow} ${styles.legendRowButton} ${active ? styles.legendRowActive : ''}`}
              onClick={() => handleToggle(segment.id)}
              aria-pressed={active}
            >
              <span className={styles.legendMarker} aria-hidden="true" style={{ '--legend-color': segment.color }} />
              <span className={styles.legendLabel}>{segment.label}</span>
              <span className={styles.legendAmount}>{`${formatCurrency(segment.amount)} บาท`}</span>
              <span className={styles.legendPercent}>{`${(segment.trueRatio * 100).toFixed(1)}%`}</span>
              <span className={styles.legendType}>จ่ายออก</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
