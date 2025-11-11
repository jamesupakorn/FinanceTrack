import React, { useState, useEffect, useRef } from 'react';
import { investmentAPI } from '../../shared/utils/apiUtils';
import { maskNumberFormat, parseToNumber, formatCurrency } from '../../shared/utils/numberUtils';
import styles from '../styles/InvestmentTable.module.css';
import { averagePercent, calcAmountFromPercent, sumPercent, mapInvestmentData } from '../../shared/utils/investmentUtils';

// InvestmentTable: แสดงและแก้ไขรายการลงทุนในแต่ละเดือน
export default function InvestmentTable({ selectedMonth, mode = 'view', onDataChange }) {
  const [baseAmount, setBaseAmount] = useState('');
  const [investments, setInvestments] = useState([]);

  // ฟังก์ชันคำนวณ amount ตามเปอร์เซ็นต์
  const recalcAmounts = (amount, invList) => {
    const base = parseToNumber(amount);
    return invList.map(item => ({
      ...item,
      amount: base && item.percent ? ((parseFloat(item.percent) / 100) * base).toFixed(2) : ''
    }));
  };
  const isFirstLoad = useRef(true);
  // เพิ่มฟังก์ชันเพิ่มรายการลงทุนใหม่
  const addInvestment = () => {
    setInvestments(prev => recalcAmounts(baseAmount, [
      ...prev,
      { name: '', percent: '', amount: '' }
    ]));
  };

  // ฟังก์ชันบันทึกข้อมูลการลงทุน
  const [saveStatus, setSaveStatus] = useState('idle');
  const handleSave = async () => {
    if (!selectedMonth) return;
    setSaveStatus('saving');
    const result = await investmentAPI.saveList(selectedMonth, investments);
    if (result) {
      setSaveStatus('success');
      if (typeof onDataChange === 'function') onDataChange();
    } else {
      setSaveStatus('error');
    }
    setTimeout(() => setSaveStatus('idle'), 2000);
  };

  // โหลดข้อมูลจาก backend เมื่อ selectedMonth เปลี่ยน
  useEffect(() => {
    if (!selectedMonth) return;
    investmentAPI.getByMonth(selectedMonth).then((data) => {
      // data คือ array investments จาก backend
      if (Array.isArray(data)) {
        setInvestments(data);
      } else {
        setInvestments([]);
      }
    });
  }, [selectedMonth]);

  // เพิ่มฟังก์ชันแก้ไขฟิลด์ในแต่ละรายการ
  const updateField = (idx, field, value) => {
    setInvestments(prev => {
      const updated = prev.map((item, i) =>
        i === idx ? { ...item, [field]: value } : item
      );
      // ถ้าแก้ percent ให้คำนวณ amount ใหม่
      if (field === 'percent') {
        return recalcAmounts(baseAmount, updated);
      }
      return updated;
    });
  };
  // เพิ่มฟังก์ชันลบรายการลงทุน
  const removeInvestment = (idx) => {
    setInvestments(prev => prev.filter((_, i) => i !== idx));
  };

  // คำนวณเปอร์เซ็นรวมของรายการลงทุน
  const totalPercent = investments.reduce((sum, item) => sum + (parseFloat(item.percent) || 0), 0);

  return (
    <div className={styles.investmentContainer}>
      <h3 className={styles.investmentTitle}>การลงทุนประจำเดือน {selectedMonth || ''}</h3>
      <div>
        <label>
          จำนวนเงินลงทุนรวม (บาท):
          {mode === 'edit' ? (
            <input
              type="number"
              min="0"
              value={baseAmount}
              onChange={e => {
                setBaseAmount(e.target.value);
                setInvestments(prev => recalcAmounts(e.target.value, prev));
              }}
              className={styles.baseAmountInput}
              disabled={mode !== 'edit'}
            />
          ) : (
            <span className={styles.baseAmountDisplay}>{maskNumberFormat(parseToNumber(baseAmount))}</span>
          )}
        </label>
      </div>
      <table className={styles.investmentTable}>
        <thead>
          <tr className={styles.tableHeaderRow}>
            <th className={styles.tableHeaderCell}>ชื่อหุ้น/กองทุน</th>
            <th className={styles.tableHeaderCell}>เปอร์เซ็นการลงทุน (%)</th>
            <th className={styles.tableHeaderCell}>จำนวนเงิน (บาท)</th>
            {mode === 'edit' && <th className={styles.tableHeaderCell}>ลบ</th>}
          </tr>
        </thead>
        <tbody>
          {investments.map((item, idx) => (
            <tr key={idx}>
              <td className={styles.tableCell}>
                <input
                  type="text"
                  value={item.name}
                  onChange={e => updateField(idx, 'name', e.target.value)}
                  className={styles.inputText}
                  disabled={mode !== 'edit'}
                />
              </td>
              <td className={styles.tableCell}>
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={item.percent}
                  onChange={e => updateField(idx, 'percent', e.target.value)}
                  className={styles.inputPercent}
                  disabled={mode !== 'edit'}
                />
              </td>
              <td className={`${styles.tableCell} ${styles.amountCell}`}>
                {mode === 'edit'
                  ? formatCurrency(item.amount)
                  : maskNumberFormat(parseToNumber(item.amount))}
              </td>
              {mode === 'edit' && (
                <td className={`${styles.tableCell} ${styles.deleteCell}`}>
                  <button type="button" onClick={() => removeInvestment(idx)} className={styles.deleteButton}>ลบ</button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {mode === 'edit' && (
        <div className={styles.actionBar}>
          <button type="button" onClick={addInvestment} className={styles.addButton}>+ เพิ่มรายการลงทุน</button>
          <button
            type="button"
            onClick={() => {
              if (investments.length === 0) return;
              const avgPercents = averagePercent(investments.length);
              setInvestments(investments.map((item, idx) => ({
                ...item,
                percent: avgPercents[idx]
              })));
            }}
            className={styles.averageButton}
            disabled={investments.length === 0}
          >
            เฉลี่ยเปอร์เซ็น
          </button>
          <button
            type="button"
            onClick={handleSave}
            className={styles.saveButton}
            disabled={totalPercent !== 100}
          >
            บันทึก
          </button>
          {saveStatus === 'saving' && <span className={styles.statusSaving}>กำลังบันทึก...</span>}
          {saveStatus === 'success' && <span className={styles.statusSuccess}>บันทึกสำเร็จ</span>}
          {saveStatus === 'error' && <span className={styles.statusError}>บันทึกผิดพลาด</span>}
        </div>
      )}
      <div className={`${styles.percentSummary} ${totalPercent !== 100 ? styles.percentSummaryError : styles.percentSummaryNormal}`}>
        รวมเปอร์เซ็น: {totalPercent}% {totalPercent > 100 && '(เกิน 100%)'}{totalPercent < 100 && '(ต้องครบ 100%)'}
      </div>
    </div>
  );
}
