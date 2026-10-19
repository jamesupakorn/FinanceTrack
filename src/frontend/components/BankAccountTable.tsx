/**
 * คอมโพเนนต์: BankAccountTable
 * แสดงสรุปยอดโอนตามบัญชีธนาคารจากผลรวมค่าใช้จ่าย
 *
 * Graphite redesign (income-expense-graphite pass, Finding 2/3) — Tailwind only, ไม่มี
 * ExpenseTable.module.css อีกต่อไป (สไตล์ชีตเดียวที่ไฟล์นี้เคยพึ่ง) + แก้ K13: เดิม row key เป็น
 * index-derived (`bank-account-row-${index}`) ทำให้ลบ/เพิ่มแถวกลางลิสต์แล้ว input โฟกัสหลุด — เปลี่ยน
 * เป็น id ที่คงที่ต่อแถว ไม่ผูกกับ index หรือค่าที่พิมพ์ (accountIds state ด้านล่าง จัดการคู่ขนานกับ
 * safeAccounts เอง ผ่าน handleAddAccount/handleDeleteAccount ที่แก้ทั้งสองพร้อมกันเสมอ)
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { compareListValues, matchesListQuery } from '../../shared/utils/frontend/listView';
import { useListProjection } from '../../shared/utils/frontend/useListProjection';
import { parseToNumber, formatCurrency } from '../../shared/utils/frontend/numberUtils';
import { useListCriteria } from '../contexts/ListViewContext';
import ListToolbar from './ListToolbar';
import { Icons } from './Icons';

interface BankAccountTableProps {
  accountSummary?: Record<string, number> | null;
  prevAccountSummary?: Record<string, number>;
  accounts?: string[];
  onChangeAccounts?: (accounts: string[]) => void;
  markDirty?: () => void;
}

const FOCUS_RING = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2';
const INPUT = `h-11 w-full rounded-sm border border-border-interactive bg-surface-2 px-space-3 text-base text-primary outline-none ${FOCUS_RING}`;
const REMOVE_BTN = `flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-border-interactive bg-surface-2 text-neg ${FOCUS_RING}`;

let accountIdCounter = 0;
const nextAccountId = () => {
  accountIdCounter += 1;
  return `bank-account-${Date.now()}-${accountIdCounter}`;
};

export default function BankAccountTable({
  accountSummary,
  prevAccountSummary = {},
  accounts = [],
  onChangeAccounts,
  markDirty
}: BankAccountTableProps) {
  const safeAccounts = Array.isArray(accounts) ? accounts : [];
  const hasPrevData = Object.values(prevAccountSummary).some(value => parseToNumber(value) > 0);

  // K13 — id คงที่ต่อแถว ไม่ใช้ index ไม่ใช้ค่าที่พิมพ์ (ทั้งสองอย่างเปลี่ยนได้ระหว่างพิมพ์/ลบกลางลิสต์)
  // sync ความยาวให้ตรงกับ safeAccounts เสมอ (เผื่อ accounts เปลี่ยนจากนอกคอมโพเนนต์ เช่น โหลดเดือนใหม่) —
  // ตัด/เติมท้ายอาเรย์เท่านั้น ไม่แตะรายการที่มีอยู่แล้ว กันไม่ให้แถวเดิม remount โดยไม่จำเป็น
  const [accountIds, setAccountIds] = useState(() => safeAccounts.map(() => nextAccountId()));
  const latestAccountsRef = useRef(safeAccounts);

  useEffect(() => {
    latestAccountsRef.current = safeAccounts;
  }, [safeAccounts]);

  useEffect(() => {
    setAccountIds((prev) => {
      if (prev.length === safeAccounts.length) return prev;
      if (prev.length < safeAccounts.length) {
        const grown = [...prev];
        while (grown.length < safeAccounts.length) grown.push(nextAccountId());
        return grown;
      }
      return prev.slice(0, safeAccounts.length);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [safeAccounts.length]);

  // ใช้ key ที่ trim แล้วตอน lookup เพื่อให้ตรงกับ key ที่ getAccountSummary สร้างไว้
  // (accounts/safeAccounts เก็บ string ดิบไว้เหมือนเดิม ไม่แตะ เพื่อไม่กระทบ rename UX)
  const normalizeKey = (value: string) => String(value || '').trim();

  const handleRenameAccount = (index: number, value: string) => {
    if (typeof onChangeAccounts !== 'function') return;
    const next = [...latestAccountsRef.current];
    next[index] = value;
    latestAccountsRef.current = next;
    onChangeAccounts(next);
  };

  const handleBlurAccount = (index: number) => {
    if (typeof onChangeAccounts !== 'function') return;
    const seen = new Set<string>();
    const normalized = [...latestAccountsRef.current]
      .map((item) => String(item || '').trim())
      .filter((item) => {
        if (!item || seen.has(item)) return false;
        seen.add(item);
        return true;
      });
    latestAccountsRef.current = normalized;
    onChangeAccounts(normalized);
  };

  const handleDeleteAccount = (index: number) => {
    if (typeof onChangeAccounts !== 'function') return;
    markDirty?.(); // K17/Finding 3 — onClick ไม่ใช่ input/change เอง ต้องสั่ง dirty ตรงนี้
    const next = [...latestAccountsRef.current].filter((_, itemIndex) => itemIndex !== index);
    latestAccountsRef.current = next;
    setAccountIds((prev) => prev.filter((_, itemIndex) => itemIndex !== index));
    onChangeAccounts(next);
  };

  const handleAddAccount = () => {
    if (typeof onChangeAccounts !== 'function') return;
    markDirty?.(); // K17/Finding 3 — เดียวกับข้างบน
    const next = [...latestAccountsRef.current, 'บัญชีใหม่'];
    latestAccountsRef.current = next;
    setAccountIds((prev) => [...prev, nextAccountId()]);
    onChangeAccounts(next);
  };

  const totalCurrent = safeAccounts.reduce((sum, account) => sum + parseToNumber(accountSummary?.[normalizeKey(account)] ?? 0), 0);
  const totalPrev = safeAccounts.reduce((sum, account) => sum + parseToNumber(prevAccountSummary?.[normalizeKey(account)] ?? 0), 0);
  const totalAll = totalCurrent + totalPrev;

  const accountRows = useMemo(() =>
    safeAccounts.map((account, index) => ({
      id: `bank-account-${index}`,
      index,
      name: account
    })),
    [safeAccounts]
  );

  const [criteria, setCriteria] = useListCriteria('bank-accounts');
  const projection = useListProjection({
    rows: accountRows,
    getId: row => row.id,
    matches: row => matchesListQuery(row.name, criteria.query),
    compare: (a, b) => compareListValues(a.name, b.name, criteria.order === 'name:desc'),
    criteriaKey: JSON.stringify(criteria),
    datasetKey: JSON.stringify(safeAccounts.map((account, index) => `${index}:${account}`).join('|')),
    editable: true
  });

  const visibleRows = projection.items;

  return (
    <div>
      <div className="mb-space-3 flex items-center justify-between gap-space-3">
        <h4 className="text-lg font-medium text-primary">บัญชีธนาคาร</h4>
        <button
          type="button"
          className={`min-h-11 rounded-sm border border-border-interactive bg-surface-2 px-space-4 text-sm font-medium text-primary transition-colors duration-fast ease-graphite hover:bg-surface-3 ${FOCUS_RING}`}
          onClick={handleAddAccount}
        >
          + เพิ่มบัญชี
        </button>
      </div>

      {/* md+: C5 table */}
      <div className="hidden overflow-x-auto rounded-md border border-border-default md:block">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-border-subtle bg-surface-2">
              <th className="p-space-3 text-left text-xs font-medium text-secondary">บัญชีธนาคาร</th>
              <th className="p-space-3 text-right text-xs font-medium text-secondary">เดือนนี้</th>
              {hasPrevData && <th className="p-space-3 text-right text-xs font-medium text-secondary">ค้างเดือนก่อน</th>}
              {hasPrevData && <th className="p-space-3 text-right text-xs font-medium text-secondary">รวม</th>}
              <th className="p-space-3 text-center text-xs font-medium text-secondary">จัดการ</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row) => {
              const index = row.index;
              const account = safeAccounts[index] ?? '';
              const current = parseToNumber(accountSummary?.[normalizeKey(account)] ?? 0) || 0;
              const prev = parseToNumber(prevAccountSummary?.[normalizeKey(account)] ?? 0) || 0;
              const total = current + prev;
              return (
                <tr key={row.id} className="border-b border-border-subtle last:border-b-0">
                  <td className="p-space-3 align-middle">
                    <input
                      type="text"
                      value={account}
                      onChange={(event) => handleRenameAccount(index, event.target.value)}
                      onBlur={() => handleBlurAccount(index)}
                      className={INPUT}
                      placeholder="ชื่อบัญชี"
                    />
                  </td>
                  <td className="p-space-3 text-right align-middle font-[family-name:var(--font-numeric)] tabular-nums text-primary">
                    {formatCurrency(current)}
                  </td>
                  {hasPrevData && (
                    <td className={`p-space-3 text-right align-middle font-[family-name:var(--font-numeric)] tabular-nums ${prev > 0 ? 'text-neg' : 'text-secondary'}`}>
                      {prev > 0 ? formatCurrency(prev) : '—'}
                    </td>
                  )}
                  {hasPrevData && (
                    <td className="p-space-3 text-right align-middle font-[family-name:var(--font-numeric)] font-semibold tabular-nums text-primary">
                      {formatCurrency(total)}
                    </td>
                  )}
                  <td className="p-space-3 text-center align-middle">
                    <button
                      type="button"
                      className={`mx-auto ${REMOVE_BTN}`}
                      onClick={() => handleDeleteAccount(index)}
                      aria-label={`ลบบัญชี ${account || 'ที่ยังไม่ตั้งชื่อ'}`}
                    >
                      <Icons.X size={16} />
                    </button>
                  </td>
                </tr>
              );
            })}
            {hasPrevData && (
              <tr className="bg-surface-2">
                <td className="p-space-3 text-sm font-semibold text-primary">รวมทั้งหมด</td>
                <td className="p-space-3 text-right font-[family-name:var(--font-numeric)] font-semibold tabular-nums text-primary">{formatCurrency(totalCurrent)}</td>
                <td className="p-space-3 text-right font-[family-name:var(--font-numeric)] font-semibold tabular-nums text-neg">{formatCurrency(totalPrev)}</td>
                <td className="p-space-3 text-right font-[family-name:var(--font-numeric)] font-semibold tabular-nums text-primary">{formatCurrency(totalAll)}</td>
                <td className="p-space-3" />
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* base tier: C4 cards */}
      <div className="flex flex-col gap-space-3 md:hidden">
        {visibleRows.map((row) => {
          const index = row.index;
          const account = safeAccounts[index] ?? '';
          const current = parseToNumber(accountSummary?.[normalizeKey(account)] ?? 0) || 0;
          const prev = parseToNumber(prevAccountSummary?.[normalizeKey(account)] ?? 0) || 0;
          const total = current + prev;
          return (
            <div key={row.id} className="min-h-14 rounded-md border border-border-default bg-surface-2 p-space-4">
              <div className="flex items-center gap-space-2">
                <input
                  type="text"
                  value={account}
                  onChange={(event) => handleRenameAccount(index, event.target.value)}
                  onBlur={() => handleBlurAccount(index)}
                  className={`${INPUT} flex-1`}
                  placeholder="ชื่อบัญชี"
                />
                <button
                  type="button"
                  className={REMOVE_BTN}
                  onClick={() => handleDeleteAccount(index)}
                  aria-label={`ลบบัญชี ${account || 'ที่ยังไม่ตั้งชื่อ'}`}
                >
                  <Icons.X size={16} />
                </button>
              </div>
              <div className="mt-space-3 flex items-center justify-between text-sm">
                <span className="text-secondary">เดือนนี้</span>
                <span className="font-[family-name:var(--font-numeric)] font-semibold tabular-nums text-primary">{formatCurrency(current)}</span>
              </div>
              {hasPrevData && (
                <>
                  <div className="mt-space-1 flex items-center justify-between text-sm">
                    <span className="text-secondary">ค้างเดือนก่อน</span>
                    <span className={`font-[family-name:var(--font-numeric)] font-semibold tabular-nums ${prev > 0 ? 'text-neg' : 'text-secondary'}`}>
                      {prev > 0 ? formatCurrency(prev) : '—'}
                    </span>
                  </div>
                  <div className="mt-space-1 flex items-center justify-between text-sm">
                    <span className="text-secondary">รวม</span>
                    <span className="font-[family-name:var(--font-numeric)] font-semibold tabular-nums text-primary">{formatCurrency(total)}</span>
                  </div>
                </>
              )}
            </div>
          );
        })}
        {hasPrevData && (
          <div className="min-h-14 rounded-md border border-accent/40 bg-accent-muted p-space-4">
            <div className="flex items-center justify-between text-sm">
              <span className="font-semibold text-primary">รวมทั้งหมด (เดือนนี้)</span>
              <span className="font-[family-name:var(--font-numeric)] font-semibold tabular-nums text-primary">{formatCurrency(totalCurrent)}</span>
            </div>
            <div className="mt-space-1 flex items-center justify-between text-sm">
              <span className="text-secondary">ค้างเดือนก่อน</span>
              <span className="font-[family-name:var(--font-numeric)] font-semibold tabular-nums text-neg">{formatCurrency(totalPrev)}</span>
            </div>
            <div className="mt-space-1 flex items-center justify-between text-sm">
              <span className="text-secondary">รวมทั้งหมด</span>
              <span className="font-[family-name:var(--font-numeric)] font-semibold tabular-nums text-primary">{formatCurrency(totalAll)}</span>
            </div>
          </div>
        )}
      </div>

      <ListToolbar
        label="บัญชีธนาคาร"
        criteria={criteria}
        onChange={setCriteria}
        orders={[
          { value: 'name:asc', label: 'ชื่อ: ก–ฮ / A–Z' },
          { value: 'name:desc', label: 'ชื่อ: ฮ–ก / Z–A' }
        ]}
        visible={visibleRows.length}
        total={safeAccounts.length}
        changed={projection.changed}
        onRefresh={projection.refresh}
        pinned={projection.pinnedIds.size}
      />
    </div>
  );
}