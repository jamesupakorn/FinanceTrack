import { useState, useEffect, useMemo } from 'react';
import {
  formatCurrency,
  parseToNumber,
  formatExpenseData,
  getAccountSummary,
  handleNumberInput,
  handleNumberBlur,
  DEFAULT_EXPENSE_ITEMS
} from '../../shared/utils/frontend/numberUtils';
import { formatExpenseForSave, calculateExpenseTotal } from '../../shared/utils/expenseUtils';
import BankAccountTable from './BankAccountTable';
import { expenseAPI } from '../../shared/utils/frontend/apiUtils';
import { useSession } from '../contexts/SessionContext';
import styles from '../styles/ExpenseTable.module.css';

const DEFAULT_EXPENSE_KEY_ORDER = DEFAULT_EXPENSE_ITEMS.map(item => item.key);
const DEFAULT_EXPENSE_LABEL_MAP = DEFAULT_EXPENSE_ITEMS.reduce((acc, item) => {
  acc[item.key] = item.label;
  return acc;
}, {});

const describeExpenseDifference = (estimateValue = 0, actualValue = 0) => {
  const diffValue = estimateValue - actualValue;
  if (Math.abs(diffValue) < 0.01) {
    return {
      value: 0,
      tone: 'neutral',
      text: 'จ่ายตรงตามที่ตั้งไว้'
    };
  }
  if (diffValue > 0) {
    return {
      value: diffValue,
      tone: 'positive',
      text: 'ตั้งงบสูงกว่ายอดใช้จริง'
    };
  }
  return {
    value: diffValue,
    tone: 'negative',
    text: 'ใช้จริงสูงกว่างบที่ตั้งไว้'
  };
};

export default function ExpenseTable({ selectedMonth }) {
  const [editExpense, setEditExpense] = useState({});
  const [isLoading, setIsLoading] = useState(false);
  const [persistedKeys, setPersistedKeys] = useState([]);
  const { currentUser } = useSession();
  const shouldShowAccountTable = currentUser?.id === 'u001';

  useEffect(() => {
    if (!selectedMonth) {
      setEditExpense({});
      setPersistedKeys([]);
      return;
    }
    setIsLoading(true);
    expenseAPI.getByMonth(selectedMonth)
      .then(data => {
        const formatted = formatExpenseData(data || {}, selectedMonth);
        setEditExpense(formatted.values || {});
        setPersistedKeys(formatted.persistedKeys || []);
      })
      .catch(error => {
        console.error('Error loading expense data:', error);
        const formatted = formatExpenseData({}, selectedMonth);
        setEditExpense(formatted.values || {});
        setPersistedKeys(formatted.persistedKeys || []);
      })
      .finally(() => setIsLoading(false));
  }, [selectedMonth]);

  const updateExpenseField = (item, field, value) => {
    setEditExpense(prev => {
      const current = prev[item] || {
        name: DEFAULT_EXPENSE_LABEL_MAP[item] || 'รายการใหม่',
        estimate: '0.00',
        actual: '0.00',
        paid: false
      };
      return {
        ...prev,
        [item]: { ...current, [field]: value }
      };
    });
  };

  const handleExpenseChange = (item, field, value) => {
    if (field === 'paid' || field === 'name') {
      updateExpenseField(item, field, value);
      return;
    }
    handleNumberInput(value, (val) => updateExpenseField(item, field, val));
  };

  const handleExpenseBlur = (item, field, value) => {
    if (field === 'paid') {
      updateExpenseField(item, field, value);
      return;
    }
    if (field === 'name') {
      const cleanName = (typeof value === 'string' && value.trim().length > 0)
        ? value.trim()
        : (DEFAULT_EXPENSE_LABEL_MAP[item] || 'รายการใหม่');
      updateExpenseField(item, field, cleanName);
      return;
    }
    updateExpenseField(item, field, value);
  };

  const handleAddExpenseItem = () => {
    const uniqueKey = `custom_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    setEditExpense(prev => ({
      ...prev,
      [uniqueKey]: {
        name: 'รายการใหม่',
        estimate: '0.00',
        actual: '0.00',
        paid: false
      }
    }));
  };

  const handleDeleteExpenseItem = (item) => {
    setEditExpense(prev => {
      const updated = { ...prev };
      delete updated[item];
      return updated;
    });
  };

  const handleSave = async () => {
    if (!selectedMonth) return;
    try {
      const prepared = formatExpenseForSave(editExpense, parseToNumber);
      const currentKeys = Object.keys(editExpense || {});
      const removedKeys = persistedKeys.filter(key => !currentKeys.includes(key));
      if (removedKeys.length > 0) {
        prepared.__removeKeys = removedKeys;
      }
      await expenseAPI.save(selectedMonth, prepared);
      // รีเฟรชข้อมูลหลังบันทึก
      const data = await expenseAPI.getByMonth(selectedMonth);
      const formatted = formatExpenseData(data || {}, selectedMonth);
      setEditExpense(formatted.values || {});
      setPersistedKeys(formatted.persistedKeys || []);
    } catch (error) {
      console.error('Error saving expense data:', error);
    }
  };
  const sortedExpenseKeys = useMemo(() => {
    const keys = Object.keys(editExpense || {});
    const defaultKeys = DEFAULT_EXPENSE_KEY_ORDER.filter(key => keys.includes(key));
    const customKeys = keys.filter(key => !DEFAULT_EXPENSE_KEY_ORDER.includes(key));
    return [...defaultKeys, ...customKeys];
  }, [editExpense]);

  const hasExpenseRows = sortedExpenseKeys.length > 0;
  const totalEstimateValue = useMemo(() => calculateExpenseTotal(editExpense, 'estimate', parseToNumber), [editExpense]);
  const totalActualValue = useMemo(() => calculateExpenseTotal(editExpense, 'actual', parseToNumber), [editExpense]);
  const totalDiffInfo = useMemo(() => describeExpenseDifference(totalEstimateValue, totalActualValue), [totalEstimateValue, totalActualValue]);
  const accountSummary = useMemo(() => getAccountSummary(editExpense), [editExpense]);

  return (
    <div className={styles.expenseTable}>
      <div className={styles.sectionHeader}>
        <div>
          <h3 className={styles.sectionTitle}>รายการค่าใช้จ่าย</h3>
          <p className={styles.sectionSubtitle}>เปรียบเทียบยอดตั้งงบ (ประมาณ) กับยอดจ่ายจริง เพื่อดูว่าประมาณการคลาดเคลื่อนตรงไหน</p>
        </div>
        <button type="button" className={styles.addItemButton} onClick={handleAddExpenseItem}>
          + เพิ่มรายการค่าใช้จ่าย
        </button>
      </div>
      {isLoading && !hasExpenseRows && (
        <div className={styles.loadingState}>กำลังโหลดข้อมูล...</div>
      )}
      {hasExpenseRows && (
        <>
          {/* Desktop Table */}
          <div className={styles.hideOnMobile}>
            <p className={styles.diffExplain}>ส่วนต่าง = ยอดประมาณ - ยอดจ่ายจริง (บวก = จ่ายน้อยกว่าที่ตั้งงบ, ลบ = จ่ายมากกว่าที่ตั้งงบ)</p>
            <div className={styles.tableContainer}>
              <table className={styles.table}>
              <thead className={styles.tableHeader}>
                <tr>
                  <th className={styles.tableHeaderCell}>รายการค่าใช้จ่าย</th>
                  <th className={`${styles.tableHeaderCell} ${styles.right}`}>ยอดประมาณ (ตั้งงบ)</th>
                  <th className={`${styles.tableHeaderCell} ${styles.right}`}>ยอดจ่ายจริง</th>
                  <th className={`${styles.tableHeaderCell} ${styles.center}`}>สถานะชำระ</th>
                  <th className={`${styles.tableHeaderCell} ${styles.right}`}>ส่วนต่าง (ประมาณ-จริง)</th>
                </tr>
              </thead>
              <tbody>
                {sortedExpenseKeys.map((item) => {
                  const row = editExpense[item] || {};
                  const estimate = parseToNumber(row.estimate);
                  const actual = parseToNumber(row.actual);
                  const paid = row.paid === true || row.paid === 'true';
                  const diffInfo = describeExpenseDifference(estimate, actual);
                  const diffClass = diffInfo.tone === 'positive'
                    ? styles.diffPositive
                    : diffInfo.tone === 'negative'
                      ? styles.diffNegative
                      : styles.diffNeutral;
                  const displayName = row.name || DEFAULT_EXPENSE_LABEL_MAP[item] || 'รายการใหม่';
                  return (
                    <tr key={item} className={styles.tableRow}>
                      <td className={styles.tableCell}>
                        <div className={styles.nameCell}>
                          <input
                            type="text"
                            value={displayName}
                            onChange={e => handleExpenseChange(item, 'name', e.target.value)}
                            onBlur={e => handleExpenseBlur(item, 'name', e.target.value)}
                            className={styles.nameInput}
                            placeholder="ชื่อรายการ"
                          />
                          <button
                            type="button"
                            className={styles.rowDeleteButton}
                            onClick={() => handleDeleteExpenseItem(item)}
                          >
                            ลบ
                          </button>
                        </div>
                      </td>
                      <td className={`${styles.tableCell} ${styles.right}`}>
                        <input
                          type="text"
                          value={row.estimate ?? ''}
                          onChange={e => handleNumberInput(e.target.value, (val) => handleExpenseChange(item, 'estimate', val))}
                          onBlur={e => handleNumberBlur(e.target.value, (val) => handleExpenseBlur(item, 'estimate', val))}
                          className={styles.expenseInput}
                        />
                      </td>
                      <td className={`${styles.tableCell} ${styles.right}`}>
                        <input
                          type="text"
                          value={row.actual ?? ''}
                          onChange={e => handleNumberInput(e.target.value, (val) => handleExpenseChange(item, 'actual', val))}
                          onBlur={e => handleNumberBlur(e.target.value, (val) => handleExpenseBlur(item, 'actual', val))}
                          className={styles.expenseInput}
                        />
                      </td>
                      <td className={`${styles.tableCell} ${styles.center} ${styles.checkboxCell}`}>
                        <input
                          type="checkbox"
                          checked={paid}
                          onChange={e => handleExpenseChange(item, 'paid', e.target.checked)}
                        />
                      </td>
                      <td className={`${styles.tableCell} ${styles.right}`}>
                        <div className={`${styles.diffValue} ${diffClass}`}>{formatCurrency(diffInfo.value)}</div>
                        <div className={styles.diffLabel}>{diffInfo.text}</div>
                      </td>
                    </tr>
                  );
                })}
                <tr className={styles.totalRow}>
                  <td className={styles.totalCell}>ยอดรวม</td>
                  <td className={`${styles.totalCell} ${styles.right}`}>{formatCurrency(totalEstimateValue)}</td>
                  <td className={`${styles.totalCell} ${styles.right}`}>{formatCurrency(totalActualValue)}</td>
                  <td className={`${styles.totalCell} ${styles.center}`}></td>
                  <td className={`${styles.totalCell} ${styles.right} ${totalDiffInfo.tone === 'positive' ? styles.totalDiffPositive : totalDiffInfo.tone === 'negative' ? styles.totalDiffNegative : styles.totalDiffNeutral}`}>
                    <div className={styles.diffValue}>{formatCurrency(totalDiffInfo.value)}</div>
                    <div className={styles.diffLabel}>{totalDiffInfo.text}</div>
                  </td>
                </tr>
              </tbody>
              </table>
            </div>
          </div>

          {/* Mobile Card List */}
          <div className={styles.mobileCardList + ' ' + styles.hideOnDesktop}>
            {sortedExpenseKeys.map(item => {
              const row = editExpense[item] || {};
              const estimate = parseToNumber(row.estimate);
              const actual = parseToNumber(row.actual);
              const paid = row.paid === true || row.paid === 'true';
              const diffInfo = describeExpenseDifference(estimate, actual);
              const diffClass = diffInfo.tone === 'positive'
                ? styles.diffPositive
                : diffInfo.tone === 'negative'
                  ? styles.diffNegative
                  : styles.diffNeutral;
              const displayName = row.name || DEFAULT_EXPENSE_LABEL_MAP[item] || 'รายการใหม่';
              return (
                <div className={styles.expenseCard} key={item}>
                  <div className={styles.cardRow}>
                    <span className={styles.cardLabel}>รายการ</span>
                    <input
                      type="text"
                      value={displayName}
                      onChange={e => handleExpenseChange(item, 'name', e.target.value)}
                      onBlur={e => handleExpenseBlur(item, 'name', e.target.value)}
                      className={styles.nameInput}
                      placeholder="ชื่อรายการ"
                    />
                  </div>
                  <div className={styles.cardRow}>
                    <span className={styles.cardLabel}>ยอดประมาณการ</span>
                    <input
                      type="text"
                      value={row.estimate ?? ''}
                      onChange={e => handleNumberInput(e.target.value, (val) => handleExpenseChange(item, 'estimate', val))}
                      onBlur={e => handleNumberBlur(e.target.value, (val) => handleExpenseBlur(item, 'estimate', val))}
                      className={styles.expenseInput}
                    />
                  </div>
                  <div className={styles.cardRow}>
                    <span className={styles.cardLabel}>ยอดที่จ่ายจริง</span>
                    <input
                      type="text"
                      value={row.actual ?? ''}
                      onChange={e => handleNumberInput(e.target.value, (val) => handleExpenseChange(item, 'actual', val))}
                      onBlur={e => handleNumberBlur(e.target.value, (val) => handleExpenseBlur(item, 'actual', val))}
                      className={styles.expenseInput}
                    />
                  </div>
                  <div className={styles.cardRow}>
                    <span className={styles.cardLabel}>สถานะชำระ</span>
                    <input
                      type="checkbox"
                      checked={paid}
                      onChange={e => handleExpenseChange(item, 'paid', e.target.checked)}
                    />
                  </div>
                  <div className={styles.cardRow}>
                    <span className={styles.cardLabel}>ส่วนต่าง</span>
                    <span className={`${styles.diffValue} ${diffClass}`}>
                      {formatCurrency(diffInfo.value)}
                    </span>
                  </div>
                  <div className={styles.cardRow}>
                    <span className={styles.cardLabel}></span>
                    <span className={styles.diffLabel}>{diffInfo.text}</span>
                  </div>
                  <div className={`${styles.cardRow} ${styles.cardActions}`}>
                    <button
                      type="button"
                      className={styles.rowDeleteButton}
                      onClick={() => handleDeleteExpenseItem(item)}
                    >
                      ลบรายการนี้
                    </button>
                  </div>
                </div>
              );
            })}
            {/* Total summary card */}
            <div className={styles.expenseCard + ' ' + styles.totalCard}>
              <div className={styles.cardRow}><span className={styles.cardLabel}>ยอดรวม</span></div>
              <div className={styles.cardRow}><span className={styles.cardLabel}>ยอดประมาณ</span><span>{formatCurrency(totalEstimateValue)}</span></div>
              <div className={styles.cardRow}><span className={styles.cardLabel}>ยอดจ่ายจริง</span><span>{formatCurrency(totalActualValue)}</span></div>
              <div className={styles.cardRow}>
                <span className={styles.cardLabel}>ส่วนต่าง</span>
                <span className={`${styles.diffValue} ${totalDiffInfo.tone === 'positive' ? styles.totalDiffPositive : totalDiffInfo.tone === 'negative' ? styles.totalDiffNegative : styles.totalDiffNeutral}`}>
                  {formatCurrency(totalDiffInfo.value)}
                </span>
              </div>
              <div className={styles.cardRow}>
                <span className={styles.cardLabel}></span>
                <span className={styles.diffLabel}>{totalDiffInfo.text}</span>
              </div>
            </div>
          </div>
          {/* ตารางสรุปค่าใช้จ่ายแต่ละบัญชี (อัพเดตเฉพาะ u001) */}
          {shouldShowAccountTable && (
            <BankAccountTable accountSummary={accountSummary} />
          )}
          <div className={styles.saveButtonContainer}>
            <button
              onClick={handleSave}
              className={styles.saveButton}
            >
              บันทึกข้อมูลรายจ่าย
            </button>
          </div>
        </>
      )}
      {!isLoading && !hasExpenseRows && (
        <div className={styles.emptyState}>ยังไม่มีรายการค่าใช้จ่ายในเดือนนี้ กด "เพิ่มรายการ" เพื่อเริ่มต้น</div>
      )}
    </div>
  );
}