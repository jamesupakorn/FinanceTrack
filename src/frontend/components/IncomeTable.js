import { useState, useEffect, useMemo } from 'react';
import {
  formatCurrency,
  parseAndFormat,
  parseToNumber,
  formatIncomeData,
  handleNumberInput,
  handleNumberBlur,
  DEFAULT_INCOME_ITEMS
} from '../../shared/utils/frontend/numberUtils';
import { formatIncomeForSave } from '../../shared/utils/incomeUtils';
import { incomeAPI, salaryAPI } from '../../shared/utils/frontend/apiUtils';
import { Icons } from './Icons';
import styles from '../styles/IncomeTable.module.css';

const CUSTOM_LABEL_FALLBACK = 'รายรับใหม่';

export default function IncomeTable({ selectedMonth, salaryUpdateTrigger }) {
  const [editIncome, setEditIncome] = useState({});
  const [incomeLabels, setIncomeLabels] = useState({});
  const [persistedKeys, setPersistedKeys] = useState([]);
  const [salaryNetIncome, setSalaryNetIncome] = useState(0);

  const defaultIncomeOrder = useMemo(() => DEFAULT_INCOME_ITEMS.map(item => item.key), []);
  const incomeKeyThaiMap = useMemo(() => {
    return DEFAULT_INCOME_ITEMS.reduce((acc, item) => {
      acc[item.key] = item.label;
      return acc;
    }, {});
  }, []);

  useEffect(() => {
    if (!selectedMonth) {
      setEditIncome({});
      setIncomeLabels({});
      setPersistedKeys([]);
      setSalaryNetIncome(0);
      return;
    }

    let cancelled = false;

    const loadIncome = async () => {
      try {
        const data = await incomeAPI.getByMonth(selectedMonth);
        if (cancelled) return;
        const formatted = formatIncomeData(data, selectedMonth);
        setEditIncome(formatted.values || {});
        setIncomeLabels(formatted.labels || {});
        setPersistedKeys(formatted.persistedKeys || Object.keys(formatted.values || {}));
      } catch (error) {
        console.error('Error loading income data:', error);
      }
    };

    const loadSalary = async () => {
      try {
        const salaryData = await salaryAPI.getByMonth(selectedMonth);
        if (cancelled) return;
        if (salaryData && salaryData.สรุป) {
          const salaryValue = salaryData.สรุป.เงินได้สุทธิ || 0;
          setSalaryNetIncome(salaryValue);
          setEditIncome(prev => ({
            ...prev,
            salary: parseAndFormat(salaryValue)
          }));
        }
      } catch (error) {
        console.error('Error loading salary data:', error);
      }
    };

    loadIncome();
    loadSalary();

    return () => {
      cancelled = true;
    };
  }, [selectedMonth, salaryUpdateTrigger]);

  const sortedIncomeKeys = useMemo(() => {
    const keys = Object.keys(editIncome || {});
    const defaults = defaultIncomeOrder.filter(key => keys.includes(key));
    const custom = keys.filter(key => !defaultIncomeOrder.includes(key));
    return [...defaults, ...custom];
  }, [editIncome, defaultIncomeOrder]);

  const hasIncomeRows = sortedIncomeKeys.length > 0;

  const getDisplayLabel = (key) => {
    const stored = incomeLabels[key];
    if (typeof stored === 'string' && stored.trim().length > 0) return stored.trim();
    if (incomeKeyThaiMap[key]) return incomeKeyThaiMap[key];
    return CUSTOM_LABEL_FALLBACK;
  };

  const getSalaryDisplayValue = () => {
    if (salaryNetIncome && !Number.isNaN(Number(salaryNetIncome))) {
      return Number(salaryNetIncome);
    }
    const stored = editIncome.salary;
    if (stored && !Number.isNaN(parseToNumber(stored))) {
      return parseToNumber(stored);
    }
    return 0;
  };

  const handleIncomeNameChange = (key, value) => {
    setIncomeLabels(prev => ({ ...prev, [key]: value }));
  };

  const handleIncomeNameBlur = (key, value) => {
    const cleaned = (value || '').trim();
    setIncomeLabels(prev => ({
      ...prev,
      [key]: cleaned.length ? cleaned : getDisplayLabel(key)
    }));
  };

  const handleAddIncomeItem = () => {
    const uniqueKey = `custom_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    setEditIncome(prev => ({
      ...prev,
      [uniqueKey]: parseAndFormat(0)
    }));
    setIncomeLabels(prev => ({
      ...prev,
      [uniqueKey]: CUSTOM_LABEL_FALLBACK
    }));
  };

  const handleDeleteIncomeItem = (key) => {
    if (key === 'salary') return;
    setEditIncome(prev => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    setIncomeLabels(prev => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const totalIncomeValue = useMemo(() => {
    return sortedIncomeKeys.reduce((sum, key) => sum + parseToNumber(editIncome[key] ?? 0), 0);
  }, [sortedIncomeKeys, editIncome]);

  const handleSave = async () => {
    if (!selectedMonth) return;
    try {
      const incomeToSave = { ...editIncome };
      const currentKeys = Object.keys(incomeToSave || {});
      const removedKeys = persistedKeys.filter(key => key !== 'salary' && !currentKeys.includes(key));
      const payload = formatIncomeForSave(incomeToSave, parseToNumber);

      if (removedKeys.length > 0) {
        payload.__removeKeys = removedKeys;
      }

      const labelPayload = {};
      Object.entries(incomeLabels || {}).forEach(([key, label]) => {
        const clean = (label || '').trim();
        if (!clean) return;
        const defaultLabel = incomeKeyThaiMap[key] || CUSTOM_LABEL_FALLBACK;
        if (key.startsWith('custom_') || clean !== defaultLabel) {
          labelPayload[key] = clean;
        }
      });
      if (Object.keys(labelPayload).length > 0) {
        payload.__labels = labelPayload;
      }

      await incomeAPI.save(selectedMonth, payload);
      const refreshed = await incomeAPI.getByMonth(selectedMonth);
      const formatted = formatIncomeData(refreshed, selectedMonth);
      setEditIncome(formatted.values || {});
      setIncomeLabels(formatted.labels || {});
      setPersistedKeys(formatted.persistedKeys || Object.keys(formatted.values || {}));
    } catch (error) {
      console.error('Error saving income data:', error);
    }
  };

  return (
    <div className={styles.incomeContainer}>
      {hasIncomeRows ? (
        <>
          <div className={styles.sectionHeader}>
            <div>
              <h3 className={styles.sectionTitle}>ปรับรายการรายรับได้เอง</h3>
              <p className={styles.sectionSubtitle}>เพิ่ม ลบ หรือแก้ไขชื่อรายการรายรับให้ตรงกับชีวิตจริงได้เลย</p>
            </div>
            <button type="button" className={styles.addItemButton} onClick={handleAddIncomeItem}>
              + เพิ่มรายการรายรับ
            </button>
          </div>

          <table className={styles.incomeTable + ' ' + styles.hideOnMobile}>
            <thead>
              <tr className={styles.tableHeader}>
                <th className={styles.headerCell}>รายการ</th>
                <th className={`${styles.headerCell} ${styles.headerCellRight}`}>จำนวนเงิน (บาท)</th>
              </tr>
            </thead>
            <tbody>
              {sortedIncomeKeys.map((itemKey) => {
                const label = getDisplayLabel(itemKey);
                const isSalary = itemKey === 'salary';
                return (
                  <tr key={itemKey} className={styles.tableRow}>
                    <td className={styles.tableCell}>
                      {isSalary ? (
                        <div className={styles.salaryLabel}>
                          <span>{label}</span>
                          <span className={styles.salaryBadge}>จากระบบเงินเดือน</span>
                        </div>
                      ) : (
                        <div className={styles.nameCell}>
                          <input
                            type="text"
                            className={styles.nameInput}
                            value={label}
                            onChange={(e) => handleIncomeNameChange(itemKey, e.target.value)}
                            onBlur={(e) => handleIncomeNameBlur(itemKey, e.target.value)}
                            placeholder="ชื่อรายการ"
                          />
                          <button
                            type="button"
                            className={styles.rowDeleteButton}
                            onClick={() => handleDeleteIncomeItem(itemKey)}
                          >
                            ลบ
                          </button>
                        </div>
                      )}
                    </td>
                    <td className={styles.inputCell}>
                      {isSalary ? (
                        <div className={styles.salaryCell}>
                          {formatCurrency(getSalaryDisplayValue())}
                          <small className={styles.salarySource}>
                            (จากระบบเงินเดือน)
                          </small>
                        </div>
                      ) : (
                        <input
                          type="text"
                          value={editIncome[itemKey] ?? ''}
                          onChange={e => handleNumberInput(e.target.value, setEditIncome, itemKey)}
                          onBlur={e => handleNumberBlur(e.target.value, setEditIncome, itemKey)}
                          className={styles.incomeInput}
                        />
                      )}
                    </td>
                  </tr>
                );
              })}
              <tr className={styles.totalRow}>
                <td className={styles.totalCell}>รวม</td>
                <td className={`${styles.totalCell} ${styles.totalValue}`}>
                  {formatCurrency(totalIncomeValue)}
                </td>
              </tr>
            </tbody>
          </table>

          <div className={styles.mobileCardList + ' ' + styles.hideOnDesktop}>
            {sortedIncomeKeys.map(itemKey => {
              const label = getDisplayLabel(itemKey);
              const isSalary = itemKey === 'salary';
              return (
                <div className={styles.incomeCard} key={itemKey}>
                  <div className={styles.cardRow}>
                    <span className={styles.cardLabel}>รายการ</span>
                    {isSalary ? (
                      <div className={styles.salaryLabel}>
                        <span>{label}</span>
                        <span className={styles.salaryBadge}>จากระบบเงินเดือน</span>
                      </div>
                    ) : (
                      <input
                        type="text"
                        className={styles.nameInput}
                        value={label}
                        onChange={(e) => handleIncomeNameChange(itemKey, e.target.value)}
                        onBlur={(e) => handleIncomeNameBlur(itemKey, e.target.value)}
                      />
                    )}
                  </div>
                  <div className={styles.cardRow}>
                    <span className={styles.cardLabel}>จำนวนเงิน</span>
                    {isSalary ? (
                      <div className={styles.salaryCell}>
                        {formatCurrency(getSalaryDisplayValue())}
                        <small className={styles.salarySource}>
                          (จากระบบเงินเดือน)
                        </small>
                      </div>
                    ) : (
                      <input
                        type="text"
                        value={editIncome[itemKey] ?? ''}
                        onChange={e => handleNumberInput(e.target.value, setEditIncome, itemKey)}
                        onBlur={e => handleNumberBlur(e.target.value, setEditIncome, itemKey)}
                        className={styles.incomeInput}
                      />
                    )}
                  </div>
                  {!isSalary && (
                    <div className={`${styles.cardRow} ${styles.cardActions}`}>
                      <button
                        type="button"
                        className={styles.rowDeleteButton}
                        onClick={() => handleDeleteIncomeItem(itemKey)}
                      >
                        ลบรายการนี้
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
            <div className={styles.incomeCard + ' ' + styles.totalCard}>
              <div className={styles.cardRow}>
                <span className={styles.cardLabel}>รวม</span>
                <span className={styles.totalValue}>{formatCurrency(totalIncomeValue)}</span>
              </div>
            </div>
          </div>

          <div className={styles.saveButtonContainer}>
            <button onClick={handleSave} className={styles.saveButton}>
              <Icons.Save size={16} color="white" className={styles.saveButtonIcon} />
              บันทึกรายรับ
            </button>
          </div>
        </>
      ) : (
        <div className={styles.emptyState}>ยังไม่มีข้อมูลรายรับสำหรับเดือนนี้</div>
      )}
    </div>
  );
}