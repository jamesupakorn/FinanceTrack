/**
 * คอมโพเนนต์: BankAccountTable
 * แสดงสรุปยอดโอนตามบัญชีธนาคารจากผลรวมค่าใช้จ่าย
 *
 * Graphite redesign (income-expense-graphite pass) — Tailwind-only.
 * ตัวเลขเดือนนี้/ค้างเดือนก่อนของแต่ละบัญชีเป็นปุ่มเปิด panel แจกแจงยอด (AccountBreakdownPanel)
 * ตัวเลขทุกตัวอ่านจาก breakdown.total ของ object เดียวกับที่ panel ใช้ — ไม่รวมยอดซ้ำฝั่ง UI
 */

import { Fragment, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import Link from 'next/link';
import type { MonthKey } from '../../shared/types/domain';
import type { AccountBreakdown } from '../../shared/utils/commonUtils';
import { compareListValues, matchesListQuery } from '../../shared/utils/frontend/listView';
import { useListProjection } from '../../shared/utils/frontend/useListProjection';
import { parseToNumber, formatCurrency } from '../../shared/utils/frontend/numberUtils';
import { formatMonthKeyTH } from '../../shared/utils/dateUtils';
import { toBankAccountNames } from '../../shared/utils/bankAccountShape';
import { useListCriteria } from '../contexts/ListViewContext';
import ListToolbar from './ListToolbar';
import AccountBreakdownPanel, { Chevron } from './AccountBreakdownPanel';

interface BankAccountTableProps {
  accountBreakdown?: Record<string, AccountBreakdown> | null;
  prevAccountBreakdown?: Record<string, AccountBreakdown>;
  accounts?: unknown;
  /** selectedMonth — ใช้กับข้อความครบกำหนด/รอบบิล */
  monthKey?: MonthKey | null;
  /** เดือนก่อนของ selectedMonth */
  prevMonthKey?: MonthKey | null;
}

// ค้างเดือนก่อน: บวก = text-neg (ค้างจ่าย), ลบ (เช่นคืนเงิน) = ตัวเลขมีเครื่องหมายโทนปกติ, 0 = '—'
const prevTone = (prev: number) => (prev > 0 ? 'text-neg' : prev < 0 ? 'text-primary' : 'text-secondary');

type Column = 'cur' | 'prev';
type Layout = 't' | 'c';

const FOCUS_RING = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2';
const TRIGGER_MOTION = 'transition-colors duration-fast ease-graphite motion-reduce:transition-none';
const NUMERIC = 'font-[family-name:var(--font-numeric)] tabular-nums';
const EMPTY_BREAKDOWN: Record<string, AccountBreakdown> = {};

const triggerLabel = (column: Column, account: string): string =>
  ` แจกแจงยอด${column === 'cur' ? 'เดือนนี้' : 'ค้างเดือนก่อน'}ของบัญชี ${account}`;

export default function BankAccountTable({
  accountBreakdown,
  prevAccountBreakdown = EMPTY_BREAKDOWN,
  accounts = [],
  monthKey = null,
  prevMonthKey = null
}: BankAccountTableProps) {
  const safeAccounts = toBankAccountNames(accounts);
  const hasPrevData = Object.values(prevAccountBreakdown).some(bucket => parseToNumber(bucket?.total) > 0);

  const normalizeKey = (value: string) => String(value || '').trim();
  const totalOf = (breakdown: Record<string, AccountBreakdown> | null | undefined, account: string): number =>
    parseToNumber(breakdown?.[normalizeKey(account)]?.total ?? 0) || 0;

  const totalCurrent = safeAccounts.reduce((sum, account) => sum + totalOf(accountBreakdown, account), 0);
  const totalPrev = safeAccounts.reduce((sum, account) => sum + totalOf(prevAccountBreakdown, account), 0);
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

  // I-1: เปิดได้ทีละ panel · I-5: reset เมื่อเดือนเปลี่ยน / บัญชีหายจากรายการที่เห็น / คอลัมน์ค้างเดือนก่อนหาย
  const baseId = useId();
  const [open, setOpen] = useState<{ account: string; column: Column } | null>(null);
  const activeOpen = open
    && visibleRows.some(row => row.name === open.account)
    && (open.column === 'cur' || hasPrevData)
    ? open
    : null;
  const triggerRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const lastTriggerKey = useRef<string | null>(null);

  useEffect(() => { setOpen(null); }, [monthKey]);
  useEffect(() => {
    if (open && !activeOpen) setOpen(null);
  }, [open, activeOpen]);

  const triggerKey = (layout: Layout, column: Column, index: number) => `${layout}-${column}-${index}`;
  const panelIdOf = (layout: Layout, column: Column, index: number) => `${baseId}-${triggerKey(layout, column, index)}`;
  const setTriggerRef = (key: string) => (node: HTMLButtonElement | null) => {
    if (node) triggerRefs.current.set(key, node);
    else triggerRefs.current.delete(key);
  };

  /** คืน focus ให้ปุ่มที่เปิด panel — ถ้าปุ่มนั้นซ่อนอยู่ (display:none) ใช้ปุ่มของ layout ที่มองเห็นแทน */
  const closePanel = () => {
    const key = lastTriggerKey.current;
    setOpen(null);
    if (!key) return;
    let target = triggerRefs.current.get(key) ?? null;
    if (!target || !target.isConnected || target.offsetParent === null) {
      const [layout, column, index] = key.split('-');
      const otherKey = triggerKey(layout === 't' ? 'c' : 't', column as Column, Number(index));
      const other = triggerRefs.current.get(otherKey);
      if (other && other.isConnected && other.offsetParent !== null) target = other;
    }
    target?.focus();
  };

  const toggle = (account: string, column: Column, key: string) => {
    lastTriggerKey.current = key;
    setOpen(previous => (previous && previous.account === account && previous.column === column ? null : { account, column }));
  };

  const handleTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>, isOpen: boolean) => {
    if (event.key !== 'Escape' || !isOpen) return;
    event.stopPropagation();
    closePanel();
  };

  const renderPanel = (layout: Layout, column: Column, account: string, index: number) => {
    const id = panelIdOf(layout, column, index);
    const breakdownMap = column === 'cur' ? accountBreakdown : prevAccountBreakdown;
    return (
      <AccountBreakdownPanel
        id={id}
        titleId={`${id}-title`}
        columnLabel={column === 'cur' ? 'เดือนนี้' : `ค้างเดือนก่อน${prevMonthKey ? ` (${formatMonthKeyTH(prevMonthKey)})` : ''}`}
        account={account}
        breakdown={breakdownMap?.[normalizeKey(account)]}
        columnMonthKey={column === 'cur' ? monthKey : prevMonthKey}
        onClose={closePanel}
      />
    );
  };

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
              const index = safeAccounts.indexOf(account);
              const current = totalOf(accountBreakdown, account);
              const prev = totalOf(prevAccountBreakdown, account);
              const total = current + prev;
              const curKey = triggerKey('t', 'cur', index);
              const prevKey = triggerKey('t', 'prev', index);
              const curOpen = activeOpen?.account === account && activeOpen.column === 'cur';
              const prevOpen = activeOpen?.account === account && activeOpen.column === 'prev';
              return (
                <Fragment key={row.id}>
                  <tr className="border-b border-border-subtle last:border-b-0">
                    <td className="p-space-3 align-middle font-medium text-primary">{account}</td>
                    <td className="p-space-1 text-right align-middle">
                      <button
                        type="button"
                        ref={setTriggerRef(curKey)}
                        aria-expanded={curOpen}
                        aria-controls={panelIdOf('t', 'cur', index)}
                        onClick={() => toggle(account, 'cur', curKey)}
                        onKeyDown={(event) => handleTriggerKeyDown(event, curOpen)}
                        className={`inline-flex min-h-11 w-full items-center justify-end gap-space-2 rounded-sm px-space-2 hover:bg-surface-3 ${TRIGGER_MOTION} ${FOCUS_RING}`}
                      >
                        <Chevron open={curOpen} />
                        <span className={`${NUMERIC} text-primary`}>{formatCurrency(current)}</span>
                        <span className="sr-only">{triggerLabel('cur', account)}</span>
                      </button>
                    </td>
                    {hasPrevData && (
                      <td className="p-space-1 text-right align-middle">
                        <button
                          type="button"
                          ref={setTriggerRef(prevKey)}
                          aria-expanded={prevOpen}
                          aria-controls={panelIdOf('t', 'prev', index)}
                          onClick={() => toggle(account, 'prev', prevKey)}
                          onKeyDown={(event) => handleTriggerKeyDown(event, prevOpen)}
                          className={`inline-flex min-h-11 w-full items-center justify-end gap-space-2 rounded-sm px-space-2 hover:bg-surface-3 ${TRIGGER_MOTION} ${FOCUS_RING}`}
                        >
                          <Chevron open={prevOpen} />
                          <span className={`${NUMERIC} ${prevTone(prev)}`}>{prev > 0 || prev < 0 ? formatCurrency(prev) : '—'}</span>
                          <span className="sr-only">{triggerLabel('prev', account)}</span>
                        </button>
                      </td>
                    )}
                    {hasPrevData && (
                      <td className={`p-space-3 text-right align-middle ${NUMERIC} font-semibold text-primary`}>
                        {formatCurrency(total)}
                      </td>
                    )}
                  </tr>
                  {(curOpen || prevOpen) && (
                    <tr className="border-b border-border-subtle last:border-b-0">
                      <td colSpan={hasPrevData ? 4 : 2} className="bg-sunken p-space-3">
                        {renderPanel('t', curOpen ? 'cur' : 'prev', account, index)}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {hasPrevData && (
              <tr className="bg-surface-2">
                <td className="p-space-3 text-sm font-semibold text-primary">รวมทั้งหมด</td>
                <td className={`p-space-3 text-right ${NUMERIC} font-semibold text-primary`}>{formatCurrency(totalCurrent)}</td>
                <td className={`p-space-3 text-right ${NUMERIC} font-semibold text-neg`}>{formatCurrency(totalPrev)}</td>
                <td className={`p-space-3 text-right ${NUMERIC} font-semibold text-primary`}>{formatCurrency(totalAll)}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* base tier: C4 cards */}
      <div className="flex flex-col gap-space-3 md:hidden">
        {visibleRows.map((row) => {
          const account = row.name;
          const index = safeAccounts.indexOf(account);
          const current = totalOf(accountBreakdown, account);
          const prev = totalOf(prevAccountBreakdown, account);
          const total = current + prev;
          const curKey = triggerKey('c', 'cur', index);
          const prevKey = triggerKey('c', 'prev', index);
          const curOpen = activeOpen?.account === account && activeOpen.column === 'cur';
          const prevOpen = activeOpen?.account === account && activeOpen.column === 'prev';
          return (
            <div key={row.id} className="min-h-14 rounded-md border border-border-default bg-surface-2 p-space-4">
              <p className="m-0 font-medium text-primary">{account}</p>
              <button
                type="button"
                ref={setTriggerRef(curKey)}
                aria-expanded={curOpen}
                aria-controls={panelIdOf('c', 'cur', index)}
                onClick={() => toggle(account, 'cur', curKey)}
                onKeyDown={(event) => handleTriggerKeyDown(event, curOpen)}
                className={`mt-space-3 flex min-h-11 w-full items-center justify-between rounded-sm text-sm hover:bg-surface-3 ${TRIGGER_MOTION} ${FOCUS_RING}`}
              >
                <span className="flex items-center gap-space-2">
                  <span className="text-secondary">เดือนนี้</span>
                  <Chevron open={curOpen} />
                </span>
                <span className={`${NUMERIC} font-semibold text-primary`}>{formatCurrency(current)}</span>
                <span className="sr-only">{triggerLabel('cur', account)}</span>
              </button>
              {curOpen && (
                <div className="mt-space-2 border-t border-border-subtle pt-space-2">
                  {renderPanel('c', 'cur', account, index)}
                </div>
              )}
              {hasPrevData && (
                <>
                  <button
                    type="button"
                    ref={setTriggerRef(prevKey)}
                    aria-expanded={prevOpen}
                    aria-controls={panelIdOf('c', 'prev', index)}
                    onClick={() => toggle(account, 'prev', prevKey)}
                    onKeyDown={(event) => handleTriggerKeyDown(event, prevOpen)}
                    className={`mt-space-1 flex min-h-11 w-full items-center justify-between rounded-sm text-sm hover:bg-surface-3 ${TRIGGER_MOTION} ${FOCUS_RING}`}
                  >
                    <span className="flex items-center gap-space-2">
                      <span className="text-secondary">ค้างเดือนก่อน</span>
                      <Chevron open={prevOpen} />
                    </span>
                    <span className={`${NUMERIC} font-semibold ${prevTone(prev)}`}>{prev > 0 || prev < 0 ? formatCurrency(prev) : '—'}</span>
                    <span className="sr-only">{triggerLabel('prev', account)}</span>
                  </button>
                  {prevOpen && (
                    <div className="mt-space-2 border-t border-border-subtle pt-space-2">
                      {renderPanel('c', 'prev', account, index)}
                    </div>
                  )}
                  <div className="mt-space-1 flex items-center justify-between text-sm">
                    <span className="text-secondary">รวม</span>
                    <span className={`${NUMERIC} font-semibold text-primary`}>{formatCurrency(total)}</span>
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
              <span className={`${NUMERIC} font-semibold text-primary`}>{formatCurrency(totalCurrent)}</span>
            </div>
            <div className="mt-space-1 flex items-center justify-between text-sm">
              <span className="text-secondary">ค้างเดือนก่อน</span>
              <span className={`${NUMERIC} font-semibold text-neg`}>{formatCurrency(totalPrev)}</span>
            </div>
            <div className="mt-space-1 flex items-center justify-between text-sm">
              <span className="text-secondary">รวมทั้งหมด</span>
              <span className={`${NUMERIC} font-semibold text-primary`}>{formatCurrency(totalAll)}</span>
            </div>
          </div>
        )}
      </div>

        </>
      )}
    </div>
  );
}
