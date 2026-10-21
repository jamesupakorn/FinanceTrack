/**
 * คอมโพเนนต์: BankAccountTable
 * แสดงสรุปยอดโอนตามบัญชีธนาคารจากผลรวมค่าใช้จ่าย
 *
 * Graphite redesign (income-expense-graphite pass) — Tailwind-only, read-only account summary.
 */

import { useMemo } from 'react';
import Link from 'next/link';
import { compareListValues, matchesListQuery } from '../../shared/utils/frontend/listView';
import { useListProjection } from '../../shared/utils/frontend/useListProjection';
import { parseToNumber, formatCurrency } from '../../shared/utils/frontend/numberUtils';
import { toBankAccountNames } from '../../shared/utils/bankAccountShape';
import { useListCriteria } from '../contexts/ListViewContext';
import ListToolbar from './ListToolbar';

interface BankAccountTableProps {
  accountSummary?: Record<string, number> | null;
  prevAccountSummary?: Record<string, number>;
  accounts?: unknown;
}

const FOCUS_RING = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2';

export default function BankAccountTable({
  accountSummary,
  prevAccountSummary = {},
  accounts = []
}: BankAccountTableProps) {
  const safeAccounts = toBankAccountNames(accounts);
  const hasPrevData = Object.values(prevAccountSummary).some(value => parseToNumber(value) > 0);

  const normalizeKey = (value: string) => String(value || '').trim();

  const totalCurrent = safeAccounts.reduce((sum, account) => sum + parseToNumber(accountSummary?.[normalizeKey(account)] ?? 0), 0);
  const totalPrev = safeAccounts.reduce((sum, account) => sum + parseToNumber(prevAccountSummary?.[normalizeKey(account)] ?? 0), 0);
  const totalAll = totalCurrent + totalPrev;

  const accountRows = useMemo(() =>
    safeAccounts.map(account => ({
      id: `bank-account-${account}`,
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
    datasetKey: safeAccounts.join('|'),
    editable: false
  });

  const visibleRows = projection.items;

  return (
    <div>
      <div className="mb-space-3 flex items-center justify-between gap-space-3">
        <h4 className="text-lg font-medium text-primary">บัญชีธนาคาร</h4>
        <Link href="/settings#bank-accounts" className={`inline-flex min-h-11 items-center rounded-sm px-space-3 text-sm font-medium text-accent hover:underline ${FOCUS_RING}`}>
          จัดการบัญชี <span aria-hidden="true">→</span>
        </Link>
      </div>

      {safeAccounts.length === 0 ? (
        <div className="rounded-md border border-dashed border-border-default bg-sunken p-space-4 text-sm text-secondary">
          <p className="m-0">ยังไม่มีบัญชีธนาคาร</p>
          <Link href="/settings#bank-accounts" className={`mt-space-2 inline-flex min-h-11 items-center text-accent hover:underline ${FOCUS_RING}`}>
            เพิ่มบัญชีได้ที่หน้าตั้งค่า <span aria-hidden="true">→</span>
          </Link>
        </div>
      ) : (
        <>
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

      {/* md+: C5 table */}
      <div className="hidden overflow-x-auto rounded-md border border-border-default md:block">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-border-subtle bg-surface-2">
              <th className="p-space-3 text-left text-xs font-medium text-secondary">บัญชีธนาคาร</th>
              <th className="p-space-3 text-right text-xs font-medium text-secondary">เดือนนี้</th>
              {hasPrevData && <th className="p-space-3 text-right text-xs font-medium text-secondary">ค้างเดือนก่อน</th>}
              {hasPrevData && <th className="p-space-3 text-right text-xs font-medium text-secondary">รวม</th>}
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row) => {
              const account = row.name;
              const current = parseToNumber(accountSummary?.[normalizeKey(account)] ?? 0) || 0;
              const prev = parseToNumber(prevAccountSummary?.[normalizeKey(account)] ?? 0) || 0;
              const total = current + prev;
              return (
                <tr key={row.id} className="border-b border-border-subtle last:border-b-0">
                  <td className="p-space-3 align-middle font-medium text-primary">{account}</td>
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
                </tr>
              );
            })}
            {hasPrevData && (
              <tr className="bg-surface-2">
                <td className="p-space-3 text-sm font-semibold text-primary">รวมทั้งหมด</td>
                <td className="p-space-3 text-right font-[family-name:var(--font-numeric)] font-semibold tabular-nums text-primary">{formatCurrency(totalCurrent)}</td>
                <td className="p-space-3 text-right font-[family-name:var(--font-numeric)] font-semibold tabular-nums text-neg">{formatCurrency(totalPrev)}</td>
                <td className="p-space-3 text-right font-[family-name:var(--font-numeric)] font-semibold tabular-nums text-primary">{formatCurrency(totalAll)}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* base tier: C4 cards */}
      <div className="flex flex-col gap-space-3 md:hidden">
        {visibleRows.map((row) => {
          const account = row.name;
          const current = parseToNumber(accountSummary?.[normalizeKey(account)] ?? 0) || 0;
          const prev = parseToNumber(prevAccountSummary?.[normalizeKey(account)] ?? 0) || 0;
          const total = current + prev;
          return (
            <div key={row.id} className="min-h-14 rounded-md border border-border-default bg-surface-2 p-space-4">
              <p className="m-0 font-medium text-primary">{account}</p>
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

        </>
      )}
    </div>
  );
}