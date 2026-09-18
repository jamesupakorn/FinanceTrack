// savingsUtils.ts
// ฟังก์ชันสำหรับ SavingsTable

export function mapSavingsApiToList(data: {
  savings_list?: Array<Record<string, unknown>>;
  รายการเงินออม?: Array<Record<string, unknown>>;
}): Array<Record<string, unknown>> {
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
