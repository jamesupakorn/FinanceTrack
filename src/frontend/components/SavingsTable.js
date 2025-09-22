import { useState, useEffect } from 'react';
import { formatCurrency, calculateSum, parseAndFormat, parseToNumber } from '../../shared/utils/numberUtils';
import { savingsAPI } from '../../shared/utils/apiUtils';
import { Icons } from './Icons';
import styles from '../styles/SavingsTable.module.css';

export default function SavingsTable({ selectedMonth }) {
  const [savingsData, setSavingsData] = useState(null);
  const [รายการเงินออม, setรายการเงินออม] = useState([]);

  useEffect(() => {
    if (selectedMonth) {
      savingsAPI.getByMonth(selectedMonth)
        .then(data => {
          setSavingsData(data);
          setรายการเงินออม(data.รายการเงินออม || []);
        })
        .catch(error => console.error('Error loading savings data:', error));
    }
  }, [selectedMonth]);

  const handleAddSavingsItem = () => {
    setรายการเงินออม([...รายการเงินออม, { รายการ: '', จำนวนเงิน: '0' }]);
  };

  const handleSavingsItemChange = (index, field, value) => {
    const newList = [...รายการเงินออม];
    newList[index][field] = field === 'จำนวนเงิน' ? value : value;
    setรายการเงินออม(newList);
  };

  const handleSavingsItemBlur = (index, field, value) => {
    if (field === 'จำนวนเงิน') {
      const newList = [...รายการเงินออม];
      newList[index][field] = parseAndFormat(value);
      setรายการเงินออม(newList);
    }
  };

  const handleDeleteSavingsItem = (index) => {
    const newList = รายการเงินออม.filter((_, i) => i !== index);
    setรายการเงินออม(newList);
  };

  const handleSavingsSave = async () => {
    try {
      // แปลงเป็น number ก่อนบันทึก
      const numericSavings = รายการเงินออม.map(item => ({
        ...item,
        จำนวนเงิน: parseToNumber(item.จำนวนเงิน)
      }));
      
      await savingsAPI.saveList(selectedMonth, numericSavings);
      alert('บันทึกรายการเงินออมสำเร็จ!');
    } catch (error) {
      console.error('Error saving savings list:', error);
    }
  };

  if (!savingsData) return <div>กำลังโหลด...</div>;

  const รวมเงินเก็บ = calculateSum(รายการเงินออม.map(item => item.จำนวนเงิน || 0));

  return (
    <div className={styles.savingsTable}>
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

        <div className={styles.tableContainer}>
          <table className={styles.table}>
            <thead className={styles.tableHeader}>
              <tr>
                <th className={styles.tableHeaderCell}>รายการ</th>
                <th className={styles.tableHeaderCell}>จำนวนเงิน (บาท)</th>
                <th className={styles.tableHeaderCell}>การจัดการ</th>
              </tr>
            </thead>
                      <tbody>
              {รายการเงินออม.map((item, index) => (
                <tr key={index} className={styles.tableRow}>
                  <td className={styles.tableCell}>
                    <input
                      type="text"
                      value={item.รายการ || ''}
                      onChange={(e) => handleEditSavingsItem(index, 'รายการ', e.target.value)}
                      placeholder="ระบุรายการ"
                      className={styles.savingsInput}
                    />
                  </td>
                  <td className={styles.tableCell}>
                    <input
                      type="text"
                      value={item.จำนวนเงิน || ''}
                      onChange={(e) => handleEditSavingsItem(index, 'จำนวนเงิน', e.target.value)}
                      placeholder="0.00"
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
    </div>
  );
}
