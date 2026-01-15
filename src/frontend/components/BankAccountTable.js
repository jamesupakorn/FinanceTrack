import React from 'react';
import { maskNumberFormat, parseToNumber, formatCurrency } from '../../shared/utils/frontend/numberUtils';
import styles from '../styles/ExpenseTable.module.css';

export default function BankAccountTable({ accountSummary, mode = 'view' }) {
  return (
    <div className={styles.tableContainer}>
      <table className={styles.table}>
        <thead className={styles.tableHeader}>
          <tr>
            <th className={styles.tableHeaderCell}>บัญชีธนาคาร</th>
            <th className={`${styles.tableHeaderCell} ${styles.right}`}>ยอดโอน</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(accountSummary).map(([account, sum]) => (
            <tr key={account} className={styles.tableRow}>
              <td className={styles.tableCell}>{account}</td>
              <td className={`${styles.tableCell} ${styles.right}`}>{(() => {
                const value = parseToNumber(sum);
                if (value === 0) return '0';
                return mode === 'edit' ? formatCurrency(value) : maskNumberFormat(value);
              })()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
