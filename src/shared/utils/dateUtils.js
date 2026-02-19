// dateUtils.js
// Shared date utility functions for expense tracking and notifications

export const THAI_MONTH_LABELS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

const DAY_IN_MS = 24 * 60 * 60 * 1000;

/**
 * Normalize number or string to zero-padded 2-digit string
 */
export function normalizeMonthPart(value) {
  return String(value).padStart(2, '0');
}

/**
 * Get number of days in a specific month
 */
export function getDaysInMonth(year, monthIndex) {
  return new Date(year, monthIndex + 1, 0).getDate();
}

/**
 * Get current date info object with formatted keys
 */
export function getCurrentDateInfo(dateInput) {
  const date = dateInput ? new Date(dateInput) : new Date();
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  const yyyy = date.getFullYear();
  const monthIndex = date.getMonth();
  const mm = normalizeMonthPart(monthIndex + 1);
  const dd = normalizeMonthPart(date.getDate());
  return {
    date,
    year: yyyy,
    monthIndex,
    monthKey: `${yyyy}-${mm}`,
    day: date.getDate(),
    dateKey: `${yyyy}-${mm}-${dd}`,
    daysInMonth: getDaysInMonth(yyyy, monthIndex)
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
 * Clamp due day to valid range (1-31), returns null if out of range
 */
export function clampDueDay(num) {
  if (num >= 1 && num <= 31) {
    return num;
  }
  return null;
}

/**
 * Format month key to Thai format (e.g., "ม.ค. 2567")
 */
export function formatMonthKeyTH(monthKey = '') {
  const [yearStr, monthStr] = monthKey.split('-');
  const year = Number(yearStr);
  const monthIndex = Number(monthStr) - 1;
  if (!Number.isFinite(year) || monthIndex < 0 || monthIndex > 11) {
    return monthKey;
  }
  const thaiYear = year + 543;
  const monthLabel = THAI_MONTH_LABELS[monthIndex] || monthStr;
  return `${monthLabel} ${thaiYear}`;
}

/**
 * Format date to Thai format (e.g., "15 ม.ค. 2567")
 */
export function formatThaiDate(target) {
  const day = target.day;
  const monthLabel = THAI_MONTH_LABELS[target.monthIndex] || normalizeMonthPart(target.monthIndex + 1);
  const thaiYear = target.year + 543;
  return `${day} ${monthLabel} ${thaiYear}`;
}

/**
 * Build due date string with day clamping (e.g., "31 ม.ค. 2567")
 */
export function buildDueDateString(target, dueDay) {
  const actualDay = Math.min(dueDay, target.daysInMonth);
  const monthLabel = THAI_MONTH_LABELS[target.monthIndex] || normalizeMonthPart(target.monthIndex + 1);
  const thaiYear = target.year + 543;
  return `${actualDay} ${monthLabel} ${thaiYear}`;
}

/**
 * Get due date from day value
 */
export function getDueDateFromDay(dayValue) {
  const parsed = Number(dayValue);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  const today = getStartOfToday();
  const year = today.getFullYear();
  const month = today.getMonth();
  const lastDay = new Date(year, month + 1, 0).getDate();
  const safeDay = Math.min(lastDay, Math.max(1, Math.round(parsed)));
  const date = new Date(year, month, safeDay);
  date.setHours(0, 0, 0, 0);
  return date;
}

/**
 * Get start of today (00:00:00)
 */
export function getStartOfToday() {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date;
}

/**
 * Format date as Thai date label
 */
export function formatDueDateLabel(date, options = { day: 'numeric', month: 'short' }) {
  if (!date) return '';
  return date.toLocaleDateString('th-TH', options);
}

/**
 * Calculate difference in days from today to due date
 */
export function calculateDaysDifference(dueDateFromDay) {
  const parsedDate = getDueDateFromDay(dueDateFromDay);
  if (!parsedDate) return null;
  const today = getStartOfToday();
  return Math.ceil((parsedDate - today) / DAY_IN_MS);
}
