/**
 * Auto-fit ขนาดตัวอักษรของตัวเลขกลางวง CashFlowRing ให้พอดีรูกลางวง
 *
 * วัดจริงไม่ได้ตอน SSR/Jest (ไม่มี getBBox) จึงประมาณความกว้างเป็นหน่วย em ตามชนิดตัวอักษร
 * ฟังก์ชัน pure + deterministic: server กับ client ได้ markup เดียวกัน ไม่มี hydration mismatch
 *
 * RING_TEXT_MAX_WIDTH (viewBox units) มาจาก: ขอบรู = RADIUS_INNER − STROKE_INNER/2 = 84 − 13 = 71,
 * เว้นขอบ 4 → รัศมีใช้ได้ 67; บรรทัดฐาน y=138 (ห่างศูนย์กลาง ~24) ได้คอร์ด ≈ 125 → งบ 124
 * เป็น "ค่าเริ่มต้น" ที่ต้อง calibrate กับฟอนต์จริง (architecture review N-1) — ถ้า bbox ล้น ให้ลดค่านี้
 */

export const RING_TEXT_MAX_WIDTH = 124;
export const RING_TEXT_MAX_SIZE = 26;
export const RING_TEXT_MIN_SIZE = 14;

const EM_DIGIT = 0.58;
const EM_PUNCT = 0.3;
const EM_SPACE = 0.28;
const EM_SIGN = 0.6;
const EM_BAHT = 0.62;
const EM_OTHER = 0.6;

function isThaiCombiningMark(code) {
  return code === 0x0e31 || (code >= 0x0e34 && code <= 0x0e3a) || (code >= 0x0e47 && code <= 0x0e4e);
}

export function estimateEmWidth(text) {
  let total = 0;
  for (const ch of String(text ?? '')) {
    const code = ch.codePointAt(0);
    if (code >= 0x30 && code <= 0x39) total += EM_DIGIT;
    else if (ch === ',' || ch === '.') total += EM_PUNCT;
    else if (ch === ' ') total += EM_SPACE;
    else if (ch === '+' || ch === '−' || ch === '-') total += EM_SIGN;
    else if (ch === '฿') total += EM_BAHT;
    else if (isThaiCombiningMark(code)) total += 0;
    else total += EM_OTHER;
  }
  return total;
}

export function fitRingFontSize(
  text,
  { maxWidth = RING_TEXT_MAX_WIDTH, maxSize = RING_TEXT_MAX_SIZE, minSize = RING_TEXT_MIN_SIZE } = {}
) {
  const em = estimateEmWidth(text);
  if (!(em > 0)) return maxSize;
  const size = Math.floor(maxWidth / em);
  return Math.min(maxSize, Math.max(minSize, size));
}
