import { useState, useEffect } from 'react';
import { formatCurrency, calculateSum, parseAndFormat, parseToNumber, formatExpenseData } from '../../shared/utils/numberUtils';
import { expenseAPI } from '../../shared/utils/apiUtils';
import styles from '../styles/ExpenseTable.module.css';

export default function ExpenseTable({ selectedMonth }) {
  const [expenseData, setExpenseData] = useState(null);
  const [editExpense, setEditExpense] = useState({});

  useEffect(() => {
    if (selectedMonth) {
      expenseAPI.getByMonth(selectedMonth)
        .then(data => {
          setExpenseData(data);
          setEditExpense(formatExpenseData(data, selectedMonth));
        })
        .catch(error => console.error('Error loading expense data:', error));
    }
  }, [selectedMonth]);

  const handleExpenseChange = (item, field, value) => {
    const current = editExpense[item] || {};
    // เก็บค่าแบบ raw ไว้ระหว่างการพิมพ์
    setEditExpense({
      ...editExpense,
      [item]: { ...current, [field]: value }
    });
  };

  const handleExpenseBlur = (item, field, value) => {
    const current = editExpense[item] || {};
    // Format เฉพาะเมื่อออกจาก input
    const formattedValue = parseAndFormat(value);
    setEditExpense({
      ...editExpense,
      [item]: { ...current, [field]: formattedValue }
    });
  };

  const handleSave = async () => {
    try {
      // แปลงเป็น number ก่อนบันทึก
      const numericExpense = {};
      Object.keys(editExpense).forEach(item => {
        numericExpense[item] = {};
        Object.keys(editExpense[item]).forEach(field => {
          numericExpense[item][field] = parseToNumber(editExpense[item][field]);
        });
      });
      
      await expenseAPI.save(selectedMonth, numericExpense);
      // รีเฟรชข้อมูลหลังบันทึก
      const data = await expenseAPI.getByMonth(selectedMonth);
      setExpenseData(data);
      setEditExpense(formatExpenseData(data, selectedMonth));
    } catch (error) {
      console.error('Error saving expense data:', error);
    }
  };

  const calculateTotal = (field) => {
    const values = Object.values(editExpense).map(item => item?.[field] || 0);
    return calculateSum(values);
  };

  return (
    <div className={styles.expenseTable}>
      {expenseData && (
        <>
          <div className={styles.tableContainer}>
            <table className={styles.table}>
              <thead className={styles.tableHeader}>
                <tr>
                  <th className={styles.tableHeaderCell}>รายการ</th>
                  <th className={`${styles.tableHeaderCell} ${styles.right}`}>ประมาณ</th>
                  <th className={`${styles.tableHeaderCell} ${styles.right}`}>จ่ายจริง</th>
                  <th className={`${styles.tableHeaderCell} ${styles.right}`}>ส่วนต่าง</th>
                </tr>
              </thead>
            <tbody>
              {expenseData.รายการ.map((item, i) => {
                const ประมาณ = parseFloat(editExpense[item]?.['ประมาณ'] || 0);
                const จ่ายจริง = parseFloat(editExpense[item]?.['จ่ายจริง'] || 0);
                const ส่วนต่าง = ประมาณ - จ่ายจริง;
                
                return (
                  <tr key={i} className={styles.tableRow}>
                    <td className={styles.tableCell}>{item}</td>
                    <td className={`${styles.tableCell} ${styles.right}`}>
                      <input
                        type="text"
                        value={editExpense[item]?.['ประมาณ'] ?? ''}
                        onChange={e => handleExpenseChange(item, 'ประมาณ', e.target.value)}
                        onBlur={e => handleExpenseBlur(item, 'ประมาณ', e.target.value)}
                        className={styles.expenseInput}
                      />
                    </td>
                    <td className={`${styles.tableCell} ${styles.right}`}>
                      <input
                        type="text"
                        value={editExpense[item]?.['จ่ายจริง'] ?? ''}
                        onChange={e => handleExpenseChange(item, 'จ่ายจริง', e.target.value)}
                        onBlur={e => handleExpenseBlur(item, 'จ่ายจริง', e.target.value)}
                        className={styles.expenseInput}
                      />
                    </td>
                    <td className={`${styles.tableCell} ${styles.right} ${ส่วนต่าง >= 0 ? styles.diffPositive : styles.diffNegative}`}>
                      {formatCurrency(ส่วนต่าง)}
                    </td>
                  </tr>
                );
              })}
              <tr className={styles.totalRow}>
                <td className={styles.totalCell}>รวม</td>
                <td className={`${styles.totalCell} ${styles.right}`}>{formatCurrency(calculateTotal('ประมาณ'))}</td>
                <td className={`${styles.totalCell} ${styles.right}`}>{formatCurrency(calculateTotal('จ่ายจริง'))}</td>
                <td className={`${styles.totalCell} ${styles.right} ${(calculateTotal('ประมาณ') - calculateTotal('จ่ายจริง')) >= 0 ? styles.totalDiffPositive : styles.totalDiffNegative}`}>
                  {formatCurrency(calculateTotal('ประมาณ') - calculateTotal('จ่ายจริง'))}
                </td>
              </tr>
            </tbody>
          </table>
          </div>
          <div className={styles.saveButtonContainer}>
            <button 
              onClick={handleSave} 
              className={styles.saveButton}
            >
              บันทึกรายจ่าย
            </button>
          </div>
        </>
      )}
    </div>
  );
}