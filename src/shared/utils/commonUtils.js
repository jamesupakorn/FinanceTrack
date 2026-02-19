// commonUtils.js
// Shared utility functions used across frontend, backend, and API

/**
 * Check if an expense item is marked as paid
 * @param {boolean|string} paid - paid value from expense item
 * @returns {boolean}
 */
export function isPaidFlag(paid) {
  return paid === true || paid === 'true';
}

/**
 * Extract and validate removal keys from API payload
 * @param {object} payload - request payload with __removeKeys
 * @returns {array} array of keys to remove
 */
export function extractRemovalKeys(payload = {}) {
  const raw = payload?.__removeKeys;
  if (!Array.isArray(raw)) return [];
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
  const summary = {};
  Object.entries(ACCOUNT_MAPPING).forEach(([account, items]) => {
    let sum = 0;
    items.forEach(item => {
      const paid = expenseData[item]?.paid;
      if (!isPaidFlag(paid)) {
        sum += parseFloat(expenseData[item]?.estimate || 0);
      }
    });
    summary[account] = sum;
  });
  return summary;
}

/**
 * Calculate total amounts from expense data
 * @param {object} expenseData - flat expense data object
 * @returns {object} {totalEstimate, totalActualPaid}
 */
export function getExpenseTotals(expenseData) {
  let totalEstimate = 0;
  let totalActualPaid = 0;
  Object.values(expenseData || {}).forEach(item => {
    if (item && typeof item === 'object') {
      totalEstimate += parseFloat(item.estimate || 0);
      totalActualPaid += parseFloat(item.actual || 0);
    }
  });
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
  const cleaned = { ...data };
  ['totalEstimate', 'totalActualPaid', 'accountSummary', 'month', '_id', '__removeKeys'].forEach(field => {
    delete cleaned[field];
  });
  return cleaned;
}
