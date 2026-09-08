// dateUtils.js
// ฟังก์ชันวันที่ที่ใช้ร่วมกันสำหรับค่าใช้จ่ายและการแจ้งเตือน

export const THAI_MONTH_LABELS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
export const END_OF_MONTH_DUE_DAY = 'EOM';

/**
 * แปลงตัวเลข/สตริงให้เป็นสตริง 2 หลัก (เติม 0 ด้านหน้า)
 */
export function normalizeMonthPart(value) {
  // เติม 0 ข้างหน้า เช่น 1 → '01', 12 → '12'
  return String(value).padStart(2, '0');
}

/**
 * หาจำนวนวันของเดือนที่ระบุ
 */
export function getDaysInMonth(year, monthIndex) {
  // สร้างวันสุดท้ายของเดือน (ค่า 0) เพื่อหาจำนวนวันในเดือน
  return new Date(year, monthIndex + 1, 0).getDate();
}

/**
 * คืนข้อมูลวันที่ปัจจุบันพร้อม key ที่ฟอร์แมตแล้ว
 */
export function getCurrentDateInfo(dateInput) {
  // ใช้วันที่ที่ส่งมา หรือใช้วันปัจจุบัน
  const date = dateInput ? new Date(dateInput) : new Date();
  // ตรวจสอบว่า date ถูกต้อง
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  const yyyy = date.getFullYear();
  const monthIndex = date.getMonth(); // 0-11
  const mm = normalizeMonthPart(monthIndex + 1);
  const dd = normalizeMonthPart(date.getDate());
  // คืนค่า object ที่มีข้อมูลการตรวจสอบวันที่
  return {
    date,
    year: yyyy,
    monthIndex,
    monthKey: `${yyyy}-${mm}`, // เช่น '2025-02'
    day: date.getDate(),
    dateKey: `${yyyy}-${mm}-${dd}`, // เช่น '2025-02-19'
    daysInMonth: getDaysInMonth(yyyy, monthIndex) // วันสุดท้ายของเดือน
  };
}

/**
 * normalizeDueDayValue(value)
 * ฟังก์ชัน: ตรวจสอบและแปลงค่าวันที่ครบกำหนดให้เป็นตัวเลข ต้องอยู่ในช่วง 1-31
 * 
 * ตัวอย่าง:
 *   normalizeDueDayValue(15)    → 15  (ตัวเลขที่ถูกต้อง)
 *   normalizeDueDayValue("10")  → 10  (string แปลงเป็นตัวเลข)
 *   normalizeDueDayValue(0)     → null (ต่ำกว่า 1)
 *   normalizeDueDayValue(32)    → null (สูงกว่า 31)
 *   normalizeDueDayValue("")    → null (string ว่าง)
 * 
 * ใช้เพื่อให้แน่ใจว่าวันที่ครบกำหนดอยู่ในช่วงที่ถูกต้อง
 * 
 * @param {number|string} value - ค่าวันที่ที่ต้องการตรวจสอบ
 * @returns {number|null} - ตัวเลขวางที่ถูกต้อง (1-31) หรือ null ถ้าไม่ถูกต้อง
 */
export function normalizeDueDayValue(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return clampDueDay(Math.floor(value));
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return clampDueDay(Math.floor(parsed));
    }
  }
  return null;
}

/**
 * ตรวจสอบว่าค่าวันครบกำหนดเป็น "วันสิ้นเดือน" หรือไม่
 */
export function isEndOfMonthDueDay(value) {
  return String(value || '').trim().toUpperCase() === END_OF_MONTH_DUE_DAY;
}

/**
 * แปลงค่าวันครบกำหนดให้เป็นเลขวันที่ที่ใช้จริงของเดือนนั้น
 */
export function resolveDueDayForMonth(dueDayValue, daysInMonth) {
  const safeDaysInMonth = Number.isFinite(daysInMonth) && daysInMonth > 0
    ? Math.floor(daysInMonth)
    : 31;
  if (isEndOfMonthDueDay(dueDayValue)) {
    return safeDaysInMonth;
  }
  const numericDay = normalizeDueDayValue(dueDayValue);
  if (!numericDay) return null;
  return Math.min(numericDay, safeDaysInMonth);
}

/**
 * จำกัดค่าวันครบกำหนดให้อยู่ในช่วง 1-31
 */
export function clampDueDay(num) {
  // ตรวจสอบว่ามีค่าอยู่ในช่วง 1-31 หรือไม่
  if (num >= 1 && num <= 31) {
    return num; // ส่งค่านั้นกลับ
  }
  return null; // ค่าไม่ถูกต้อง
}

/**
 * ฟอร์แมตเดือนเป็นภาษาไทย เช่น "ม.ค. 2567"
 */
export function formatMonthKeyTH(monthKey = '') {
  // สตริงตัดแยก YYYY-MM
  const [yearStr, monthStr] = monthKey.split('-');
  const year = Number(yearStr);
  const monthIndex = Number(monthStr) - 1; // แปลง 1-based เป็น 0-based
  // ตรวจสอบว่าปี และเดือนถูกต้อง
  if (!Number.isFinite(year) || monthIndex < 0 || monthIndex > 11) {
    return monthKey; // ถ้าไม่ถูกต้องคืนค่าเดิม
  }
  // แปลงเป็นปีพุทธศักราช (บวก 543)
  const thaiYear = year + 543;
  const monthLabel = THAI_MONTH_LABELS[monthIndex] || monthStr;
  // เช่น 'ม.ค. 2567'
  return `${monthLabel} ${thaiYear}`;
}

/**
 * ฟอร์แมตวันที่เป็นภาษาไทย เช่น "15 ม.ค. 2567"
 */
export function formatThaiDate(target) {
  // ดึงข้อมูลวันที่, เดือน, ปี
  const day = target.day;
  const monthLabel = THAI_MONTH_LABELS[target.monthIndex] || normalizeMonthPart(target.monthIndex + 1);
  // แปลงเป็นปีพุทธศักราช
  const thaiYear = target.year + 543;
  // เช่น '19 ก.พ. 2568'
  return `${day} ${monthLabel} ${thaiYear}`;
}

/**
 * สร้างข้อความวันครบกำหนด พร้อมจำกัดวันให้ไม่เกินวันสุดท้ายของเดือน
 */
export function buildDueDateString(target, dueDay) {
  // ลดคำค่าวันให้อยู่ในช่วงวันสุดท้ายของเดือน เช่น เดือนกุมภาพันธ์มี 28 วัน ถ้า 31 → 28
  const actualDay = resolveDueDayForMonth(dueDay, target.daysInMonth);
  if (!actualDay) {
    return formatThaiDate(target);
  }
  const monthLabel = THAI_MONTH_LABELS[target.monthIndex] || normalizeMonthPart(target.monthIndex + 1);
  const thaiYear = target.year + 543;
  // เช่น '28 ก.พ. 2568'
  return `${actualDay} ${monthLabel} ${thaiYear}`;
}

function parseMonthKeyToYearMonth(monthKey) {
  if (typeof monthKey !== 'string') return null;
  const trimmedMonthKey = monthKey.trim();
  if (!/^\d{4}-\d{2}$/.test(trimmedMonthKey)) return null;
  const [yearStr, monthStr] = trimmedMonthKey.split('-');
  const year = Number(yearStr);
  const monthIndex = Number(monthStr) - 1;
  if (!Number.isFinite(year) || !Number.isFinite(monthIndex) || monthIndex < 0 || monthIndex > 11) {
    return null;
  }
  return { year, monthIndex };
}

/**
 * สร้างวันที่ครบกำหนดจากเลขวัน
 */
export function getDueDateFromDay(dayValue, monthKey) {
  const monthContext = parseMonthKeyToYearMonth(monthKey);
  // เคุวตา 00:00:00
  const today = getStartOfToday();
  const year = monthContext ? monthContext.year : today.getFullYear();
  const monthIndex = monthContext ? monthContext.monthIndex : today.getMonth();
  // หาจำนวันสุดท้ายของเดือน
  const lastDay = new Date(year, monthIndex + 1, 0).getDate();
  // ลดไวดนี่ให้อยู่ในช่วงวันสุดท้ายของเดือน
  const safeDay = resolveDueDayForMonth(dayValue, lastDay);
  if (!safeDay) return null;
  // สร้าง object วันแตว 00:00:00
  const date = new Date(year, monthIndex, safeDay);
  date.setHours(0, 0, 0, 0);
  return date;
}

/**
 * คืนวันที่ปัจจุบันที่เวลา 00:00:00
 */
export function getStartOfToday() {
  // สร้าง object วันปัจจุบันโดยตั้งเวลาเวลา 00:00:00
  const date = new Date();
  date.setHours(0, 0, 0, 0); // ตั้งเวลานิมิ นาที ยาวินาที วินาที
  return date;
}

/**
 * ฟอร์แมตวันที่เป็นสตริงภาษาไทยสำหรับแสดงผล
 */
export function formatDueDateLabel(date, options = { day: 'numeric', month: 'short' }) {
  // จัดรูปแบบวันเป็นสตริง ไทย เช่น '19', '19 ก.พ. 568'
  if (!date) return '';
  return date.toLocaleDateString('th-TH', options);
}
