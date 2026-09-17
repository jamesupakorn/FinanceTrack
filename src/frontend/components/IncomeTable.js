/**
 * คอมโพเนนต์: IncomeTable
 * จัดการข้อมูลรายรับรายเดือน พร้อมรองรับรายการแบบกำหนดเอง
 * @param {object} props
 * @param {string} props.selectedMonth - เดือนที่เลือก (YYYY-MM)
 * @param {number} props.salaryUpdateTrigger - ตัวกระตุ้นให้รีเฟรชข้อมูลเงินเดือน
 * @param {function} props.markDirty - (Graphite, K17) เรียกจาก handleAddIncomeItem/handleDeleteIncomeItem
 *   เป็นคำสั่งแรกเสมอ — ปุ่มเหล่านี้เป็น onClick ไม่ใช่ input/change จึงไม่โดน bubbled listener ของ
 *   WorkspaceShell.js จับ (spec.md §Files "The C11 dirty signal", UX_SPEC §7 K17)
 *
 * Graphite redesign (income-expense-graphite pass) — Tailwind only (UX_SPEC §5.1 C11 / §6.5 base /
 * §6.6 lg), ไม่มี IncomeTable.module.css อีกต่อไป — โครงสร้าง/logic ทั้งหมดคงเดิม (K12/K13/K14 conform
 * อยู่แล้วในโค้ดเดิม ตาม UX_SPEC §8.1 — เปลี่ยนแค่ className ยกเว้นจุด markDirty ที่เพิ่มใหม่)
 */

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
import { showToast } from '../../shared/utils/frontend/toast';
import { Icons } from './Icons';
import LoadingNotice from './LoadingNotice';

const CUSTOM_LABEL_FALLBACK = 'รายรับใหม่';

const FOCUS_RING = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2';
const INPUT = `h-11 w-full rounded-sm border border-border-interactive bg-surface-2 px-space-3 text-base text-primary outline-none ${FOCUS_RING}`;
const REMOVE_BTN = `flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-border-interactive bg-surface-2 text-neg ${FOCUS_RING}`;

/**
 * ตารางแก้ไขรายรับรายเดือน
 */
export default function IncomeTable({ selectedMonth, salaryUpdateTrigger, onOpenSalaryModal, onRegisterSave, onSaved, markDirty }) {
  const [editIncome, setEditIncome] = useState({});
  const [incomeLabels, setIncomeLabels] = useState({});
  const [persistedKeys, setPersistedKeys] = useState([]);
  const [salaryNetIncome, setSalaryNetIncome] = useState(0);
  const [pendingScrollKey, setPendingScrollKey] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

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
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    setIsLoading(true);

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

    // รอทั้งสอง endpoint ก่อนปิด loading — เดิมไม่มี isLoading เลย ช่วงระหว่างรอ fetch จะขึ้น
    // "ยังไม่มีข้อมูลรายรับ" หลอกผู้ใช้ว่าข้อมูลหาย (critique 2026-08-29 P2)
    Promise.allSettled([loadIncome(), loadSalary()]).then(() => {
      if (!cancelled) setIsLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [selectedMonth, salaryUpdateTrigger]);

  useEffect(() => {
    if (!pendingScrollKey) return;
    const tryScroll = () => {
      if (typeof document === 'undefined') return false;
      const targets = Array.from(document.querySelectorAll(`[data-income-key="${pendingScrollKey}"]`));
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
          setPendingScrollKey(null);
        }
      }, 80);
      return () => clearTimeout(timer);
    }
    setPendingScrollKey(null);
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [editIncome, pendingScrollKey]);

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

  const getInputLabelValue = (key) => {
    const stored = incomeLabels[key];
    if (stored !== undefined && stored !== null) return stored;
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
      [key]: cleaned.length ? cleaned : (incomeKeyThaiMap[key] || CUSTOM_LABEL_FALLBACK)
    }));
  };

  const handleAmountInputFocus = (event) => {
    event.target.select();
  };

  const handleAddIncomeItem = () => {
    markDirty?.(); // K17 — คำสั่งแรกเสมอ: ปุ่มนี้เป็น onClick ไม่ใช่ input/change จึงไม่ bubble ไปโดน
                    // ตัวจับ isDirty ของ WorkspaceShell.js เอง (spec.md §Files "The C11 dirty signal")
    const uniqueKey = `custom_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    setEditIncome(prev => ({
      ...prev,
      [uniqueKey]: parseAndFormat(0)
    }));
    setIncomeLabels(prev => ({
      ...prev,
      [uniqueKey]: CUSTOM_LABEL_FALLBACK
    }));
    setPendingScrollKey(uniqueKey);
  };

  const handleDeleteIncomeItem = (key) => {
    if (key === 'salary') return;
    markDirty?.(); // K17 — เดียวกับข้างบน
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
      showToast('บันทึกรายรับสำเร็จ');
      onSaved?.();
    } catch (error) {
      console.error('Error saving income data:', error);
      showToast('บันทึกไม่สำเร็จ กรุณาลองใหม่', 'error');
    }
  };

  // ลงทะเบียนฟังก์ชันบันทึกของตัวเองไว้กับ ref ของ WorkspaceShell (Amendment A5 — เดิมคือ effect ที่ฟัง
  // ตัวนับ Save All ตาม ADR-003) handleSave เป็นฟังก์ชันใหม่ทุก render จึง effect นี้รันทุก render ก็จริง
  // แต่ onRegisterSave เขียนแค่ ref ไม่มี setState จึงไม่ re-render ซ้อน (ห้ามเปลี่ยนเป็น setState เด็ดขาด
  // — จะวนไม่จบ ดู ADR-018 §2 / AC-A5-23)
  useEffect(() => {
    if (!onRegisterSave) return undefined;
    onRegisterSave(handleSave);
    return () => onRegisterSave(null);
  }, [onRegisterSave, handleSave]);

  return (
    <div>
      {hasIncomeRows ? (
        <>
          <div className="mb-space-4 flex flex-wrap items-start justify-between gap-space-3">
            <div>
              <h3 className="text-lg font-medium text-primary">ปรับรายการรายรับได้เอง</h3>
              <p className="mt-space-1 text-sm text-secondary">เพิ่ม ลบ หรือแก้ไขชื่อรายการรายรับให้ตรงกับชีวิตจริงได้เลย</p>
            </div>
            <button type="button" className={`min-h-11 shrink-0 rounded-sm bg-accent px-space-4 text-sm font-medium text-on-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2`} onClick={handleAddIncomeItem}>
              + เพิ่มรายการรายรับ
            </button>
          </div>

          {/* md+: C5 table */}
          <div className="hidden overflow-x-auto rounded-md border border-border-default md:block">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-border-subtle bg-surface-2">
                  <th className="p-space-3 text-left text-xs font-medium text-secondary">รายการ</th>
                  <th className="p-space-3 text-right text-xs font-medium text-secondary">จำนวนเงิน (บาท)</th>
                </tr>
              </thead>
              <tbody>
                {sortedIncomeKeys.map((itemKey) => {
                  const label = getDisplayLabel(itemKey);
                  const inputLabelValue = getInputLabelValue(itemKey);
                  const isSalary = itemKey === 'salary';
                  return (
                    <tr key={itemKey} className="border-b border-border-subtle last:border-b-0" data-income-key={itemKey}>
                      <td className="p-space-3 align-middle">
                        {isSalary ? (
                          onOpenSalaryModal ? (
                            <button
                              type="button"
                              className={`flex items-center gap-space-2 text-left text-primary ${FOCUS_RING}`}
                              onClick={() => onOpenSalaryModal?.()}
                              aria-haspopup="dialog"
                              aria-label="แก้ไขเงินเดือน — เปิดเครื่องคำนวณเงินเดือน"
                            >
                              <span>{label}</span>
                              <span className="rounded-full bg-info/15 px-space-2 py-[2px] text-xs font-medium text-info">จากระบบเงินเดือน</span>
                              <Icons.Edit size={14} />
                            </button>
                          ) : (
                            <div className="flex items-center gap-space-2 text-primary">
                              <span>{label}</span>
                              <span className="rounded-full bg-info/15 px-space-2 py-[2px] text-xs font-medium text-info">จากระบบเงินเดือน</span>
                            </div>
                          )
                        ) : (
                          <div className="flex min-w-0 items-center gap-space-3">
                            <input
                              type="text"
                              className={`${INPUT} flex-1`}
                              value={inputLabelValue}
                              onChange={(e) => handleIncomeNameChange(itemKey, e.target.value)}
                              onBlur={(e) => handleIncomeNameBlur(itemKey, e.target.value)}
                              placeholder="ชื่อรายการ"
                            />
                            <button
                              type="button"
                              className={REMOVE_BTN}
                              onClick={() => handleDeleteIncomeItem(itemKey)}
                              aria-label={`ลบ ${label}`}
                            >
                              <Icons.X size={16} />
                            </button>
                          </div>
                        )}
                      </td>
                      <td className="p-space-3 text-right align-middle">
                        {isSalary ? (
                          <div>
                            <span className="font-[family-name:var(--font-numeric)] text-lg font-semibold tabular-nums text-primary">
                              {formatCurrency(getSalaryDisplayValue())}
                            </span>
                            <br />
                            <small className="text-xs text-tertiary">(จากระบบเงินเดือน)</small>
                          </div>
                        ) : (
                          <input
                            type="text"
                            inputMode="decimal"
                            value={editIncome[itemKey] ?? ''}
                            onChange={e => handleNumberInput(e.target.value, setEditIncome, itemKey)}
                            onBlur={e => handleNumberBlur(e.target.value, setEditIncome, itemKey)}
                            onFocus={handleAmountInputFocus}
                            className={`${INPUT} text-right font-[family-name:var(--font-numeric)] tabular-nums`}
                          />
                        )}
                      </td>
                    </tr>
                  );
                })}
                <tr className="bg-surface-2">
                  <td className="p-space-3 text-sm font-semibold text-primary">รวม</td>
                  <td className="p-space-3 text-right font-[family-name:var(--font-numeric)] text-lg font-semibold tabular-nums text-primary">
                    {formatCurrency(totalIncomeValue)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* base tier: C4/C11 cards */}
          <div className="flex flex-col gap-space-3 md:hidden">
            {sortedIncomeKeys.map(itemKey => {
              const label = getDisplayLabel(itemKey);
              const inputLabelValue = getInputLabelValue(itemKey);
              const isSalary = itemKey === 'salary';
              return (
                <div
                  className="min-h-14 rounded-md border border-border-default bg-surface-2 p-space-4 [scroll-margin-top:calc(var(--topbar-safe-top,90px)+8px)]"
                  key={itemKey}
                  data-income-key={itemKey}
                >
                  {isSalary ? (
                    <div className="flex items-center justify-between gap-space-3">
                      {onOpenSalaryModal ? (
                        <button
                          type="button"
                          className={`flex flex-1 items-center gap-space-2 text-left text-primary ${FOCUS_RING}`}
                          onClick={() => onOpenSalaryModal?.()}
                          aria-haspopup="dialog"
                          aria-label="แก้ไขเงินเดือน — เปิดเครื่องคำนวณเงินเดือน"
                        >
                          <span className="font-medium">{label}</span>
                          <span className="rounded-full bg-info/15 px-space-2 py-[2px] text-xs font-medium text-info">จากระบบเงินเดือน</span>
                          <Icons.Edit size={14} />
                        </button>
                      ) : (
                        <div className="flex items-center gap-space-2 text-primary">
                          <span className="font-medium">{label}</span>
                          <span className="rounded-full bg-info/15 px-space-2 py-[2px] text-xs font-medium text-info">จากระบบเงินเดือน</span>
                        </div>
                      )}
                      <span className="shrink-0 whitespace-nowrap font-[family-name:var(--font-numeric)] text-lg font-semibold tabular-nums text-primary">
                        {formatCurrency(getSalaryDisplayValue())}
                      </span>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-space-3">
                      <div className="flex items-center gap-space-2">
                        <input
                          type="text"
                          className={`${INPUT} flex-1`}
                          value={inputLabelValue}
                          onChange={(e) => handleIncomeNameChange(itemKey, e.target.value)}
                          onBlur={(e) => handleIncomeNameBlur(itemKey, e.target.value)}
                          placeholder="ชื่อรายการ"
                        />
                        <button
                          type="button"
                          className={REMOVE_BTN}
                          onClick={() => handleDeleteIncomeItem(itemKey)}
                          aria-label={`ลบ ${label}`}
                        >
                          <Icons.X size={16} />
                        </button>
                      </div>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={editIncome[itemKey] ?? ''}
                        onChange={e => handleNumberInput(e.target.value, setEditIncome, itemKey)}
                        onBlur={e => handleNumberBlur(e.target.value, setEditIncome, itemKey)}
                        onFocus={handleAmountInputFocus}
                        className={`${INPUT} text-right font-[family-name:var(--font-numeric)] text-lg font-semibold tabular-nums`}
                        placeholder="0.00"
                      />
                    </div>
                  )}
                </div>
              );
            })}
            <div className="flex min-h-14 items-center justify-between rounded-md border border-accent/40 bg-accent-muted p-space-4">
              <span className="text-sm font-semibold text-primary">รวม</span>
              <span className="font-[family-name:var(--font-numeric)] text-lg font-semibold tabular-nums text-primary">
                {formatCurrency(totalIncomeValue)}
              </span>
            </div>
          </div>
        </>
      ) : isLoading ? (
        <LoadingNotice />
      ) : (
        <div className="rounded-md border border-dashed border-border-default bg-sunken p-space-4 text-sm text-secondary">ยังไม่มีข้อมูลรายรับสำหรับเดือนนี้</div>
      )}
    </div>
  );
}
