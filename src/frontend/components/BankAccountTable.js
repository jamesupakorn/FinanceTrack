/**
 * คอมโพเนนต์: BankAccountTable
 * แสดงสรุปยอดโอนตามบัญชีธนาคารจากผลรวมค่าใช้จ่าย
 * @param {object} props
 * @param {object} props.accountSummary - ยอดรวมแยกตามบัญชี (เดือนนี้)
 * @param {object} props.prevAccountSummary - ยอดค้างแยกตามบัญชี (เดือนก่อน)
 */

import React from 'react';
import { parseToNumber, formatCurrency } from '../../shared/utils/frontend/numberUtils';
import styles from '../styles/ExpenseTable.module.css';

export default function BankAccountTable({ accountSummary, prevAccountSummary = {}, accounts = [], onChangeAccounts }) {
  const safeAccounts = Array.isArray(accounts) ? accounts : [];
  const hasPrevData = Object.values(prevAccountSummary).some(v => parseToNumber(v) > 0);

  const handleRenameAccount = (index, value) => {
    if (typeof onChangeAccounts !== 'function') return;
    const next = [...safeAccounts];
    next[index] = value;
    onChangeAccounts(next);
  };

  const handleBlurAccount = (index) => {
    if (typeof onChangeAccounts !== 'function') return;
    const seen = new Set();
    const normalized = safeAccounts
      .map((item) => String(item || '').trim())
      .filter((item) => {
        if (!item || seen.has(item)) return false;
        seen.add(item);
        return true;
      });
    onChangeAccounts(normalized);
  };

  const handleDeleteAccount = (index) => {
    if (typeof onChangeAccounts !== 'function') return;
    const next = safeAccounts.filter((_, itemIndex) => itemIndex !== index);
    onChangeAccounts(next);
  };

  const handleAddAccount = () => {
    if (typeof onChangeAccounts !== 'function') return;
    onChangeAccounts([...safeAccounts, 'บัญชีใหม่']);
  };

  const totalCurrent = safeAccounts.reduce((s, a) => s + parseToNumber(accountSummary?.[a]), 0);
  const totalPrev = safeAccounts.reduce((s, a) => s + parseToNumber(prevAccountSummary?.[a]), 0);
  const totalAll = totalCurrent + totalPrev;

  return (
    <div className={styles.bankAccountPanel}>
      <div className={styles.bankAccountHeader}>
        <h4 className={styles.bankAccountTitle}>บัญชีธนาคาร</h4>
        <button type="button" className={styles.addBankAccountButton} onClick={handleAddAccount}>
          + เพิ่มบัญชี
        </button>
      </div>

      <div className={styles.tableContainer}>
        <table className={styles.table}>
          <thead className={styles.tableHeader}>
            <tr>
              <th className={styles.tableHeaderCell}>บัญชีธนาคาร</th>
              <th className={`${styles.tableHeaderCell} ${styles.right}`}>เดือนนี้</th>
              {hasPrevData && (
                <th className={`${styles.tableHeaderCell} ${styles.right}`}>ค้างเดือนก่อน</th>
              )}
              {hasPrevData && (
                <th className={`${styles.tableHeaderCell} ${styles.right}`}>รวม</th>
              )}
              <th className={`${styles.tableHeaderCell} ${styles.center}`}>จัดการ</th>
            </tr>
          </thead>
          <tbody>
            {safeAccounts.map((account, index) => {
              const current = parseToNumber(accountSummary?.[account]) || 0;
              const prev = parseToNumber(prevAccountSummary?.[account]) || 0;
              const total = current + prev;
              return (
                <tr key={`bank-account-row-${index}`} className={styles.tableRow}>
                  <td className={styles.tableCell}>
                    <input
                      type="text"
                      value={account}
                      onChange={(event) => handleRenameAccount(index, event.target.value)}
                      onBlur={() => handleBlurAccount(index)}
                      className={styles.bankAccountInput}
                      placeholder="ชื่อบัญชี"
                    />
                  </td>
                  <td className={`${styles.tableCell} ${styles.right}`}>
                    {formatCurrency(current)}
                  </td>
                  {hasPrevData && (
                    <td className={`${styles.tableCell} ${styles.right} ${prev > 0 ? styles.overdueCell : ''}`}>
                      {prev > 0 ? formatCurrency(prev) : '—'}
                    </td>
                  )}
                  {hasPrevData && (
                    <td className={`${styles.tableCell} ${styles.right} ${styles.totalCell}`}>
                      {formatCurrency(total)}
                    </td>
                  )}
                  <td className={`${styles.tableCell} ${styles.center}`}>
                    <button type="button" className={styles.rowDeleteButton} onClick={() => handleDeleteAccount(index)}>
                      ลบ
                    </button>
                  </td>
                </tr>
              );
            })}
            {hasPrevData && (
              <tr className={styles.totalRow}>
                <td className={styles.tableCell}><strong>รวมทั้งหมด</strong></td>
                <td className={`${styles.tableCell} ${styles.right}`}>{formatCurrency(totalCurrent)}</td>
                <td className={`${styles.tableCell} ${styles.right} ${styles.overdueCell}`}>{formatCurrency(totalPrev)}</td>
                <td className={`${styles.tableCell} ${styles.right} ${styles.totalCell}`}><strong>{formatCurrency(totalAll)}</strong></td>
                <td className={styles.tableCell} />
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
