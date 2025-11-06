// investmentUtils.js
// ฟังก์ชันช่วยจัดการข้อมูลการลงทุน

/**
 * เฉลี่ยเปอร์เซ็นต์ให้ครบ 100% ตามจำนวนรายการ
 * @param {number} count - จำนวนรายการ
 * @returns {string[]} - array ของเปอร์เซ็นต์แต่ละรายการ (string)
 */
export function averagePercent(count) {
  if (count <= 0) return [];
  const avg = Math.floor((100 * 100) / count) / 100;
  let remain = 100 - avg * (count - 1);
  return Array.from({ length: count }, (_, idx) => (idx === count - 1 ? remain : avg).toString());
}

/**
 * คำนวณ amount จาก percent และ baseAmount
 * @param {number|string} percent
 * @param {number|string} baseAmount
 * @returns {string}
 */
export function calcAmountFromPercent(percent, baseAmount) {
  const p = parseFloat(percent) || 0;
  const b = parseFloat(baseAmount) || 0;
  return ((p / 100) * b).toFixed(2);
}

/**
 * รวมเปอร์เซ็นต์ทั้งหมด
 * @param {Array} investments - array ของ object ที่มี percent
 * @returns {number}
 */
export function sumPercent(investments) {
  return investments.reduce((sum, item) => sum + (parseFloat(item.percent) || 0), 0);
}

/**
 * map ข้อมูลลงทุนจาก backend ให้พร้อมใช้งานใน state
 * @param {Array} data
 * @returns {Array}
 */
export function mapInvestmentData(data) {
  return Array.isArray(data)
    ? data.map(item => ({
        ...item,
        percent: item.percent?.toString() ?? '',
        amount: item.amount?.toString() ?? '',
        name: item.name ?? ''
      }))
    : [];
}
