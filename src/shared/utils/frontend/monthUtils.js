// monthUtils.js
// รวมฟังก์ชันที่เกี่ยวกับการจัดการเดือน เช่น การคำนวณเดือนก่อนหน้า การแปลงข้อมูลเดือน ฯลฯ

/**
 * ดึงข้อมูลเดือนจาก object (เช่น { months: { ... } })
 * @param {object} obj - object ที่มี key months
 * @param {string} month - เดือนที่ต้องการ (YYYY-MM)
 * @returns {object} - ข้อมูลเดือนนั้น หรือ {} ถ้าไม่มี
 */
export function getMonthData(obj, month) {
  if (!obj || !obj.months) return {};
  return obj.months[month] ? JSON.parse(JSON.stringify(obj.months[month])) : {};
}

/**
 * คำนวณเดือนก่อนหน้า (YYYY-MM)
 * @param {string} month - เดือนปัจจุบัน (YYYY-MM)
 * @returns {string} - เดือนก่อนหน้า (YYYY-MM)
 */
export function getPrevMonth(month) {
  const [y, m] = month.split('-').map(Number);
  let prevY = y, prevM = m - 1;
  if (prevM < 1) { prevY -= 1; prevM = 12; }
  return `${prevY}-${String(prevM).padStart(2, '0')}`;
}

/**
 * แปลงเดือน (YYYY-MM) เป็น label ภาษาไทย เช่น 'ตุลาคม 2025'
 * @param {string} month - เดือน (YYYY-MM)
 * @returns {string} - label ภาษาไทย
 */
export function formatMonthLabelTH(month) {
  const [year, m] = month.split('-');
  const date = new Date(Number(year), Number(m) - 1, 1);
  return date.toLocaleDateString('th-TH', { year: 'numeric', month: 'long' });
}
