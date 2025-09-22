import { useState, useEffect } from 'react';
import { formatCurrency } from '../../shared/utils/numberUtils';
import { taxAPI } from '../../shared/utils/apiUtils';
import styles from '../styles/TaxTable.module.css';

export default function TaxTable({ selectedMonth }) {
  const [selectedYear, setSelectedYear] = useState((new Date().getFullYear() + 543).toString());
  const [ภาษีสะสม, setภาษีสะสม] = useState('0.00');
  const [allYearData, setAllYearData] = useState({});
  const [showAddForm, setShowAddForm] = useState(false);
  const [newYear, setNewYear] = useState('');
  const [ภาษีรายเดือน, setภาษีรายเดือน] = useState({
    '01': '0.00', '02': '0.00', '03': '0.00', '04': '0.00',
    '05': '0.00', '06': '0.00', '07': '0.00', '08': '0.00',
    '09': '0.00', '10': '0.00', '11': '0.00', '12': '0.00'
  });

  useEffect(() => {
    loadAllTaxData();
  }, []);

  useEffect(() => {
    if (allYearData[selectedYear]) {
      if (allYearData[selectedYear].ภาษีรายเดือน) {
        setภาษีรายเดือน(allYearData[selectedYear].ภาษีรายเดือน);
        const totalTax = Object.values(allYearData[selectedYear].ภาษีรายเดือน).reduce((sum, value) => sum + parseFloat(value || 0), 0);
        setภาษีสะสม(formatCurrency(totalTax));
      } else {
        setภาษีรายเดือน({
          '01': '0.00', '02': '0.00', '03': '0.00', '04': '0.00',
          '05': '0.00', '06': '0.00', '07': '0.00', '08': '0.00',
          '09': '0.00', '10': '0.00', '11': '0.00', '12': '0.00'
        });
        setภาษีสะสม(formatCurrency(allYearData[selectedYear].ภาษีสะสม || 0));
      }
    } else {
      setภาษีสะสม('0.00');
      setภาษีรายเดือน({
        '01': '0.00', '02': '0.00', '03': '0.00', '04': '0.00',
        '05': '0.00', '06': '0.00', '07': '0.00', '08': '0.00',
        '09': '0.00', '10': '0.00', '11': '0.00', '12': '0.00'
      });
    }
  }, [selectedYear, allYearData]);

  const loadAllTaxData = async () => {
    try {
      const data = await taxAPI.getAll();
      setAllYearData(data.ภาษีรายปี || {});
    } catch (error) {
      console.error('Error loading tax data:', error);
      setAllYearData({});
    }
  };

  const handleSave = async () => {
    try {
      const totalTax = Object.values(ภาษีรายเดือน).reduce((sum, val) => sum + parseFloat(val || 0), 0);
      const yearData = {
        ภาษีสะสม: totalTax,
        ภาษีรายเดือน: ภาษีรายเดือน
      };
      await taxAPI.saveYearly(selectedYear, yearData);
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
        ภาษีสะสม: 0,
        ภาษีรายเดือน: {
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
    // เก็บค่าแบบ raw ไว้ระหว่างการพิมพ์
    const newภาษีรายเดือน = {
      ...ภาษีรายเดือน,
      [month]: value
    };
    setภาษีรายเดือน(newภาษีรายเดือน);
  };

  const handleMonthlyTaxBlur = async (month, value) => {
    // Format เฉพาะเมื่อออกจาก input และบันทึกข้อมูล
    const numericValue = parseFloat(value) || 0;
    const newภาษีรายเดือน = {
      ...ภาษีรายเดือน,
      [month]: numericValue
    };
    setภาษีรายเดือน(newภาษีรายเดือน);
    
    const totalTax = Object.values(newภาษีรายเดือน).reduce((sum, val) => sum + parseFloat(val || 0), 0);
    setภาษีสะสม(formatCurrency(totalTax));
    
    try {
      const yearData = {
        ภาษีสะสม: totalTax,
        ภาษีรายเดือน: newภาษีรายเดือน
      };
      await taxAPI.saveYearly(selectedYear, yearData);
    } catch (error) {
      console.error('Error saving monthly tax data:', error);
    }
  };

  const calculateAccumulatedTax = (upToMonth) => {
    const months = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'];
    const monthIndex = months.indexOf(upToMonth);
    let accumulated = 0;
    
    for (let i = 0; i <= monthIndex; i++) {
      accumulated += parseFloat(ภาษีรายเดือน[months[i]] || 0);
    }
    
    return accumulated;
  };

  const getTotalYearlyTax = () => {
    return Object.values(ภาษีรายเดือน).reduce((sum, value) => sum + parseFloat(value || 0), 0);
  };

  return (
    <div className={styles.taxTable}>
      <h2 className={styles.headerTitle}>ภาษีสะสม</h2>
      
      <div className={styles.yearSelector}>
        <label className={styles.yearLabel}>เลือกปี:</label>
        <select 
          value={selectedYear} 
          onChange={(e) => setSelectedYear(e.target.value)}
          className={styles.yearSelect}
        >
          {getSortedYears().map(year => (
            <option key={year} value={year}>พ.ศ. {year}</option>
          ))}
        </select>
        
        <button 
          onClick={() => {
            setShowAddForm(!showAddForm);
            if (!showAddForm) {
              const currentYear = (new Date().getFullYear() + 543).toString();
              setNewYear(currentYear);
            }
          }}
          className={styles.addYearBtn}
        >
          + เพิ่มปีใหม่
        </button>
      </div>

      {showAddForm && (
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
            <button onClick={handleAddNewYear} className={styles.submitBtn}>เพิ่ม</button>
            <button onClick={() => {
              setShowAddForm(false);
              setNewYear('');
            }} className={styles.cancelBtn}>ยกเลิก</button>
          </div>
        </div>
      )}

      <div className={styles.tableSection}>
        <h3 className={styles.tableTitle}>ภาษีสะสมรายเดือน พ.ศ. {selectedYear}</h3>
        <table className={styles.monthlyTable}>
          <thead className={styles.tableHeader}>
            <tr>
              <th className={`${styles.tableHeaderCell} ${styles.left}`}>เดือน</th>
              <th className={`${styles.tableHeaderCell} ${styles.right}`}>ภาษีรายเดือน (บาท)</th>
              <th className={`${styles.tableHeaderCell} ${styles.right}`}>ภาษีสะสมถึงเดือนนี้ (บาท)</th>
            </tr>
          </thead>
          <tbody>
            {[
              { month: '01', name: 'มกราคม' }, { month: '02', name: 'กุมภาพันธ์' }, { month: '03', name: 'มีนาคม' },
              { month: '04', name: 'เมษายน' }, { month: '05', name: 'พฤษภาคม' }, { month: '06', name: 'มิถุนายน' },
              { month: '07', name: 'กรกฎาคม' }, { month: '08', name: 'สิงหาคม' }, { month: '09', name: 'กันยายน' },
              { month: '10', name: 'ตุลาคม' }, { month: '11', name: 'พฤศจิกายน' }, { month: '12', name: 'ธันวาคม' }
            ].map(({ month, name }) => {
              const accumulatedTax = calculateAccumulatedTax(month);
              return (
                <tr key={month} className={styles.tableRow}>
                  <td className={`${styles.tableCell} ${styles.left}`}>{name}</td>
                  <td className={`${styles.tableCell} ${styles.right}`}>
                    <input
                      type="text"
                      value={ภาษีรายเดือน[month]}
                      onChange={e => handleMonthlyTaxChange(month, e.target.value)}
                      onBlur={e => handleMonthlyTaxBlur(month, e.target.value)}
                      className={styles.monthInput}
                    />
                  </td>
                  <td className={`${styles.tableCell} ${styles.right} ${styles.accumulatedCell}`}>
                    {formatCurrency(accumulatedTax)}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className={styles.totalRow}>
              <td className={styles.totalCell}>รวมทั้งปี</td>
              <td className={`${styles.totalCell} ${styles.right}`}>{formatCurrency(getTotalYearlyTax())}</td>
              <td className={`${styles.totalCell} ${styles.right}`}>{formatCurrency(getTotalYearlyTax())}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* ปุ่มจัดการข้อมูล */}
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
          ลบข้อมูลปี พ.ศ. {selectedYear}
        </button>
      </div>
    </div>
  );
}
