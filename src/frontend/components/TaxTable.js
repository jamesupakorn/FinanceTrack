import { useState, useEffect } from 'react';
import { formatCurrency, handleNumberInput, handleNumberBlur, parseToNumber, maskNumberFormat } from '../../shared/utils/numberUtils';
import { taxAPI, incomeAPI } from '../../shared/utils/apiUtils';
import styles from '../styles/TaxTable.module.css';

export default function TaxTable({ selectedMonth, mode = 'view' }) {
  // default ปีที่เลือกเป็น AD (คศ)
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear().toString());
  // รวมเงินได้ทั้งปี
  const [totalYearlyIncome, setTotalYearlyIncome] = useState('0.00');
  const [accumulatedTax, setAccumulatedTax] = useState('0.00');
  // รายรับแต่ละเดือนของปีที่เลือก
  const [monthlyIncome, setMonthlyIncome] = useState({
    '01': '0.00', '02': '0.00', '03': '0.00', '04': '0.00',
    '05': '0.00', '06': '0.00', '07': '0.00', '08': '0.00',
    '09': '0.00', '10': '0.00', '11': '0.00', '12': '0.00'
  });
  const [allYearData, setAllYearData] = useState({});
  const [showAddForm, setShowAddForm] = useState(false);
  const [newYear, setNewYear] = useState('');
  const [monthlyTax, setMonthlyTax] = useState({
    '01': '0.00', '02': '0.00', '03': '0.00', '04': '0.00',
    '05': '0.00', '06': '0.00', '07': '0.00', '08': '0.00',
    '09': '0.00', '10': '0.00', '11': '0.00', '12': '0.00'
  });

  // โหลดรายรับทั้งปีเมื่อปีที่เลือกเปลี่ยน
  useEffect(() => {
    const fetchIncome = async () => {
      try {
        const incomeData = await incomeAPI.getAll();
        // incomeData.months: { '2025-01': {...}, ... }
        if (incomeData && incomeData.months) {
          const year = selectedYear;
          let sum = 0;
          const monthly = {
            '01': 0, '02': 0, '03': 0, '04': 0, '05': 0, '06': 0,
            '07': 0, '08': 0, '09': 0, '10': 0, '11': 0, '12': 0
          };
          Object.entries(incomeData.months).forEach(([monthKey, values]) => {
            if (monthKey.startsWith(year + '-')) {
              // monthKey: '2025-01' => '01'
              const m = monthKey.split('-')[1];
              const monthSum = Object.values(values).reduce((acc, v) => acc + parseToNumber(v), 0);
              sum += monthSum;
              if (monthly[m] !== undefined) monthly[m] += monthSum;
            }
          });
          setTotalYearlyIncome(formatCurrency(sum));
          // format each month
          const formatted = {};
          Object.entries(monthly).forEach(([k, v]) => {
            formatted[k] = formatCurrency(v);
          });
          setMonthlyIncome(formatted);
        } else {
          setTotalYearlyIncome('0.00');
          setMonthlyIncome({
            '01': '0.00', '02': '0.00', '03': '0.00', '04': '0.00',
            '05': '0.00', '06': '0.00', '07': '0.00', '08': '0.00',
            '09': '0.00', '10': '0.00', '11': '0.00', '12': '0.00'
          });
        }
      } catch (e) {
        setTotalYearlyIncome('0.00');
        setMonthlyIncome({
          '01': '0.00', '02': '0.00', '03': '0.00', '04': '0.00',
          '05': '0.00', '06': '0.00', '07': '0.00', '08': '0.00',
          '09': '0.00', '10': '0.00', '11': '0.00', '12': '0.00'
        });
      }
    };
    fetchIncome();
  }, [selectedYear]);

  // Mapping English tax keys to Thai labels
  const taxKeyThaiMapping = {
  monthly_tax: 'ภาษีรายเดือน',
  accumulated_tax: 'ภาษีสะสม'
  };

  useEffect(() => {
    loadAllTaxData();
  }, []);

  useEffect(() => {
  // selectedYear is always AD (คศ)
  if (allYearData[selectedYear]) {
    // Monthly Tax
    if (allYearData[selectedYear].monthly_tax) {
      const rawMonthlyTax = {};
      for (let i = 1; i <= 12; i++) {
        const key = i.toString().padStart(2, '0');
        const value = allYearData[selectedYear].monthly_tax[key] ?? allYearData[selectedYear].monthly_tax[i.toString()] ?? '0.00';
        rawMonthlyTax[key] = value;
      }
      setMonthlyTax(rawMonthlyTax);
    } else {
      setMonthlyTax({
        '01': '0.00', '02': '0.00', '03': '0.00', '04': '0.00',
        '05': '0.00', '06': '0.00', '07': '0.00', '08': '0.00',
        '09': '0.00', '10': '0.00', '11': '0.00', '12': '0.00'
      });
    }
    setAccumulatedTax(formatCurrency(allYearData[selectedYear].accumulated_tax || 0));

    // Monthly Income: always merge backend data into all 12 months
    const defaultIncome = {
      '01': '0.00', '02': '0.00', '03': '0.00', '04': '0.00',
      '05': '0.00', '06': '0.00', '07': '0.00', '08': '0.00',
      '09': '0.00', '10': '0.00', '11': '0.00', '12': '0.00'
    };
    let mergedIncome = { ...defaultIncome };
    if (allYearData[selectedYear].monthly_income) {
      Object.entries(allYearData[selectedYear].monthly_income).forEach(([m, v]) => {
        if (mergedIncome[m] !== undefined) mergedIncome[m] = v;
      });
    }
    setMonthlyIncome(mergedIncome);
  } else {
    setAccumulatedTax('0.00');
    setMonthlyTax({
      '01': '0.00', '02': '0.00', '03': '0.00', '04': '0.00',
      '05': '0.00', '06': '0.00', '07': '0.00', '08': '0.00',
      '09': '0.00', '10': '0.00', '11': '0.00', '12': '0.00'
    });
    setMonthlyIncome({
      '01': '0.00', '02': '0.00', '03': '0.00', '04': '0.00',
      '05': '0.00', '06': '0.00', '07': '0.00', '08': '0.00',
      '09': '0.00', '10': '0.00', '11': '0.00', '12': '0.00'
    });
  }
}, [selectedYear, allYearData]);

  const loadAllTaxData = async () => {
    try {
      const data = await taxAPI.getAll();
  // Use English keys from backend
  setAllYearData(data.tax_by_year || {});
    } catch (error) {
      console.error('Error loading tax data:', error);
      setAllYearData({});
    }
  };

  const handleSave = async () => {
    try {
      // ส่ง monthly_tax ที่ไม่มี comma และ monthly_income ไป backend
      const monthlyTaxNoComma = Object.fromEntries(
        Object.entries(monthlyTax).map(([month, value]) => [month, value.toString().replace(/,/g, '')])
      );
      // ส่ง monthly_income ด้วย (ไม่ต้องแปลง comma เพราะเป็น string ที่ format แล้ว)
      await taxAPI.saveYearly(selectedYear, {
        monthly_tax: monthlyTaxNoComma,
        monthly_income: monthlyIncome
      });
      await loadAllTaxData();
      alert('บันทึกข้อมูลภาษีเรียบร้อยแล้ว');
    } catch (error) {
      console.error('Error saving tax data:', error);
      alert('เกิดข้อผิดพลาดในการบันทึกข้อมูล');
    }
  };

  const handleDelete = async (year) => {
    const confirmDelete = confirm(`คุณแน่ใจหรือไม่ที่จะลบข้อมูลภาษีปี ${year}?`);
    
    if (!confirmDelete) return;

    try {
      const response = await taxAPI.deleteYear(year);
      
      if (!response.success) {
        alert(`เกิดข้อผิดพลาด: ${response.message}`);
        return;
      }
      
      await loadAllTaxData();
      
      const remainingYears = Object.keys(allYearData).filter(y => y !== year);
      
      if (remainingYears.length > 0) {
        setSelectedYear(remainingYears[0]);
      } else {
        const currentYear = (new Date().getFullYear() + 543).toString();
        const newYearData = {
          ภาษีสะสม: 0,
          ภาษีรายเดือน: {
            '01': '0.00', '02': '0.00', '03': '0.00', '04': '0.00',
            '05': '0.00', '06': '0.00', '07': '0.00', '08': '0.00',
            '09': '0.00', '10': '0.00', '11': '0.00', '12': '0.00'
          }
        };
        await taxAPI.saveYearly(currentYear, newYearData);
        setSelectedYear(currentYear);
        await loadAllTaxData();
      }
      
      alert(`ลบข้อมูลภาษีปี ${year} เรียบร้อยแล้ว`);
    } catch (error) {
      console.error('Error deleting tax data:', error);
      alert('เกิดข้อผิดพลาดในการเชื่อมต่อกับเซิร์ฟเวอร์ กรุณาลองใหม่อีกครั้ง');
    }
  };

  const handleAddNewYear = async () => {
    if (!newYear.trim()) {
      alert('กรุณากรอกปี');
      return;
    }

    const year = parseInt(newYear);
    if (isNaN(year) || year < 2563 || year > 2573) {
      alert('กรุณากรอกปี พ.ศ. ระหว่าง 2563-2573');
      return;
    }

    if (allYearData[year.toString()]) {
      alert('ปีนี้มีข้อมูลอยู่แล้ว');
      return;
    }

    try {
      const newYearData = {
        accumulated_tax: 0,
        monthly_tax: {
          '01': '0.00', '02': '0.00', '03': '0.00', '04': '0.00',
          '05': '0.00', '06': '0.00', '07': '0.00', '08': '0.00',
          '09': '0.00', '10': '0.00', '11': '0.00', '12': '0.00'
        }
      };
      await taxAPI.saveYearly(year.toString(), newYearData);
      await loadAllTaxData();
      setSelectedYear(year.toString());
      setShowAddForm(false);
      setNewYear('');
      alert('เพิ่มปีใหม่เรียบร้อยแล้ว');
    } catch (error) {
      console.error('Error adding new year:', error);
      alert('เกิดข้อผิดพลาดในการเพิ่มปีใหม่');
    }
  };

  const getSortedYears = () => {
    return Object.keys(allYearData).sort((a, b) => parseInt(b) - parseInt(a));
  };

  const handleMonthlyTaxChange = (month, value) => {
    // format เป็นทศนิยม 2 ตำแหน่งทุกครั้งที่ onChange
    handleNumberInput(value, setMonthlyTax, month);
  };

  const handleMonthlyTaxBlur = async (month, value) => {
    handleNumberInput(value, setMonthlyTax, month);
    // ส่วน save backend คงเดิม
  };

  const calculateAccumulatedTax = (upToMonth) => {
    const months = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'];
    const monthIndex = months.indexOf(upToMonth);
    let accumulated = 0;
    for (let i = 0; i <= monthIndex; i++) {
      accumulated += parseToNumber(monthlyTax[months[i]]);
    }
    return accumulated;
  };

  const getTotalYearlyTax = () => {
  return Object.values(monthlyTax).reduce((sum, value) => sum + parseToNumber(value), 0);
  };

  return (
    <div className={styles.taxTable}>
      <h2 className={styles.headerTitle}>ภาษีสะสม</h2>
      <div className={styles.yearSelector}>
        <label className={styles.yearLabel}>เลือกปี:</label>
        <select 
          value={selectedYear}
          onChange={(e) => {
            // Always store AD (คศ) in selectedYear
            setSelectedYear(e.target.value);
          }}
          className={styles.yearSelect}
        >
          {getSortedYears().map(yearAD => {
            // Display BE (พศ) only
            const yearBE = (parseInt(yearAD) + 543).toString();
            return <option key={yearAD} value={yearAD}>พ.ศ. {yearBE}</option>;
          })}
        </select>
        {mode === 'edit' && (
          <button 
            onClick={() => {
              setShowAddForm(!showAddForm);
              if (!showAddForm) {
                // default ปีใหม่เป็น BE (พศ) for input, but convert to AD (คศ) for logic
                const currentYearAD = new Date().getFullYear();
                setNewYear((currentYearAD + 543).toString());
              }
            }}
            className={styles.addYearBtn}
          >
            + เพิ่มปีใหม่
          </button>
        )}
      </div>

  {showAddForm && mode === 'edit' && (
        <div className={styles.addForm}>
          <h4 className={styles.addFormTitle}>เพิ่มปีใหม่</h4>
          <div className={styles.addFormControls}>
            <label className={styles.addFormLabel}>ปี พ.ศ.:</label>
            <input
              type="number"
              value={newYear}
              onChange={(e) => setNewYear(e.target.value)}
              placeholder="เช่น 2568"
              min="2563"
              max="2573"
              className={styles.yearInput}
            />
            <button onClick={() => {
              // Convert BE (พศ) to AD (คศ) before saving
              const yearAD = (parseInt(newYear) - 543).toString();
              setNewYear('');
              handleAddNewYear(yearAD);
            }} className={styles.submitBtn}>เพิ่ม</button>
            <button onClick={() => {
              setShowAddForm(false);
              setNewYear('');
            }} className={styles.cancelBtn}>ยกเลิก</button>
          </div>
        </div>
      )}

      <div className={styles.tableSection}>
  <h3 className={styles.tableTitle}>ภาษีสะสมรายเดือน พ.ศ. {parseInt(selectedYear) + 543}</h3>
        <table className={styles.monthlyTable}>
          <thead className={styles.tableHeader}>
            <tr>
              <th className={`${styles.tableHeaderCell} ${styles.left}`}>เดือน</th>
              <th className={`${styles.tableHeaderCell} ${styles.right}`}>รายรับ (บาท)</th>
              <th className={`${styles.tableHeaderCell} ${styles.right}`}>{taxKeyThaiMapping['monthly_tax']} (บาท)</th>
              <th className={`${styles.tableHeaderCell} ${styles.right}`}>{taxKeyThaiMapping['accumulated_tax']} (บาท)</th>
            </tr>
          </thead>
          <tbody>
            {[{ month: '01', name: 'มกราคม' }, { month: '02', name: 'กุมภาพันธ์' }, { month: '03', name: 'มีนาคม' },
              { month: '04', name: 'เมษายน' }, { month: '05', name: 'พฤษภาคม' }, { month: '06', name: 'มิถุนายน' },
              { month: '07', name: 'กรกฎาคม' }, { month: '08', name: 'สิงหาคม' }, { month: '09', name: 'กันยายน' },
              { month: '10', name: 'ตุลาคม' }, { month: '11', name: 'พฤศจิกายน' }, { month: '12', name: 'ธันวาคม' }
            ].map(({ month, name }) => {
              const accumulatedTax = calculateAccumulatedTax(month);
              const safeMonthly = monthlyTax[month] !== undefined && monthlyTax[month] !== null && monthlyTax[month] !== ''
                ? parseToNumber(monthlyTax[month])
                : 0;
              let displayMonthlyTax;
              if (safeMonthly === 0) {
                displayMonthlyTax = '0';
              } else {
                displayMonthlyTax = maskNumberFormat(parseToNumber(safeMonthly));
                if (!displayMonthlyTax) displayMonthlyTax = '0';
              }
              const safeAccumulated = accumulatedTax !== undefined && accumulatedTax !== null && accumulatedTax !== ''
                ? parseToNumber(accumulatedTax)
                : 0;
              let displayAccumulatedTax = maskNumberFormat(parseToNumber(safeAccumulated));
              if (!displayAccumulatedTax) displayAccumulatedTax = '0';
              // รายรับแต่ละเดือน
              const income = monthlyIncome[month] || '0.00';
              return (
                <tr key={month} className={styles.tableRow}>
                  <td className={`${styles.tableCell} ${styles.left}`}>{name}</td>
                  <td className={`${styles.tableCell} ${styles.right}`}>
                    {mode === 'edit' ? (
                      <input
                        type="text"
                        value={income}
                        onChange={e => handleNumberInput(e.target.value, setMonthlyIncome, month)}
                        onBlur={e => handleNumberBlur(e.target.value, setMonthlyIncome, month)}
                        placeholder="รายรับ"
                        className={styles.monthInput}
                      />
                    ) : (
                      <span>{income}</span>
                    )}
                  </td>
                  <td className={`${styles.tableCell} ${styles.right}`}>
                    {mode === 'edit' ? (
                      <input
                        type="text"
                        value={monthlyTax[month]}
                        onChange={e => handleNumberInput(e.target.value, setMonthlyTax, month)}
                        onBlur={e => handleNumberBlur(e.target.value, setMonthlyTax, month)}
                        placeholder={taxKeyThaiMapping['monthly_tax']}
                        className={styles.monthInput}
                      />
                    ) : (
                      <span>{displayMonthlyTax}</span>
                    )}
                  </td>
                  <td className={`${styles.tableCell} ${styles.right} ${styles.accumulatedCell}`}>{mode === 'edit' ? formatCurrency(accumulatedTax) : displayAccumulatedTax}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className={styles.totalRow}>
              <td className={styles.totalCell}>รวมทั้งปี</td>
              <td className={`${styles.totalCell} ${styles.right}`}>
                {(() => {
                  // Sum all monthlyIncome values
                  const sum = Object.values(monthlyIncome).reduce((acc, v) => acc + (parseFloat((v+'').replace(/,/g, '')) || 0), 0);
                  return formatCurrency(sum);
                })()}
              </td>
              <td className={`${styles.totalCell} ${styles.right}`}>
                {(() => {
                  // Sum all monthlyTax values
                  const sum = Object.values(monthlyTax).reduce((acc, v) => acc + (parseFloat((v+'').replace(/,/g, '')) || 0), 0);
                  return formatCurrency(sum);
                })()}
              </td>
              <td className={`${styles.totalCell} ${styles.right}`}>
                {(() => {
                  // Sum all monthlyTax values for accumulated tax (should match last accumulated cell)
                  const sum = Object.values(monthlyTax).reduce((acc, v) => acc + (parseFloat((v+'').replace(/,/g, '')) || 0), 0);
                  return formatCurrency(sum);
                })()}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* ปุ่มจัดการข้อมูล */}
      {mode === 'edit' && (
        <div className={styles.actionButtons}>
          <button 
            onClick={handleSave} 
            className={styles.saveBtn}
          >
            บันทึกภาษี
          </button>
          <button 
            onClick={() => handleDelete(selectedYear)} 
            className={styles.deleteBtn}
          >
            ลบข้อมูลปี พ.ศ. {parseInt(selectedYear) + 543}
          </button>
        </div>
      )}
    </div>
  );
}
