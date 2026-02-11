import React from 'react';
import { parseToNumber, formatCurrency } from '../../shared/utils/frontend/numberUtils';
import styles from '../styles/ExpenseTable.module.css';

export default function BankAccountTable({ accountSummary }) {
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
              <td className={`${styles.tableCell} ${styles.right}`}>
                {formatCurrency(parseToNumber(sum) || 0)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
