import type { ExpenseItem } from '../../types/domain';
import { calculateOvertimeTotal, normaliseOvertimeRows } from '../overtimeUtils';

/** Module-private shape for calculateSalarySummary's single caller (pages/api/salary.js). */
interface SalaryBreakdown {
  income?: Record<string, unknown>;
  deduct?: Record<string, unknown>;
  /** แถว OT ที่บันทึกไว้ (ดิบ) — normalise ที่นี่ก่อนคำนวณเสมอ */
  overtime?: unknown;
  /** ต้องส่งมาด้วยทุกครั้ง มิฉะนั้น OT จะคิดเป็น 0 เงียบ ๆ (V-1, DATA_MODEL inv. 5) */
  month?: string;
}

// Salary summary calculation
export function calculateSalarySummary(salaryData: SalaryBreakdown): {
  total_income: number;
  total_deduct: number;
  net_income: number;
} {
  const incomeTotal = Object.values(salaryData.income || {}).reduce((sum: number, val) => sum + (parseFloat(String(val)) || 0), 0);
  // ยอด OT ที่คำนวณได้ บวกเพิ่มจากผลรวม income — ยอด OT แบบเดิม (income.overtime_*) อยู่ในผลรวม
  // ข้างบนแล้ว จึงไม่ถูกนับซ้ำที่นี่ (D-1 / BR-OT-009)
  // salary อ่านด้วย parseFloat(String()) ชุดเดียวกับผลรวม income เพื่อไม่ให้สองฝั่งตีค่าต่างกัน (A-3)
  const overtimeTotal = calculateOvertimeTotal(
    normaliseOvertimeRows(salaryData.overtime),
    parseFloat(String(salaryData.income?.salary)) || 0,
    salaryData.month ?? ''
  );
  const total_income = incomeTotal + overtimeTotal;
  const total_deduct = Object.values(salaryData.deduct || {}).reduce((sum: number, val) => sum + (parseFloat(String(val)) || 0), 0);
  const net_income = total_income - total_deduct;
  return { total_income, total_deduct, net_income };
}

// Savings summary calculation
export function calculateTotalSavings(savingsList: unknown = []): number {
  if (!Array.isArray(savingsList)) return 0;
  return savingsList.reduce((sum, item) => {
    const amount = item?.savings_amount ?? item?.amount ?? item?.จำนวนเงิน ?? 0;
    return sum + (parseFloat(String(amount).replace(/,/g, '')) || 0);
  }, 0);
}

/** Module-private, minimal duck-typed shape — only the 2 methods enforceMonthLimit's own logic touches. */
interface MonthLimitCollection {
  find(
    filter: Record<string, unknown>,
    options?: { projection?: Record<string, number> }
  ): { toArray(): Promise<Array<Record<string, unknown>>> };
  deleteMany(filter: Record<string, unknown>): Promise<unknown>;
}

interface EnforceMonthLimitOptions {
  filter?: Record<string, unknown>;
  additionalMonths?: string[];
  sortComparator?: (a: string, b: string) => number;
}

export async function enforceMonthLimit(
  collection: MonthLimitCollection | null | undefined,
  limit: number = 15,
  options: EnforceMonthLimitOptions = {}
): Promise<{ retainedMonths: string[] }> {
  if (!collection || typeof collection.find !== 'function') {
    return { retainedMonths: [] };
  }

  const {
    filter = {},
    additionalMonths = [],
    sortComparator,
  } = options || {};

  const baseFilter = { ...filter, month: { $exists: true } };
  const monthDocs = await collection
    .find(baseFilter, { projection: { month: 1 } })
    .toArray();

  const monthSet = new Set<string>();
  monthDocs.forEach(doc => {
    if (doc && typeof doc.month === 'string' && doc.month.length > 0) {
      monthSet.add(doc.month);
    }
  });
  additionalMonths.forEach(monthKey => {
    if (typeof monthKey === 'string' && monthKey.length > 0) {
      monthSet.add(monthKey);
    }
  });

  const comparator = typeof sortComparator === 'function'
    ? sortComparator
    : (a: string, b: string) => b.localeCompare(a);
  const orderedMonths = Array.from(monthSet).sort(comparator);
  const retainedMonths = orderedMonths.slice(0, limit);
  const monthsToDelete = orderedMonths.slice(limit);

  if (monthsToDelete.length > 0) {
    const deleteFilter = { ...filter, month: { $in: monthsToDelete } };
    await collection.deleteMany(deleteFilter);
  }

  return { retainedMonths };
}

// Investment: map doc to month-data object
export function mapInvestmentDoc(doc: { investments?: unknown[] } | null | undefined): unknown[] {
  return doc && doc.investments ? doc.investments : [];
}

// Tax accumulated: ensure monthly_provident always present
export function ensureMonthlyProvident(doc: Record<string, unknown>): Record<string, unknown> {
  if (!doc.monthly_provident) doc.monthly_provident = {};
  return doc;
}
// Utility: คำนวณผลรวมจาก object
export function sumValues(obj: Record<string, unknown>, excludeKeys: string[] = []): number {
  return Object.entries(obj)
    .filter(([key, v]) => typeof v === 'number' && !excludeKeys.includes(key))
    .reduce((sum, [, value]) => sum + (parseFloat(String(value)) || 0), 0);
}

// Utility: map doc expense/income เป็น flat object พร้อม summary
export function mapDocToFlatItemObjectWithTotals(
  doc: Record<string, unknown> | null | undefined
): Record<string, Partial<ExpenseItem>> & { bankAccounts?: string[]; totalActualPaid?: number } {
  if (!doc) return {};
  if (doc.months) {
    // เอกสารที่มี .months เป็น "months map" (รูปแบบอื่นทั้งก้อน) ไม่ใช่ flat item map —
    // ฟังก์ชันนี้คืนค่า doc ดิบตามเดิมทุกประการ (โค้ดเดิมก็ทำแบบนี้) แม้จะไม่ตรงกับ
    // return type ที่ประกาศไว้ในทุก branch อื่น — cast เดียว ไม่เปลี่ยนพฤติกรรม
    return doc as Record<string, Partial<ExpenseItem>> & {
      bankAccounts?: string[];
      totalActualPaid?: number;
    };
  }

  const out: Record<string, unknown> = {};
  const summaryFields = new Set(['month', '_id', 'accountSummary', 'totalActualPaid', 'bankAccounts']);

  if (Array.isArray(doc.bankAccounts)) {
    out.bankAccounts = Array.from(
      new Set(doc.bankAccounts.map((item) => String(item || '').trim()).filter(Boolean))
    );
  }

  if (doc.actual && typeof doc.actual === 'object') {
    const actualBucket = doc.actual as Record<string, unknown>;
    const items = Array.from(new Set(Object.keys(actualBucket)));
    items.forEach((key) => {
      const row = doc[key] as Record<string, unknown> | undefined;
      const dueDayValue = row?.dueDay ?? (typeof row?.dueDate === 'string' ? row.dueDate : undefined);
      out[key] = {
        name: typeof row?.name === 'string' ? row.name : '',
        actual: actualBucket[key] ?? 0,
        account: typeof row?.account === 'string' ? row.account : '',
        paid: false,
        ...(dueDayValue !== undefined ? { dueDay: dueDayValue } : {})
      };
    });
  } else {
    Object.keys(doc).forEach((key) => {
      if (summaryFields.has(key)) return;
      const val = doc[key];
      if (val && typeof val === 'object' && !Array.isArray(val)) {
        const row = val as Record<string, unknown>;
        const dueDayValue = row.dueDay ?? (typeof row.dueDate === 'string' ? row.dueDate : undefined);
        out[key] = {
          name: typeof row.name === 'string' ? row.name : '',
          actual: row.actual ?? 0,
          account: typeof row.account === 'string' ? row.account : '',
          paid: typeof row.paid === 'boolean' ? row.paid : false,
          ...(dueDayValue !== undefined ? { dueDay: dueDayValue } : {})
        };
      }
    });
  }
  // Add summary fields
  const sumActual = Object.values(out).reduce<number>((sum, v) => {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return sum;
    const actualValue = (v as Record<string, unknown>).actual;
    return sum + (actualValue ? parseFloat(String(actualValue)) || 0 : 0);
  }, 0);
  out.totalActualPaid = Math.round(sumActual * 100) / 100;
  return out as Record<string, Partial<ExpenseItem>> & {
    bankAccounts?: string[];
    totalActualPaid?: number;
  };
}

// Utility: ลบ field รวมยอดที่รู้จัก (เดิมชื่อ removeSummaryFields — เปลี่ยนชื่อกัน collision กับ
// commonUtils.ts's removeSummaryFields ซึ่งมี behavior ต่างกัน, TD-M15)
export function stripKnownTotalFields(
  obj: Record<string, unknown>,
  fields: string[] = ['รวม', 'totalActualPaid']
): Record<string, unknown> {
  const out = { ...obj };
  fields.forEach(f => { if (f in out) delete out[f]; });
  return out;
}
