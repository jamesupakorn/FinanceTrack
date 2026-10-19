import {
  downloadSummaryReportCsv, serializeReportCsv, type ReportPayload
} from '../../../src/shared/utils/frontend/reportCsv';
import { getChartData } from '../../../src/shared/utils/frontend/summaryUtils';

const report: ReportPayload = {
  reportMonth: '2026-08',
  monthLabel: 'สิงหาคม 2569',
  chartData: getChartData({ totalIncome: 52000, totalExpenseActual: 15000 }),
  summaryData: {
    ยอดรวมรายรับรายเดือน: 52000,
    ยอดรวมค่าใช้จ่ายรายเดือน_ทั่วไป: 12000,
    ยอดรวมค่าใช้จ่ายรายเดือน_บัตรเครดิต: 3000,
    ยอดรวมค่าใช้จ่ายรายเดือน_รายวัน: 500,
    ยอดรวมค่าใช้จ่ายรายเดือน_ยังไม่ชำระ: 999,
    ยอดรวมเงินเก็บรายเดือน: 8000,
    ภาษีสะสมตั้งแต่เดือนแรก: 1200,
    ยอดเงินคงเหลือ: 37000
  },
  details: {
    incomeRows: [{ item: 'เงินเดือน', amount: 52000 }],
    expenseRows: [
      { item: 'ค่าเช่า', actual: 12000, paid: 'ชำระแล้ว' },
      { item: 'บัตรเครดิต', actual: 3000, paid: 'ยังไม่ชำระ' }
    ],
    savingsRows: [{ item: 'กองทุนสำรอง', amount: 8000 }]
  }
};

test('serializes the exact rectangular report, BOM, CRLF, six summaries, details and tax', () => {
  expect(serializeReportCsv(report)).toBe('\uFEFF' + [
    'เดือน,หมวด,รายการ,จำนวนเงิน,สถานะ',
    '2026-08,สรุป,รายรับรวม,52000.00,',
    '2026-08,สรุป,รายจ่ายทั่วไป,12000.00,',
    '2026-08,สรุป,บัตรเครดิต,3000.00,',
    '2026-08,สรุป,รายจ่ายประจำวัน,500.00,',
    '2026-08,สรุป,เงินออมรวม,8000.00,',
    '2026-08,สรุป,เงินคงเหลือ,37000.00,',
    '2026-08,รายรับ,เงินเดือน,52000.00,',
    '2026-08,รายจ่าย,ค่าเช่า,12000.00,ชำระแล้ว',
    '2026-08,รายจ่าย,บัตรเครดิต,3000.00,ยังไม่ชำระ',
    '2026-08,เงินออม,กองทุนสำรอง,8000.00,',
    '2026-08,ภาษี,ภาษีสะสม,1200.00,',
    ''
  ].join('\r\n'));
});

test('quotes commas, double quotes, CR and LF without changing saved labels', () => {
  const item = 'ค่าอาหาร, "ไทย"\r\nมื้อเย็น';
  const input = { ...report, details: { ...report.details, incomeRows: [{ item, amount: 12.345 }] } };
  expect(serializeReportCsv(input)).toContain('2026-08,รายรับ,"ค่าอาหาร, ""ไทย""\r\nมื้อเย็น",12.35,\r\n');
  expect(input.details.incomeRows[0].item).toBe(item);
});

test.each(['=1+1', '+SUM(A1)', '-1+2', '@SUM(A1)', '\tformula', '\rformula', '  =1', '\n=1'])(
  'neutralizes formula-like text %j but keeps negative numbers numeric',
  (item) => {
    const csv = serializeReportCsv({
      ...report, details: { incomeRows: [], savingsRows: [], expenseRows: [{ item, actual: -10, paid: 'ยังไม่ชำระ' }] }
    });
    const escaped = `'${item}`.replace(/"/g, '""');
    expect(csv).toContain(`${/[\r\n,"]/.test(item) ? `"${escaped}"` : escaped},-10.00,ยังไม่ชำระ\r\n`);
  }
);

test('empty details emit only header, six summaries and tax, with no synthetic detail row', () => {
  const csv = serializeReportCsv({ ...report, details: { incomeRows: [], expenseRows: [], savingsRows: [] } });
  expect(csv.trimEnd().split('\r\n')).toHaveLength(8);
});

test('rejects non-finite amounts instead of exporting a success-shaped value', () => {
  expect(() => serializeReportCsv({
    ...report, details: { ...report.details, incomeRows: [{ item: 'invalid', amount: NaN }] }
  })).toThrow('Invalid report amount');
});

describe('browser download', () => {
  let anchor: HTMLAnchorElement | undefined;
  beforeEach(() => {
    URL.createObjectURL = jest.fn(() => 'blob:csv');
    URL.revokeObjectURL = jest.fn();
    jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      anchor = this;
    });
  });
  afterEach(() => jest.restoreAllMocks());

  test('downloads a UTF-8 BOM file with the selected-month filename and cleans up', async () => {
    downloadSummaryReportCsv(report);
    expect(anchor?.download).toBe('รายงานการเงิน-2026-08.csv');
    expect(anchor?.href).toBe('blob:csv');
    expect(anchor?.isConnected).toBe(false);
    const blob = jest.mocked(URL.createObjectURL).mock.calls[0][0] as Blob;
    expect(blob.type).toBe('text/csv;charset=utf-8');
    const bytes = await new Promise<ArrayBuffer>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.readAsArrayBuffer(blob);
    });
    expect(Array.from(new Uint8Array(bytes).slice(0, 3))).toEqual([0xef, 0xbb, 0xbf]);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:csv');
  });

  test('cleans up and propagates download failures to the caller', () => {
    jest.mocked(HTMLAnchorElement.prototype.click).mockImplementation(() => { throw new Error('blocked'); });
    expect(() => downloadSummaryReportCsv(report)).toThrow('blocked');
    expect(document.querySelector('a[download]')).toBeNull();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:csv');
  });
});
