/**
 * คอมโพเนนต์: BankAccountTable
 * แสดงสรุปยอดโอนตามบัญชีธนาคารจากผลรวมค่าใช้จ่าย
 * @param {object} props
 * @param {object} props.accountSummary - ยอดรวมแยกตามบัญชี
 */

import React from 'react';
import { parseToNumber, formatCurrency } from '../../shared/utils/frontend/numberUtils';
import styles from '../styles/ExpenseTable.module.css';

/**
 * ตารางสรุปยอดโอนรายบัญชี
 */
export default function BankAccountTable({ accountSummary, accounts = [], onChangeAccounts }) {
  const safeAccounts = Array.isArray(accounts) ? accounts : [];

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
    if (!normalized.length) {
      normalized.push('ไม่ระบุบัญชี');
    }
    onChangeAccounts(normalized);
  };

  const handleDeleteAccount = (index) => {
    if (typeof onChangeAccounts !== 'function') return;
    const next = safeAccounts.filter((_, itemIndex) => itemIndex !== index);
    onChangeAccounts(next.length ? next : ['ไม่ระบุบัญชี']);
  };

  const handleAddAccount = () => {
    if (typeof onChangeAccounts !== 'function') return;
    onChangeAccounts([...safeAccounts, '']);
  };

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
              <th className={`${styles.tableHeaderCell} ${styles.right}`}>ยอดโอน</th>
              <th className={`${styles.tableHeaderCell} ${styles.center}`}>จัดการ</th>
            </tr>
          </thead>
          <tbody>
            {safeAccounts.map((account, index) => (
              <tr key={`${account}-${index}`} className={styles.tableRow}>
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
                  {formatCurrency(parseToNumber(accountSummary?.[account]) || 0)}
                </td>
                <td className={`${styles.tableCell} ${styles.center}`}>
                  <button type="button" className={styles.rowDeleteButton} onClick={() => handleDeleteAccount(index)}>
                    ลบ
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
