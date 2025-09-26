import React from 'react';
import { formatCurrency } from '../../shared/utils/numberUtils';
import styles from '../styles/ExpenseTable.module.css';

export default function BankAccountTable({ accountSummary }) {
  // Ensure all currency display uses formatCurrency
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
              <td className={`${styles.tableCell} ${styles.right}`}>{formatCurrency(sum)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
