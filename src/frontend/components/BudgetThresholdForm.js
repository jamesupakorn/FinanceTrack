/**
 * คอมโพเนนต์: BudgetThresholdForm
 * ฟอร์ม 5 เกณฑ์สุขภาพงบประมาณ (`/settings`) — presentational: รับ `values`/`loading`/`loadFailed`/
 * `saving` จากหน้าแม่ (pages/settings.js), เก็บ draft/validation/dirty state ไว้ในตัวเอง แล้วเรียก
 * `onSave(thresholds)`/`onRetryLoad()` กลับไปให้หน้าแม่ทำ I/O จริง (ตาม pattern เดียวกับที่โปรเจกต์นี้
 * แยก presentational form ออกจาก page ที่ถือ state การเชื่อม API — ไม่ได้คิดรูปแบบใหม่)
 *
 * ช่องตัวเลขเป็น type="text" + inputMode="numeric" เสมอ (ADR-006 Decision 2 — ห้าม type="number")
 * validate ตอน blur ไม่ใช่ทุกคีย์ (บทเรียนเดิมของโปรเจกต์ — พิมพ์แล้วโดน normalize จะหลุดโฟกัส,
 * CLAUDE.md §3.4) ตัวเลข 0–100 ทศนิยมไม่เกิน 1 ตำแหน่งเท่านั้น — ไม่มี cross-field validation
 * (ผลรวมเกิน 100% เป็นทางเลือกที่ถูกต้อง แสดงเป็นบรรทัดข้อมูล ไม่ใช่ error — §/settings composition)
 *
 * Deep-link (#creditCard จาก Dashboard "แก้ไขเกณฑ์"): มือถือ/เดสก์ท็อปเหมือนกัน — เลื่อนไปหาช่องนั้น,
 * โฟกัส, แล้วกระพริบเส้นขอบ 2 วินาที ผ่าน CSS class ปกติ (globals.css มี prefers-reduced-motion
 * ครอบ animation-duration ด้วย !important อยู่แล้ว จึงไม่ต้องเขียน media query ซ้ำที่นี่)
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { BUDGET_THRESHOLD_KEYS, DEFAULT_BUDGET_THRESHOLDS, BUDGET_ROW_DEFS } from '../../shared/utils/frontend/monthlySummary';
import styles from '../styles/Settings.module.css';

// prefix/suffixText เป็น UI-only ของฟอร์มนี้ — label/kind มาจาก BUDGET_ROW_DEFS แหล่งเดียว (TD-M07)
// ทั้ง 4 เกณฑ์คำนวณเป็น % ของรายรับทั้งหมดเหมือนกัน (monthlySummary.js's getMonthlySummaryModel,
// ratios.*) — เดิมมีแค่ generalExpense ที่ระบุตัวหาร ทำให้อีก 3 ช่องกำกวม (critique 2026-08-29 P1)
const FIELD_PRESENTATION = {
  generalExpense: { prefix: 'ไม่เกิน', suffixText: '% ของรายรับ' },
  dailyExpense: { prefix: 'ไม่เกิน', suffixText: '% ของรายรับ' },
  creditCard: { prefix: 'ไม่เกิน', suffixText: '% ของรายรับ' },
  savings: { prefix: 'อย่างน้อย', suffixText: '% ของรายรับ' }
};

const FIELD_DEFS = BUDGET_ROW_DEFS.map(({ id, label, kind }) => ({
  key: id,
  label,
  kind,
  ...FIELD_PRESENTATION[id]
}));

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

function buildDraftFromValues(values) {
  const draft = {};
  BUDGET_THRESHOLD_KEYS.forEach((key) => {
    const source = values && typeof values === 'object' ? values[key] : undefined;
    draft[key] = String(source ?? DEFAULT_BUDGET_THRESHOLDS[key]);
  });
  return draft;
}

export default function BudgetThresholdForm({ values, loading, loadFailed, saving, onSave, onRetryLoad }) {
  const [draft, setDraft] = useState(() => buildDraftFromValues(values));
  const [errors, setErrors] = useState({});
  const [isDirty, setIsDirty] = useState(false);
  const inputRefs = useRef({});
  const initializedRef = useRef(false);
  const [pulseKey, setPulseKey] = useState(null);

  // เติม draft จากค่าที่โหลดมาจริงครั้งแรก (หรือหลังกด "ลองอีกครั้ง") — ไม่ทับ draft ที่ผู้ใช้กำลังพิมพ์อยู่
  // loading=true (รอบโหลดใหม่เริ่ม/retry) รีเซ็ต flag เพื่อให้ populate ใหม่รอบถัดไปที่ loading กลับเป็น
  // false — ถ้าไม่รีเซ็ต การกด "ลองอีกครั้ง" หลัง loadFailed จะไม่ดึงค่าจริงที่โหลดสำเร็จมาเติมให้
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

  // deep-link #creditCard (จาก Dashboard "แก้ไขเกณฑ์") — เลื่อน/โฟกัส/กระพริบครั้งเดียวหลังฟอร์มพร้อมใช้งาน
  useEffect(() => {
    if (loading || typeof window === 'undefined') return;
    const hashKey = window.location.hash.replace('#', '');
    if (!hashKey || !BUDGET_THRESHOLD_KEYS.includes(hashKey)) return;
    const target = inputRefs.current[hashKey];
    if (!target) return;
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    target.focus({ preventScroll: true });
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
    BUDGET_THRESHOLD_KEYS.forEach((key) => { nextDraft[key] = String(DEFAULT_BUDGET_THRESHOLDS[key]); });
    setDraft(nextDraft);
    setErrors({});
    setIsDirty(true);
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    const nextErrors = {};
    let firstInvalidKey = null;
    const thresholds = {};

    FIELD_DEFS.forEach(({ key }) => {
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

    Promise.resolve(onSave(thresholds)).then((succeeded) => {
      if (succeeded !== false) setIsDirty(false);
    });
  };

  // บรรทัดสรุป — ข้อมูลอย่างเดียว ไม่ใช่ validation (ผลรวมเกิน 100% เป็นทางเลือกที่ถูกต้อง)
  const { capSum, goalSum } = useMemo(() => {
    const readNumeric = (key) => {
      const numeric = Number(draft[key]);
      return Number.isFinite(numeric) ? numeric : 0;
    };
    return {
      capSum: readNumeric('generalExpense') + readNumeric('dailyExpense') + readNumeric('creditCard'),
      goalSum: readNumeric('savings')
    };
  }, [draft]);

  const disableSave = loadFailed || saving;

  return (
    <form className={styles.thresholdForm} onSubmit={handleSubmit} noValidate>
      {loadFailed && (
        <div className={styles.loadFailedNotice} role="alert">
          <span>โหลดค่าที่บันทึกไว้ไม่สำเร็จ กำลังแสดงค่าเริ่มต้น</span>
          <button type="button" className={styles.retryButton} onClick={onRetryLoad}>ลองอีกครั้ง</button>
        </div>
      )}

      <div className={styles.fieldList}>
        {FIELD_DEFS.map(({ key, label, prefix, suffixText }) => {
          const fieldId = `budget-threshold-${key}`;
          const hintId = `${fieldId}-hint`;
          const errorId = `${fieldId}-error`;
          const hasError = Boolean(errors[key]);

          return (
            <div
              key={key}
              className={`${styles.fieldRow} ${pulseKey === key ? styles.fieldRowPulse : ''}`}
            >
              <label className={styles.fieldLabel} htmlFor={fieldId}>
                {label} {prefix}
              </label>
              <div className={styles.fieldInputWrapper}>
                <input
                  id={fieldId}
                  ref={(el) => { inputRefs.current[key] = el; }}
                  type="text"
                  inputMode="numeric"
                  className={`${styles.fieldInput} ${hasError ? styles.fieldInputError : ''}`}
                  value={draft[key]}
                  disabled={loading}
                  onChange={(event) => handleChange(key, event.target.value)}
                  onBlur={() => handleBlur(key)}
                  aria-describedby={hasError ? `${hintId} ${errorId}` : hintId}
                  aria-invalid={hasError ? 'true' : undefined}
                />
                <span className={styles.fieldSuffix} aria-hidden="true">{suffixText}</span>
              </div>
              <span id={hintId} className={styles.fieldHint}>{`${label} ${prefix} 0–100${suffixText}`}</span>
              {hasError && (
                <span id={errorId} className={styles.fieldError} role="alert">{errors[key]}</span>
              )}
            </div>
          );
        })}
      </div>

      <p className={styles.summaryLine}>
        {`รวมเพดานรายจ่าย ${capSum}% · เป้าหมายเงินออม ${goalSum}%`}
      </p>

      <div className={styles.formActions}>
        <button type="button" className={styles.resetButton} onClick={handleReset} disabled={loading}>
          คืนค่าเริ่มต้น
        </button>
        <button type="submit" className={styles.saveButton} disabled={!isDirty || disableSave}>
          {saving ? 'กำลังบันทึก...' : 'บันทึก'}
        </button>
      </div>
    </form>
  );
}
