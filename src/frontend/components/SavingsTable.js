import { useState, useEffect, useCallback, useMemo } from 'react';
import { formatCurrency, parseAndFormat, parseToNumber } from '../../shared/utils/frontend/numberUtils';
import { mapSavingsApiToList } from '../../shared/utils/savingsUtils';
import { savingsAPI } from '../../shared/utils/frontend/apiUtils';
import { Icons } from './Icons';
import InvestmentTable from './InvestmentTable';
import styles from '../styles/SavingsTable.module.css';

export default function SavingsTable({ selectedMonth }) {

  const [savingsData, setSavingsData] = useState(null);
  const [รายการเงินออม, setรายการเงินออม] = useState([]);

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

  const handleAddSavingsItem = () => {
    const defaultAmount = parseAndFormat(0);
    setรายการเงินออม(prev => ([
      ...prev,
      {
        savings_type: '',
        รายการ: '',
        savings_amount: defaultAmount,
        จำนวนเงิน: defaultAmount
      }
    ]));
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
      alert('บันทึกรายการเงินออมสำเร็จ!');
    } catch (error) {
      console.error('Error saving savings list:', error);
    }
  };

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

  return (
    <div className={styles.savingsTable}>
      {isLoading && (
        <div className={styles.loadingState}>กำลังโหลด...</div>
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
                <tr key={index} className={styles.tableRow}>
                  <td className={styles.tableCell}>
                    <input
                      type="text"
                      value={item.savings_type || ''}
                      onChange={(e) => handleSavingsItemChange(index, 'savings_type', e.target.value)}
                      placeholder={savingsKeyThaiMapping['savings_type']}
                      className={styles.savingsInput}
                    />
                  </td>
                  <td className={styles.tableCell}>
                    <input
                      type="text"
                      value={item.savings_amount || ''}
                      onChange={e => handleSavingsAmountInput(e.target.value, index)}
                      onBlur={e => handleSavingsAmountBlur(e.target.value, index)}
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
            <div className={styles.savingsCard} key={index}>
              <div className={styles.cardRow}>
                <label className={styles.cardLabel}>{savingsKeyThaiMapping['savings_type']}</label>
                <input
                  type="text"
                  value={item.savings_type || ''}
                  onChange={e => handleSavingsItemChange(index, 'savings_type', e.target.value)}
                  placeholder={savingsKeyThaiMapping['savings_type']}
                  className={styles.savingsInput}
                />
              </div>
              <div className={styles.cardRow}>
                <label className={styles.cardLabel}>{savingsKeyThaiMapping['savings_amount']}</label>
                <input
                  type="text"
                  value={item.savings_amount || ''}
                  onChange={e => handleSavingsAmountInput(e.target.value, index)}
                  onBlur={e => handleSavingsAmountBlur(e.target.value, index)}
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

        <div className={styles.saveButtonContainer}>
          <button 
            onClick={handleSavingsSave}
            className={styles.saveButton}
          >
            <Icons.Save size={16} color="white" />
            บันทึกรายการเงินออม
          </button>
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

      {/* การลงทุน */}
      <div className={styles.investmentSection}>
        <InvestmentTable selectedMonth={selectedMonth} />
      </div>
    </div>
  );
}
