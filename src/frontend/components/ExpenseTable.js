// Mapping ภาษาไทยสำหรับ key รายการค่าใช้จ่าย
const expenseKeyThaiMap = {
  house: 'ค่าบ้าน',
  water: 'ค่าน้ำ',
  internet: 'ค่าเน็ต',
  electricity: 'ค่าไฟ',
  mobile: 'โทรศัพท์มือถือ',
  credit_kbank: 'บัตรเครดิต KBank',
  credit_kungsri: 'บัตรเครดิต Kungsri',
  credit_uob: 'บัตรเครดิต UOB',
  credit_ttb: 'บัตรเครดิต TTB',
  shopee: 'Shopee',
  netflix: 'Netflix',
  youtube: 'YouTube',
  youtube_membership: 'YouTube Membership',
  motorcycle: 'ค่ารถจักรยานยนต์',
  miscellaneous: 'ค่าใช้จ่ายเบ็ดเตล็ด'
};
import { useState, useEffect } from 'react';
import { formatCurrency, parseAndFormat, parseToNumber, formatExpenseData, getAccountSummary, handleNumberInput, handleNumberBlur, maskNumberFormat } from '../../shared/utils/numberUtils';
import { formatExpenseForSave, calculateExpenseTotal } from '../../shared/utils/expenseUtils';
import BankAccountTable from './BankAccountTable';
import { expenseAPI } from '../../shared/utils/apiUtils';
import styles from '../styles/ExpenseTable.module.css';

export default function ExpenseTable({ selectedMonth, mode = 'view' }) {
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
    if (field === 'paid') {
      setEditExpense({
        ...editExpense,
        [item]: { ...current, [field]: value }
      });
    } else {
      handleNumberInput(value, (val) => {
        setEditExpense({
          ...editExpense,
          [item]: { ...current, [field]: val }
        });
      });
    }
  };

  const handleExpenseBlur = (item, field, value) => {
    const current = editExpense[item] || {};
    if (field === 'paid') {
      setEditExpense({
        ...editExpense,
        [item]: { ...current, [field]: value }
      });
    } else {
      handleNumberBlur(value, (val) => {
        setEditExpense({
          ...editExpense,
          [item]: { ...current, [field]: val }
        });
      });
    }
  };

  const handleSave = async () => {
    try {
      // ใช้ฟังก์ชันกลาง format ข้อมูลก่อน save
      await expenseAPI.save(selectedMonth, formatExpenseForSave(editExpense, parseToNumber));
      // รีเฟรชข้อมูลหลังบันทึก
      const data = await expenseAPI.getByMonth(selectedMonth);
      setExpenseData(data);
      setEditExpense(formatExpenseData(data, selectedMonth));
    } catch (error) {
      console.error('Error saving expense data:', error);
    }
  };

  const calculateTotal = (field) => calculateExpenseTotal(editExpense, field, parseToNumber);



  return (
    <div className={styles.expenseTable}>
      {expenseData && (
        <>
          {/* ตารางหลักเดิม */}
          <div className={styles.tableContainer}>
            <table className={styles.table}>
              <thead className={styles.tableHeader}>
                <tr>
                  <th className={styles.tableHeaderCell}>รายการค่าใช้จ่าย</th>
                  <th className={`${styles.tableHeaderCell} ${styles.right}`}>ยอดประมาณการ</th>
                  <th className={`${styles.tableHeaderCell} ${styles.right}`}>ยอดที่จ่ายจริง</th>
                  <th className={`${styles.tableHeaderCell} ${styles.center}`}>สถานะชำระ</th>
                  <th className={`${styles.tableHeaderCell} ${styles.right}`}>ส่วนต่าง</th>
                </tr>
              </thead>
              <tbody>
                {Object.keys(expenseKeyThaiMap).map((item, i) => {
                  // ใช้ field ใหม่ 'estimate', 'actual', 'paid'
                    const estimate = parseToNumber(
                      editExpense[item]?.['estimate'] ??
                      (expenseData.estimate && expenseData.estimate[item]) ??
                      (expenseData.months && expenseData.months[selectedMonth]?.[item]?.['estimate']) ??
                      0
                    );
                    const actual = parseToNumber(
                      editExpense[item]?.['actual'] ??
                      (expenseData.actual && expenseData.actual[item]) ??
                      (expenseData.months && expenseData.months[selectedMonth]?.[item]?.['actual']) ??
                      0
                    );
                    // Default paid to false if undefined/null
                    const paid = (editExpense[item]?.['paid'] !== undefined && editExpense[item]?.['paid'] !== null)
                      ? editExpense[item]['paid']
                      : (expenseData.actual && typeof expenseData.actual[item] === 'object' && expenseData.actual[item]?.['paid'] !== undefined)
                        ? expenseData.actual[item]['paid']
                        : (expenseData.months && expenseData.months[selectedMonth]?.[item]?.['paid'] !== undefined)
                          ? expenseData.months[selectedMonth][item]['paid']
                          : false;
                  const diff = actual - estimate;
                  return (
                    <tr key={i} className={styles.tableRow}>
                      <td className={styles.tableCell}>{expenseKeyThaiMap[item] ?? item}</td>
                      <td className={`${styles.tableCell} ${styles.right}`}>
                        {mode === 'edit' ? (
                          <input
                            type="text"
                            value={editExpense[item]?.['estimate'] ?? expenseData.months[selectedMonth]?.[item]?.['estimate'] ?? ''}
                            onChange={e => handleNumberInput(e.target.value, (val) => handleExpenseChange(item, 'estimate', val))}
                            onBlur={e => handleNumberBlur(e.target.value, (val) => handleExpenseBlur(item, 'estimate', val))}
                            className={styles.expenseInput}
                          />
                        ) : (
                          <span>{(() => {
                            const value = parseToNumber(estimate);
                            return value === 0 ? '0' : maskNumberFormat(value);
                          })()}</span>
                        )}
                      </td>
                      <td className={`${styles.tableCell} ${styles.right}`}>
                        {mode === 'edit' ? (
                          <input
                            type="text"
                            value={editExpense[item]?.['actual'] ?? expenseData.months[selectedMonth]?.[item]?.['actual'] ?? ''}
                            onChange={e => handleNumberInput(e.target.value, (val) => handleExpenseChange(item, 'actual', val))}
                            onBlur={e => handleNumberBlur(e.target.value, (val) => handleExpenseBlur(item, 'actual', val))}
                            className={styles.expenseInput}
                          />
                        ) : (
                          <span>{(() => {
                            const value = parseToNumber(actual);
                            return value === 0 ? '0' : maskNumberFormat(value);
                          })()}</span>
                        )}
                      </td>
                      <td className={`${styles.tableCell} ${styles.center} ${styles.checkboxCell}`}>
                        <input
                          type="checkbox"
                          checked={paid === true || paid === 'true' ? true : false}
                          onChange={e => handleExpenseChange(item, 'paid', e.target.checked)}
                          disabled={mode !== 'edit'}
                        />
                      </td>
                      <td className={`${styles.tableCell} ${styles.right} ${diff >= 0 ? styles.diffPositive : styles.diffNegative}`}>
                        {mode === 'edit' ? formatCurrency(diff) : (() => {
                          const value = parseToNumber(diff);
                          return value === 0 ? '0' : maskNumberFormat(value);
                        })()}
                      </td>
                    </tr>
                  );
                })}
                <tr className={styles.totalRow}>
                  <td className={styles.totalCell}>ยอดรวม</td>
                  <td className={`${styles.totalCell} ${styles.right}`}>{mode === 'edit' ? formatCurrency(calculateTotal('estimate')) : (() => {
                    const value = parseToNumber(calculateTotal('estimate'));
                    return value === 0 ? '0' : maskNumberFormat(value);
                  })()}</td>
                  <td className={`${styles.totalCell} ${styles.right}`}>{mode === 'edit' ? formatCurrency(calculateTotal('actual')) : (() => {
                    const value = parseToNumber(calculateTotal('actual'));
                    return value === 0 ? '0' : maskNumberFormat(value);
                  })()}</td>
                  <td className={`${styles.totalCell} ${styles.center}`}></td>
                  <td className={`${styles.totalCell} ${styles.right} ${(calculateTotal('actual') - calculateTotal('estimate')) >= 0 ? styles.totalDiffPositive : styles.totalDiffNegative}`}>
                    {mode === 'edit' ? formatCurrency(calculateTotal('actual') - calculateTotal('estimate')) : (() => {
                      const value = parseToNumber(calculateTotal('actual') - calculateTotal('estimate'));
                      return value === 0 ? '0' : maskNumberFormat(value);
                    })()}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          {/* ตารางสรุปค่าใช้จ่ายแต่ละบัญชี */}
          <BankAccountTable accountSummary={getAccountSummary(editExpense)} mode={mode} />
          {mode === 'edit' && (
            <div className={styles.saveButtonContainer}>
              <button
                onClick={handleSave}
                className={styles.saveButton}
              >
                บันทึกข้อมูลรายจ่าย
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}