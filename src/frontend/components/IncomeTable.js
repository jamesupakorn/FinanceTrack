// Mapping ภาษาไทยสำหรับ key รายรับ
const incomeKeyThaiMap = {
  salary: 'เงินเดือน',
  income2: 'แหล่งรายรับ 2',
  other: 'อื่นๆ'
};
import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { formatCurrency, parseAndFormat, parseToNumber, formatIncomeData, handleNumberInput, handleNumberBlur, maskNumberFormat } from '../../shared/utils/numberUtils';
import { formatIncomeForSave } from '../../shared/utils/incomeUtils';
import { calculateTotalWithSalary } from '../../shared/utils/numberUtils';
import { incomeAPI, salaryAPI } from '../../shared/utils/apiUtils';
import { Icons } from './Icons';
import styles from '../styles/IncomeTable.module.css';

export default function IncomeTable({ selectedMonth, salaryUpdateTrigger, mode = 'view' }) {

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
      await incomeAPI.save(selectedMonth, formatIncomeForSave(incomeToSave, parseToNumber));
      // รีเฟรชข้อมูลหลังบันทึก
      const data = await incomeAPI.getByMonth(selectedMonth);
      setIncomeData(data);
      setEditIncome(formatIncomeData(data, selectedMonth));
    } catch (error) {
      console.error('Error saving income data:', error);
    }
  };

  // ใช้ฟังก์ชันรวมที่ตัดเงินเดือนออกก่อนบวก salaryNetIncome
  // ยอดรวมรายรับจาก backend
  const getTotalIncome = () => (incomeData && typeof incomeData.รวม === 'number' ? incomeData.รวม : 0);

  // Fallback: use keys from editIncome or incomeData (excluding 'month' and 'รวม') if items is missing
  let incomeItems = [];
  if (incomeData && Array.isArray(incomeData.items)) {
    incomeItems = incomeData.items;
  } else if (editIncome && Object.keys(editIncome).length > 0) {
    incomeItems = Object.keys(editIncome);
  } else if (incomeData && typeof incomeData === 'object') {
    incomeItems = Object.keys(incomeData).filter(k => k !== 'month' && k !== 'รวม');
  }

  // Helper: format value for display
  const getDisplayValue = (value) => {
    const num = parseToNumber(value);
    return num === 0 ? '0' : maskNumberFormat(num);
  };

  // Helper: get salary value for display
  const getSalaryDisplayValue = () => {
    if (salaryNetIncome !== undefined && salaryNetIncome !== null && salaryNetIncome !== '' && !isNaN(Number(salaryNetIncome))) {
      return Number(salaryNetIncome);
    }
    if (editIncome['เงินเดือน'] !== undefined && editIncome['เงินเดือน'] !== null && editIncome['เงินเดือน'] !== '' && !isNaN(parseToNumber(editIncome['เงินเดือน']))) {
      return parseToNumber(editIncome['เงินเดือน']);
    }
    return 0;
  };

  return (
    <div className={styles.incomeContainer}>
      {incomeData && (
        <>
          {/* Desktop Table */}
          <table className={styles.incomeTable + ' ' + styles.hideOnMobile}>
            <thead>
              <tr className={styles.tableHeader}>
                <th className={styles.headerCell}>รายการ</th>
                <th className={`${styles.headerCell} ${styles.headerCellRight}`}>จำนวนเงิน (บาท)</th>
              </tr>
            </thead>
            <tbody>
              {incomeItems.map((item, i) => (
                <tr key={i} className={styles.tableRow}>
                  <td className={styles.tableCell}>{incomeKeyThaiMap[item] ?? item}</td>
                  <td className={styles.inputCell}>
                    {item === 'เงินเดือน' ? (
                      <div className={styles.salaryCell}>
                        {mode === 'edit'
                          ? formatCurrency(salaryNetIncome || editIncome[item] || 0)
                          : getDisplayValue(getSalaryDisplayValue())}
                        <small className={styles.salarySource}>
                          (จากระบบเงินเดือน)
                        </small>
                      </div>
                    ) : (
                      mode === 'edit' ? (
                        <input
                          type="text"
                          value={editIncome[item] ?? ''}
                          onChange={e => handleNumberInput(e.target.value, setEditIncome, item)}
                          onBlur={e => handleNumberBlur(e.target.value, setEditIncome, item)}
                          className={styles.incomeInput}
                        />
                      ) : (
                        <span>{getDisplayValue(editIncome[item])}</span>
                      )
                    )}
                  </td>
                </tr>
              ))}
              <tr className={styles.totalRow}>
                <td className={styles.totalCell}>รวม</td>
                <td className={`${styles.totalCell} ${styles.totalValue}`}>
                  {mode === 'edit'
                    ? formatCurrency(getTotalIncome())
                    : getDisplayValue(getTotalIncome())}
                </td>
              </tr>
            </tbody>
          </table>

          {/* Mobile Card List */}
          <div className={styles.mobileCardList + ' ' + styles.hideOnDesktop}>
            {incomeItems.map((item, i) => (
              <div className={styles.incomeCard} key={i}>
                <div className={styles.cardRow}><span className={styles.cardLabel}>รายการ</span><span>{incomeKeyThaiMap[item] ?? item}</span></div>
                <div className={styles.cardRow}>
                  <span className={styles.cardLabel}>จำนวนเงิน</span>
                  {item === 'เงินเดือน' ? (
                    <div className={styles.salaryCell}>
                      {mode === 'edit'
                        ? formatCurrency(salaryNetIncome || editIncome[item] || 0)
                        : getDisplayValue(getSalaryDisplayValue())}
                      <small className={styles.salarySource}>
                        (จากระบบเงินเดือน)
                      </small>
                    </div>
                  ) : (
                    mode === 'edit' ? (
                      <input
                        type="text"
                        value={editIncome[item] ?? ''}
                        onChange={e => handleNumberInput(e.target.value, setEditIncome, item)}
                        onBlur={e => handleNumberBlur(e.target.value, setEditIncome, item)}
                        className={styles.incomeInput}
                      />
                    ) : (
                      <span>{getDisplayValue(editIncome[item])}</span>
                    )
                  )}
                </div>
              </div>
            ))}
            {/* Total summary card */}
            <div className={styles.incomeCard + ' ' + styles.totalCard}>
              <div className={styles.cardRow}><span className={styles.cardLabel}>รวม</span><span className={styles.totalValue}>{mode === 'edit' ? formatCurrency(getTotalIncome()) : getDisplayValue(getTotalIncome())}</span></div>
            </div>
          </div>
          {mode === 'edit' && (
            <div className={styles.saveButtonContainer}>
              <button onClick={handleSave} className={styles.saveButton}>
                <Icons.Save size={16} color="white" className={styles.saveButtonIcon} />
                บันทึกรายรับ
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}