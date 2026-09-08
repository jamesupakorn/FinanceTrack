// Salary summary calculation
export function calculateSalarySummary(salaryData) {
  const total_income = Object.values(salaryData.income || {}).reduce((sum, val) => sum + (parseFloat(val) || 0), 0);
  const total_deduct = Object.values(salaryData.deduct || {}).reduce((sum, val) => sum + (parseFloat(val) || 0), 0);
  const net_income = total_income - total_deduct;
  return { total_income, total_deduct, net_income };
}

// Savings summary calculation
export function calculateTotalSavings(savingsList = []) {
  if (!Array.isArray(savingsList)) return 0;
  return savingsList.reduce((sum, item) => {
    const amount = item?.savings_amount ?? item?.amount ?? item?.จำนวนเงิน ?? 0;
    return sum + (parseFloat(String(amount).replace(/,/g, '')) || 0);
  }, 0);
}

export async function enforceMonthLimit(collection, limit = 15, options = {}) {
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

  const monthSet = new Set();
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
    : (a, b) => b.localeCompare(a);
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
export function mapInvestmentDoc(doc) {
  return doc && doc.investments ? doc.investments : [];
}

// Tax accumulated: ensure monthly_provident always present
export function ensureMonthlyProvident(doc) {
  if (!doc.monthly_provident) doc.monthly_provident = {};
  return doc;
}
// Utility: คำนวณผลรวมจาก object
export function sumValues(obj, excludeKeys = []) {
  return Object.entries(obj)
    .filter(([key, v]) => typeof v === 'number' && !excludeKeys.includes(key))
    .reduce((sum, [, value]) => sum + (parseFloat(value) || 0), 0);
}

// Utility: map doc expense/income เป็น flat object พร้อม summary
export function mapDocToFlatItemObjectWithTotals(doc) {
  if (!doc) return {};
  if (doc.months) return doc;
  let out = {};
  const summaryFields = new Set(['month', '_id', 'accountSummary', 'totalActualPaid', 'bankAccounts']);

  if (Array.isArray(doc.bankAccounts)) {
    out.bankAccounts = Array.from(new Set(doc.bankAccounts.map((item) => String(item || '').trim()).filter(Boolean)));
  }

  if (doc.actual && typeof doc.actual === 'object') {
    const items = Array.from(new Set([...Object.keys(doc.actual)]));
    items.forEach(key => {
      const dueDayValue = doc[key]?.dueDay ?? (typeof doc[key]?.dueDate === 'string' ? doc[key].dueDate : undefined);
      out[key] = {
        name: typeof doc[key]?.name === 'string' ? doc[key].name : '',
        actual: doc.actual[key] ?? 0,
        account: typeof doc[key]?.account === 'string' ? doc[key].account : '',
        paid: false,
        ...(dueDayValue !== undefined ? { dueDay: dueDayValue } : {})
      };
    });
  } else {
    Object.keys(doc).forEach(key => {
      if (summaryFields.has(key)) return;
      const val = doc[key];
      if (val && typeof val === 'object' && !Array.isArray(val)) {
        const dueDayValue = val?.dueDay ?? (typeof val?.dueDate === 'string' ? val.dueDate : undefined);
        out[key] = {
          name: typeof val.name === 'string' ? val.name : '',
          actual: val.actual ?? 0,
          account: typeof val.account === 'string' ? val.account : '',
          paid: typeof val.paid === 'boolean' ? val.paid : false,
          ...(dueDayValue !== undefined ? { dueDay: dueDayValue } : {})
        };
      }
    });
  }
  // Add summary fields
  const sumActual = Object.values(out).reduce((sum, v) => {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return sum;
    return sum + (v.actual ? parseFloat(v.actual) || 0 : 0);
  }, 0);
  out.totalActualPaid = Math.round(sumActual * 100) / 100;
  return out;
}

// Utility: ลบ field summary ออกจาก object
export function removeSummaryFields(obj, fields = ['รวม', 'totalActualPaid']) {
  const out = { ...obj };
  fields.forEach(f => { if (f in out) delete out[f]; });
  return out;
}
