import type { ReactNode } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import ReportsPage from '../../pages/reports';
import {
  incomeAPI, expenseAPI, savingsAPI, salaryAPI, taxAPI, investmentAPI, dailyExpenseAPI
} from '../../src/shared/utils/frontend/apiUtils';
import { downloadSummaryReportCsv } from '../../src/shared/utils/frontend/reportCsv';
import { downloadSummaryReportPdf } from '../../src/shared/utils/frontend/reportPdf';
import { showToast } from '../../src/shared/utils/frontend/toast';
import { buildInstallmentRowKey } from '../../src/shared/utils/creditCardUtils';

let mockCurrentUser: { id: string } | null = { id: 'u001' };

jest.mock('../../src/frontend/contexts/SessionContext', () => ({
  useSession: () => ({ currentUser: mockCurrentUser })
}));
jest.mock('../../src/frontend/components/Layout', () => ({
  __esModule: true,
  default: ({ children, headerActions }: { children: ReactNode; headerActions: ReactNode }) =>
    <><header>{headerActions}</header>{children}</>
}));
jest.mock('../../src/frontend/components/SummaryReport', () => () => null);
jest.mock('../../src/frontend/components/MonthComparison', () => () => null);
jest.mock('../../src/shared/utils/frontend/toast', () => ({ showToast: jest.fn() }));
jest.mock('../../src/shared/utils/frontend/reportCsv', () => ({
  downloadSummaryReportCsv: jest.fn()
}));
jest.mock('../../src/shared/utils/frontend/reportPdf', () => ({
  downloadSummaryReportPdf: jest.fn()
}));
jest.mock('../../src/shared/utils/frontend/apiUtils', () => ({
  incomeAPI: { getAll: jest.fn(), getByMonth: jest.fn() },
  expenseAPI: { getAll: jest.fn(), getByMonth: jest.fn() },
  savingsAPI: { getAll: jest.fn(), getByMonth: jest.fn() },
  salaryAPI: { getAll: jest.fn(), getByMonth: jest.fn() },
  investmentAPI: { getAll: jest.fn() },
  dailyExpenseAPI: { getByMonth: jest.fn() },
  taxAPI: { getByYear: jest.fn() }
}));

const monthlySources = [incomeAPI, expenseAPI, savingsAPI, salaryAPI, dailyExpenseAPI];
const pdfButton = () => screen.getByRole('button', { name: 'Download Report PDF' });
const csvButton = () => screen.getByRole('button', { name: 'ดาวน์โหลด CSV' });
const error = new Error('source unavailable');

beforeEach(() => {
  jest.resetAllMocks();
  mockCurrentUser = { id: 'u001' };
  localStorage.clear();
  localStorage.setItem('edit_selected_month_u001', '2026-08');
  for (const api of [incomeAPI, expenseAPI, savingsAPI, salaryAPI]) {
    jest.mocked(api.getAll).mockResolvedValue({ months: { '2026-08': {}, '2026-07': {} } });
  }
  jest.mocked(investmentAPI.getAll).mockResolvedValue({});
  for (const api of monthlySources) jest.mocked(api.getByMonth).mockResolvedValue({});
  jest.mocked(taxAPI.getByYear).mockResolvedValue({});
  jest.mocked(downloadSummaryReportPdf).mockResolvedValue(undefined);
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

async function ready() {
  render(<ReportsPage />);
  await waitFor(() => expect(csvButton()).toBeEnabled());
  await waitFor(() => expect(pdfButton()).toBeEnabled());
}

test('CSV uses displayed month, not the PDF multi-month picker; navigation updates the next export', async () => {
  await ready();
  fireEvent.click(pdfButton());
  const dialog = screen.getByRole('dialog');
  fireEvent.click(within(dialog).getByRole('button', { name: 'เลือกทั้งหมด' }));
  fireEvent.click(within(dialog).getByRole('button', { name: 'ปิด' }));
  fireEvent.click(csvButton());
  await waitFor(() => expect(downloadSummaryReportCsv).toHaveBeenCalledTimes(1));
  expect(jest.mocked(downloadSummaryReportCsv).mock.calls[0][0].reportMonth).toBe('2026-08');
  for (const api of monthlySources) expect(api.getByMonth).toHaveBeenCalledWith('2026-08');
  expect(taxAPI.getByYear).toHaveBeenCalledWith('2026');
  expect(downloadSummaryReportPdf).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'เดือนก่อนหน้า' }));
  fireEvent.click(csvButton());
  await waitFor(() => expect(downloadSummaryReportCsv).toHaveBeenCalledTimes(2));
  expect(jest.mocked(downloadSummaryReportCsv).mock.calls[1][0].reportMonth).toBe('2026-07');
});

test('uses the shared model and existing detail mappers, preserving the report balance formula', async () => {
  jest.mocked(incomeAPI.getByMonth).mockResolvedValue({
    รวม: '130', salary: '100', income2: '25', other: '5', __labels: { income2: 'โบนัส' }, userId: 'u001'
  });
  jest.mocked(expenseAPI.getByMonth).mockResolvedValue({
    rent: { name: 'ค่าเช่า', actual: '20', paid: true },
    utilities: { actual: 10, paid: false },
    [buildInstallmentRowKey('ip_0123456789ab', 1)]: { name: 'งวดผ่อน', actual: 15, paid: 'true' },
    totalActualPaid: 999
  });
  jest.mocked(savingsAPI.getByMonth).mockResolvedValue({
    รวมเงินเก็บ: 8, savings_list: [{ savings_type: 'เงินสำรอง', savings_amount: '8' }]
  });
  jest.mocked(salaryAPI.getByMonth).mockResolvedValue({ summary: { net_income: 200 } });
  jest.mocked(dailyExpenseAPI.getByMonth).mockResolvedValue({ totalMonthly: 7 });
  jest.mocked(taxAPI.getByYear).mockResolvedValue({ '2026': { accumulated_tax: 12 } });
  await ready();
  fireEvent.click(csvButton());
  await waitFor(() => expect(downloadSummaryReportCsv).toHaveBeenCalledTimes(1));
  const report = jest.mocked(downloadSummaryReportCsv).mock.calls[0][0];
  expect(report.summaryData).toEqual({
    ยอดรวมรายรับรายเดือน: 230,
    ยอดรวมค่าใช้จ่ายรายเดือน_ทั่วไป: 30,
    ยอดรวมค่าใช้จ่ายรายเดือน_บัตรเครดิต: 15,
    ยอดรวมค่าใช้จ่ายรายเดือน_รายวัน: 7,
    ยอดรวมค่าใช้จ่ายรายเดือน_ยังไม่ชำระ: 10,
    ยอดรวมเงินเก็บรายเดือน: 8,
    ภาษีสะสมตั้งแต่เดือนแรก: 12,
    ยอดเงินคงเหลือ: 185
  });
  expect(report.details).toEqual({
    incomeRows: [
      { item: 'เงินเดือน', amount: 100 }, { item: 'โบนัส', amount: 25 }, { item: 'อื่นๆ', amount: 5 }
    ],
    expenseRows: [
      { item: 'ค่าเช่า', actual: 20, paid: 'ชำระแล้ว' },
      { item: 'utilities', actual: 10, paid: 'ยังไม่ชำระ' },
      { item: 'งวดผ่อน', actual: 15, paid: 'ชำระแล้ว' }
    ],
    savingsRows: [{ item: 'เงินสำรอง', amount: 8 }]
  });
});

test.each([
  ['income', incomeAPI.getByMonth], ['expense', expenseAPI.getByMonth],
  ['savings', savingsAPI.getByMonth], ['salary', salaryAPI.getByMonth],
  ['daily expense', dailyExpenseAPI.getByMonth], ['tax', taxAPI.getByYear]
])('aborts CSV on %s failure, toasts, clears busy, and allows a successful retry', async (_name, request) => {
  jest.mocked(request).mockRejectedValueOnce(error);
  await ready();
  fireEvent.click(csvButton());
  await waitFor(() => expect(showToast).toHaveBeenCalledWith(
    'ไม่สามารถดาวน์โหลดรายงาน CSV ได้ กรุณาลองใหม่', 'error'
  ));
  expect(downloadSummaryReportCsv).not.toHaveBeenCalled();
  expect(csvButton()).toBeEnabled();
  expect(pdfButton()).toBeEnabled();
  fireEvent.click(csvButton());
  await waitFor(() => expect(downloadSummaryReportCsv).toHaveBeenCalledTimes(1));
});

test('successful empty sources produce normal zero summary with no detail rows', async () => {
  await ready();
  fireEvent.click(csvButton());
  await waitFor(() => expect(downloadSummaryReportCsv).toHaveBeenCalledTimes(1));
  const report = jest.mocked(downloadSummaryReportCsv).mock.calls[0][0];
  expect(Object.values(report.summaryData)).toEqual(Array(8).fill(0));
  expect(report.details).toEqual({ incomeRows: [], expenseRows: [], savingsRows: [] });
});

test.each([
  ['income', incomeAPI.getByMonth], ['expense', expenseAPI.getByMonth],
  ['savings', savingsAPI.getByMonth], ['salary', salaryAPI.getByMonth],
  ['daily expense', dailyExpenseAPI.getByMonth], ['tax', taxAPI.getByYear]
])('rejects unreadable %s JSON (API client null) instead of exporting zero-filled CSV', async (_name, request) => {
  jest.mocked(request).mockResolvedValueOnce(null);
  await ready();
  fireEvent.click(csvButton());
  await waitFor(() => expect(showToast).toHaveBeenCalledWith(
    'ไม่สามารถดาวน์โหลดรายงาน CSV ได้ กรุณาลองใหม่', 'error'
  ));
  expect(downloadSummaryReportCsv).not.toHaveBeenCalled();
  expect(csvButton()).toBeEnabled();
  expect(pdfButton()).toBeEnabled();
});

test('CSV busy state blocks both formats and duplicate clicks, keeping the captured month', async () => {
  let resolveTax!: (value: object) => void;
  jest.mocked(taxAPI.getByYear).mockReturnValueOnce(new Promise((resolve) => { resolveTax = resolve; }));
  await ready();
  const csv = csvButton();
  act(() => { csv.click(); csv.click(); });
  expect(screen.getByRole('button', { name: 'กำลังสร้าง CSV...' })).toBeDisabled();
  expect(pdfButton()).toBeDisabled();
  fireEvent.click(pdfButton());
  fireEvent.click(screen.getByRole('button', { name: 'เดือนก่อนหน้า' }));
  await act(async () => { resolveTax({}); });
  expect(downloadSummaryReportCsv).toHaveBeenCalledTimes(1);
  expect(jest.mocked(downloadSummaryReportCsv).mock.calls[0][0].reportMonth).toBe('2026-08');
  expect(taxAPI.getByYear).toHaveBeenCalledTimes(1);
  expect(csvButton()).toBeEnabled();
});

test('PDF keeps multi-month selection and fallback behavior, with shared busy state', async () => {
  for (const api of monthlySources) jest.mocked(api.getByMonth).mockRejectedValue(error);
  jest.mocked(taxAPI.getByYear).mockRejectedValue(error);
  let finishPdf!: () => void;
  jest.mocked(downloadSummaryReportPdf).mockReturnValueOnce(new Promise((resolve) => { finishPdf = resolve; }));
  await ready();
  fireEvent.click(pdfButton());
  fireEvent.click(screen.getByRole('button', { name: 'เลือกทั้งหมด' }));
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'ดาวน์โหลดรายงาน' }));
  await waitFor(() => expect(downloadSummaryReportPdf).toHaveBeenCalledTimes(1));
  expect(csvButton()).toBeDisabled();
  expect(screen.getByRole('button', { name: 'กำลังสร้าง PDF...' })).toBeDisabled();
  fireEvent.click(csvButton());
  expect(downloadSummaryReportCsv).not.toHaveBeenCalled();
  const reports = jest.mocked(downloadSummaryReportPdf).mock.calls[0][0]?.reportItems;
  if (!reports) throw new Error('Expected PDF report items');
  expect(reports.map(({ reportMonth }) => reportMonth)).toEqual(['2026-08', '2026-07']);
  expect(reports[0].summaryData?.ยอดเงินคงเหลือ).toBe(0);
  expect(showToast).not.toHaveBeenCalled();
  await act(async () => { finishPdf(); });
  expect(csvButton()).toBeEnabled();
  expect(pdfButton()).toBeEnabled();
});

test('CSV generation failures are reported and busy state clears', async () => {
  jest.mocked(downloadSummaryReportCsv).mockImplementationOnce(() => { throw error; });
  await ready();
  fireEvent.click(csvButton());
  await waitFor(() => expect(showToast).toHaveBeenCalledWith(
    'ไม่สามารถดาวน์โหลดรายงาน CSV ได้ กรุณาลองใหม่', 'error'
  ));
  expect(csvButton()).toBeEnabled();
  expect(pdfButton()).toBeEnabled();
});

test('CSV is disabled without a selected month and never fabricates a filename', () => {
  mockCurrentUser = null;
  render(<ReportsPage />);
  expect(csvButton()).toBeDisabled();
  fireEvent.click(csvButton());
  expect(downloadSummaryReportCsv).not.toHaveBeenCalled();
  expect(taxAPI.getByYear).not.toHaveBeenCalled();
});

test('PDF generation errors toast and release both export controls', async () => {
  jest.mocked(downloadSummaryReportPdf).mockRejectedValueOnce(error);
  await ready();
  fireEvent.click(pdfButton());
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'ดาวน์โหลดรายงาน' }));
  await waitFor(() => expect(showToast).toHaveBeenCalledWith(
    'ไม่สามารถดาวน์โหลดรายงาน PDF ได้ กรุณาลองใหม่', 'error'
  ));
  expect(csvButton()).toBeEnabled();
  expect(pdfButton()).toBeEnabled();
});
