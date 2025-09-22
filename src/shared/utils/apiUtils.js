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
    const response = await fetch(`${API_URLS.INCOME}?month=${month}`);
    return response.json();
  },

  // บันทึกข้อมูลรายรับ
  save: async (month, values) => {
    const response = await fetch(API_URLS.INCOME, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ month, values })
    });
    return response.json();
  }
};

// API สำหรับรายจ่าย
export const expenseAPI = {
  // ดึงข้อมูลรายจ่ายตามเดือน
  getByMonth: async (month) => {
    const response = await fetch(`${API_URLS.EXPENSE}?month=${month}`);
    return response.json();
  },

  // บันทึกข้อมูลรายจ่าย
  save: async (month, values) => {
    const response = await fetch(API_URLS.EXPENSE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ month, values })
    });
    return response.json();
  }
};

// API สำหรับเงินออม
export const savingsAPI = {
  // ดึงข้อมูลเงินออมตามเดือน
  getByMonth: async (month) => {
    const response = await fetch(`${API_URLS.SAVINGS}?month=${month}`);
    return response.json();
  },

  // บันทึกยอดออมสะสม
  saveAccumulated: async (month, ยอดออมสะสม) => {
    const response = await fetch(API_URLS.SAVINGS, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ month, ยอดออมสะสม })
    });
    return response.json();
  },

  // บันทึกรายการเงินออม
  saveList: async (month, รายการเงินออม) => {
    const response = await fetch(API_URLS.SAVINGS, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ month, รายการเงินออม })
    });
    return response.json();
  }
};

// API สำหรับภาษี
export const taxAPI = {
  // ดึงข้อมูลภาษีทั้งหมด
  getAll: async () => {
    const response = await fetch(API_URLS.TAX);
    return response.json();
  },

  // ดึงข้อมูลภาษีตามปี
  getByYear: async (year) => {
    const response = await fetch(`${API_URLS.TAX}?year=${year}`);
    return response.json();
  },

  // บันทึกภาษีสะสมรายปี
  saveYearly: async (year, data) => {
    // รองรับทั้งการส่งข้อมูลแบบใหม่ (object) และแบบเก่า (number)
    let requestBody;
    if (typeof data === 'object' && data !== null) {
      // ถ้าเป็น object ให้ส่งแยกเป็น ภาษีสะสม และ ภาษีรายเดือน
      requestBody = { 
        year, 
        ภาษีสะสม: data.ภาษีสะสม,
        ภาษีรายเดือน: data.ภาษีรายเดือน
      };
    } else {
      // ถ้าเป็น number ให้ส่งแบบเก่า
      requestBody = { year, ภาษีสะสม: data };
    }
    
    const response = await fetch(API_URLS.TAX, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody)
    });
    return response.json();
  },

  // ลบปีออกจากระบบ
  deleteYear: async (year) => {
    console.log('🌐 API deleteYear called with year:', year);
    
    const response = await fetch(API_URLS.TAX, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ year })
    });
    
    console.log('🌐 DELETE Response status:', response.status);
    
    const result = await response.json();
    console.log('🌐 DELETE Response data:', result);
    
    return result;
  }
};

// API สำหรับเงินเดือน
export const salaryAPI = {
  // ดึงข้อมูลเงินเดือนตามเดือน
  getByMonth: async (month) => {
    const response = await fetch(`${API_URLS.SALARY}?month=${month}`);
    return response.json();
  },

  // ดึงข้อมูลเงินเดือนทั้งหมด
  getAll: async () => {
    const response = await fetch(API_URLS.SALARY);
    return response.json();
  },

  // บันทึกข้อมูลเงินเดือน
  save: async (month, รายได้, หัก, หมายเหตุ = '') => {
    const response = await fetch(API_URLS.SALARY, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ month, รายได้, หัก, หมายเหตุ })
    });
    return response.json();
  },

  // ลบข้อมูลเงินเดือน
  delete: async (month) => {
    const response = await fetch(`${API_URLS.SALARY}?month=${month}`, {
      method: 'DELETE'
    });
    return response.json();
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