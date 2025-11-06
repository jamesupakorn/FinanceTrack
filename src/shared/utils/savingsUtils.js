// savingsUtils.js
// ฟังก์ชันสำหรับ SavingsTable

export function mapSavingsApiToList(data) {
  if (Array.isArray(data.savings_list)) {
    return data.savings_list.map(item => ({
      ...item,
      รายการ: item.savings_type ?? item.รายการ ?? '',
      จำนวนเงิน: item.savings_amount ?? item.amount ?? item.จำนวนเงิน ?? 0
    }));
  } else if (Array.isArray(data.รายการเงินออม)) {
    return data.รายการเงินออม;
  } else {
    return [];
  }
}

export function calculateTotalSavings(list) {
  return list.reduce((sum, item) => sum + (parseFloat(item.จำนวนเงิน) || 0), 0);
}
