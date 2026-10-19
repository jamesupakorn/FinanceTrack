import type { ChartData } from './summaryUtils';

export interface ReportPayload {
  reportMonth: string;
  monthLabel: string;
  summaryData: {
    ยอดรวมรายรับรายเดือน: number;
    ยอดรวมค่าใช้จ่ายรายเดือน_ทั่วไป: number;
    ยอดรวมค่าใช้จ่ายรายเดือน_บัตรเครดิต: number;
    ยอดรวมค่าใช้จ่ายรายเดือน_รายวัน: number;
    ยอดรวมค่าใช้จ่ายรายเดือน_ยังไม่ชำระ: number;
    ยอดรวมเงินเก็บรายเดือน: number;
    ภาษีสะสมตั้งแต่เดือนแรก: number;
    ยอดเงินคงเหลือ: number;
  };
  chartData: ChartData;
  details: {
    incomeRows: { item: string; amount: number }[];
    expenseRows: { item: string; actual: number; paid: string }[];
    savingsRows: { item: string; amount: number }[];
  };
}

const escapeCell = (value: string | number): string => {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Invalid report amount');
    return value.toFixed(2);
  }
  // Protect text only; negative numeric amounts must remain numeric.
  const text = /^[\s]*[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

export function serializeReportCsv({ reportMonth, summaryData, details }: ReportPayload): string {
  const row = (category: string, label: string, amount: number, status = '') =>
    [reportMonth, category, label, amount, status];
  const rows: (string | number)[][] = [
    ['เดือน', 'หมวด', 'รายการ', 'จำนวนเงิน', 'สถานะ'],
    row('สรุป', 'รายรับรวม', summaryData.ยอดรวมรายรับรายเดือน),
    row('สรุป', 'รายจ่ายทั่วไป', summaryData.ยอดรวมค่าใช้จ่ายรายเดือน_ทั่วไป),
    row('สรุป', 'บัตรเครดิต', summaryData.ยอดรวมค่าใช้จ่ายรายเดือน_บัตรเครดิต),
    row('สรุป', 'รายจ่ายประจำวัน', summaryData.ยอดรวมค่าใช้จ่ายรายเดือน_รายวัน),
    row('สรุป', 'เงินออมรวม', summaryData.ยอดรวมเงินเก็บรายเดือน),
    row('สรุป', 'เงินคงเหลือ', summaryData.ยอดเงินคงเหลือ),
    ...details.incomeRows.map(({ item, amount }) => row('รายรับ', item, amount)),
    ...details.expenseRows.map(({ item, actual, paid }) => row('รายจ่าย', item, actual, paid)),
    ...details.savingsRows.map(({ item, amount }) => row('เงินออม', item, amount)),
    row('ภาษี', 'ภาษีสะสม', summaryData.ภาษีสะสมตั้งแต่เดือนแรก)
  ];
  return `\uFEFF${rows.map((cells) => cells.map(escapeCell).join(',')).join('\r\n')}\r\n`;
}

export function downloadSummaryReportCsv(report: ReportPayload): void {
  const blob = new Blob([serializeReportCsv(report)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  try {
    anchor.href = url;
    anchor.download = `รายงานการเงิน-${report.reportMonth}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
  } finally {
    anchor.remove();
    URL.revokeObjectURL(url);
  }
}
