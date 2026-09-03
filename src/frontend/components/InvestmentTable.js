/**
 * คอมโพเนนต์: InvestmentTable
 * จัดการรายการลงทุนรายเดือน (สัดส่วน/จำนวนเงิน)
 * @param {object} props
 * @param {string} props.selectedMonth - เดือนที่เลือก (YYYY-MM)
 * @param {function} props.onDataChange - callback เมื่อบันทึกสำเร็จ
 * @param {function} props.markDirty - (Graphite, K17) เรียกจาก addInvestment/removeInvestment เป็น
 *   คำสั่งแรกเสมอ — ปุ่มเหล่านี้เป็น onClick ไม่ใช่ input/change จึงไม่โดน bubbled listener ของ
 *   WorkspaceShell.js จับ (spec.md §Files "The C11 dirty signal", UX_SPEC §7 K17)
 *
 * Graphite redesign (daily-savings-tax-graphite pass) — Tailwind only (UX_SPEC §5.1 C11 / §6.5 base /
 * §6.6 lg), ไม่มี InvestmentTable.module.css อีกต่อไป. C11 conformance fix สองจุด: (1) แถวใหม่มีชื่อ
 * default ไม่ว่างแล้ว (K12 — เดิม name: '' ทำให้แถวใหม่ดูเหมือนกดไม่ติด) (2) key เปลี่ยนจาก index
 * เป็น id คงที่ต่อแถว (K13 — เดิม key={idx} ทำให้แถวสลับ/remount เวลาเพิ่ม-ลบ จนโฟกัสหลุดกลางคัน)
 */

import { useState, useEffect } from 'react';
import { investmentAPI } from '../../shared/utils/frontend/apiUtils';
import { parseToNumber, formatCurrency } from '../../shared/utils/frontend/numberUtils';
import { averagePercent } from '../../shared/utils/investmentUtils';
import { showToast } from '../../shared/utils/frontend/toast';
import { Icons } from './Icons';

function genId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

const NAME_FALLBACK = 'การลงทุนใหม่';

const FOCUS_RING = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2';
const INPUT = `h-11 w-full rounded-sm border border-border-interactive bg-surface-2 px-space-3 text-base text-primary outline-none ${FOCUS_RING}`;
const REMOVE_BTN = `flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-border-interactive bg-surface-2 text-neg ${FOCUS_RING}`;
const CARD = 'rounded-md border border-border-default bg-surface-1 p-space-4 shadow-elev-1';
const BTN_SECONDARY = `min-h-11 rounded-sm border border-border-interactive bg-surface-2 px-space-4 text-sm font-medium text-secondary ${FOCUS_RING} disabled:opacity-50`;

// InvestmentTable: แสดงและแก้ไขรายการลงทุนในแต่ละเดือน
export default function InvestmentTable({ selectedMonth, onDataChange, onRegisterSave, onSaved, markDirty }) {
  const [baseAmount, setBaseAmount] = useState('');
  const [investments, setInvestments] = useState([]);

  const handleAmountInputFocus = (event) => {
    event.target.select();
  };

  // ฟังก์ชันคำนวณ amount ตามเปอร์เซ็นต์
  const recalcAmounts = (amount, invList) => {
    const base = parseToNumber(amount);
    return invList.map(item => ({
      ...item,
      amount: base && item.percent ? ((parseFloat(item.percent) / 100) * base).toFixed(2) : ''
    }));
  };
  // เพิ่มฟังก์ชันเพิ่มรายการลงทุนใหม่
  const addInvestment = () => {
    markDirty?.(); // K17 — คำสั่งแรกเสมอ: ปุ่มนี้เป็น onClick ไม่ใช่ input/change (spec.md §Files
                    // "The C11 dirty signal")
    setInvestments(prev => recalcAmounts(baseAmount, [
      ...prev,
      { id: genId(), name: NAME_FALLBACK, percent: '', amount: '' }
    ]));
  };

  // ฟังก์ชันบันทึกข้อมูลการลงทุน
  const handleSave = async () => {
    if (!selectedMonth) return;
    const result = await investmentAPI.saveList(selectedMonth, investments);
    if (result) {
      if (typeof onDataChange === 'function') onDataChange();
      showToast('บันทึกสำเร็จ');
      onSaved?.();
    } else {
      showToast('บันทึกไม่สำเร็จ', 'error');
    }
  };

  // ลงทะเบียนฟังก์ชันบันทึกกับ ref ของ WorkspaceShell แทนตัวนับ Save All เดิม (Amendment A5 —
  // ดูคำอธิบายเต็มใน IncomeTable.js ที่จุดเดียวกัน)
  useEffect(() => {
    if (!onRegisterSave) return undefined;
    onRegisterSave(handleSave);
    return () => onRegisterSave(null);
  }, [onRegisterSave, handleSave]);

  // โหลดข้อมูลจาก backend เมื่อ selectedMonth เปลี่ยน
  useEffect(() => {
    if (!selectedMonth) return;
    investmentAPI.getByMonth(selectedMonth).then((data) => {
      if (Array.isArray(data) && data.length > 0) {
        setInvestments(data.map(item => ({ ...item, id: item.id || genId() })));
      } else {
        // ถ้าเดือนนี้ยังไม่มีข้อมูล ให้ดึงชื่อหุ้น/กองทุนจากเดือนก่อนหน้า
        investmentAPI.getAll().then((allData) => {
          // allData เป็น object {month: [investments]}
          const months = Object.keys(allData).filter(m => m !== selectedMonth).sort();
          // หาเดือนล่าสุดก่อนหน้า
          let prevMonth = null;
          for (let i = months.length - 1; i >= 0; i--) {
            if (months[i] < selectedMonth) {
              prevMonth = months[i];
              break;
            }
          }
          if (prevMonth && Array.isArray(allData[prevMonth])) {
            // copy เฉพาะ name, percent (amount จะคำนวณใหม่)
            const prevInvestments = allData[prevMonth].map(item => ({
              id: genId(),
              name: item.name || '',
              percent: item.percent || '',
              amount: ''
            }));
            setInvestments(prevInvestments);
          } else {
            setInvestments([]);
          }
        });
      }
    });
  }, [selectedMonth]);

  // เพิ่มฟังก์ชันแก้ไขฟิลด์ในแต่ละรายการ
  const updateField = (id, field, value) => {
    setInvestments(prev => {
      const updated = prev.map((item) =>
        item.id === id ? { ...item, [field]: value } : item
      );
      // ถ้าแก้ percent ให้คำนวณ amount ใหม่
      if (field === 'percent') {
        return recalcAmounts(baseAmount, updated);
      }
      return updated;
    });
  };
  // เพิ่มฟังก์ชันลบรายการลงทุน
  const removeInvestment = (id) => {
    markDirty?.(); // K17 — เดียวกับข้างบน
    setInvestments(prev => prev.filter((item) => item.id !== id));
  };

  // คำนวณเปอร์เซ็นรวมของรายการลงทุน
  const totalPercent = investments.reduce((sum, item) => sum + (parseFloat(item.percent) || 0), 0);
  const hasRows = investments.length > 0;

  return (
    <div>
      <div className="mb-space-4">
        <h3 className="text-lg font-medium text-primary">การลงทุนประจำเดือน {selectedMonth || ''}</h3>
      </div>

      <div className="mb-space-4">
        <label className="block text-sm text-secondary">
          จำนวนเงินลงทุนรวม (บาท)
          <input
            type="text"
            inputMode="decimal"
            value={baseAmount}
            onChange={e => {
              setBaseAmount(e.target.value);
              setInvestments(prev => recalcAmounts(e.target.value, prev));
            }}
            onFocus={handleAmountInputFocus}
            className={`${INPUT} mt-space-2 max-w-xs text-right font-[family-name:var(--font-numeric)] tabular-nums`}
          />
        </label>
      </div>

      {hasRows ? (
        <>
          {/* md+: C5 table */}
          <div className="hidden overflow-x-auto rounded-md border border-border-default md:block">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-border-subtle bg-surface-2">
                  <th className="p-space-3 text-left text-xs font-medium text-secondary">ชื่อหุ้น/กองทุน</th>
                  <th className="p-space-3 text-right text-xs font-medium text-secondary">เปอร์เซ็นการลงทุน (%)</th>
                  <th className="p-space-3 text-right text-xs font-medium text-secondary">จำนวนเงิน (บาท)</th>
                  <th className="p-space-3 text-center text-xs font-medium text-secondary">ลบ</th>
                </tr>
              </thead>
              <tbody>
                {investments.map((item) => (
                  <tr key={item.id} className="border-b border-border-subtle last:border-b-0">
                    <td className="p-space-3 align-middle">
                      <input
                        type="text"
                        value={item.name}
                        onChange={e => updateField(item.id, 'name', e.target.value)}
                        className={INPUT}
                      />
                    </td>
                    <td className="p-space-3 align-middle">
                      <input
                        type="text"
                        inputMode="decimal"
                        value={item.percent}
                        onChange={e => updateField(item.id, 'percent', e.target.value)}
                        onFocus={handleAmountInputFocus}
                        className={`${INPUT} text-right font-[family-name:var(--font-numeric)] tabular-nums`}
                      />
                    </td>
                    <td className="p-space-3 text-right align-middle font-[family-name:var(--font-numeric)] tabular-nums text-primary">
                      {formatCurrency(item.amount)}
                    </td>
                    <td className="p-space-3 text-center align-middle">
                      <button
                        type="button"
                        onClick={() => removeInvestment(item.id)}
                        className={`mx-auto ${REMOVE_BTN}`}
                        aria-label={`ลบ ${item.name || NAME_FALLBACK}`}
                      >
                        <Icons.X size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* base tier: C4/C11 cards */}
          <div className="flex flex-col gap-space-3 md:hidden">
            {investments.map((item) => (
              <div className="min-h-14 rounded-md border border-border-default bg-surface-2 p-space-4" key={item.id}>
                <div className="flex items-center gap-space-2">
                  <input
                    type="text"
                    value={item.name}
                    onChange={e => updateField(item.id, 'name', e.target.value)}
                    className={`${INPUT} flex-1 font-medium`}
                    placeholder="ชื่อหุ้น/กองทุน"
                  />
                  <button
                    type="button"
                    onClick={() => removeInvestment(item.id)}
                    className={REMOVE_BTN}
                    aria-label={`ลบ ${item.name || NAME_FALLBACK}`}
                  >
                    <Icons.X size={16} />
                  </button>
                </div>
                <div className="mt-space-3 flex items-center gap-space-3">
                  <input
                    type="text"
                    inputMode="decimal"
                    value={item.percent}
                    onChange={e => updateField(item.id, 'percent', e.target.value)}
                    onFocus={handleAmountInputFocus}
                    className={`${INPUT} flex-1 text-right font-[family-name:var(--font-numeric)] tabular-nums`}
                    placeholder="0%"
                  />
                  <span className="shrink-0 whitespace-nowrap font-[family-name:var(--font-numeric)] text-lg font-semibold tabular-nums text-primary">
                    {formatCurrency(item.amount)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </>
      ) : (
        <div className="rounded-md border border-dashed border-border-default bg-sunken p-space-4 text-sm text-secondary">
          ไม่มีรายการลงทุน
        </div>
      )}

      <div className="mt-space-4 flex flex-wrap items-center gap-space-3">
        <button type="button" onClick={addInvestment} className="min-h-11 shrink-0 rounded-sm bg-accent px-space-4 text-sm font-medium text-on-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2">
          + เพิ่มรายการลงทุน
        </button>
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
          className={BTN_SECONDARY}
          disabled={investments.length === 0}
        >
          เฉลี่ยเปอร์เซ็น
        </button>
      </div>

      <div className={`${CARD} mt-space-4 flex items-center justify-between ${totalPercent !== 100 ? 'border-warn/40' : 'border-pos/40'}`}>
        <span className="text-sm text-secondary">รวมเปอร์เซ็น</span>
        <span className={`font-[family-name:var(--font-numeric)] text-lg font-semibold tabular-nums ${totalPercent !== 100 ? 'text-warn' : 'text-pos'}`}>
          {totalPercent}% {totalPercent > 100 && '(เกิน 100%)'}{totalPercent < 100 && '(ต้องครบ 100%)'}
        </span>
      </div>
    </div>
  );
}
