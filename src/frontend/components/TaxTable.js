
// ...imports and component definition...
import { useState, useEffect } from 'react';
import { formatCurrency, handleNumberInput, handleNumberBlur, parseToNumber, maskNumberFormat } from '../../shared/utils/numberUtils';
import { taxAPI, incomeAPI } from '../../shared/utils/apiUtils';
import styles from '../styles/TaxTable.module.css';

export default function TaxTable({ selectedMonth, mode = 'view' }) {
  // ...existing code...
  // เพิ่มปีใหม่ (เฉพาะโหมด edit)
  const handleAddNewYear = (yearAD) => {
    if (!yearAD || allYearData[yearAD]) return;
    // สร้างข้อมูลว่างสำหรับปีใหม่
    const emptyYearData = {
      monthly_tax: {
        '01': '0.00', '02': '0.00', '03': '0.00', '04': '0.00',
        '05': '0.00', '06': '0.00', '07': '0.00', '08': '0.00',
        '09': '0.00', '10': '0.00', '11': '0.00', '12': '0.00'
      },
      monthly_income: {
        '01': '0.00', '02': '0.00', '03': '0.00', '04': '0.00',
        '05': '0.00', '06': '0.00', '07': '0.00', '08': '0.00',
        '09': '0.00', '10': '0.00', '11': '0.00', '12': '0.00'
      },
      monthly_provident: {
        '01': '0.00', '02': '0.00', '03': '0.00', '04': '0.00',
        '05': '0.00', '06': '0.00', '07': '0.00', '08': '0.00',
        '09': '0.00', '10': '0.00', '11': '0.00', '12': '0.00'
      }
    };
    setAllYearData(prev => ({ ...prev, [yearAD]: emptyYearData }));
    setSelectedYear(yearAD);
    setMonthlyTax(emptyYearData.monthly_tax);
    setMonthlyIncome(emptyYearData.monthly_income);
    setMonthlyProvident(emptyYearData.monthly_provident);
    setShowAddForm(false);
  };  // ลบปี (เฉพาะโหมด edit)
  const handleDelete = async (yearAD) => {
    if (!yearAD || !allYearData[yearAD]) return;
    // ลบที่ backend ก่อน
    try {
      const res = await fetch('/api/tax_accumulated', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ year: yearAD })
      });
      const result = await res.json();
      if (!result.success) {
        alert(result.message || 'ลบข้อมูลไม่สำเร็จ');
        return;
      }
    } catch (e) {
      alert('เกิดข้อผิดพลาดในการลบข้อมูล');
      return;
    }
    // ลบที่ frontend
    const updated = { ...allYearData };
    delete updated[yearAD];
    setAllYearData(updated);
    if (selectedYear === yearAD) {
      const years = Object.keys(updated);
      if (years.length > 0) {
        const latest = years.sort((a, b) => parseInt(b) - parseInt(a))[0];
        setSelectedYear(latest);
      } else {
        setSelectedYear('');
        setMonthlyTax({});
        setMonthlyIncome({});
        setMonthlyProvident({});
      }
    }
  };
  // โหลดข้อมูลปีทั้งหมดสำหรับ dropdown ปี (ต้องอยู่ในฟังก์ชันคอมโพเนนต์เท่านั้น)
  useEffect(() => {
    const fetchAllYears = async () => {
      try {
        const res = await fetch('/api/tax_accumulated');
        const data = await res.json();
        setAllYearData(data.tax_by_year || {});
      } catch (error) {
        setAllYearData({});
      }
    };
    fetchAllYears();
  }, []);
  // Save handler: POST all tax data including provident to backend
  const handleSave = async () => {
    try {
      await fetch('/api/tax_accumulated', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          year: selectedYear,
          monthly_tax: monthlyTax,
          monthly_income: monthlyIncome,
          monthly_provident: monthlyProvident
        })
      });
      alert('บันทึกข้อมูลภาษีสำเร็จ');
    } catch (e) {
      alert('เกิดข้อผิดพลาดในการบันทึกข้อมูลภาษี');
    }
  };
  // State for provident fund and its tax
  const [monthlyProvident, setMonthlyProvident] = useState({
    '01': '0.00', '02': '0.00', '03': '0.00', '04': '0.00',
    '05': '0.00', '06': '0.00', '07': '0.00', '08': '0.00',
    '09': '0.00', '10': '0.00', '11': '0.00', '12': '0.00'
  });
  const [monthlyProvidentTax, setMonthlyProvidentTax] = useState({
    '01': '0.00', '02': '0.00', '03': '0.00', '04': '0.00',
    '05': '0.00', '06': '0.00', '07': '0.00', '08': '0.00',
    '09': '0.00', '10': '0.00', '11': '0.00', '12': '0.00'
  });
  // Mapping English tax keys to Thai labels
  const taxKeyThaiMapping = {
    monthly_tax: 'ภาษีรายเดือน',
    accumulated_tax: 'ภาษีสะสม'
  };
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

  // โหลดข้อมูลภาษีและ provident เมื่อปีที่เลือกเปลี่ยน
  useEffect(() => {
    const fetchTaxData = async () => {
      try {
        const res = await fetch(`/api/tax_accumulated?year=${selectedYear}`);
        const data = await res.json();
        const yearData = data[selectedYear];
        const default12 = {
          '01': '0.00', '02': '0.00', '03': '0.00', '04': '0.00',
          '05': '0.00', '06': '0.00', '07': '0.00', '08': '0.00',
          '09': '0.00', '10': '0.00', '11': '0.00', '12': '0.00'
        };
        setMonthlyTax((yearData && yearData.monthly_tax) ? yearData.monthly_tax : { ...default12 });
        setMonthlyIncome((yearData && yearData.monthly_income) ? yearData.monthly_income : { ...default12 });
        setMonthlyProvident((yearData && yearData.monthly_provident) ? yearData.monthly_provident : { ...default12 });
      } catch (error) {
        const default12 = {
          '01': '0.00', '02': '0.00', '03': '0.00', '04': '0.00',
          '05': '0.00', '06': '0.00', '07': '0.00', '08': '0.00',
          '09': '0.00', '10': '0.00', '11': '0.00', '12': '0.00'
        };
        setMonthlyTax({ ...default12 });
        setMonthlyIncome({ ...default12 });
        setMonthlyProvident({ ...default12 });
        console.error('Error fetching tax data:', error);
      }
    };
    fetchTaxData();
  }, [selectedYear]);

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

  // ฟังก์ชันคำนวณรายได้สะสมถึงเดือนที่กำหนด
  const calculateAccumulatedIncome = (upToMonth) => {
    const months = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'];
    const monthIndex = months.indexOf(upToMonth);
    let accumulated = 0;
    for (let i = 0; i <= monthIndex; i++) {
      accumulated += parseToNumber(monthlyIncome[months[i]]);
    }
    return accumulated;
  };

  return (
    <div className={styles.taxTable}>
      <h2 className={styles.headerTitle}>ภาษีสะสม</h2>
      <div className={styles.yearSelector}>
        <label className={styles.yearLabel}>เลือกปี:</label>
        <select 
          value={selectedYear}
          onChange={(e) => {
            setSelectedYear(e.target.value);
          }}
          className={styles.yearSelect}
        >
          {getSortedYears().map(yearAD => {
            const yearBE = (parseInt(yearAD) + 543).toString();
            return <option key={yearAD} value={yearAD}>พ.ศ. {yearBE}</option>;
          })}
        </select>
        {mode === 'edit' && (
          <>
            <button 
              onClick={() => {
                setShowAddForm(!showAddForm);
                if (!showAddForm) {
                  const currentYearAD = new Date().getFullYear();
                  setNewYear((currentYearAD + 543).toString());
                }
              }}
              className={styles.addYearBtn}
            >
              + เพิ่มปีใหม่
            </button>
            <button 
              onClick={() => handleDelete(selectedYear)}
              className={styles.deleteBtn}
            >
              ลบข้อมูลปี พ.ศ. {parseInt(selectedYear) + 543}
            </button>
          </>
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
              <th className={`${styles.tableHeaderCell} ${styles.right}`}>รายได้สะสม (บาท)</th>
              <th className={`${styles.tableHeaderCell} ${styles.right}`}>กองทุนสำรองเลี้ยงชีพ (บาท)</th>
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
              const accumulatedIncome = calculateAccumulatedIncome(month);
              const income = monthlyIncome[month] || '0.00';
              let displayAccumulatedIncome = maskNumberFormat(parseToNumber(accumulatedIncome));
              if (!displayAccumulatedIncome) displayAccumulatedIncome = '0';
              const provident = monthlyProvident?.[month] || '0.00';
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
                      <span>{maskNumberFormat(parseToNumber(income))}</span>
                    )}
                  </td>
                  <td className={`${styles.tableCell} ${styles.right}`}>
                    <span>{mode === 'edit' ? formatCurrency(accumulatedIncome) : displayAccumulatedIncome}</span>
                  </td>
                  <td className={`${styles.tableCell} ${styles.right}`}>
                    {mode === 'edit' ? (
                      <input
                        type="text"
                        value={provident}
                        onChange={e => handleNumberInput(e.target.value, setMonthlyProvident, month)}
                        onBlur={e => handleNumberBlur(e.target.value, setMonthlyProvident, month)}
                        placeholder="กองทุนสำรองเลี้ยงชีพ"
                        className={styles.monthInput}
                      />
                    ) : (
                      <span>{maskNumberFormat(parseToNumber(provident))}</span>
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
                  const sum = Object.values(monthlyIncome).reduce((acc, v) => acc + (parseFloat((v+'').replace(/,/g, '')) || 0), 0);
                  return formatCurrency(sum);
                })()}
              </td>
              <td className={`${styles.totalCell} ${styles.right}`}>
                {(() => {
                  // รายได้สะสมทั้งปี = รายรับรวมทั้งปี
                  const sum = Object.values(monthlyIncome).reduce((acc, v) => acc + (parseFloat((v+'').replace(/,/g, '')) || 0), 0);
                  return formatCurrency(sum);
                })()}
              </td>
              <td className={`${styles.totalCell} ${styles.right}`}>
                {(() => {
                  const sum = Object.values(monthlyProvident || {}).reduce((acc, v) => acc + (parseFloat((v+'').replace(/,/g, '')) || 0), 0);
                  return formatCurrency(sum);
                })()}
              </td>
              <td className={`${styles.totalCell} ${styles.right}`}>
                {(() => {
                  const sum = Object.values(monthlyTax).reduce((acc, v) => acc + (parseFloat((v+'').replace(/,/g, '')) || 0), 0);
                  return formatCurrency(sum);
                })()}
              </td>
              <td className={`${styles.totalCell} ${styles.right}`}>
                {(() => {
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
        </div>
      )}
    </div>
  );
}
