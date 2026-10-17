/**
 * Auto-fit ขนาดตัวอักษรของตัวเลขกลางวง CashFlowRing ให้พอดีรูกลางวง
 *
 * วัดจริงไม่ได้ตอน SSR/Jest (ไม่มี getBBox) จึงประมาณความกว้างเป็นหน่วย em ตามชนิดตัวอักษร
 * ฟังก์ชัน pure + deterministic: server กับ client ได้ markup เดียวกัน ไม่มี hydration mismatch
 *
 * RING_TEXT_MAX_WIDTH (viewBox units) มาจาก: ขอบรู = RADIUS_INNER − STROKE_INNER/2 = 84 − 13 = 71,
 * เว้นขอบ 4 → รัศมีใช้ได้ 67; บรรทัดฐาน y=138 (ห่างศูนย์กลาง ~24) ได้คอร์ด ≈ 125 → งบ 124
 * เป็น "ค่าเริ่มต้น" ที่ต้อง calibrate กับฟอนต์จริง (architecture review N-1) — ถ้า bbox ล้น ให้ลดค่านี้
 *
 * โมดูลนี้ยังให้บริการ CSS-width amount tiles ด้วย (CreditCardDashboard: หนี้คงเหลือรวม,
 * ครบกำหนดเร็ว ๆ นี้, วงเงินคงเหลือ, และสถิติยอดครบกำหนดรอบนี้ต่อการ์ด) ผ่าน `fitFontSizeCss` ที่เติม
 * เข้ามาด้านล่าง ส่วนของวง (`fitRingFontSize`, `estimateEmWidth`, `RING_TEXT_*`) ไม่เปลี่ยนแปลง
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

/**
 * ตัวเลขใน CreditCardDashboard ใช้ฟอนต์ IBM Plex Mono (--font-numeric) ซึ่งเป็น monospace จริง
 * ทุกตัวอักษร รวมถึง ',' และ '.' กว้างเท่ากัน ~0.6em ประมาณไว้ 0.62em (กว้างกว่าจริงเล็กน้อยโดยตั้งใจ
 * ตามหลัก "err wide" เดียวกับฝั่งวง) ตารางของ estimateEmWidth ใช้กับฟอนต์ Anuphan (proportional) จึง
 * ประเมินเครื่องหมายวรรคตอนของ mono ต่ำกว่าจริงครึ่งหนึ่ง ใช้ไม่ได้กับจุดนี้ (spec D-3)
 */
export const MONO_EM_PER_GLYPH = 0.62;

export function estimateMonoEmWidth(text) {
  let glyphCount = 0;
  for (const ch of String(text ?? '')) {
    if (!isThaiCombiningMark(ch.codePointAt(0))) glyphCount += 1;
  }
  return MONO_EM_PER_GLYPH * glyphCount;
}

/** พื้นสุดของขนาดตัวเลขที่ fit แล้ว (สูงกว่าพื้น 12px ทั่วไปของโปรเจกต์ และเท่ากับพื้นของวง) */
export const AMOUNT_TEXT_MIN_PX = 14;

/**
 * คืนค่า CSS `font-size` แบบ string สำหรับ clamp ตามความกว้างจริงของ container (หน่วย cqi)
 * ไม่ใช่ความกว้างคงที่แบบฝั่งวง เพราะ text-2xl ของโปรเจกต์นี้เป็น fluid (clamp) ไม่ใช่ขนาดคงที่
 * จึงต้องให้ browser คำนวณความกว้างจริงเอง (spec D-2) ฟังก์ชัน pure, deterministic, SSR-safe
 */
export function fitFontSizeCss(
  text,
  { estimate = estimateMonoEmWidth, minPx = AMOUNT_TEXT_MIN_PX, maxCss = 'var(--text-2xl)' } = {}
) {
  const em = estimate(text);
  if (!(em > 0)) return maxCss;
  // ปัดขึ้นด้วย epsilon กัน floating-point noise เช่น 4 * 0.62 * 100 = 248.00000000000003
  const emRounded = Math.ceil(em * 100 - 1e-9) / 100;
  const emStr = String(Number(emRounded));
  return `clamp(${minPx}px, calc(100cqi / ${emStr}), ${maxCss})`;
}
