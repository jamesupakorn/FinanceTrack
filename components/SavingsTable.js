import { useState, useEffect } from 'react';
import { formatCurrency, calculateSum, handleNumberInput, parseAndFormat, formatSavingsData } from '../utils/numberUtils';
import { savingsAPI } from '../utils/apiUtils';

export default function SavingsTable({ month }) {
  const [data, setData] = useState(null);
  const [ยอดออมสะสม, setยอดออมสะสม] = useState(0);
  const [รายการเงินออม, setรายการเงินออม] = useState([]);

  useEffect(() => {
    if (month) {
      savingsAPI.getByMonth(month)
        .then(data => {
          const formatted = formatSavingsData(data);
          setยอดออมสะสม(formatted.ยอดออมสะสม);
          setรายการเงินออม(formatted.รายการเงินออม);
        })
        .catch(error => console.error('Error loading savings data:', error));
    }
  }, [month]);

  const handleSaveยอดออมสะสม = async () => {
    try {
      const formattedValue = parseAndFormat(ยอดออมสะสม);
      setยอดออมสะสม(formattedValue);
      await savingsAPI.saveAccumulated(month, formattedValue);
    } catch (error) {
      console.error('Error saving accumulated savings:', error);
    }
  };

  const handleAddรายการเงินออม = () => {
    const newEntry = {
      วันที่: new Date().toISOString().split('T')[0],
      จำนวนเงิน: 0,
      หมายเหตุ: ''
    };
    setรายการเงินออม([...รายการเงินออม, newEntry]);
  };

  const handleUpdateรายการเงินออม = (index, field, value) => {
    const updated = [...รายการเงินออม];
    if (field === 'จำนวนเงิน') {
      updated[index][field] = parseAndFormat(value);
    } else {
      updated[index][field] = value;
    }
    setรายการเงินออม(updated);
  };

  const handleDeleteรายการเงินออม = (index) => {
    const updated = รายการเงินออม.filter((_, i) => i !== index);
    setรายการเงินออม(updated);
  };

  const handleSaveรายการเงินออม = async () => {
    try {
      await savingsAPI.saveList(month, รายการเงินออม);
    } catch (error) {
      console.error('Error saving savings list:', error);
    }
  };

  const calculateTotalรายการเงินออม = () => {
    const values = รายการเงินออม.map(item => item.จำนวนเงิน);
    return calculateSum(values);
  };

  return (
    <div>
      <h2>เงินออม {month}</h2>
      
      {/* ยอดออมสะสม */}
      <div style={{ marginBottom: 32, padding: 16, backgroundColor: '#f8f9fa', borderRadius: 8 }}>
        <h3>ยอดออมสะสม</h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <input
            type="text"
            value={ยอดออมสะสม}
            onChange={e => setยอดออมสะสม(parseAndFormat(e.target.value))}
            style={{ width: '150px', padding: 8 }}
          />
          <span>บาท</span>
          <button 
            onClick={handleSaveยอดออมสะสม}
            style={{ padding: '8px 16px', backgroundColor: '#28a745', color: 'white', border: 'none', borderRadius: '4px' }}
          >
            บันทึกยอดออมสะสม
          </button>
        </div>
      </div>

      {/* รายการเงินออม */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3>รายการเงินออม</h3>
          <button 
            onClick={handleAddรายการเงินออม}
            style={{ padding: '8px 16px', backgroundColor: '#007bff', color: 'white', border: 'none', borderRadius: '4px' }}
          >
            เพิ่มรายการ
          </button>
        </div>
        
        <table border="1" cellPadding="8" style={{ width: '100%', marginBottom: 16 }}>
          <thead>
            <tr>
              <th>วันที่</th>
              <th>จำนวนเงิน</th>
              <th>หมายเหตุ</th>
              <th>จัดการ</th>
            </tr>
          </thead>
          <tbody>
            {รายการเงินออม.map((item, index) => (
              <tr key={index}>
                <td>
                  <input
                    type="date"
                    value={item.วันที่}
                    onChange={e => handleUpdateรายการเงินออม(index, 'วันที่', e.target.value)}
                    style={{ width: '140px' }}
                  />
                </td>
                <td>
                  <input
                    type="text"
                    value={item.จำนวนเงิน}
                    onChange={e => handleUpdateรายการเงินออม(index, 'จำนวนเงิน', e.target.value)}
                    style={{ width: '120px' }}
                  />
                </td>
                <td>
                  <input
                    type="text"
                    value={item.หมายเหตุ}
                    onChange={e => handleUpdateรายการเงินออม(index, 'หมายเหตุ', e.target.value)}
                    style={{ width: '200px' }}
                  />
                </td>
                <td>
                  <button 
                    onClick={() => handleDeleteรายการเงินออม(index)}
                    style={{ padding: '4px 8px', backgroundColor: '#dc3545', color: 'white', border: 'none', borderRadius: '4px' }}
                  >
                    ลบ
                  </button>
                </td>
              </tr>
            ))}
            {รายการเงินออม.length > 0 && (
              <tr style={{ backgroundColor: '#f0f0f0', fontWeight: 'bold' }}>
                <td colSpan="1">รวม</td>
                <td>{formatCurrency(calculateTotalรายการเงินออม())}</td>
                <td colSpan="2"></td>
              </tr>
            )}
          </tbody>
        </table>
        
        <button 
          onClick={handleSaveรายการเงินออม}
          style={{ padding: '8px 16px', backgroundColor: '#17a2b8', color: 'white', border: 'none', borderRadius: '4px' }}
        >
          บันทึกรายการเงินออม
        </button>
      </div>
    </div>
  );
}