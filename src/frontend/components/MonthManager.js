import React, { useState } from 'react';
import { getNextMonth, generateMonthOptions } from '../../shared/utils/numberUtils';
import styles from '../styles/MonthManager.module.css';

const MonthManager = ({ selectedMonth, onMonthSelected, onDataRefresh }) => {
  const [showAddForm, setShowAddForm] = useState(false);
  const [newMonthName, setNewMonthName] = useState('');
  const monthOptions = generateMonthOptions();

  const handleAddNewMonth = () => {
    const nextMonth = getNextMonth(selectedMonth);
    const nextDate = new Date(nextMonth + '-01');
    const monthLabel = nextDate.toLocaleDateString('th-TH', { 
      year: 'numeric', 
      month: 'long' 
    });
    
    // เปลี่ยนไปเดือนใหม่
    onMonthSelected(nextMonth);
    
    // รีเฟรชข้อมูล
    onDataRefresh();
    
    // ซ่อนฟอร์ม
    setShowAddForm(false);
    setNewMonthName('');
  };

  const handleCustomMonth = () => {
    if (newMonthName.trim()) {
      // สร้างเดือนใหม่จากที่กรอก (format: YYYY-MM)
      if (/^\d{4}-\d{2}$/.test(newMonthName)) {
        onMonthChange(newMonthName);
        setShowAddForm(false);
        setNewMonthName('');
      } else {
        alert('กรุณากรอกรูปแบบ YYYY-MM (เช่น 2025-10)');
      }
    }
  };

  return (
    <div className={styles.monthManager}>
      {/* แสดงเดือนปัจจุบันและ dropdown เลือกเดือน */}
      <div className={styles.currentMonthDisplay}>
        <div className={styles.monthSelectionRow}>
          <label className={styles.monthLabel}>เดือนปัจจุบัน: </label>
          <select 
            value={selectedMonth} 
            onChange={(e) => onMonthSelected(e.target.value)}
            className={styles.monthSelect}
          >
            {monthOptions.map(option => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className={styles.monthActions}>
        <button 
          onClick={() => setShowAddForm(!showAddForm)}
          className={styles.addMonthBtn}
        >
          + เพิ่มเดือนใหม่
        </button>
      </div>

      {showAddForm && (
        <div className={styles.addMonthForm}>
          <div className={styles.formContent}>
            <h4>เพิ่มเดือนใหม่</h4>
            
            <button 
              onClick={handleAddNewMonth}
              className={styles.quickAddBtn}
            >
              เดือนถัดไป ({getNextMonth(selectedMonth)})
            </button>
            
            <div className={styles.customMonth}>
              <input
                type="text"
                placeholder="YYYY-MM (เช่น 2025-10)"
                value={newMonthName}
                onChange={(e) => setNewMonthName(e.target.value)}
                className={styles.monthInput}
              />
              <button onClick={handleCustomMonth} className={styles.customAddBtn}>
                เพิ่ม
              </button>
            </div>
            
            <button 
              onClick={() => setShowAddForm(false)}
              className={styles.cancelBtn}
            >
              ยกเลิก
            </button>
          </div>
        </div>
      )}

    </div>
  );
};

export default MonthManager;