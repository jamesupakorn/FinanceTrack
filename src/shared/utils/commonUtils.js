// commonUtils.js
// ฟังก์ชันใช้งานร่วมกันระหว่าง frontend, backend และ API

/**
 * ตรวจสอบว่ารายการถูกทำเครื่องหมายว่าชำระแล้วหรือไม่
 * @param {boolean|string} paid - ค่าจากฟิลด์ paid
 * @returns {boolean}
 */
export function isPaidFlag(paid) {
  // ตรวจสอบว่าค่าอยู่ในรูปแบบ boolean หรือ string 'true' ทั้ง 2 แบบถือว่าชำระแล้ว
  return paid === true || paid === 'true';
}

/**
 * ดึงรายการ key ที่ต้องลบจาก payload
 * @param {object} payload - ข้อมูลที่มี __removeKeys
 * @returns {array} รายการ key ที่ต้องลบ
 */
export function extractRemovalKeys(payload = {}) {
  // ดึงรายการ key ที่ต้องลบออกจาก payload
  const raw = payload?.__removeKeys;
  if (!Array.isArray(raw)) return []; // ถ้าไม่ใช่ array ให้คืน array ว่าง
  // กรอง key ที่เป็นข้อความและไม่ว่าง
  return raw.filter(key => typeof key === 'string' && key.length > 0);
}

/**
 * mapping สำหรับสรุปยอดตามบัญชี
 */
export const ACCOUNT_MAPPING = {
  "กรุงศรี": ["credit_kungsri"],
  "ttb": ["house", "credit_ttb"],
  "กสิกร": ["credit_kbank", "shopee", "netflix", "youtube", "youtube_membership"],
  "UOB": ["credit_uob"]
};

export const DEFAULT_BANK_ACCOUNTS = Object.keys(ACCOUNT_MAPPING);
export const LEGACY_ITEM_ACCOUNT_MAP = Object.entries(ACCOUNT_MAPPING).reduce((acc, [account, items]) => {
  items.forEach((item) => {
    acc[item] = account;
  });
  return acc;
}, {});

/**
 * คำนวณสรุปยอดตามบัญชีจากข้อมูลค่าใช้จ่าย
 * @param {object} expenseData - ข้อมูลค่าใช้จ่ายแบบ flat
 * @param {array} bankAccounts - รายชื่อบัญชีที่อนุญาต
 * @returns {object} สรุปยอด {ชื่อบัญชี: ยอดรวม}
 */
export function getAccountSummary(expenseData, bankAccounts = DEFAULT_BANK_ACCOUNTS) {
  const summary = {};
  const normalizedAccounts = Array.isArray(bankAccounts)
    ? Array.from(new Set(bankAccounts.map((item) => String(item || '').trim()).filter(Boolean)))
    : [];

  normalizedAccounts.forEach((account) => {
    summary[account] = 0;
  });

  Object.entries(expenseData || {}).forEach(([itemKey, item]) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return;
    if (['month', '_id', 'userId', 'periodKey', 'accountSummary', 'totalActualPaid', '__removeKeys', 'bankAccounts'].includes(itemKey)) return;
    const paid = item?.paid;
    if (isPaidFlag(paid)) return;

    const accountName = (typeof item.account === 'string' && item.account.trim().length > 0)
      ? item.account.trim()
      : (LEGACY_ITEM_ACCOUNT_MAP[itemKey] || 'ไม่ระบุบัญชี');

    if (!(accountName in summary)) {
      summary[accountName] = 0;
    }

    summary[accountName] += parseFloat(item?.actual || 0);
  });

  return summary;
}

/**
 * คำนวณยอดรวมค่าใช้จ่ายจากข้อมูล
 * @param {object} expenseData - ข้อมูลค่าใช้จ่ายแบบ flat
 * @returns {object} {totalActualPaid}
 */
export function getExpenseTotals(expenseData) {
  let totalActualPaid = 0; // รวมยอดจ่ายจริง
  // วนลูปแต่ละรายการค่าใช้จ่าย
  Object.values(expenseData || {}).forEach(item => {
    if (item && typeof item === 'object') {
      totalActualPaid += parseFloat(item.actual || 0);
    }
  });
  // คืนค่าโดยปัดเศษ 2 ตำแหน่ง
  return {
    totalActualPaid: Math.round(totalActualPaid * 100) / 100
  };
}

/**
 * ลบฟิลด์สรุปยอด/metadata ออกจากข้อมูล
 * @param {object} data - ข้อมูลดิบ
 * @returns {object} ข้อมูลที่ถูกทำความสะอาดแล้ว
 */
export function removeSummaryFields(data = {}) {
  const cleaned = { ...data }; // คัดลอก data object
  // ลบฟิลด์ที่เป็น metadata และไม่ต้องบันทึกลงฐานข้อมูล
  ['totalActualPaid', 'accountSummary', 'month', '_id', '__removeKeys'].forEach(field => {
    delete cleaned[field];
  });
  return cleaned; // คืน object ที่ทำความสะอาดแล้ว
}
