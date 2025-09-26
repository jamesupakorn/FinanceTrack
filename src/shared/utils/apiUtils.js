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

  // บันทึกข้อมูลรายจ่าย
  save: async (month, values) => {
    try {
      const response = await fetch(API_URLS.EXPENSE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ month, values })
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
  saveAccumulated: async (month, ยอดออมสะสม) => {
    try {
      const response = await fetch(API_URLS.SAVINGS, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ month, ยอดออมสะสม })
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
  saveList: async (month, รายการเงินออม) => {
    try {
      const response = await fetch(API_URLS.SAVINGS, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ month, รายการเงินออม })
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
      return await response.json();
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
      console.log('🌐 API deleteYear called with year:', year);
      
      const response = await fetch(API_URLS.TAX, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ year })
      });
      
      console.log('🌐 DELETE Response status:', response.status);
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const result = await response.json();
      console.log('🌐 DELETE Response data:', result);
      
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
      return await response.json();
    } catch (error) {
      console.error('Error fetching all salary data:', error);
      throw error;
    }
  },

  // บันทึกข้อมูลเงินเดือน
  save: async (month, รายได้, หัก, หมายเหตุ = '') => {
    try {
      const response = await fetch(API_URLS.SALARY, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ month, รายได้, หัก, หมายเหตุ })
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