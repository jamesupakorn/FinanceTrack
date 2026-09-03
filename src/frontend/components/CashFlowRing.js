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
 *
 * Graphite redesign (Dashboard pass) — Tailwind only, no *.module.css. ใช้ร่วมกับ /reports
 * (SummaryReport.js, interactive=false) ดังนั้น container-query fix ของ BUG-A2-1 (legend ล้นทับกัน
 * เมื่อ .ringSection ถูกวางในคอนเทนเนอร์แคบ) ต้องอยู่รอดการย้าย — ทำผ่าน Tailwind v3.4 arbitrary-
 * property/variant syntax (container-type/@container) แทน @media เดิม ไม่เพิ่ม dependency ใหม่
 * (architecture-review-dashboard-graphite.md Finding 2)
 */

import { formatCurrency } from '../../shared/utils/frontend/numberUtils';

const RADIUS_OUTER = 104;
const RADIUS_INNER = 84;
const STROKE_INNER = 26;
const GAP_PX = 2;
const MIN_ARC_RATIO = 0.015; // เสี้ยวที่มียอด > 0 วาดอย่างน้อย 1.5% เสมอ ไม่งั้นมองไม่เห็นเลย (ADR-015)

// สี segment = money semantics ใหม่ (UX_SPEC §3.1) — ไม่ผูกกับ accent จึงเปลี่ยน accent hue แล้วความหมาย
// ตัวเลขไม่เปลี่ยน แถวเป็น <circle stroke=...>/<text fill=...> ที่ className ไปไม่ถึง จึงยังอ่านจาก
// var(--neg)/var(--warn)/var(--pos)/var(--info) ที่ globals.css ประกาศไว้ (ตรงกับที่ architecture review
// Finding 2 note ไว้ว่า SVG stroke/fill ต้องคง var() ไว้ แค่ชี้ไป token ใหม่)
const SEGMENT_DEFS = [
  { id: 'generalExpense', label: 'รายจ่ายทั่วไป', ratioKey: 'generalExpense', color: 'var(--neg)' },
  { id: 'dailyExpense', label: 'รายจ่ายประจำวัน', ratioKey: 'dailyExpense', color: 'var(--warn)' },
  { id: 'savings', label: 'เงินออม', ratioKey: 'savings', color: 'var(--pos)' },
  { id: 'creditCard', label: 'บัตรเครดิต', ratioKey: 'creditCard', color: 'var(--info)' }
];

// ปุ่ม/แถว legend ที่โต้ตอบได้ทั้งหมดใช้กติกาเดียวกัน: 44px ขั้นต่ำ (K1) + focus ring ชัดเจน (K4/N1 §3.1 Focus)
const FOCUS_RING = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2';

function sanitizeNumber(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return num === 0 ? 0 : num;
}

// แถว legend หนึ่งแถว — ใช้ทั้งกับ <div> (interactive=false, /reports) และ <button> (interactive=true, /)
// รูปแบบ C4 (§5 component vocabulary): ชื่อซ้าย + จำนวนเงิน/เปอร์เซ็นต์ขวา, tabular-nums เสมอ (N3)
// container query (BUG-A2-1): เมื่อ .ringSection แคบ ≤330px (เช่น /reports .chartsSection) ห่อบรรทัดแทนทับกัน
const LEGEND_ROW_BASE =
  'flex min-h-14 items-center gap-space-3 rounded-sm border-l-2 border-transparent px-space-2 py-space-2 ' +
  'text-sm text-primary [@container(max-width:330px)]:flex-wrap [@container(max-width:330px)]:gap-y-1';

export default function CashFlowRing({ model, selected, onSelect, monthLabel, interactive = true }) {
  if (!model || !model.hasIncome) {
    return (
      <section
        className="rounded-md border border-border-default bg-surface-1 p-space-4 shadow-elev-1 md:p-space-5 [container-type:inline-size]"
        aria-label="โครงสร้างกระแสเงินสดเดือนนี้"
      >
        <h2 className="mb-space-4 text-xl font-semibold text-primary">โครงสร้างกระแสเงินสดเดือนนี้</h2>
        <div className="rounded-md border border-dashed border-border-default p-space-5 text-center text-secondary">
          <p>ยังคำนวณสัดส่วนไม่ได้</p>
          <p className="mb-space-3 mt-space-1 text-sm text-tertiary">ยังไม่มีรายรับในเดือนนี้</p>
          <a
            href="/workspace/income"
            className={`inline-flex min-h-11 items-center rounded-full bg-accent px-space-4 font-semibold text-on-accent no-underline ${FOCUS_RING}`}
          >
            เพิ่มรายรับ
          </a>
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
    <section className="rounded-md border border-border-default bg-surface-1 p-space-4 shadow-elev-1 md:p-space-5 [container-type:inline-size]">
      <h2 className="mb-space-4 text-xl font-semibold text-primary">โครงสร้างกระแสเงินสดเดือนนี้</h2>

      <div className="mb-space-4 flex justify-center">
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
            stroke={overIncome ? 'var(--neg)' : 'var(--border-default)'}
            strokeWidth="6"
          />
          {/* รางด้านใน */}
          <circle cx="120" cy="120" r={RADIUS_INNER} fill="none" stroke="var(--surface-2)" strokeWidth={STROKE_INNER} />

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
            className="tabular-nums"
            x="120" y="138" textAnchor="middle" fontSize="26" fontWeight="600"
            fill={netCashFlow >= 0 ? 'var(--pos)' : 'var(--neg)'}
          >
            {`${netCashFlow >= 0 ? '+' : '−'}${formatCurrency(Math.abs(netCashFlow))} ฿`}
          </text>
          {overIncome && (
            <text className="tabular-nums" x="120" y="156" textAnchor="middle" fontSize="12" fill="var(--neg)">
              {`เกินรายรับ ${formatCurrency(overAmount)} ฿`}
            </text>
          )}
        </svg>

        {/* รายการตัวเลข 5 ค่าเดียวกันสำหรับ screen reader อ่านทีละตัว (AC-DB-22) */}
        <ul className="sr-only">
          <li>{`รายรับ ${formatCurrency(totalIncome)} บาท`}</li>
          {segments.map((s) => (
            <li key={s.id}>{`${s.label} ${formatCurrency(s.amount)} บาท คิดเป็น ${(s.trueRatio * 100).toFixed(1)}% ของรายรับ`}</li>
          ))}
          <li>{`กระแสเงินสดสุทธิ ${netCashFlow >= 0 ? 'บวก' : 'ลบ'} ${formatCurrency(Math.abs(netCashFlow))} บาท`}</li>
        </ul>
      </div>

      <div className="flex flex-col gap-space-1">
        <div className={LEGEND_ROW_BASE}>
          <span className="h-3 w-3 shrink-0 rounded-xs bg-secondary" aria-hidden="true" />
          <span className="min-w-0 flex-1 [@container(max-width:330px)]:basis-[calc(100%-22px)]">รายรับ</span>
          <span className="whitespace-nowrap text-secondary tabular-nums">{`${formatCurrency(totalIncome)} บาท`}</span>
          <span className="min-w-12 text-right text-secondary tabular-nums">100%</span>
          <span className="min-w-14 text-right text-xs text-tertiary">รับเข้า</span>
        </div>
        {segments.map((segment) => {
          const active = isSelected(segment.id);
          // interactive=false (/reports): แถวเป็น <div> ธรรมดา ไม่มี onClick/aria-pressed
          if (!interactive) {
            return (
              <div key={segment.id} className={LEGEND_ROW_BASE}>
                <span className="h-3 w-3 shrink-0 rounded-xs" aria-hidden="true" style={{ backgroundColor: segment.color }} />
                <span className="min-w-0 flex-1 [@container(max-width:330px)]:basis-[calc(100%-22px)]">{segment.label}</span>
                <span className="whitespace-nowrap text-secondary tabular-nums">{`${formatCurrency(segment.amount)} บาท`}</span>
                <span className="min-w-12 text-right text-secondary tabular-nums">{`${(segment.trueRatio * 100).toFixed(1)}%`}</span>
                <span className="min-w-14 text-right text-xs text-tertiary">จ่ายออก</span>
              </div>
            );
          }
          return (
            <button
              key={segment.id}
              type="button"
              className={`${LEGEND_ROW_BASE} w-full cursor-pointer bg-transparent text-left font-sans hover:bg-surface-2 ${FOCUS_RING} ${
                active ? 'border-l-accent bg-accent-muted font-semibold' : ''
              }`}
              onClick={() => handleToggle(segment.id)}
              aria-pressed={active}
            >
              <span className="h-3 w-3 shrink-0 rounded-xs" aria-hidden="true" style={{ backgroundColor: segment.color }} />
              <span className="min-w-0 flex-1 [@container(max-width:330px)]:basis-[calc(100%-22px)]">{segment.label}</span>
              <span className="whitespace-nowrap text-secondary tabular-nums">{`${formatCurrency(segment.amount)} บาท`}</span>
              <span className="min-w-12 text-right text-secondary tabular-nums">{`${(segment.trueRatio * 100).toFixed(1)}%`}</span>
              <span className="min-w-14 text-right text-xs text-tertiary">จ่ายออก</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
