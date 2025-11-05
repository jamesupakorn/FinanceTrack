import React, { useState, useEffect, useRef } from 'react';
import { investmentAPI } from '../../shared/utils/apiUtils';
import { maskNumberFormat, parseToNumber, formatCurrency } from '../../shared/utils/numberUtils';

// InvestmentTable: แสดงและแก้ไขรายการลงทุนในแต่ละเดือน
export default function InvestmentTable({ selectedMonth, mode = 'view', onDataChange }) {
  const [baseAmount, setBaseAmount] = useState('');
  const [investments, setInvestments] = useState([]);
  const isFirstLoad = useRef(true);

  // โหลดข้อมูลจาก backend เมื่อ selectedMonth เปลี่ยน
  useEffect(() => {
    if (!selectedMonth) return;
    investmentAPI.getByMonth(selectedMonth).then((data) => {
      if (Array.isArray(data) && data.length > 0) {
        setInvestments(data.map(item => ({ ...item, percent: item.percent?.toString() ?? '', amount: item.amount?.toString() ?? '', name: item.name ?? '' })));
        // คำนวณ baseAmount จากข้อมูล (ถ้ามี)
        const sum = data.reduce((acc, item) => acc + (parseFloat(item.amount) || 0), 0);
        setBaseAmount(sum ? sum.toString() : '');
      } else {
        setInvestments([]);
        setBaseAmount('');
      }
      isFirstLoad.current = false;
    });
  }, [selectedMonth]);

  // คำนวณจำนวนเงินแต่ละรายการตามเปอร์เซ็นต์
  useEffect(() => {
    if (!baseAmount || isNaN(baseAmount)) return;
    setInvestments((prev) =>
      prev.map((item) => {
        const percent = parseFloat(item.percent) || 0;
        const amount = ((percent / 100) * parseFloat(baseAmount || 0)).toFixed(2);
        return { ...item, amount };
      })
    );
  }, [baseAmount, investments.length]);


  // Manual save state
  const [saveStatus, setSaveStatus] = useState('idle'); // idle | saving | success | error

  // Manual save handler
  const handleSave = async () => {
    if (!selectedMonth || !baseAmount || investments.length === 0) return;
    setSaveStatus('saving');
    try {
      await investmentAPI.saveList(selectedMonth, investments.map(item => ({ ...item, amount: parseFloat(item.amount) || 0, percent: parseFloat(item.percent) || 0 })));
      setSaveStatus('success');
      setTimeout(() => setSaveStatus('idle'), 1200);
    } catch (e) {
      setSaveStatus('error');
      setTimeout(() => setSaveStatus('idle'), 2000);
    }
  };

  // ตรวจสอบเปอร์เซ็นต์รวม
  const totalPercent = investments.reduce((sum, item) => sum + (parseFloat(item.percent) || 0), 0);

  // เพิ่มรายการใหม่
  const addInvestment = () => {
    setInvestments([...investments, { name: '', percent: '', amount: '' }]);
  };

  // ลบรายการ
  const removeInvestment = (idx) => {
    setInvestments(investments.filter((_, i) => i !== idx));
  };

  // อัปเดตฟิลด์
  const updateField = (idx, field, value) => {
    setInvestments((prev) =>
      prev.map((item, i) => (i === idx ? { ...item, [field]: value } : item))
    );
  };

  // แจ้ง parent เมื่อข้อมูลเปลี่ยน
  useEffect(() => {
    if (onDataChange) onDataChange({ baseAmount, investments });
  }, [baseAmount, investments, onDataChange]);

  return (
    <div style={{ marginTop: 24 }}>
      <h3 style={{ marginBottom: 12 }}>การลงทุนประจำเดือน {selectedMonth || ''}</h3>
      <div style={{ marginBottom: 12 }}>
        <label>
          จำนวนเงินลงทุนรวม (บาท):
          {mode === 'edit' ? (
            <input
              type="number"
              min="0"
              value={baseAmount}
              onChange={e => setBaseAmount(e.target.value)}
              style={{ marginLeft: 8, padding: 4, borderRadius: 4, border: '1px solid #ccc', width: 120 }}
              disabled={mode !== 'edit'}
            />
          ) : (
            <span style={{ marginLeft: 8, fontWeight: 500, fontSize: 18, color: '#444' }}>{maskNumberFormat(parseToNumber(baseAmount))}</span>
          )}
        </label>
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', background: '#fff', borderRadius: 8, overflow: 'hidden' }}>
        <thead>
          <tr style={{ background: '#f3f4f6' }}>
            <th style={{ padding: 8, border: '1px solid #e5e7eb' }}>ชื่อหุ้น/กองทุน</th>
            <th style={{ padding: 8, border: '1px solid #e5e7eb' }}>เปอร์เซ็นการลงทุน (%)</th>
            <th style={{ padding: 8, border: '1px solid #e5e7eb' }}>จำนวนเงิน (บาท)</th>
            {mode === 'edit' && <th style={{ padding: 8, border: '1px solid #e5e7eb' }}>ลบ</th>}
          </tr>
        </thead>
        <tbody>
          {investments.map((item, idx) => (
            <tr key={idx}>
              <td style={{ padding: 8, border: '1px solid #e5e7eb' }}>
                <input
                  type="text"
                  value={item.name}
                  onChange={e => updateField(idx, 'name', e.target.value)}
                  style={{ width: '100%', padding: 4, borderRadius: 4, border: '1px solid #ccc' }}
                  disabled={mode !== 'edit'}
                />
              </td>
              <td style={{ padding: 8, border: '1px solid #e5e7eb' }}>
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={item.percent}
                  onChange={e => updateField(idx, 'percent', e.target.value)}
                  style={{ width: 80, padding: 4, borderRadius: 4, border: '1px solid #ccc' }}
                  disabled={mode !== 'edit'}
                />
              </td>
              <td style={{ padding: 8, border: '1px solid #e5e7eb', textAlign: 'right' }}>
                {mode === 'edit'
                  ? formatCurrency(item.amount)
                  : maskNumberFormat(parseToNumber(item.amount))}
              </td>
              {mode === 'edit' && (
                <td style={{ padding: 8, border: '1px solid #e5e7eb', textAlign: 'center' }}>
                  <button type="button" onClick={() => removeInvestment(idx)} style={{ color: '#dc2626', background: 'none', border: 'none', fontWeight: 600, cursor: 'pointer' }}>ลบ</button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {mode === 'edit' && (
        <div style={{ marginTop: 12, display: 'flex', gap: 12, alignItems: 'center' }}>
          <button type="button" onClick={addInvestment} style={{ padding: '6px 16px', borderRadius: 6, border: 'none', background: '#1a7f37', color: 'white', fontWeight: 600, cursor: 'pointer' }}>+ เพิ่มรายการลงทุน</button>
          <button
            type="button"
            onClick={() => {
              if (investments.length === 0) return;
              const avg = Math.floor((100 * 100) / investments.length) / 100;
              let remain = 100 - avg * (investments.length - 1);
              setInvestments(investments.map((item, idx) => ({
                ...item,
                percent: (idx === investments.length - 1 ? remain : avg).toString()
              })));
            }}
            style={{ padding: '6px 16px', borderRadius: 6, border: 'none', background: '#f59e42', color: 'white', fontWeight: 600, cursor: investments.length === 0 ? 'not-allowed' : 'pointer', opacity: investments.length === 0 ? 0.5 : 1 }}
            disabled={investments.length === 0}
          >
            เฉลี่ยเปอร์เซ็น
          </button>
          <button
            type="button"
            onClick={handleSave}
            style={{ padding: '6px 24px', borderRadius: 6, border: 'none', background: '#2563eb', color: 'white', fontWeight: 600, cursor: (totalPercent !== 100 && totalPercent !== 0) ? 'not-allowed' : 'pointer', opacity: (totalPercent !== 100 && totalPercent !== 0) ? 0.5 : 1 }}
            disabled={totalPercent !== 100 && totalPercent !== 0}
          >
            บันทึก
          </button>
          {saveStatus === 'saving' && <span style={{ color: '#2563eb' }}>กำลังบันทึก...</span>}
          {saveStatus === 'success' && <span style={{ color: '#16a34a' }}>บันทึกสำเร็จ</span>}
          {saveStatus === 'error' && <span style={{ color: '#dc2626' }}>บันทึกผิดพลาด</span>}
        </div>
      )}
      <div style={{ marginTop: 8, color: totalPercent !== 100 ? 'red' : '#666', fontWeight: 500 }}>
        รวมเปอร์เซ็น: {totalPercent}% {totalPercent > 100 && '(เกิน 100%)'}{totalPercent < 100 && '(ต้องครบ 100%)'}
      </div>
    </div>
  );
}
