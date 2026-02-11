import React, { useState, useEffect } from 'react';
import { formatCurrency, parseAndFormat, parseToNumber } from '../../shared/utils/frontend/numberUtils';
import { salaryAPI, incomeAPI, taxAPI } from '../../shared/utils/frontend/apiUtils';
import styles from '../styles/SalaryCalculator.module.css';

// ฟังก์ชันสำหรับแปลงเดือนเป็นชื่อภาษาไทย
const getThaiMonthName = (monthStr) => {
  if (!monthStr) return '';
  const [year, month] = monthStr.split('-');
  const monthNames = [
    'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
    'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'
  ];
  return `${monthNames[parseInt(month) - 1]} ${year}`;
};

const salaryKeyThaiMapping = {
  salary: 'เงินเดือน',
  overtime_1x: 'ค่าล่วงเวลา 1 เท่า',
  overtime_1_5x: 'ค่าล่วงเวลา 1.5 เท่า',
  overtime_2x: 'ค่าล่วงเวลา 2 เท่า',
  overtime_3x: 'ค่าล่วงเวลา 3 เท่า',
  overtime_other: 'ค่าล่วงเวลาอื่นๆ',
  bonus: 'โบนัส',
  other_income: 'เงินได้อื่นๆ',
  provident_fund: 'หักกองทุนสำรองเลี้ยงชีพ',
  social_security: 'หักสมทบประกันสังคม',
  tax: 'หักภาษี'
};

const LABELS_META_KEY = '__labels';
const incomePresetKeys = [
  'salary',
  'overtime_1x',
  'overtime_1_5x',
  'overtime_2x',
  'overtime_3x',
  'overtime_other',
  'bonus',
  'other_income'
];
const deductionPresetKeys = ['provident_fund', 'social_security', 'tax'];

const buildPresetItems = (keys) =>
  keys.map((key) => ({
    id: key,
    key,
    label: salaryKeyThaiMapping[key] || 'รายการใหม่',
    value: ''
  }));

const generateItemId = (prefix) => {
  const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  return `${prefix}_${stamp}`;
};

const createNewItem = (type) => {
  const id = generateItemId(type);
  return {
    id,
    key: id,
    label: type === 'income' ? 'รายได้ใหม่' : 'รายการหักใหม่',
    value: ''
  };
};

const formatIncomingValue = (rawValue) => {
  if (rawValue === undefined || rawValue === null || rawValue === '') {
    return '';
  }
  return parseAndFormat(rawValue);
};

const isNumericValue = (value) => {
  if (typeof value === 'number') return true;
  if (typeof value === 'string') {
    return value.trim().length > 0;
  }
  return false;
};

const buildItemsFromSource = (sectionData, presetKeys, type) => {
  if (!sectionData || typeof sectionData !== 'object') {
    return buildPresetItems(presetKeys);
  }

  const labelsMap =
    sectionData[LABELS_META_KEY] && typeof sectionData[LABELS_META_KEY] === 'object'
      ? sectionData[LABELS_META_KEY]
      : {};

  const items = [];
  const seenKeys = new Set();

  presetKeys.forEach((key) => {
    seenKeys.add(key);
    const hasValue = Object.prototype.hasOwnProperty.call(sectionData, key);
    items.push({
      id: key,
      key,
      label: labelsMap[key] || salaryKeyThaiMapping[key] || 'รายการใหม่',
      value: hasValue ? formatIncomingValue(sectionData[key]) : ''
    });
  });

  Object.entries(sectionData)
    .filter(([key, value]) => key !== LABELS_META_KEY && !seenKeys.has(key) && isNumericValue(value))
    .forEach(([key, value]) => {
      items.push({
        id: key,
        key,
        label: labelsMap[key] || 'รายการใหม่',
        value: formatIncomingValue(value)
      });
      seenKeys.add(key);
    });

  return items.length ? items : [createNewItem(type)];
};

const serializeItemsForSave = (items) => {
  const values = {};
  const labels = {};
  items.forEach((item) => {
    values[item.key] = parseToNumber(item.value);
    labels[item.key] = item.label?.trim() || 'รายการใหม่';
  });
  values[LABELS_META_KEY] = labels;
  return values;
};

const sumItems = (items) => items.reduce((sum, item) => sum + parseToNumber(item.value), 0);

const SalaryCalculator = ({ selectedMonth, onSalaryUpdate }) => {
  const [incomeItems, setIncomeItems] = useState(() => buildPresetItems(incomePresetKeys));
  const [deductionItems, setDeductionItems] = useState(() => buildPresetItems(deductionPresetKeys));
  const [calculatedResults, setCalculatedResults] = useState({
    รวมรายได้: 0,
    รวมหัก: 0,
    เงินได้สุทธิ: 0
  });

  useEffect(() => {
    const totalIncome = sumItems(incomeItems);
    const totalDeduction = sumItems(deductionItems);
    setCalculatedResults({
      รวมรายได้: totalIncome,
      รวมหัก: totalDeduction,
      เงินได้สุทธิ: totalIncome - totalDeduction
    });
  }, [incomeItems, deductionItems]);

  useEffect(() => {
    if (!selectedMonth) {
      setIncomeItems(buildPresetItems(incomePresetKeys));
      setDeductionItems(buildPresetItems(deductionPresetKeys));
      return;
    }
    loadSalaryData(selectedMonth);
  }, [selectedMonth]);

  const loadSalaryData = async (month) => {
    try {
      const data = await salaryAPI.getByMonth(month);
      setIncomeItems(buildItemsFromSource(data?.income, incomePresetKeys, 'income'));
      setDeductionItems(buildItemsFromSource(data?.deduct, deductionPresetKeys, 'deduction'));
    } catch (error) {
      console.error('Error loading salary data:', error);
      setIncomeItems(buildPresetItems(incomePresetKeys));
      setDeductionItems(buildPresetItems(deductionPresetKeys));
    }
  };

  const updateItems = (type, updater) => {
    if (type === 'income') {
      setIncomeItems((prev) => updater(prev));
      return;
    }
    setDeductionItems((prev) => updater(prev));
  };

  const handleLabelChange = (type, id, nextLabel) => {
    updateItems(type, (prev) => prev.map((item) => (item.id === id ? { ...item, label: nextLabel } : item)));
  };

  const handleValueChange = (type, id, value) => {
    updateItems(type, (prev) => prev.map((item) => (item.id === id ? { ...item, value } : item)));
  };

  const handleValueBlur = (type, id, value) => {
    updateItems(type, (prev) =>
      prev.map((item) => (item.id === id ? { ...item, value: formatIncomingValue(value) } : item))
    );
  };

  const handleAddItem = (type) => {
    updateItems(type, (prev) => [...prev, createNewItem(type)]);
  };

  const handleRemoveItem = (type, id) => {
    updateItems(type, (prev) => {
      const filtered = prev.filter((item) => item.id !== id);
      if (filtered.length === 0) {
        return [createNewItem(type)];
      }
      return filtered;
    });
  };

  const saveSalaryData = async () => {
    try {
      if (!selectedMonth) {
        alert('กรุณาเลือกเดือนที่ต้องการก่อน');
        return;
      }

      const incomePayload = serializeItemsForSave(incomeItems);
      const deductionPayload = serializeItemsForSave(deductionItems);
      const totalIncome = sumItems(incomeItems);
      const totalDeduct = sumItems(deductionItems);
      const netIncomeValue = totalIncome - totalDeduct;

      const result = await salaryAPI.save(selectedMonth, incomePayload, deductionPayload);

      if (result.success) {
        try {
          const [yearStr, monthStr] = selectedMonth.split('-');
          const year = (parseInt(yearStr, 10) + 543).toString();
          const month = monthStr.padStart(2, '0');
          const taxItem = deductionItems.find((item) => item.key === 'tax');
          const taxValue = taxItem ? parseToNumber(taxItem.value) : 0;
          await taxAPI.updateMonthlyTax(year, month, taxValue);
        } catch (e) {
          // ไม่ต้องแจ้ง error ให้ user
        }
        try {
          await incomeAPI.save(selectedMonth, { salary: netIncomeValue });
        } catch (e) {
          console.error('Failed to sync monthly income salary value:', e);
        }
        // เรียก callback เพื่อให้ parent component อัพเดต
        if (onSalaryUpdate) {
          onSalaryUpdate();
        }
        alert('บันทึกข้อมูลเงินเดือนเรียบร้อย');
      } else {
        alert('เกิดข้อผิดพลาด: ' + (result.error || 'ไม่สามารถบันทึกได้'));
      }
    } catch (error) {
      console.error('Error saving salary data:', error);
      alert('เกิดข้อผิดพลาดในการบันทึกข้อมูล');
    }
  };

  const clearAll = () => {
    setIncomeItems((prev) => prev.map((item) => ({ ...item, value: '' })));
    setDeductionItems((prev) => prev.map((item) => ({ ...item, value: '' })));
  };

  return (
    <div className={styles.salaryCalculator}>
      <h2 className={styles.title}>คำนวณเงินเดือน - {selectedMonth ? getThaiMonthName(selectedMonth) : 'กรุณาเลือกเดือน'}</h2>

      <div className={styles.salaryContent}>
        <div className={styles.incomeSection}>
          <div className={styles.sectionHeader}>
            <h3 className={`${styles.sectionTitle} ${styles.incomeTitle}`}>รายได้</h3>
            <button
              type="button"
              className={`${styles.addRowBtn} ${styles.addIncomeBtn}`}
              onClick={() => handleAddItem('income')}
            >
              + เพิ่มรายการ
            </button>
          </div>
          <div className={styles.dynamicList}>
            {incomeItems.map((item) => (
              <div key={item.id} className={`${styles.dynamicRow} ${styles.incomeRow}`}>
                <div className={styles.rowField}>
                  <span className={styles.fieldLabel}>ชื่อรายการ</span>
                  <input
                    type="text"
                    value={item.label}
                    onChange={(e) => handleLabelChange('income', item.id, e.target.value)}
                    placeholder="เช่น ค่า OT พิเศษ"
                    className={styles.labelInput}
                    aria-label="แก้ไขชื่อรายการรายได้"
                  />
                </div>
                <div className={styles.rowField}>
                  <span className={styles.fieldLabel}>จำนวนเงิน</span>
                  <input
                    type="text"
                    value={item.value}
                    onChange={(e) => handleValueChange('income', item.id, e.target.value)}
                    onBlur={(e) => handleValueBlur('income', item.id, e.target.value)}
                    placeholder="0.00"
                    className={`${styles.labelInput} ${styles.amountInput}`}
                    aria-label="จำนวนเงินรายได้"
                    inputMode="decimal"
                  />
                </div>
                <div className={styles.rowActions}>
                  <button
                    type="button"
                    className={styles.removeRowBtn}
                    onClick={() => handleRemoveItem('income', item.id)}
                    aria-label="ลบรายการรายได้นี้"
                  >
                    ลบ
                  </button>
                </div>
              </div>
            ))}
          </div>
          <div className={`${styles.subtotal} ${styles.incomeSubtotal}`}>
            <span>รวมรายได้: </span>
            <span className={styles.amount}>{formatCurrency(calculatedResults.รวมรายได้)}</span>
          </div>
        </div>

        <div className={styles.deductionSection}>
          <div className={styles.sectionHeader}>
            <h3 className={`${styles.sectionTitle} ${styles.deductionTitle}`}>
              ค่าใช้จ่ายหักออก
            </h3>
            <button
              type="button"
              className={`${styles.addRowBtn} ${styles.addDeductionBtn}`}
              onClick={() => handleAddItem('deduction')}
            >
              + เพิ่มรายการ
            </button>
          </div>
          <div className={styles.dynamicList}>
            {deductionItems.map((item) => (
              <div key={item.id} className={`${styles.dynamicRow} ${styles.deductionRow}`}>
                <div className={styles.rowField}>
                  <span className={styles.fieldLabel}>ชื่อรายการ</span>
                  <input
                    type="text"
                    value={item.label}
                    onChange={(e) => handleLabelChange('deduction', item.id, e.target.value)}
                    placeholder="เช่น เงินกู้กยศ"
                    className={styles.labelInput}
                    aria-label="แก้ไขชื่อรายการค่าใช้จ่ายหักออก"
                  />
                </div>
                <div className={styles.rowField}>
                  <span className={styles.fieldLabel}>จำนวนเงิน</span>
                  <input
                    type="text"
                    value={item.value}
                    onChange={(e) => handleValueChange('deduction', item.id, e.target.value)}
                    onBlur={(e) => handleValueBlur('deduction', item.id, e.target.value)}
                    placeholder="0.00"
                    className={`${styles.labelInput} ${styles.amountInput}`}
                    aria-label="จำนวนเงินรายการค่าใช้จ่ายหักออก"
                    inputMode="decimal"
                  />
                </div>
                <div className={styles.rowActions}>
                  <button
                    type="button"
                    className={styles.removeRowBtn}
                    onClick={() => handleRemoveItem('deduction', item.id)}
                    aria-label="ลบรายการค่าใช้จ่ายหักออกนี้"
                  >
                    ลบ
                  </button>
                </div>
              </div>
            ))}
          </div>
          <div className={`${styles.subtotal} ${styles.deductionSubtotal}`}>
            <span>รวมหัก: </span>
            <span className={styles.amount}>{formatCurrency(calculatedResults.รวมหัก)}</span>
          </div>
        </div>
      </div>

      {/* ผลลัพธ์สุทธิ */}
      <div className={styles.netResult}>
        <h3>
          เงินได้สุทธิ: <span className={styles.netAmount}>{formatCurrency(calculatedResults.เงินได้สุทธิ)}</span>
        </h3>
      </div>

      {/* ปุ่มจัดการ */}
      <div className={styles.actionButtons}>
        <button
          onClick={saveSalaryData}
          className={styles.saveBtn}
          aria-label="บันทึกเงินเดือน"
          tabIndex={0}
        >
          บันทึกเงินเดือน
        </button>
        <button
          onClick={clearAll}
          className={styles.clearBtn}
          aria-label="ล้างข้อมูล"
          tabIndex={0}
        >
          ล้างข้อมูล
        </button>
      </div>
    </div>
  );
};

export default SalaryCalculator;