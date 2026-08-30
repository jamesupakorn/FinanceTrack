/**
 * คอมโพเนนต์: SavingsTable
 * จัดการรายการเงินออมรายเดือน และแสดงตารางรายการเงินออม
 * @param {object} props
 * @param {string} props.selectedMonth - เดือนที่เลือก (YYYY-MM)
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { formatCurrency, parseAndFormat, parseToNumber } from '../../shared/utils/frontend/numberUtils';
import { mapSavingsApiToList } from '../../shared/utils/savingsUtils';
import { savingsAPI, savingsGoalsAPI } from '../../shared/utils/frontend/apiUtils';
import { showToast } from '../../shared/utils/frontend/toast';
import { Icons } from './Icons';
import styles from '../styles/SavingsTable.module.css';

/**
 * ตารางเงินออมรายเดือน
 */
export default function SavingsTable({ selectedMonth, triggerSave }) {
  const lastSaveTriggerRef = useRef(triggerSave);

  const [savingsData, setSavingsData] = useState(null);
  const [รายการเงินออม, setรายการเงินออม] = useState([]);
  const [pendingScrollIndex, setPendingScrollIndex] = useState(null);
  const [goalOptions, setGoalOptions] = useState([]);

  const loadGoalOptions = useCallback(async () => {
    try {
      const data = await savingsGoalsAPI.getAll();
      const names = Array.isArray(data?.goals)
        ? data.goals
          .map((goal) => (goal?.goalName || '').trim())
          .filter(Boolean)
        : [];
      setGoalOptions(Array.from(new Set(names)));
    } catch (error) {
      console.error('Error loading savings goals for dropdown:', error);
      setGoalOptions([]);
    }
  }, []);

  const loadSavingsData = useCallback(async (month) => {
    if (!month) return;
    try {
      const data = await savingsAPI.getByMonth(month);
      setSavingsData(data);
      const formattedList = mapSavingsApiToList(data).map(item => {
        const amountValue = item?.savings_amount ?? item?.จำนวนเงิน ?? 0;
        const formattedAmount = parseAndFormat(amountValue);
        const nameValue = item?.savings_type ?? item?.รายการ ?? '';
        return {
          ...item,
          savings_type: nameValue,
          รายการ: nameValue,
          savings_amount: formattedAmount,
          จำนวนเงิน: formattedAmount
        };
      });
      setรายการเงินออม(formattedList);
    } catch (error) {
      console.error('Error loading savings data:', error);
    }
  }, []);

  useEffect(() => {
    if (selectedMonth) {
      loadSavingsData(selectedMonth);
    } else {
      setSavingsData(null);
      setรายการเงินออม([]);
    }
  }, [selectedMonth, loadSavingsData]);

  useEffect(() => {
    loadGoalOptions();
  }, [loadGoalOptions, selectedMonth, triggerSave]);

  useEffect(() => {
    if (pendingScrollIndex === null) return;
    const tryScroll = () => {
      if (typeof document === 'undefined') return false;
      const targets = Array.from(document.querySelectorAll(`[data-savings-index="${pendingScrollIndex}"]`));
      const target = targets.find((node) => node.offsetParent !== null) || targets[0];
      if (!target) return false;
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      const firstInput = target.querySelector('input[type="text"]');
      if (firstInput && typeof firstInput.focus === 'function') {
        firstInput.focus({ preventScroll: true });
      }
      return true;
    };

    let timer = null;
    const done = tryScroll();
    if (!done) {
      timer = setTimeout(() => {
        if (tryScroll()) {
          setPendingScrollIndex(null);
        }
      }, 80);
      return () => clearTimeout(timer);
    }
    setPendingScrollIndex(null);
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [pendingScrollIndex, รายการเงินออม]);

  const handleAddSavingsItem = () => {
    const defaultAmount = parseAndFormat(0);
    let nextIndex = 0;
    setรายการเงินออม(prev => {
      nextIndex = prev.length;
      return [
        ...prev,
        {
          savings_type: '',
          รายการ: '',
          savings_amount: defaultAmount,
          จำนวนเงิน: defaultAmount
        }
      ];
    });
    setPendingScrollIndex(nextIndex);
  };

  // ใช้ shared numberUtils สำหรับ input logic
  const handleSavingsItemChange = (index, field, value) => {
    const newList = [...รายการเงินออม];
    newList[index][field] = value;
    if (field === 'savings_type' || field === 'รายการ') {
      newList[index].savings_type = value;
      newList[index].รายการ = value;
    }
    setรายการเงินออม(newList);
  };

  const handleSavingsAmountInput = (value, index) => {
    const newList = [...รายการเงินออม];
    newList[index].savings_amount = value;
    newList[index].จำนวนเงิน = value;
    setรายการเงินออม(newList);
  };

  const handleSavingsAmountBlur = (value, index) => {
    const newList = [...รายการเงินออม];
    const formatted = parseAndFormat(value);
    newList[index].savings_amount = formatted;
    newList[index].จำนวนเงิน = formatted;
    setรายการเงินออม(newList);
  };

  const handleAmountInputFocus = (event) => {
    event.target.select();
  };

  const handleDeleteSavingsItem = (index) => {
    const newList = รายการเงินออม.filter((_, i) => i !== index);
    setรายการเงินออม(newList);
  };

  const handleSavingsSave = async () => {
    if (!selectedMonth) return;
    try {
      // แปลงเป็น number ก่อนบันทึก
      const numericSavings = รายการเงินออม.map(item => {
        const amountSource = item?.savings_amount ?? item?.จำนวนเงิน ?? 0;
        const nameValue = item?.savings_type ?? item?.รายการ ?? '';
        const numericAmount = parseToNumber(amountSource);
        return {
          ...item,
          savings_type: nameValue,
          รายการ: nameValue,
          savings_amount: numericAmount,
          จำนวนเงิน: numericAmount
        };
      });
      await savingsAPI.saveList(selectedMonth, numericSavings);
      await loadSavingsData(selectedMonth);
      showToast('บันทึกรายการเงินออมสำเร็จ');
    } catch (error) {
      console.error('Error saving savings list:', error);
      showToast('บันทึกไม่สำเร็จ กรุณาลองใหม่', 'error');
    }
  };

  useEffect(() => {
    if (triggerSave === lastSaveTriggerRef.current) return;
    lastSaveTriggerRef.current = triggerSave;
    if (triggerSave) handleSavingsSave();
  }, [triggerSave]);

  // ยอดรวมเงินเก็บคำนวณจากสถานะปัจจุบัน เพื่อสะท้อนผลการแก้ไขทันที
  const displayedTotalSavings = useMemo(() => {
    if (!Array.isArray(รายการเงินออม)) return 0;
    return รายการเงินออม.reduce((sum, item) => {
      const amount = item?.savings_amount ?? item?.จำนวนเงิน ?? 0;
      return sum + parseToNumber(amount);
    }, 0);
  }, [รายการเงินออม]);

  const hasEditableRows = Array.isArray(รายการเงินออม) && รายการเงินออม.length > 0;
  const รวมเงินเก็บ = hasEditableRows
    ? displayedTotalSavings
    : (typeof savingsData?.รวมเงินเก็บ === 'number' ? savingsData.รวมเงินเก็บ : 0);
  const isLoading = !savingsData;
  const savingsKeyThaiMapping = {
    savings_type: 'รายการออม',
    savings_amount: 'จำนวนเงินออม'
  };

  const getRowGoalOptions = (currentValue) => {
    const value = (currentValue || '').trim();
    if (!value || goalOptions.includes(value)) return goalOptions;
    return [...goalOptions, value];
  };

  return (
    <div className={styles.savingsTable}>
      {isLoading && (
        <div className={styles.loadingState} role="status" aria-live="polite">กำลังโหลด...</div>
      )}
      {/* รายการเงินออม */}
      <div>
        <div className={styles.sectionTitle}>
          <h3 className={styles.titleText}>
            <Icons.Edit size={20} color="var(--text-primary)" />
            รายการเงินออม
          </h3>
          <button 
            onClick={handleAddSavingsItem}
            className={styles.addButton}
          >
            <Icons.Plus size={16} color="white" />
            เพิ่มรายการ
          </button>
        </div>

        {/* Desktop Table */}
        <div className={styles.tableContainer + ' ' + styles.hideOnMobile}>
          <table className={styles.table}>
            <thead className={styles.tableHeader}>
              <tr>
                <th className={styles.tableHeaderCell}>{savingsKeyThaiMapping['savings_type']}</th>
                <th className={styles.tableHeaderCell}>{savingsKeyThaiMapping['savings_amount']}</th>
                <th className={styles.tableHeaderCell}>การจัดการ</th>
              </tr>
            </thead>
            <tbody>
              {รายการเงินออม.map((item, index) => (
                <tr key={index} className={styles.tableRow} data-savings-index={index}>
                  <td className={styles.tableCell}>
                    <select
                      value={item.savings_type || ''}
                      onChange={(e) => handleSavingsItemChange(index, 'savings_type', e.target.value)}
                      className={styles.savingsInput}
                    >
                      <option value="">ไม่ระบุ</option>
                      {getRowGoalOptions(item.savings_type).map((goalName) => (
                        <option key={goalName} value={goalName}>{goalName}</option>
                      ))}
                    </select>
                  </td>
                  <td className={styles.tableCell}>
                    <input
                      type="text"
                      value={item.savings_amount || ''}
                      onChange={e => handleSavingsAmountInput(e.target.value, index)}
                      onBlur={e => handleSavingsAmountBlur(e.target.value, index)}
                      onFocus={handleAmountInputFocus}
                      placeholder={savingsKeyThaiMapping['savings_amount']}
                      className={styles.savingsInput}
                    />
                  </td>
                  <td className={`${styles.tableCell} ${styles.center}`}>
                    <button 
                      onClick={() => handleDeleteSavingsItem(index)}
                      className={styles.deleteButton}
                    >
                      <Icons.Trash size={14} color="white" />
                      ลบ
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Mobile Card List */}
        <div className={styles.mobileCardList + ' ' + styles.hideOnDesktop}>
          {รายการเงินออม.length === 0 && (
            <div className={styles.emptyCard}>ไม่มีรายการเงินออม</div>
          )}
          {รายการเงินออม.map((item, index) => (
            <div className={styles.savingsCard} key={index} data-savings-index={index}>
              <div className={styles.cardRow}>
                <label className={styles.cardLabel}>{savingsKeyThaiMapping['savings_type']}</label>
                <select
                  value={item.savings_type || ''}
                  onChange={e => handleSavingsItemChange(index, 'savings_type', e.target.value)}
                  className={styles.savingsInput}
                >
                  <option value="">ไม่ระบุ</option>
                  {getRowGoalOptions(item.savings_type).map((goalName) => (
                    <option key={goalName} value={goalName}>{goalName}</option>
                  ))}
                </select>
              </div>
              <div className={styles.cardRow}>
                <label className={styles.cardLabel}>{savingsKeyThaiMapping['savings_amount']}</label>
                <input
                  type="text"
                  value={item.savings_amount || ''}
                  onChange={e => handleSavingsAmountInput(e.target.value, index)}
                  onBlur={e => handleSavingsAmountBlur(e.target.value, index)}
                  onFocus={handleAmountInputFocus}
                  placeholder={savingsKeyThaiMapping['savings_amount']}
                  className={styles.savingsInput}
                />
              </div>
              <div className={styles.cardRow}>
                <button 
                  onClick={() => handleDeleteSavingsItem(index)}
                  className={styles.deleteButton}
                >
                  <Icons.Trash size={14} color="white" />
                  ลบ
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* สรุป */}
      <div className={styles.summarySection}>
        <h4 className={styles.summaryTitle}>
          <Icons.DollarSign size={20} color="var(--secondary-color)" />
          สรุปเงินออม
        </h4>
        <div className={styles.summaryContent}>
          <div className={styles.summaryItem}>
            <span className={styles.summaryLabel}>รวมเงินออมเดือนนี้:</span>
            <span className={styles.summaryValue}>{formatCurrency(รวมเงินเก็บ)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
