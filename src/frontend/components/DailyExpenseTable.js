import { useState, useEffect, useCallback } from 'react';
import { dailyExpenseAPI } from '../../shared/utils/frontend/apiUtils';
import { formatCurrency, parseToNumber } from '../../shared/utils/frontend/numberUtils';
import { showToast } from '../../shared/utils/frontend/toast';
import styles from '../styles/DailyExpenseTable.module.css';

function genId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function getMonthlyAmount(item) {
  const amount = parseToNumber(item.amount);
  if (item.category === 'fixed') {
    if (item.frequency === 'daily') return amount * 30;
    if (item.frequency === 'weekly') return amount * 4.33;
    return 0;
  }
  if (item.category === 'misc') return amount;
  return 0;
}

function calcTotals(items) {
  let fixedMonthly = 0;
  let miscMonthly = 0;
  items.forEach(item => {
    const m = getMonthlyAmount(item);
    if (item.category === 'fixed') fixedMonthly += m;
    else if (item.category === 'misc') miscMonthly += m;
  });
  return { fixedMonthly, miscMonthly, totalMonthly: fixedMonthly + miscMonthly };
}

function ItemRow({ item, onChange, onDelete }) {
  const monthlyAmt = getMonthlyAmount(item);

  return (
    <div className={`${styles.row} ${item.category === 'misc' ? styles.rowMisc : ''}`}>
      <input
        className={styles.nameInput}
        type="text"
        value={item.name}
        onChange={e => onChange(item.id, 'name', e.target.value)}
        placeholder="ชื่อรายการ"
      />
      <input
        className={styles.amountInput}
        type="text"
        inputMode="numeric"
        value={item.amount}
        onChange={e => onChange(item.id, 'amount', e.target.value)}
        placeholder="0"
      />
      {item.category === 'fixed' && (
        <>
          <select
            className={styles.freqSelect}
            value={item.frequency || 'daily'}
            onChange={e => onChange(item.id, 'frequency', e.target.value)}
          >
            <option value="daily">ต่อวัน</option>
            <option value="weekly">ต่อสัปดาห์</option>
          </select>
          <span className={styles.monthlyAmt}>
            {monthlyAmt > 0 ? formatCurrency(Math.round(monthlyAmt)) : '—'}
          </span>
        </>
      )}
      <button
        type="button"
        className={styles.deleteBtn}
        onClick={() => onDelete(item.id)}
        title="ลบ"
      >
        ✕
      </button>
    </div>
  );
}

export default function DailyExpenseTable({ selectedMonth, onRegisterSave, onSaved }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);

  const loadData = useCallback(async (isCancelled) => {
    if (!selectedMonth) return;
    setLoading(true);
    try {
      const data = await dailyExpenseAPI.getByMonth(selectedMonth);
      if (isCancelled()) return;
      const loaded = (data?.items || []).map(item => ({
        ...item,
        id: item.id || genId(),
      }));
      setItems(loaded);
    } catch {
      if (isCancelled()) return;
      setItems([]);
    } finally {
      if (!isCancelled()) setLoading(false);
    }
  }, [selectedMonth]);

  useEffect(() => {
    let cancelled = false;
    loadData(() => cancelled);
    return () => { cancelled = true; };
  }, [loadData]);

  // เดิมเป็น IIFE ข้างใน effect ที่ฟังตัวนับ Save All — ดึงออกมาเป็นฟังก์ชันชื่อ handleSave เพราะ
  // ตอนนี้ WorkspaceShell ต้องเรียกมันได้ตรง ๆ ผ่าน onRegisterSave (Amendment A5)
  const handleSave = useCallback(async () => {
    try {
      await dailyExpenseAPI.save(selectedMonth, items);
      showToast('บันทึกค่าใช้จ่ายรายวันเรียบร้อยแล้ว', 'success');
      onSaved?.();
    } catch (err) {
      showToast(err?.message || 'บันทึกค่าใช้จ่ายรายวันไม่สำเร็จ', 'error');
    }
  }, [selectedMonth, items, onSaved]);

  useEffect(() => {
    if (!onRegisterSave) return undefined;
    onRegisterSave(handleSave);
    return () => onRegisterSave(null);
  }, [onRegisterSave, handleSave]);

  const handleChange = (id, field, value) => {
    setItems(prev => prev.map(item => item.id === id ? { ...item, [field]: value } : item));
  };

  const handleDelete = (id) => {
    setItems(prev => prev.filter(item => item.id !== id));
  };

  const addFixed = () => {
    setItems(prev => [
      ...prev,
      { id: genId(), category: 'fixed', name: '', amount: '', frequency: 'daily' },
    ]);
  };

  const addMisc = () => {
    setItems(prev => [
      ...prev,
      { id: genId(), category: 'misc', name: '', amount: '', frequency: null },
    ]);
  };

  const fixedItems = items.filter(i => i.category === 'fixed');
  const miscItems = items.filter(i => i.category === 'misc');
  const { fixedMonthly, miscMonthly, totalMonthly } = calcTotals(items);

  if (loading) {
    return <div className={styles.loading} role="status" aria-live="polite">กำลังโหลด...</div>;
  }

  return (
    <div className={styles.container}>

      {/* ส่วนที่ 1: รายการประจำ */}
      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <h4 className={styles.sectionTitle}>รายจ่ายประจำ</h4>
          <span className={styles.sectionHint}>กรอกยอดต่อวัน หรือต่อสัปดาห์</span>
        </div>

        <div className={styles.tableHeader}>
          <span className={styles.colName}>รายการ</span>
          <span className={styles.colAmount}>ยอด</span>
          <span className={styles.colFreq}>ความถี่</span>
          <span className={styles.colMonthly}>/เดือน</span>
          <span className={styles.colAction} />
        </div>

        {fixedItems.length === 0 && (
          <div className={styles.emptyRow}>ยังไม่มีรายการ</div>
        )}
        {fixedItems.map(item => (
          <ItemRow
            key={item.id}
            item={item}
            onChange={handleChange}
            onDelete={handleDelete}
          />
        ))}

        <button type="button" className={styles.addBtn} onClick={addFixed}>
          + เพิ่มรายการประจำ
        </button>

        <div className={styles.sectionTotal}>
          รวมประจำ/เดือน: <strong>{formatCurrency(Math.round(fixedMonthly))}</strong>
        </div>
      </section>

      {/* ส่วนที่ 2: รายจ่ายหยิบหย่อย */}
      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <h4 className={styles.sectionTitle}>รายจ่ายหยิบหย่อย</h4>
          <span className={styles.sectionHint}>กรอกยอดรวม/เดือน</span>
        </div>

        <div className={styles.tableHeader}>
          <span className={styles.colName}>รายการ</span>
          <span className={styles.colAmountMisc}>ยอด/เดือน</span>
          <span className={styles.colAction} />
        </div>

        {miscItems.length === 0 && (
          <div className={styles.emptyRow}>ยังไม่มีรายการ</div>
        )}
        {miscItems.map(item => (
          <ItemRow
            key={item.id}
            item={item}
            onChange={handleChange}
            onDelete={handleDelete}
          />
        ))}

        <button type="button" className={styles.addBtn} onClick={addMisc}>
          + เพิ่มรายจ่ายหยิบหย่อย
        </button>

        <div className={styles.sectionTotal}>
          รวมหยิบหย่อย/เดือน: <strong>{formatCurrency(Math.round(miscMonthly))}</strong>
        </div>
      </section>

      {/* ยอดรวม */}
      <div className={styles.grandTotal}>
        <span>ยอดรวมค่าใช้จ่ายรายวัน/เดือน</span>
        <strong className={styles.grandTotalValue}>{formatCurrency(Math.round(totalMonthly))}</strong>
      </div>
    </div>
  );
}
