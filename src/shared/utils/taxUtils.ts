// taxUtils.js
// ฟังก์ชันช่วยคำนวณและจัดการข้อมูลภาษี

/**
 * สร้าง object เดือนเปล่า (12 เดือน)
 * @param {string} defaultValue - ค่า default เช่น '0.00'
 * @returns {object}
 */
export function createDefault12MonthsObject(defaultValue: string = '0.00'): Record<string, string> {
  const obj: Record<string, string> = {};
  for (let i = 1; i <= 12; i++) {
    obj[String(i).padStart(2, '0')] = defaultValue;
  }
  return obj;
}

/**
 * คำนวณผลรวมสะสมถึงเดือนที่กำหนด
 * @param {object} monthlyObj - object { '01': value, ... }
 * @param {string} upToMonth - เดือนสุดท้าย (เช่น '05')
 * @param {function} parseFn - ฟังก์ชันแปลงค่า (เช่น parseFloat)
 * @returns {number}
 */
export function sumAccumulated(
  monthlyObj: Record<string, string>,
  upToMonth: string,
  parseFn: (value: number | string) => number = parseFloat as (value: number | string) => number
): number {
  const months = Object.keys(monthlyObj).sort();
  const idx = months.indexOf(upToMonth);
  let sum = 0;
  for (let i = 0; i <= idx; i++) {
    sum += parseFn(monthlyObj[months[i]]);
  }
  return sum;
}

/**
 * ผลรวมทั้งปี
 * @param {object} monthlyObj - object { '01': value, ... }
 * @param {function} parseFn - ฟังก์ชันแปลงค่า (เช่น parseFloat)
 * @returns {number}
 */
export function sumYearly(
  monthlyObj: Record<string, string>,
  parseFn: (value: number | string) => number = parseFloat as (value: number | string) => number
): number {
  return Object.values(monthlyObj).reduce((sum, v) => sum + parseFn(v), 0);
}

/**
 * เรียงปีจากมากไปน้อย
 * @param {object} yearObj - object ที่ key เป็นปี
 * @returns {string[]} - array ปีเรียงจากมากไปน้อย
 */
export function getSortedYears(yearObj: Record<string, unknown> | null | undefined): string[] {
  if (!yearObj) return [];
  return Object.keys(yearObj).sort((a, b) => parseInt(b) - parseInt(a));
}
