const toNumericValue = (value) => {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0;
  }
  if (typeof value === 'string') {
    const numeric = Number(value.replace(/,/g, '').trim());
    return Number.isFinite(numeric) ? numeric : 0;
  }
  return 0;
};

const formatAmountForPdf = (value) => {
  const numericValue = toNumericValue(value);
  return `${numericValue.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })} บาท`;
};

const formatPercentForPdf = (value) => `${toNumericValue(value).toFixed(2)}%`;
const toPercentInRange = (value) => Math.max(0, Math.min(100, toNumericValue(value)));

const createExpenseRatioChartImage = ({ title, expensePercent }) => {
  if (typeof document === 'undefined') {
    return null;
  }

  const canvas = document.createElement('canvas');
  canvas.width = 320;
  canvas.height = 220;

  const context = canvas.getContext('2d');
  if (!context) {
    return null;
  }

  const chartExpensePercent = toPercentInRange(expensePercent);
  const chartIncomePercent = Math.max(0, 100 - chartExpensePercent);

  const centerX = 160;
  const centerY = 110;
  const radius = 62;
  const lineWidth = 26;
  const startAngle = -Math.PI / 2;
  const fullAngle = Math.PI * 2;
  const incomeAngle = (chartIncomePercent / 100) * fullAngle;

  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);

  context.textAlign = 'center';
  context.fillStyle = '#1f2937';
  context.font = '700 24px Sarabun, sans-serif';
  context.fillText(title, centerX, 32);

  context.lineWidth = lineWidth;
  context.lineCap = 'butt';

  context.strokeStyle = '#e5e7eb';
  context.beginPath();
  context.arc(centerX, centerY, radius, 0, fullAngle);
  context.stroke();

  if (chartIncomePercent > 0) {
    context.strokeStyle = '#4df0c3';
    context.beginPath();
    context.arc(centerX, centerY, radius, startAngle, startAngle + incomeAngle);
    context.stroke();
  }

  if (chartExpensePercent > 0) {
    context.strokeStyle = '#ff7aa2';
    context.beginPath();
    context.arc(centerX, centerY, radius, startAngle + incomeAngle, startAngle + fullAngle);
    context.stroke();
  }

  context.fillStyle = '#111827';
  context.font = '700 28px Sarabun, sans-serif';
  context.fillText(`${chartExpensePercent.toFixed(2)}%`, centerX, 116);

  context.fillStyle = '#6b7280';
  context.font = '500 18px Sarabun, sans-serif';
  context.fillText('รายจ่าย', centerX, 140);

  const legendY = 188;

  context.fillStyle = '#4df0c3';
  context.fillRect(48, legendY - 10, 14, 14);
  context.fillStyle = '#111827';
  context.textAlign = 'left';
  context.font = '500 15px Sarabun, sans-serif';
  context.fillText(`รับ ${chartIncomePercent.toFixed(2)}%`, 68, legendY + 2);

  context.fillStyle = '#ff7aa2';
  context.fillRect(182, legendY - 10, 14, 14);
  context.fillStyle = '#111827';
  context.fillText(`จ่าย ${chartExpensePercent.toFixed(2)}%`, 202, legendY + 2);

  return canvas.toDataURL('image/png');
};

const THAI_FONT_FAMILY = 'Sarabun';
const THAI_FONT_REGULAR_FILE = 'Sarabun-Regular.ttf';
const THAI_FONT_BOLD_FILE = 'Sarabun-Bold.ttf';
let cachedThaiFontPayload = null;

const arrayBufferToBase64 = (arrayBuffer) => {
  const bytes = new Uint8Array(arrayBuffer);
  const chunkSize = 0x8000;
  let binary = '';
  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
};

const loadThaiFontPayload = async () => {
  if (cachedThaiFontPayload) {
    return cachedThaiFontPayload;
  }
  const [regularResponse, boldResponse] = await Promise.all([
    fetch('/fonts/Sarabun-Regular.ttf'),
    fetch('/fonts/Sarabun-Bold.ttf')
  ]);

  if (!regularResponse.ok || !boldResponse.ok) {
    throw new Error('Unable to load Thai font files');
  }

  const [regularBuffer, boldBuffer] = await Promise.all([
    regularResponse.arrayBuffer(),
    boldResponse.arrayBuffer()
  ]);

  cachedThaiFontPayload = {
    regularBase64: arrayBufferToBase64(regularBuffer),
    boldBase64: arrayBufferToBase64(boldBuffer)
  };

  return cachedThaiFontPayload;
};

const registerThaiFont = async (doc) => {
  try {
    const { regularBase64, boldBase64 } = await loadThaiFontPayload();
    doc.addFileToVFS(THAI_FONT_REGULAR_FILE, regularBase64);
    doc.addFont(THAI_FONT_REGULAR_FILE, THAI_FONT_FAMILY, 'normal');
    doc.addFileToVFS(THAI_FONT_BOLD_FILE, boldBase64);
    doc.addFont(THAI_FONT_BOLD_FILE, THAI_FONT_FAMILY, 'bold');
    return THAI_FONT_FAMILY;
  } catch (error) {
    console.warn('Thai font registration failed, fallback to helvetica:', error);
    return 'helvetica';
  }
};

const getFallbackRows = (columnCount, message = 'ไม่มีข้อมูล') => {
  if (columnCount <= 1) return [[message]];
  return [[message, ...Array.from({ length: columnCount - 1 }, () => '-')]];
};

const getMonthText = (item) => item?.monthLabel || item?.reportMonth || '-';

const normalizeReportItems = ({ reportItems, summaryData, chartData, reportMonth, details }) => {
  if (Array.isArray(reportItems) && reportItems.length > 0) {
    return reportItems;
  }
  const fallbackItem = {
    reportMonth: reportMonth || new Date().toISOString().slice(0, 7),
    summaryData: summaryData || {},
    chartData: chartData || {},
    details: details || {}
  };
  return [fallbackItem];
};

export const downloadSummaryReportPdf = async ({ reportItems, summaryData, chartData, reportMonth, details } = {}) => {
  const normalizedItems = normalizeReportItems({ reportItems, summaryData, chartData, reportMonth, details });
  const generatedAt = new Date().toLocaleString('th-TH', { hour12: false });

  const [{ jsPDF }, autoTableModule] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable')
  ]);

  const autoTable = autoTableModule.default || autoTableModule;
  const doc = new jsPDF({ orientation: 'p', unit: 'pt', format: 'a4' });
  const pdfFontFamily = await registerThaiFont(doc);
  const marginLeft = 40;
  let contentBottomY = 86;

  const runAutoTable = (options) => {
    if (typeof autoTable === 'function') {
      autoTable(doc, options);
      return;
    }
    if (typeof doc.autoTable === 'function') {
      doc.autoTable(options);
      return;
    }
    throw new Error('PDF table plugin unavailable');
  };

  const renderSectionTable = ({ title, head, body, headColor = [93, 91, 255] }) => {
    const pageHeight = doc.internal.pageSize.getHeight();
    let titleY = contentBottomY + 20;
    if (titleY + 120 > pageHeight - 40) {
      doc.addPage();
      titleY = 48;
      contentBottomY = 48;
    }

    doc.setFont(pdfFontFamily, 'bold');
    doc.setFontSize(12);
    doc.text(title, marginLeft, titleY);

    runAutoTable({
      startY: titleY + 8,
      head: [head],
      body,
      theme: 'grid',
      margin: { left: marginLeft, right: marginLeft },
      styles: { font: pdfFontFamily, fontSize: 10 },
      headStyles: { fillColor: headColor, textColor: [255, 255, 255], font: pdfFontFamily, fontStyle: 'bold' }
    });

    contentBottomY = doc.lastAutoTable?.finalY || titleY;
  };

  normalizedItems.forEach((item, index) => {
    if (index > 0) {
      doc.addPage();
    }

    contentBottomY = 86;

    const normalizedSummary = item?.summaryData || {};
    const normalizedChart = item?.chartData || {};
    const normalizedDetails = item?.details || {};

    const incomeRows = Array.isArray(normalizedDetails.incomeRows) ? normalizedDetails.incomeRows : [];
    const expenseRows = Array.isArray(normalizedDetails.expenseRows) ? normalizedDetails.expenseRows : [];
    const savingsRows = Array.isArray(normalizedDetails.savingsRows) ? normalizedDetails.savingsRows : [];

    doc.setFont(pdfFontFamily, 'bold');
    doc.setFontSize(18);
    doc.text('รายงานสรุปการเงินรายเดือน', marginLeft, 48);

    doc.setFont(pdfFontFamily, 'normal');
    doc.setFontSize(11);
    doc.text(`เดือน: ${getMonthText(item)}`, marginLeft, 70);
    doc.text(`สร้างเมื่อ: ${generatedAt}`, marginLeft, 86);

    runAutoTable({
      startY: 106,
      head: [['สรุป', 'ประมาณการ', 'จ่ายจริง']],
      body: [
        [
          'รายรับรวม',
          formatAmountForPdf(normalizedSummary.ยอดรวมรายรับรายเดือน),
          formatAmountForPdf(normalizedSummary.ยอดรวมรายรับรายเดือน)
        ],
        [
          'รายจ่ายรวม',
          formatAmountForPdf(normalizedSummary.ยอดรวมค่าใช้จ่ายรายเดือน_ทั้งหมด),
          formatAmountForPdf(normalizedSummary.ยอดรวมค่าใช้จ่ายรายเดือน_จ่ายจริง)
        ],
        [
          'เงินออมรวม',
          formatAmountForPdf(normalizedSummary.ยอดรวมเงินเก็บรายเดือน),
          formatAmountForPdf(normalizedSummary.ยอดรวมเงินเก็บรายเดือน)
        ],
        [
          'เงินคงเหลือ',
          formatAmountForPdf(normalizedSummary.ยอดเงินคงเหลือ_ประมาณการ),
          formatAmountForPdf(normalizedSummary.ยอดเงินคงเหลือ_จริง)
        ]
      ],
      theme: 'grid',
      margin: { left: marginLeft, right: marginLeft },
      styles: { font: pdfFontFamily, fontSize: 10 },
      headStyles: { fillColor: [93, 91, 255], textColor: [255, 255, 255], font: pdfFontFamily, fontStyle: 'bold' }
    });

    contentBottomY = doc.lastAutoTable?.finalY || 106;

    const pageHeight = doc.internal.pageSize.getHeight();
    const chartBlockHeight = 200;
    let chartTitleY = contentBottomY + 20;

    if (chartTitleY + chartBlockHeight > pageHeight - 40) {
      doc.addPage();
      chartTitleY = 48;
      contentBottomY = 48;
    }

    doc.setFont(pdfFontFamily, 'bold');
    doc.setFontSize(12);
    doc.text('สัดส่วนรายจ่าย (แผนภูมิ)', marginLeft, chartTitleY);

    const estimatedExpensePercent = toPercentInRange(normalizedChart?.ประมาณการ?.เปอร์เซ็นต์จ่าย);
    const actualExpensePercent = toPercentInRange(normalizedChart?.จ่ายจริง?.เปอร์เซ็นต์จ่าย);
    const estimatedChartImage = createExpenseRatioChartImage({
      title: 'ประมาณการ',
      expensePercent: estimatedExpensePercent
    });
    const actualChartImage = createExpenseRatioChartImage({
      title: 'จ่ายจริง',
      expensePercent: actualExpensePercent
    });

    if (estimatedChartImage && actualChartImage) {
      const chartTopY = chartTitleY + 10;
      const chartWidth = 240;
      const chartHeight = 170;

      doc.addImage(estimatedChartImage, 'PNG', marginLeft, chartTopY, chartWidth, chartHeight, undefined, 'FAST');
      doc.addImage(actualChartImage, 'PNG', marginLeft + chartWidth + 20, chartTopY, chartWidth, chartHeight, undefined, 'FAST');

      contentBottomY = chartTopY + chartHeight;
    } else {
      runAutoTable({
        startY: chartTitleY + 8,
        head: [['ประเภท', 'ค่า']],
        body: [
          ['สัดส่วนรายจ่ายประมาณการ', formatPercentForPdf(estimatedExpensePercent)],
          ['สัดส่วนรายจ่ายจริง', formatPercentForPdf(actualExpensePercent)]
        ],
        theme: 'grid',
        margin: { left: marginLeft, right: marginLeft },
        styles: { font: pdfFontFamily, fontSize: 10 },
        headStyles: { fillColor: [78, 203, 255], textColor: [255, 255, 255], font: pdfFontFamily, fontStyle: 'bold' }
      });

      contentBottomY = doc.lastAutoTable?.finalY || chartTitleY;
    }

    renderSectionTable({
      title: 'รายละเอียดรายรับรายเดือน',
      head: ['รายการ', 'จำนวนเงิน'],
      body: incomeRows.length
        ? incomeRows.map((row) => [row.item || '-', formatAmountForPdf(row.amount)])
        : getFallbackRows(2, 'ไม่มีข้อมูลรายรับ')
    });

    renderSectionTable({
      title: 'รายละเอียดรายจ่ายรายเดือน',
      head: ['รายการ', 'ประมาณการ', 'จ่ายจริง', 'สถานะ'],
      body: expenseRows.length
        ? expenseRows.map((row) => [
          row.item || '-',
          formatAmountForPdf(row.estimate),
          formatAmountForPdf(row.actual),
          row.paid || '-'
        ])
        : getFallbackRows(4, 'ไม่มีข้อมูลรายจ่าย')
    });

    renderSectionTable({
      title: 'รายละเอียดเงินออมรายเดือน',
      head: ['รายการ', 'จำนวนเงิน'],
      body: savingsRows.length
        ? savingsRows.map((row) => [row.item || '-', formatAmountForPdf(row.amount)])
        : getFallbackRows(2, 'ไม่มีข้อมูลเงินออม')
    });
  });

  const monthlyTaxRows = normalizedItems.map((item) => [
    getMonthText(item),
    formatAmountForPdf(item?.summaryData?.ภาษีสะสมตั้งแต่เดือนแรก)
  ]);

  doc.addPage();
  doc.setFont(pdfFontFamily, 'bold');
  doc.setFontSize(16);
  doc.text('ภาษีสะสมทั้งหมดรายเดือน', marginLeft, 48);

  runAutoTable({
    startY: 66,
    head: [['เดือน', 'ภาษีสะสม']],
    body: monthlyTaxRows.length ? monthlyTaxRows : getFallbackRows(2, 'ไม่มีข้อมูลภาษีสะสม'),
    theme: 'grid',
    margin: { left: marginLeft, right: marginLeft },
    styles: { font: pdfFontFamily, fontSize: 10 },
    headStyles: { fillColor: [93, 91, 255], textColor: [255, 255, 255], font: pdfFontFamily, fontStyle: 'bold' }
  });

  const filenameSuffix = normalizedItems.length === 1
    ? (normalizedItems[0]?.reportMonth || 'ไม่ระบุเดือน')
    : `${normalizedItems[normalizedItems.length - 1]?.reportMonth || 'ไม่ระบุเดือน'}-ถึง-${normalizedItems[0]?.reportMonth || 'ไม่ระบุเดือน'}`;

  doc.save(`รายงานการเงิน-${filenameSuffix}.pdf`);
};
