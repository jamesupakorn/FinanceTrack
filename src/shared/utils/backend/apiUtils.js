// API สำหรับการลงทุน
export const investmentAPI = {
  // ดึงข้อมูลการลงทุนทั้งหมด
  getAll: async () => {
    try {
      const response = await fetch('/api/investment');
      if (!response.ok) throw new Error('Failed to fetch investment');
      return await response.json();
    } catch (error) {
      console.error('Error fetching investment:', error);
      return {};
    }
  },
  // ดึงข้อมูลการลงทุนตามเดือน
  getByMonth: async (month) => {
    try {
      const response = await fetch(`/api/investment?month=${month}`);
      if (!response.ok) throw new Error('Failed to fetch investment by month');
      return await response.json();
    } catch (error) {
      console.error('Error fetching investment by month:', error);
      return [];
    }
  },
  // บันทึกข้อมูลการลงทุน (ทั้งเดือน)
  saveList: async (month, investments) => {
    try {
      const response = await fetch('/api/investment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ month, investments })
      });
      if (!response.ok) throw new Error('Failed to save investment');
      return await response.json();
    } catch (error) {
      console.error('Error saving investment:', error);
      return null;
    }
  }
};
// ...existing code...

// Salary summary calculation
export function calculateSalarySummary(salaryData) {
  const total_income = Object.values(salaryData.income || {}).reduce((sum, val) => sum + (parseFloat(val) || 0), 0);
  const total_deduct = Object.values(salaryData.deduct || {}).reduce((sum, val) => sum + (parseFloat(val) || 0), 0);
  const net_income = total_income - total_deduct;
  return { total_income, total_deduct, net_income };
}

// Savings summary calculation
export function calculateTotalSavings(savingsList) {
  return savingsList.reduce((sum, item) => sum + (parseFloat(item.amount) || 0), 0);
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
  if (doc.estimate && doc.actual) {
    const items = Array.from(new Set([...Object.keys(doc.estimate), ...Object.keys(doc.actual)]));
    items.forEach(key => {
      out[key] = {
        estimate: doc.estimate[key] ?? 0,
        actual: doc.actual[key] ?? 0,
        paid: false
      };
    });
  } else {
    Object.keys(doc).forEach(key => {
      if (key === 'month' || key === '_id') return;
      const val = doc[key];
      if (val && typeof val === 'object') {
        out[key] = {
          estimate: val.estimate ?? 0,
          actual: val.actual ?? 0,
          paid: typeof val.paid === 'boolean' ? val.paid : false
        };
      }
    });
  }
  // Add summary fields
  const sumEstimate = Object.values(out).reduce((sum, v) => sum + (typeof v === 'object' && v.estimate ? parseFloat(v.estimate) || 0 : 0), 0);
  const sumActual = Object.values(out).reduce((sum, v) => sum + (typeof v === 'object' && v.actual ? parseFloat(v.actual) || 0 : 0), 0);
  out.totalEstimate = Math.round(sumEstimate * 100) / 100;
  out.totalActualPaid = Math.round(sumActual * 100) / 100;
  return out;
}

// Utility: ลบ field summary ออกจาก object
export function removeSummaryFields(obj, fields = ['รวม', 'totalEstimate', 'totalActualPaid']) {
  const out = { ...obj };
  fields.forEach(f => { if (f in out) delete out[f]; });
  return out;
}
// Utility functions สำหรับเรียก API

// URL constants
const API_URLS = {
  INCOME: '/api/monthly_income',
  EXPENSE: '/api/monthly_expense',
  SAVINGS: '/api/savings',
  TAX: '/api/tax_accumulated',
  SALARY: '/api/salary'
};

// API สำหรับรายรับ
export const incomeAPI = {
  // ดึงข้อมูลรายรับตามเดือน
  getByMonth: async (month) => {
    try {
      const response = await fetch(`${API_URLS.INCOME}?month=${month}`);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      console.error('Error fetching income data:', error);
      throw error;
    }
  },

  // ดึงข้อมูลรายรับทั้งหมด
  getAll: async () => {
    try {
      const response = await fetch(API_URLS.INCOME);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data = await response.json();
      return { months: data };
    } catch (error) {
      console.error('Error fetching all income data:', error);
      throw error;
    }
  },

  // บันทึกข้อมูลรายรับ
  save: async (month, values) => {
    try {
      const response = await fetch(API_URLS.INCOME, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ month, values })
      });
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      console.error('Error saving income data:', error);
      throw error;
    }
  }
};

// API สำหรับรายจ่าย
export const expenseAPI = {
  // ดึงข้อมูลรายจ่ายตามเดือน
  getByMonth: async (month) => {
    try {
      const response = await fetch(`${API_URLS.EXPENSE}?month=${month}`);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      console.error('Error fetching expense data:', error);
      throw error;
    }
  },

  // ดึงข้อมูลรายจ่ายทั้งหมด
  getAll: async () => {
    try {
      const response = await fetch(API_URLS.EXPENSE);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data = await response.json();
      return { months: data };
    } catch (error) {
      console.error('Error fetching all expense data:', error);
      throw error;
    }
  },

  // บันทึกข้อมูลรายจ่าย
  save: async (month, values) => {
    try {
      const response = await fetch(API_URLS.EXPENSE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ month, expense_data: values })
      });
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      console.error('Error saving expense data:', error);
      throw error;
    }
  }
};

// API สำหรับเงินออม
export const savingsAPI = {
  // ดึงข้อมูลเงินออมทั้งหมด
  getAll: async () => {
    try {
      const response = await fetch(API_URLS.SAVINGS);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data = await response.json();
      return { months: data };
    } catch (error) {
      console.error('Error fetching all savings data:', error);
      throw error;
    }
  },
  // ดึงข้อมูลเงินออมตามเดือน
  getByMonth: async (month) => {
    try {
      const response = await fetch(`${API_URLS.SAVINGS}?month=${month}`);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      console.error('Error fetching savings data:', error);
      throw error;
    }
  },
  // บันทึกยอดออมสะสม
  saveAccumulated: async (month, accumulated_savings) => {
    try {
      const response = await fetch(API_URLS.SAVINGS, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ month, accumulated_savings })
      });
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      console.error('Error saving accumulated savings:', error);
      throw error;
    }
  },
  // บันทึกรายการเงินออม
  saveList: async (month, savings_list) => {
    try {
      const response = await fetch(API_URLS.SAVINGS, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ month, savings_list })
      });
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      console.error('Error saving savings list:', error);
      throw error;
    }
  }
};

// API สำหรับภาษี
export const taxAPI = {
  // ดึงข้อมูลภาษีทั้งหมด
  getAll: async () => {
    try {
      const response = await fetch(API_URLS.TAX);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data = await response.json();
      return { months: data };
    } catch (error) {
      console.error('Error fetching tax data:', error);
      throw error;
    }
  },

  // ดึงข้อมูลภาษีตามปี
  getByYear: async (year) => {
    try {
      const response = await fetch(`${API_URLS.TAX}?year=${year}`);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      console.error('Error fetching tax data by year:', error);
      throw error;
    }
  },

  // บันทึกภาษีสะสมรายปี
  saveYearly: async (year, data) => {
    try {
      // Support both new (object) and old (number) formats
      let requestBody;
      if (typeof data === 'object' && data !== null) {
        // If object, send as accumulated_tax, monthly_tax, and monthly_income if present
        requestBody = {
          year,
          accumulated_tax: data.accumulated_tax,
          monthly_tax: data.monthly_tax
        };
        if (data.monthly_income) {
          requestBody.monthly_income = data.monthly_income;
        }
      } else {
        // If number, send as accumulated_tax only
        requestBody = { year, accumulated_tax: data };
      }
      const response = await fetch(API_URLS.TAX, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
      });
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      console.error('Error saving tax data:', error);
      throw error;
    }
  },

  // ลบปีออกจากระบบ
  deleteYear: async (year) => {
    try {
  //
      
      const response = await fetch(API_URLS.TAX, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ year })
      });
      
  //
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const result = await response.json();
  //
      
      return result;
    } catch (error) {
      console.error('Error deleting tax year:', error);
      throw error;
    }
  }
};

// API สำหรับเงินเดือน
export const salaryAPI = {
  // ดึงข้อมูลเงินเดือนตามเดือน
  getByMonth: async (month) => {
    try {
      const response = await fetch(`${API_URLS.SALARY}?month=${month}`);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      console.error('Error fetching salary data:', error);
      throw error;
    }
  },

  // ดึงข้อมูลเงินเดือนทั้งหมด
  getAll: async () => {
    try {
      const response = await fetch(API_URLS.SALARY);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data = await response.json();
      return { months: data };
    } catch (error) {
      console.error('Error fetching all salary data:', error);
      throw error;
    }
  },

  // บันทึกข้อมูลเงินเดือน
  save: async (month, income, deduct, note = '') => {
    try {
      const response = await fetch(API_URLS.SALARY, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ month, income, deduct, note })
      });
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      console.error('Error saving salary data:', error);
      throw error;
    }
  },

  // ลบข้อมูลเงินเดือน
  delete: async (month) => {
    try {
      const response = await fetch(`${API_URLS.SALARY}?month=${month}`, {
        method: 'DELETE'
      });
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      console.error('Error deleting salary data:', error);
      throw error;
    }
  }
};

// Generic API utility functions
export const apiUtils = {
  // จัดการ error response
  handleError: (error) => {
    console.error('API Error:', error);
    // สามารถเพิ่ม error handling logic เพิ่มเติมได้
  },

  // ตัวอย่าง retry mechanism
  retryRequest: async (apiCall, maxRetries = 3) => {
    for (let i = 0; i < maxRetries; i++) {
      try {
        return await apiCall();
      } catch (error) {
        if (i === maxRetries - 1) throw error;
        await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
      }
    }
  }
};