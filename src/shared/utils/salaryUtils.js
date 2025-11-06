// salaryUtils.js
// ฟังก์ชันสำหรับ SalaryCalculator

export function formatSalaryData(rawData, parseAndFormat) {
  const formattedData = {};
  Object.keys(rawData).forEach(key => {
    formattedData[key] = parseAndFormat(rawData[key]);
  });
  return formattedData;
}

export function splitSalaryData(salaryData, parseToNumber) {
  return {
    income: {
      salary: parseToNumber(salaryData.salary),
      overtime_1x: parseToNumber(salaryData.overtime_1x),
      overtime_1_5x: parseToNumber(salaryData.overtime_1_5x),
      overtime_2x: parseToNumber(salaryData.overtime_2x),
      overtime_3x: parseToNumber(salaryData.overtime_3x),
      overtime_other: parseToNumber(salaryData.overtime_other),
      bonus: parseToNumber(salaryData.bonus),
      other_income: parseToNumber(salaryData.other_income)
    },
    deduction: {
      provident_fund: parseToNumber(salaryData.provident_fund),
      social_security: parseToNumber(salaryData.social_security),
      tax: parseToNumber(salaryData.tax)
    }
  };
}
