/**
 * คอมโพเนนต์: BudgetThresholdForm
 * ฟอร์มเกณฑ์สุขภาพงบประมาณ (`/settings`) — presentational: รับ `values`/`loading`/`loadFailed`/`saving`
 * จากหน้าแม่ (pages/settings.js), เก็บ draft/validation/dirty state ไว้ในตัวเอง แล้วเรียก
 * `onSave(thresholds)`/`onRetryLoad()` กลับไปให้หน้าแม่ทำ I/O จริง (pattern เดิม ไม่ได้คิดใหม่)
 *
 * ช่องตัวเลขเป็น type="text" เสมอ (ADR-006 Decision 2 — ห้าม type="number") + inputMode="decimal"
 * เพราะรับทศนิยม 1 ตำแหน่งได้จริง validate ตอน blur ไม่ใช่ทุกคีย์ (บทเรียนเดิมของโปรเจกต์ — พิมพ์แล้วโดน
 * normalize จะหลุดโฟกัส, CLAUDE.md §3.4)
 *
 * Graphite redesign (/settings pass) — Tailwind only, ไม่ import Settings.module.css อีกต่อไป
 * (task-size-settings-graphite.md §Effort Estimate Step 1). ของใหม่ 2 อย่างตาม UX_SPEC §9:
 *   1) AllocationBar — แถบ 100%-wide เดียว 4 ช่อง สีต่อหมวด + เปอร์เซ็นต์ต่อหมวด แทนบรรทัดข้อความเดิม
 *      สีต่อหมวดใช้ชุดเดียวกับ CashFlowRing's SEGMENT_DEFS (Dashboard/reports) เพื่อไม่ให้ "เงินออม" ของ
 *      หน้านี้ขัดกับที่อื่นในแอป — segment "เงินออม" ขึ้นลายทแยง (hatch) แทนพื้นทึบ เพราะเป็นค่าที่คำนวณให้
 *      ไม่ใช่ค่าที่กรอกเอง (UX_SPEC §9 "hatched pattern, or --surface-3")
 *   2) เงินออม (savings) เป็นค่า read-only/derived เสมอ = 100 − (บิลและรายจ่าย + ค่าใช้จ่ายรายวัน +
 *      บัตรเครดิต) (ADR-017 §2) — ไม่มี onChange/onBlur/independent validation ของตัวเองอีกต่อไป จึงไม่มี
 *      สถานะ error "ผลรวมไม่ถึง 100%" เพราะสถานะนั้นเกิดขึ้นไม่ได้โดยโครงสร้าง (ADR-017 §2 คำต่อคำ)
 *
 * ผลรวมของเพดาน 3 ข้อยังเกิน 100 ได้จากการพิมพ์ (ทำให้เงินออมที่ derive ติดลบ) — ADR-017 §3 เลือกวิธี
 * "block บันทึกด้วยเหตุผลบอกใน UI" มากกว่าการ silently clamp หรือ snap ค่าที่ผู้ใช้พิมพ์ จึงกัน submit
 * ตรงนี้ (ปุ่มบันทึก disabled + ข้อความ role="alert") ไม่ใช่ validation error ต่อช่องเดียวแบบเดิม
 *
 * Deep-link (#creditCard จาก Dashboard "แก้ไขเกณฑ์"): เลื่อนไปหาแถวนั้น, โฟกัส (ถ้าโฟกัสได้), highlight
 * ด้วย outline ring ค้างไว้ 2 วินาทีแล้วเอาออก (แทน keyframe blink เดิมที่อยู่ใน Settings.module.css ซึ่ง
 * ถูกลบไปพร้อม pass นี้ — Tailwind utility ล้วน ไม่เพิ่ม global CSS ใหม่)
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { BUDGET_THRESHOLD_KEYS, DEFAULT_BUDGET_THRESHOLDS, BUDGET_ROW_DEFS } from '../../shared/utils/frontend/monthlySummary';

const FOCUS_RING = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2';
const INPUT = `h-11 w-24 rounded-sm border border-border-interactive bg-surface-2 px-space-3 text-right text-base text-primary outline-none ${FOCUS_RING}`;
const PRIMARY_BUTTON = `inline-flex h-11 items-center justify-center rounded-sm bg-accent px-space-4 text-sm font-semibold text-on-accent disabled:cursor-not-allowed disabled:opacity-45 ${FOCUS_RING}`;
const SECONDARY_BUTTON = `inline-flex h-11 items-center justify-center rounded-sm border border-border-interactive bg-surface-2 px-space-4 text-sm font-semibold text-primary disabled:cursor-not-allowed disabled:opacity-45 ${FOCUS_RING}`;
const HIGHLIGHT_RING = 'outline outline-2 outline-accent outline-offset-2';

// สี segment ต่อหมวด — ชุดเดียวกับ CashFlowRing.js's SEGMENT_DEFS (generalExpense=--neg,
// dailyExpense=--warn, creditCard=--info, savings=--pos) ไม่ใช่ "สีสถานะ" แบบ BudgetHealthPanel
// (ok/near/over) — ที่นี่คือสีประจำหมวด ไม่ใช่สีบอกว่ากำลังเกินเกณฑ์หรือไม่
const ALLOCATION_COLORS = {
  generalExpense: 'var(--neg)',
  dailyExpense: 'var(--warn)',
  creditCard: 'var(--info)',
  savings: 'var(--pos)'
};

const FIELD_PRESENTATION = {
  generalExpense: { prefix: 'ไม่เกิน', suffixText: '% ของรายรับ' },
  dailyExpense: { prefix: 'ไม่เกิน', suffixText: '% ของรายรับ' },
  creditCard: { prefix: 'ไม่เกิน', suffixText: '% ของรายรับ' },
  savings: { prefix: 'อย่างน้อย', suffixText: '% ของรายรับ · คำนวณอัตโนมัติ' }
};

// เกณฑ์ที่กรอกเองได้ 3 ข้อ — savings ไม่อยู่ในนี้อีกต่อไป เพราะเป็นค่าที่ derive มา ไม่ใช่ค่าที่แก้ไขได้ (ADR-017 §2)
const EDITABLE_FIELD_DEFS = BUDGET_ROW_DEFS
  .filter(({ id }) => id !== 'savings')
  .map(({ id, label }) => ({ key: id, label, ...FIELD_PRESENTATION[id] }));

const SAVINGS_FIELD_DEF = (() => {
  const def = BUDGET_ROW_DEFS.find(({ id }) => id === 'savings');
  return { key: def.id, label: def.label, ...FIELD_PRESENTATION[def.id] };
})();

const VALIDATION_MESSAGE = 'กรอกตัวเลข 0–100 เท่านั้น';
const NUMERIC_ONE_DECIMAL_RE = /^\d+(\.\d)?$/;

/** ตัวเลข 0–100 ทศนิยมไม่เกิน 1 ตำแหน่งเท่านั้น — สะท้อน server-side validation ตัวเดียวกัน (M-6) */
function parseThresholdInput(rawValue) {
  const trimmed = String(rawValue ?? '').trim();
  if (!trimmed || !NUMERIC_ONE_DECIMAL_RE.test(trimmed)) return { valid: false };
  const numeric = Number(trimmed);
  if (!Number.isFinite(numeric) || numeric < 0 || numeric > 100) return { valid: false };
  return { valid: true, numeric };
}

function roundToOneDecimal(value) {
  return Math.round(value * 10) / 10;
}

function buildDraftFromValues(values) {
  const draft = {};
  EDITABLE_FIELD_DEFS.forEach(({ key }) => {
    const source = values && typeof values === 'object' ? values[key] : undefined;
    draft[key] = String(source ?? DEFAULT_BUDGET_THRESHOLDS[key]);
  });
  return draft;
}

/**
 * AllocationBar — แถบ 100%-wide เดียว 4 segment ตาม UX_SPEC §9 คอมโพเนนต์ประกอบจาก primitive เดิม
 * (ไม่ใช่ C-primitive ที่ 12 — architecture-review-settings-graphite.md §Architecture findings)
 * segment "เงินออม" (derived: true) ใช้ลายทแยง repeating-linear-gradient แทนพื้นทึบ ให้ดูต่างจาก
 * 3 ช่องที่กรอกเองได้ชัดเจนโดยไม่ต้องพึ่งสีอย่างเดียว (N2 — สีอย่างเดียวไม่พอสื่อความหมาย)
 */
function AllocationBar({ segments, overCap }) {
  const ariaSummary = segments.map((segment) => `${segment.label} ${segment.displayPercent}%`).join(', ');

  return (
    <div className="flex flex-col gap-space-3">
      <div
        role="img"
        aria-label={`สัดส่วนงบประมาณ 100%: ${ariaSummary}`}
        className={`flex h-8 w-full overflow-hidden rounded-full border bg-surface-2 ${overCap ? 'border-neg' : 'border-border-default'}`}
      >
        {segments.map((segment) => (
          <div
            key={segment.key}
            className="h-full transition-[width] duration-base first:rounded-l-full last:rounded-r-full"
            style={{
              width: `${segment.widthPercent}%`,
              background: segment.derived
                ? `repeating-linear-gradient(135deg, ${segment.color} 0px, ${segment.color} 5px, var(--surface-3) 5px, var(--surface-3) 10px)`
                : segment.color
            }}
          />
        ))}
      </div>

      <div className="grid grid-cols-2 gap-x-space-4 gap-y-space-2 sm:grid-cols-4" aria-hidden="true">
        {segments.map((segment) => (
          <div key={segment.key} className="flex min-w-0 items-center gap-space-2 text-xs text-secondary">
            <span
              className="h-3 w-3 shrink-0 rounded-full"
              style={{
                background: segment.derived
                  ? `repeating-linear-gradient(135deg, ${segment.color} 0px, ${segment.color} 2px, var(--surface-3) 2px, var(--surface-3) 4px)`
                  : segment.color
              }}
            />
            <span className="truncate">{segment.label}</span>
            <span className="ml-auto font-semibold text-primary tabular-nums">{`${segment.displayPercent}%`}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function BudgetThresholdForm({ values, loading, loadFailed, saving, onSave, onRetryLoad, onDirtyChange }) {
  const [draft, setDraft] = useState(() => buildDraftFromValues(values));
  const [errors, setErrors] = useState({});
  const [isDirty, setIsDirty] = useState(false);
  const inputRefs = useRef({});
  const initializedRef = useRef(false);
  const [pulseKey, setPulseKey] = useState(null);

  // แจ้งหน้าแม่ทุกครั้งที่ isDirty เปลี่ยน เพื่อให้ Layout's onBeforeNavigate เตือนก่อนออกจากหน้าถ้ายัง
  // ไม่ได้บันทึก
  useEffect(() => {
    onDirtyChange?.(isDirty);
  }, [isDirty, onDirtyChange]);

  // เติม draft จากค่าที่โหลดมาจริงครั้งแรก (หรือหลังกด "ลองอีกครั้ง") — ไม่ทับ draft ที่ผู้ใช้กำลังพิมพ์อยู่
  useEffect(() => {
    if (loading) {
      initializedRef.current = false;
      return;
    }
    if (initializedRef.current) return;
    setDraft(buildDraftFromValues(values));
    setIsDirty(false);
    setErrors({});
    initializedRef.current = true;
  }, [loading, values]);

  // deep-link (จาก Dashboard "แก้ไขเกณฑ์") — เลื่อน/โฟกัส/ไฮไลต์ครั้งเดียวหลังฟอร์มพร้อมใช้งาน ครอบคลุมทั้ง
  // 3 input ที่แก้ไขได้และแถว "เงินออม" ที่เป็น read-only (ref ผูกไว้ทั้งคู่ด้านล่าง)
  useEffect(() => {
    if (loading || typeof window === 'undefined') return;
    const hashKey = window.location.hash.replace('#', '');
    if (!hashKey || !BUDGET_THRESHOLD_KEYS.includes(hashKey)) return;
    const target = inputRefs.current[hashKey];
    if (!target) return;
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (typeof target.focus === 'function') target.focus({ preventScroll: true });
    setPulseKey(hashKey);
    const timer = setTimeout(() => setPulseKey(null), 2000);
    return () => clearTimeout(timer);
  }, [loading]);

  const handleChange = (key, value) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
    setIsDirty(true);
  };

  const handleBlur = (key) => {
    const result = parseThresholdInput(draft[key]);
    setErrors((prev) => ({ ...prev, [key]: result.valid ? null : VALIDATION_MESSAGE }));
  };

  const handleReset = () => {
    const nextDraft = {};
    EDITABLE_FIELD_DEFS.forEach(({ key }) => { nextDraft[key] = String(DEFAULT_BUDGET_THRESHOLDS[key]); });
    setDraft(nextDraft);
    setErrors({});
    setIsDirty(true);
  };

  // เงินออม = 100 − ผลรวม 3 เพดาน คำนวณสดทุกครั้งที่ draft เปลี่ยน ไม่รอ blur/submit (ADR-017 §2
  // "a read-only, auto-updating figure") ค่าที่กรอกไม่ครบ/ไม่ผ่าน validation ถือเป็น 0 ชั่วคราวสำหรับ
  // การคำนวณสดนี้เท่านั้น (การ block บันทึกจริงยังใช้ parseThresholdInput ตอน submit อยู่ด้านล่าง)
  const { capValues, capSum, derivedSavings, overCap } = useMemo(() => {
    const readNumeric = (key) => {
      const numeric = Number(draft[key]);
      return Number.isFinite(numeric) ? numeric : 0;
    };
    const values4 = EDITABLE_FIELD_DEFS.reduce((acc, { key }) => { acc[key] = readNumeric(key); return acc; }, {});
    const sum = roundToOneDecimal(Object.values(values4).reduce((a, b) => a + b, 0));
    return { capValues: values4, capSum: sum, derivedSavings: roundToOneDecimal(100 - sum), overCap: sum > 100 };
  }, [draft]);

  const allocationSegments = useMemo(() => {
    const savingsDisplay = Math.max(0, derivedSavings);
    // เมื่อ overCap แถบยังเต็ม 100% เสมอ (สัดส่วนตามเพดาน 3 ข้อ, เงินออมหดเหลือ 0) แทนที่จะล้นกรอบ
    const totalForScale = overCap ? capSum : (capSum + savingsDisplay);
    const scale = totalForScale > 0 ? 100 / totalForScale : 0;
    const capSegments = EDITABLE_FIELD_DEFS.map(({ key, label }) => ({
      key,
      label,
      color: ALLOCATION_COLORS[key],
      derived: false,
      displayPercent: roundToOneDecimal(capValues[key]),
      widthPercent: Math.max(0, capValues[key]) * scale
    }));
    const savingsSegment = {
      key: SAVINGS_FIELD_DEF.key,
      label: SAVINGS_FIELD_DEF.label,
      color: ALLOCATION_COLORS.savings,
      derived: true,
      displayPercent: derivedSavings,
      widthPercent: savingsDisplay * scale
    };
    return [...capSegments, savingsSegment];
  }, [capValues, capSum, derivedSavings, overCap]);

  const handleSubmit = (event) => {
    event.preventDefault();
    if (overCap) return; // ปุ่มบันทึก disabled อยู่แล้วเมื่อ overCap แต่กันไว้อีกชั้น (ADR-017 §3)

    const nextErrors = {};
    let firstInvalidKey = null;
    const thresholds = {};

    EDITABLE_FIELD_DEFS.forEach(({ key }) => {
      const result = parseThresholdInput(draft[key]);
      if (!result.valid) {
        nextErrors[key] = VALIDATION_MESSAGE;
        if (!firstInvalidKey) firstInvalidKey = key;
      } else {
        thresholds[key] = result.numeric;
      }
    });

    setErrors(nextErrors);
    if (firstInvalidKey) {
      inputRefs.current[firstInvalidKey]?.focus();
      return;
    }

    // เงินออม = 100 − ผลรวม 3 เพดานที่ผ่าน validation แล้ว — ไม่มีค่าที่ผู้ใช้กรอกเองอีกต่อไป (ADR-017 §2)
    thresholds.savings = roundToOneDecimal(100 - (thresholds.generalExpense + thresholds.dailyExpense + thresholds.creditCard));

    Promise.resolve(onSave(thresholds)).then((succeeded) => {
      if (succeeded !== false) setIsDirty(false);
    });
  };

  const disableSave = loadFailed || saving || overCap;

  return (
    <form className="flex flex-col gap-space-5" onSubmit={handleSubmit} noValidate>
      {loadFailed && (
        <div className="flex flex-wrap items-center justify-between gap-space-3 rounded-sm border border-neg/35 bg-neg/10 p-space-3 text-sm text-primary" role="alert">
          <span>โหลดค่าที่บันทึกไว้ไม่สำเร็จ กำลังแสดงค่าเริ่มต้น</span>
          <button type="button" className={SECONDARY_BUTTON} onClick={onRetryLoad}>ลองอีกครั้ง</button>
        </div>
      )}

      <AllocationBar segments={allocationSegments} overCap={overCap} />

      <div className="flex flex-col gap-space-4">
        {EDITABLE_FIELD_DEFS.map(({ key, label, prefix, suffixText }) => {
          const fieldId = `budget-threshold-${key}`;
          const hintId = `${fieldId}-hint`;
          const errorId = `${fieldId}-error`;
          const hasError = Boolean(errors[key]);

          return (
            <div
              key={key}
              className={`flex flex-col gap-space-1 rounded-sm p-space-1 sm:grid sm:grid-cols-[1fr_auto] sm:items-center sm:gap-space-4 ${pulseKey === key ? HIGHLIGHT_RING : ''}`}
            >
              <label className="text-sm font-semibold text-primary" htmlFor={fieldId}>{`${label} ${prefix}`}</label>
              <div className="flex items-center gap-space-2 sm:justify-self-end">
                <input
                  id={fieldId}
                  ref={(el) => { inputRefs.current[key] = el; }}
                  type="text"
                  inputMode="decimal"
                  className={`${INPUT} ${hasError ? 'border-neg' : ''}`}
                  value={draft[key]}
                  disabled={loading}
                  onChange={(event) => handleChange(key, event.target.value)}
                  onBlur={() => handleBlur(key)}
                  aria-describedby={hasError ? `${hintId} ${errorId}` : hintId}
                  aria-invalid={hasError ? 'true' : undefined}
                />
                <span className="whitespace-nowrap text-xs text-secondary" aria-hidden="true">{suffixText}</span>
              </div>
              <span id={hintId} className="text-xs text-tertiary sm:col-span-2">{`${label} ${prefix} 0–100${suffixText}`}</span>
              {hasError && (
                <span id={errorId} className="text-xs font-semibold text-neg sm:col-span-2" role="alert">{errors[key]}</span>
              )}
            </div>
          );
        })}

        {/* เงินออม — read-only, คำนวณสดจาก 3 ข้อด้านบน ไม่ใช่ input ที่แก้ไขได้อีกต่อไป (ADR-017 §2) */}
        <div
          id={`budget-threshold-${SAVINGS_FIELD_DEF.key}`}
          ref={(el) => { inputRefs.current[SAVINGS_FIELD_DEF.key] = el; }}
          tabIndex={-1}
          className={`flex flex-col gap-space-1 rounded-sm border border-dashed border-border-default bg-surface-2 p-space-3 ${pulseKey === SAVINGS_FIELD_DEF.key ? HIGHLIGHT_RING : ''}`}
        >
          <div className="flex items-center justify-between gap-space-3">
            <span className="text-sm font-semibold text-primary">{`${SAVINGS_FIELD_DEF.label} ${SAVINGS_FIELD_DEF.prefix}`}</span>
            <span className={`text-lg font-bold tabular-nums ${overCap ? 'text-neg' : 'text-primary'}`}>{`${derivedSavings}%`}</span>
          </div>
          <span className="text-xs text-tertiary">{`คำนวณอัตโนมัติ: 100% − ผลรวมเพดาน 3 ข้อด้านบน (${capSum}%)`}</span>
        </div>
      </div>

      {overCap && (
        <p className="m-0 text-sm font-semibold text-neg" role="alert">
          {`ผลรวมเพดาน ${capSum}% เกิน 100% — เงินออมติดลบไม่ได้ กรุณาปรับเพดานให้ไม่เกิน 100% ก่อนบันทึก`}
        </p>
      )}

      <div className="flex items-center justify-between gap-space-3 border-t border-border-subtle pt-space-4 max-sm:flex-col-reverse max-sm:items-stretch">
        <button type="button" className={SECONDARY_BUTTON} onClick={handleReset} disabled={loading}>
          คืนค่าเริ่มต้น
        </button>
        <button type="submit" className={PRIMARY_BUTTON} disabled={!isDirty || disableSave}>
          {saving ? 'กำลังบันทึก...' : 'บันทึก'}
        </button>
      </div>
    </form>
  );
}
