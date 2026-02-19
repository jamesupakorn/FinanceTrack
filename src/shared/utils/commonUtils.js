// commonUtils.js
// Shared utility functions used across frontend, backend, and API

/**
 * Check if an expense item is marked as paid
 * @param {boolean|string} paid - paid value from expense item
 * @returns {boolean}
 */
export function isPaidFlag(paid) {
  // ตรวจสอบว่าค่าอยู่ในรูปแบบ boolean หรือ string 'true' ทั้ง 2 แบบถือว่าชำระแล้ว
  return paid === true || paid === 'true';
}

/**
 * Extract and validate removal keys from API payload
 * @param {object} payload - request payload with __removeKeys
 * @returns {array} array of keys to remove
 */
export function extractRemovalKeys(payload = {}) {
  // ดึงรายการ key ที่ต้องลบออกจาก payload
  const raw = payload?.__removeKeys;
  if (!Array.isArray(raw)) return []; // ถ้าไม่ใช่ array ให้คืน array ว่าง
  // กรอง key ที่เป็นข้อความและไม่ว่าง
  return raw.filter(key => typeof key === 'string' && key.length > 0);
}

/**
 * Account summary mapping for expense tracking
 */
export const ACCOUNT_MAPPING = {
  "กรุงศรี": ["credit_kungsri"],
  "ttb": ["house", "credit_ttb"],
  "กสิกร": ["credit_kbank", "shopee", "netflix", "youtube", "youtube_membership"],
  "UOB": ["credit_uob"]
};

/**
 * Calculate account summary from expense data
 * @param {object} expenseData - flat expense data object
 * @returns {object} account summary object {accountName: totalAmount}
 */
export function getAccountSummary(expenseData) {
  const summary = {}; // เก็บยอดรวมสำหรับแต่ละบัญชี
  // วนลูปแต่ละบัญชี (กรุงศรี, TTB, กสิกร, UOB)
  Object.entries(ACCOUNT_MAPPING).forEach(([account, items]) => {
    let sum = 0;
    // วนลูปรายการที่อยู่ในบัญชีนี้
    items.forEach(item => {
      const paid = expenseData[item]?.paid;
      // รวมเฉพาะรายการที่ยังไม่ได้ชำระ
      if (!isPaidFlag(paid)) {
        sum += parseFloat(expenseData[item]?.estimate || 0);
      }
    });
    summary[account] = sum; // บันทึกยอดรวมของบัญชี
  });
  return summary;
}

/**
 * Calculate total amounts from expense data
 * @param {object} expenseData - flat expense data object
 * @returns {object} {totalEstimate, totalActualPaid}
 */
export function getExpenseTotals(expenseData) {
  let totalEstimate = 0; // รวมยอดคาดการณ์
  let totalActualPaid = 0; // รวมยอดจ่ายจริง
  // วนลูปแต่ละรายการค่าใช้จ่าย
  Object.values(expenseData || {}).forEach(item => {
    if (item && typeof item === 'object') {
      totalEstimate += parseFloat(item.estimate || 0);
      totalActualPaid += parseFloat(item.actual || 0);
    }
  });
  // คืนค่าทั้งสองโดยปัดเศษ 2 ตำแหน่ง
  return {
    totalEstimate: Math.round(totalEstimate * 100) / 100,
    totalActualPaid: Math.round(totalActualPaid * 100) / 100
  };
}

/**
 * Remove summary fields from data object
 * @param {object} data - data object
 * @returns {object} cleaned data
 */
export function removeSummaryFields(data = {}) {
  const cleaned = { ...data }; // คัดลอก data object
  // ลบฟิลด์ที่เป็น metadata และไม่ต้องบันทึกลงฐานข้อมูล
  ['totalEstimate', 'totalActualPaid', 'accountSummary', 'month', '_id', '__removeKeys'].forEach(field => {
    delete cleaned[field];
  });
  return cleaned; // คืน object ที่ทำความสะอาดแล้ว
}
