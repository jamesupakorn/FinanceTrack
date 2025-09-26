// Mapping ภาษาไทยสำหรับ key รายรับ
const incomeKeyThaiMap = {
  salary: 'เงินเดือน',
  income2: 'แหล่งรายรับ 2',
  other: 'อื่นๆ'
};
import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { formatCurrency, calculateSum, parseAndFormat, parseToNumber, formatIncomeData, handleNumberInput, handleNumberBlur } from '../../shared/utils/numberUtils';
import { incomeAPI, salaryAPI } from '../../shared/utils/apiUtils';
import { Icons } from './Icons';
import styles from '../styles/IncomeTable.module.css';

export default function IncomeTable({ selectedMonth, salaryUpdateTrigger }) {
  const [incomeData, setIncomeData] = useState(null);
  const [editIncome, setEditIncome] = useState({});
  const [salaryNetIncome, setSalaryNetIncome] = useState(0);

  useEffect(() => {
    if (selectedMonth) {
      // โหลดข้อมูลรายรับ
      incomeAPI.getByMonth(selectedMonth)
        .then(data => {
          setIncomeData(data);
          setEditIncome(formatIncomeData(data, selectedMonth));
        })
        .catch(error => console.error('Error loading income data:', error));

      // โหลดข้อมูลเงินเดือนสุทธิ
      salaryAPI.getByMonth(selectedMonth)
        .then(salaryData => {
          if (salaryData && salaryData.สรุป) {
            setSalaryNetIncome(salaryData.สรุป.เงินได้สุทธิ || 0);
          }
        })
        .catch(error => console.error('Error loading salary data:', error));
    }
  }, [selectedMonth, salaryUpdateTrigger]); // เพิ่ม salaryUpdateTrigger เพื่อรีเฟรชเมื่อเงินเดือนเปลี่ยน

  const handleIncomeChange = (รายการ, value) => {
    // เก็บค่าแบบ raw ไว้ระหว่างการพิมพ์
    setEditIncome(prev => ({ ...prev, [รายการ]: value }));
  };

  const handleIncomeBlur = (รายการ, value) => {
    // Format เฉพาะเมื่อออกจาก input
    const formattedValue = parseAndFormat(value);
    setEditIncome(prev => ({ ...prev, [รายการ]: formattedValue }));
  };

  const handleSave = async () => {
    try {
      // แยกเงินเดือนออกก่อนบันทึก (ไม่บันทึกเพราะมาจาก salary)
      const incomeToSave = { ...editIncome };
      delete incomeToSave.เงินเดือน;
      
      // แปลงเป็น number ก่อนบันทึก
      const numericIncome = {};
      Object.keys(incomeToSave).forEach(key => {
        numericIncome[key] = parseToNumber(incomeToSave[key]);
      });
      
      await incomeAPI.save(selectedMonth, numericIncome);
      // รีเฟรชข้อมูลหลังบันทึก
      const data = await incomeAPI.getByMonth(selectedMonth);
      setIncomeData(data);
      setEditIncome(formatIncomeData(data, selectedMonth));
    } catch (error) {
      console.error('Error saving income data:', error);
    }
  };

  const calculateTotal = () => {
    return calculateSum(Object.values(editIncome));
  };

  const calculateTotalWithSalary = () => {
    // คำนวณรวมโดยรวมเงินเดือนสุทธิจาก salary
    const otherIncomes = Object.entries(editIncome)
      .filter(([key]) => key !== 'เงินเดือน')
      .map(([, value]) => parseToNumber(value));
    // เงินเดือนสุทธิอาจมี comma หรือเป็น string
    const salaryValue = parseToNumber(salaryNetIncome);
    return calculateSum([...otherIncomes, salaryValue]);
  };

  return (
    <div className={styles.incomeContainer}>
      {incomeData && (
        <>
          <table className={styles.incomeTable}>
            <thead>
              <tr className={styles.tableHeader}>
                <th className={styles.headerCell}>รายการ</th>
                <th className={`${styles.headerCell} ${styles.headerCellRight}`}>จำนวนเงิน (บาท)</th>
              </tr>
            </thead>
            <tbody>
              {incomeData.items.map((item, i) => (
                <tr key={i} className={styles.tableRow}>
                  <td className={styles.tableCell}>{incomeKeyThaiMap[item] ?? item}</td>
                  <td className={styles.inputCell}>
                    {item === 'เงินเดือน' ? (
                      // แสดงเงินเดือนสุทธิจาก salary (ไม่ให้แก้ไข)
                      <div className={styles.salaryCell}>
                        {formatCurrency(salaryNetIncome || editIncome[item] || 0)}
                        <small className={styles.salarySource}>
                          (จากระบบเงินเดือน)
                        </small>
                      </div>
                    ) : (
                      // รายการอื่นๆ ให้แก้ไขได้ปกติ
                      <input
                        type="text"
                        value={editIncome[item] ?? ''}
                        onChange={e => handleNumberInput(e.target.value, setEditIncome, item)}
                        onBlur={e => handleNumberBlur(e.target.value, setEditIncome, item)}
                        className={styles.incomeInput}
                      />
                    )}
                  </td>
                </tr>
              ))}
              <tr className={styles.totalRow}>
                <td className={styles.totalCell}>รวม</td>
                <td className={`${styles.totalCell} ${styles.totalValue}`}>
                  {formatCurrency(calculateTotalWithSalary())}
                </td>
              </tr>
            </tbody>
          </table>
          <div className={styles.saveButtonContainer}>
            <button onClick={handleSave} className={styles.saveButton}>
              <Icons.Save size={16} color="white" className={styles.saveButtonIcon} />
              บันทึกรายรับ
            </button>
          </div>
        </>
      )}
    </div>
  );
}