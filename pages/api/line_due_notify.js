/**
 * API: pages/api/line_due_notify.js
 * ส่งแจ้งเตือนค่าใช้จ่ายที่ถึงกำหนดผ่าน LINE
 * รองรับทั้ง JSON และ MongoDB
 * - แจ้งเตือนรายการครบกำหนด/ค้างชำระตามวันที่ที่ระบุ
 * - รองรับการกำหนดวันครบกำหนดแบบรายเดือน
 * - รวมผลตามสถานะ (ครบกำหนด/ค้างชำระ/ยังไม่ถึงกำหนด)
 * - ใช้ CRON_SECRET เป็นด่านเดียวและบังคับเสมอ (static Bearer "API token" ถูกถอดออกใน TD-C02 follow-up)
 * - เลือกส่งเฉพาะผู้ใช้หรือส่งให้ทุกคนที่มี LINE ID
 *
 * พารามิเตอร์:
 * - date: วันที่เป้าหมายรูปแบบ YYYY-MM-DD (ไม่ระบุจะใช้วันนี้)
 * - userId: เลือกผู้ใช้เฉพาะ (ไม่ระบุจะส่งทุกคน)
 * - mode: รูปแบบแจ้งเตือน 'due' | 'unpaid' | 'both'
 */

import { sendLineMessage, sendLineFlexMessage } from '../../src/shared/utils/sendLineMessage';
import { isJsonMode, getMongoCollection } from '../../lib/dataSource';
import { isPaidFlag } from '../../src/shared/utils/commonUtils';
import crypto from 'crypto';
import { getUserCreditData } from '../../src/shared/utils/backend/creditCardStore';
import {
  PLAN_STATUS,
  buildRevolvingCycles,
  summariseRevolving
} from '../../src/shared/utils/creditCardUtils';
import {
  THAI_MONTH_LABELS,
  normalizeMonthPart,
  getDaysInMonth,
  getCurrentDateInfo,
  resolveDueDayForMonth,
  normalizeDueDayValue,
  isEndOfMonthDueDay,
  formatMonthKeyTH,
  formatThaiDate,
  buildDueDateString
} from '../../src/shared/utils/dateUtils';
import { loadUsers, getUserData } from '../../src/backend/data/userUtils.js';
import {
  LINE_THEME,
  textComponent,
  separator,
  tintBox,
  ctaButton
} from '../../src/shared/utils/backend/lineFlexTheme';

const JSON_EXPENSE_FILE = 'monthly_expense.json';
const DUE_SOON_DAYS = 3;

/**
 * ดึงรายการค่าใช้จ่ายจากเอกสาร โดยตัด field ระบบออก
 * @param {object} doc - เอกสารค่าใช้จ่ายของเดือน
 * @returns {array} รายการค่าใช้จ่ายที่ใช้งานจริง
 */
function extractExpenseItems(doc = {}) {
  const ignoreKeys = new Set([
    '_id',
    'month',
    'userId',
    'periodKey',
    'accountSummary',
    'totalActualPaid'
  ]);
  return Object.entries(doc)
    .filter(([key, value]) => !ignoreKeys.has(key) && value && typeof value === 'object')
    .map(([, value]) => value);
}

/**
 * หาสถานะรายการเทียบกับวันเป้าหมาย
 * @param {object} item - รายการค่าใช้จ่ายที่มี dueDay หรือ dueDate
 * @param {object} target - ข้อมูลวันเป้าหมาย (day, daysInMonth)
 * @returns {object} {status, dueDay}
 */
function getDueStatus(item, target) {
  if (!item || !target) return { status: 'invalid', dueDay: null };
  const dueDay = getDueDayNumber(item);
  const resolvedDueDay = resolveDueDayForMonth(dueDay, target.daysInMonth);
  if (!resolvedDueDay || resolvedDueDay < 1 || resolvedDueDay > target.daysInMonth) {
    return { status: 'invalid', dueDay: null };
  }
  if (resolvedDueDay === target.day) return { status: 'due', dueDay };
  if (resolvedDueDay < target.day) return { status: 'overdue', dueDay };
  if ((resolvedDueDay - target.day) <= DUE_SOON_DAYS) {
    return { status: 'dueSoon', dueDay };
  }
  return { status: 'upcoming', dueDay };
}

function formatAmount(value) {
  const numeric = Number(value || 0);
  if (Number.isNaN(numeric)) return String(value || '0');
  return numeric.toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

/**
 * สร้างข้อความแจ้งเตือนแบบจัดกลุ่มรายการ
 * @param {object} target - ข้อมูลวันเป้าหมาย
 * @param {object} groupedItems - รายการที่จัดกลุ่มตามสถานะ
 * @param {string} notifyMode - โหมดแจ้งเตือน
 * @returns {string} ข้อความสำหรับส่ง LINE
 */
function buildMessage(target, groupedItems, notifyMode) {
  const hasDue = groupedItems.due.length > 0;
  const hasOverdue = groupedItems.overdue.length > 0;
  const hasDueSoon = groupedItems.dueSoon.length > 0;
  const headerTitle = notifyMode === 'unpaid'
    ? 'รายการค้างชำระ'
    : hasDue && hasOverdue
      ? 'ครบกำหนดวันนี้ + ค้างชำระ'
      : hasDueSoon
        ? `กำหนดการใกล้ชำระ (ภายใน ${DUE_SOON_DAYS} วัน)`
      : hasDue
        ? 'ครบกำหนดวันนี้'
        : 'ค้างชำระ';
  const monthLabel = formatMonthKeyTH(target.monthKey);
  const header = [
    '🔔 FinanceTrack แจ้งเตือนค่าใช้จ่าย',
    headerTitle,
    `เดือน ${monthLabel}`,
    `วันที่ ${formatThaiDate(target)}`,
    '━━━━━━━━━━━━'
  ].join('\n');
  const dueSection = groupedItems.due.length
    ? buildSection('✅ ครบกำหนดวันนี้', groupedItems.due, target, { hideDate: true })
    : null;
  const dueSoonSection = groupedItems.dueSoon.length
    ? buildSection(`⏳ ใกล้ครบกำหนด (อีกไม่เกิน ${DUE_SOON_DAYS} วัน)`, groupedItems.dueSoon, target)
    : null;
  const overdueSection = groupedItems.overdue.length
    ? buildSection('⚠️ ค้างชำระ', groupedItems.overdue, target)
    : null;
  const unpaidSection = notifyMode === 'unpaid' && groupedItems.otherUnpaid.length
    ? buildSection('🗂️ รายการยังไม่ถึงกำหนด', groupedItems.otherUnpaid, target, { hideDate: true })
    : null;
  const sections = [dueSection, dueSoonSection, overdueSection, unpaidSection].filter(Boolean);
  const todayItems = [...groupedItems.due, ...groupedItems.overdue];
  const upcomingItems = [...groupedItems.dueSoon, ...groupedItems.otherUnpaid];
  const todayTotal = sumItemAmounts(todayItems);
  const upcomingTotal = sumItemAmounts(upcomingItems);
  const footerLines = [
    '━━━━━━━━━━━━',
    `ต้องจ่ายวันนี้/ค้างชำระ: ${formatAmount(todayTotal)} บาท (${todayItems.length} รายการ)`,
    upcomingItems.length ? `ใกล้ครบกำหนด: ${formatAmount(upcomingTotal)} บาท (${upcomingItems.length} รายการ)` : null,
    'อัปเดตสถานะ ➜ https://finance-track-one.vercel.app/ 💼'
  ].filter(Boolean);
  const footer = footerLines.join('\n');
  return [header, ...sections, footer].join('\n\n');
}

/**
 * หา headerTitle เดียวกับที่ buildMessage() ใช้ — แยกออกมาเป็นฟังก์ชันเล็กเพื่อให้ altText ของ Flex
 * (ที่ต้องคำนวณก่อนเรียก buildDueNotifyFlex) ใช้ค่าเดียวกันได้โดยไม่ต้อง copy-paste ผิดที่ผิดทาง
 * buildMessage() เองไม่ถูกแตะ ยังคง byte-identical (AC-22)
 */
function deriveDueHeaderTitle(groupedItems, notifyMode) {
  const hasDue = groupedItems.due.length > 0;
  const hasOverdue = groupedItems.overdue.length > 0;
  const hasDueSoon = groupedItems.dueSoon.length > 0;
  return notifyMode === 'unpaid'
    ? 'รายการค้างชำระ'
    : hasDue && hasOverdue
      ? 'ครบกำหนดวันนี้ + ค้างชำระ'
      : hasDueSoon
        ? `กำหนดการใกล้ชำระ (ภายใน ${DUE_SOON_DAYS} วัน)`
      : hasDue
        ? 'ครบกำหนดวันนี้'
        : 'ค้างชำระ';
}

/** หนึ่งแถวรายการในสไตล์ Flex — ชื่อ+จำนวนเงินเป็นคอลัมน์ในแนวนอน แล้วตามด้วยบรรทัดวันที่ (ถ้ามี) */
function buildFlexItemRow(item, target, opts = {}) {
  const name = item.name || 'รายการไม่มีชื่อ';
  const fromMonth = item._fromMonth ? ` (ค้างจาก ${formatMonthKeyTH(item._fromMonth)})` : '';
  const row = {
    type: 'box', layout: 'horizontal', spacing: 'sm', contents: [
      { ...textComponent(`${name}${fromMonth}`, 'sm', LINE_THEME.textPrimary), flex: 3 },
      { ...textComponent(`${formatAmount(item.actual || 0)} บาท`, 'sm', LINE_THEME.textPrimary, '700'), flex: 2, align: 'end' }
    ]
  };
  if (opts.hideDate) return [row];
  const dueDay = getDueDayNumber(item);
  const dueDateText = dueDay ? buildDueDateString(target, dueDay) : null;
  return dueDateText ? [row, textComponent(`📅 ${dueDateText}`, 'xs', LINE_THEME.textSecondary)] : [row];
}

/** หนึ่ง section ในสไตล์ Flex — หัวข้อ section แล้วตามด้วยกลุ่มบัญชี (เรียก groupItemsByAccount() เดิม ไม่แก้) */
function buildFlexSection(title, items, target, opts, titleColor) {
  const groups = groupItemsByAccount(items);
  const showHeadings = !(groups.length === 1 && groups[0].account === OTHER_ACCOUNT_LABEL);
  const groupContents = groups.flatMap(group => [
    ...(showHeadings ? [textComponent(group.account, 'sm', LINE_THEME.textSecondary, '700')] : []),
    ...group.items.flatMap(item => buildFlexItemRow(item, target, opts))
  ]);
  return [textComponent(title, 'md', titleColor, '700'), ...groupContents];
}

/**
 * สร้างข้อความแจ้งเตือนค่าใช้จ่ายแบบ Flex (ธีมสว่าง) — โครงสร้าง/ลำดับข้อมูลเหมือน buildMessage() ทุกประการ
 * (สเปก AC-8…AC-15) เปลี่ยนแค่รูปแบบการแสดงผลจากข้อความล้วนเป็น Flex bubble
 * @param {object} target - ข้อมูลวันเป้าหมาย
 * @param {object} groupedItems - รายการที่จัดกลุ่มตามสถานะ
 * @param {string} notifyMode - โหมดแจ้งเตือน
 * @returns {object} Flex bubble
 */
function buildDueNotifyFlex(target, groupedItems, notifyMode) {
  const hasDue = groupedItems.due.length > 0;
  const hasOverdue = groupedItems.overdue.length > 0;
  const headerTitle = deriveDueHeaderTitle(groupedItems, notifyMode);
  const monthLabel = formatMonthKeyTH(target.monthKey);
  const statusColor = (hasDue || hasOverdue) ? LINE_THEME.danger : LINE_THEME.warning;

  const dueSection = groupedItems.due.length
    ? buildFlexSection('✅ ครบกำหนดวันนี้', groupedItems.due, target, { hideDate: true }, LINE_THEME.danger)
    : null;
  const dueSoonSection = groupedItems.dueSoon.length
    ? buildFlexSection(`⏳ ใกล้ครบกำหนด (อีกไม่เกิน ${DUE_SOON_DAYS} วัน)`, groupedItems.dueSoon, target, {}, LINE_THEME.warning)
    : null;
  const overdueSection = groupedItems.overdue.length
    ? buildFlexSection('⚠️ ค้างชำระ', groupedItems.overdue, target, {}, LINE_THEME.danger)
    : null;
  const unpaidSection = notifyMode === 'unpaid' && groupedItems.otherUnpaid.length
    ? buildFlexSection('🗂️ รายการยังไม่ถึงกำหนด', groupedItems.otherUnpaid, target, { hideDate: true }, LINE_THEME.textSecondary)
    : null;
  const sections = [dueSection, dueSoonSection, overdueSection, unpaidSection].filter(Boolean);
  const sectionContents = sections.flatMap((section, index) => [
    ...section,
    ...(index < sections.length - 1 ? [separator('lg')] : [])
  ]);

  const todayItems = [...groupedItems.due, ...groupedItems.overdue];
  const upcomingItems = [...groupedItems.dueSoon, ...groupedItems.otherUnpaid];
  const todayTotal = sumItemAmounts(todayItems);
  const upcomingTotal = sumItemAmounts(upcomingItems);
  const hasToday = todayItems.length > 0;
  const totalsBox = tintBox(hasToday ? LINE_THEME.tintDanger : LINE_THEME.tintSuccess, [
    textComponent('ต้องจ่ายวันนี้/ค้างชำระ', 'sm', LINE_THEME.textSecondary),
    textComponent(`${formatAmount(todayTotal)} บาท`, 'xxl', hasToday ? LINE_THEME.danger : LINE_THEME.success, '700'),
    textComponent(`(${todayItems.length} รายการ)`, 'xs', LINE_THEME.textSecondary),
    ...(upcomingItems.length
      ? [textComponent(`ใกล้ครบกำหนด ${formatAmount(upcomingTotal)} บาท (${upcomingItems.length} รายการ)`, 'xs', LINE_THEME.warning)]
      : [])
  ]);

  return {
    type: 'bubble', size: 'mega',
    styles: { body: { backgroundColor: LINE_THEME.surface }, footer: { backgroundColor: LINE_THEME.surfaceFooter } },
    body: {
      type: 'box', layout: 'vertical', paddingAll: 'xl', contents: [
        textComponent('FinanceTrack', 'sm', LINE_THEME.brand, '700'),
        textComponent('🔔 แจ้งเตือนค่าใช้จ่าย', 'xl', LINE_THEME.textPrimary, '700'),
        textComponent(headerTitle, 'md', statusColor, '700'),
        textComponent(`เดือน ${monthLabel}`, 'sm', LINE_THEME.textSecondary),
        textComponent(`วันที่ ${formatThaiDate(target)}`, 'sm', LINE_THEME.textSecondary),
        separator('xl'),
        ...sectionContents,
        totalsBox
      ]
    },
    footer: {
      type: 'box', layout: 'vertical', spacing: 'sm', contents: [
        ctaButton('อัปเดตสถานะ', 'https://finance-track-one.vercel.app/')
      ]
    }
  };
}

const OTHER_ACCOUNT_LABEL = 'อื่นๆ';

/**
 * จัดกลุ่มรายการตามบัญชี โดยคงลำดับการปรากฏครั้งแรกของแต่ละบัญชี
 * รายการที่ไม่มีบัญชีถูกรวมไว้ในกลุ่มท้ายสุดชื่อ "อื่นๆ"
 * @param {array} items - รายการค่าใช้จ่าย
 * @returns {array} กลุ่มรายการ [{ account, items }]
 */
function groupItemsByAccount(items) {
  const named = new Map(); // Map คง insertion order ตามลำดับปรากฏครั้งแรก
  const unnamed = [];
  for (const item of items) {
    if (!item.account) { unnamed.push(item); continue; }
    if (!named.has(item.account)) named.set(item.account, []);
    named.get(item.account).push(item);
  }
  const groups = [...named.entries()].map(([account, groupItems]) => ({ account, items: groupItems }));
  if (unnamed.length) groups.push({ account: OTHER_ACCOUNT_LABEL, items: unnamed });
  return groups;
}

function buildSection(title, items, target, opts = {}) {
  const groups = groupItemsByAccount(items);
  // ถ้ามีกลุ่มเดียวและเป็นกลุ่ม "อื่นๆ" (ไม่มีรายการไหนมีบัญชีเลย) ให้ตัด heading ทิ้ง เพราะไม่ได้ช่วยจัดกลุ่มอะไร
  const showHeadings = !(groups.length === 1 && groups[0].account === OTHER_ACCOUNT_LABEL);
  const lines = groups.flatMap(group => [
    ...(showHeadings ? [group.account] : []),
    ...group.items.map(item => formatLineItem(item, target, opts))
  ]);
  return [title, ...lines].join('\n');
}

function formatLineItem(item, target, opts = {}) {
  const name = item.name || 'รายการไม่มีชื่อ';
  const amount = formatAmount(item.actual || 0);
  const fromMonth = item._fromMonth ? ` (ค้างจาก ${formatMonthKeyTH(item._fromMonth)})` : '';
  const firstLine = `• ${name} — ${amount} บาท${fromMonth}`;
  if (opts.hideDate) return firstLine;
  const dueDay = getDueDayNumber(item);
  const dueDateText = dueDay ? buildDueDateString(target, dueDay) : null;
  return dueDateText ? `${firstLine}\n   📅 ${dueDateText}` : firstLine;
}

/**
 * ดึงเลขวันที่ครบกำหนดจากรายการ
 * รองรับทั้ง dueDay และ dueDate
 * @param {object} item - รายการค่าใช้จ่าย
 * @returns {number|null} วันครบกำหนด (1-31) หรือ null
 */
function getDueDayNumber(item = {}) {
  // รองรับ 'EOM' (วันสิ้นเดือน) โดยคืนค่า raw ให้ resolveDueDayForMonth จัดการต่อ
  if (isEndOfMonthDueDay(item.dueDay)) return item.dueDay;
  const rawDay = normalizeDueDayValue(item.dueDay);
  if (rawDay) return rawDay;
  if (typeof item.dueDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(item.dueDate)) {
    const dayPart = item.dueDate.slice(-2);
    return normalizeDueDayValue(dayPart);
  }
  return null;
}

/**
 * คำนวณยอดรวมของรายการค่าใช้จ่าย
 * @param {array} items - รายการค่าใช้จ่าย
 * @returns {number} ยอดรวมทั้งหมด
 */
function sumItemAmounts(items = []) {
  return items.reduce((sum, item) => {
    const raw = Number(item.actual || 0);
    if (!Number.isNaN(raw) && Number.isFinite(raw)) {
      return sum + raw;
    }
    return sum;
  }, 0);
}

/**
 * ดึงรายชื่อผู้ใช้ที่มี LINE ID สำหรับส่งแจ้งเตือน
 * @param {string|null} targetUserId - ส่งเฉพาะผู้ใช้ หากไม่ระบุจะส่งทุกคน
 * @returns {array} รายชื่อผู้ใช้ที่มี LineId
 */
async function getUsersForNotify(targetUserId) {
  // Reject non-string userId before it can shape a Mongo filter.
  if (targetUserId !== undefined && targetUserId !== null && typeof targetUserId !== 'string') {
    return [];
  }
  if (isJsonMode()) {
    const users = loadUsers();
    return users.filter(user => user.LineId && (!targetUserId || user.id === targetUserId));
  }
  const collection = await getMongoCollection('users');
  const filter = targetUserId ? { id: targetUserId } : {};
  const docs = await collection.find(filter).toArray();
  return docs.filter(user => user.LineId);
}

function getPrevMonthKey(monthKey) {
  const [y, m] = monthKey.split('-').map(Number);
  if (m === 1) return `${y - 1}-12`;
  return `${y}-${String(m - 1).padStart(2, '0')}`;
}

async function getExpenseDocForMonth(userId, monthKey) {
  if (isJsonMode()) {
    const bucket = getUserData(JSON_EXPENSE_FILE, userId);
    return bucket?.[monthKey] || null;
  }
  const collection = await getMongoCollection('monthly_expense');
  return collection.findOne({ userId, month: monthKey });
}

// ---------------------------------------------------------------------------
// แจ้งเตือนบัตรเครดิต (BR-CC-011) — ข้อความแยกอีกฉบับ ส่งหลังข้อความค่าใช้จ่ายเดิม
// เส้นทาง buildMessage() เดิมไม่ถูกแตะต้อง
//
// งวดผ่อนและยอดหมุนเวียนไม่เคยถูกบันทึกลง monthly_expense (ADR-009 · ADR-011)
// getExpenseDocForMonth() อ่าน store ตรง ๆ จึงมองไม่เห็นแถวเหล่านี้
// ยอดบัตรเครดิตจึงไม่มีทางถูกแจ้งซ้ำในข้อความค่าใช้จ่ายทั่วไป (AC-61)
// ---------------------------------------------------------------------------

/**
 * รวบรวมบัตรที่มีงวดผ่อน/ยอดหมุนเวียนครบกำหนด/ใกล้ครบ/เลยกำหนด ในเดือนเป้าหมาย
 * @param {object} creditData - { cards, plans, cycles }
 * @param {object} target - ข้อมูลวันเป้าหมาย
 * @returns {array} รายการเหตุการณ์ต่อบัตร
 */
function collectCardDueEvents(creditData, target) {
  const cards = Array.isArray(creditData?.cards) ? creditData.cards : [];
  const plans = Array.isArray(creditData?.plans) ? creditData.plans : [];
  const cycles = Array.isArray(creditData?.cycles) ? creditData.cycles : [];
  // ⚠ เช็คแค่ cards เท่านั้น — เงื่อนไขเดิมมี !plans.length ด้วย ทำให้ผู้ใช้ที่ใช้
  //   เฉพาะยอดหมุนเวียน (ไม่มีแผนผ่อนเลย) ไม่ได้รับข้อความอะไรเลย (AC-59)
  if (!cards.length) return [];

  return cards.map(card => {
    const resolvedDueDay = resolveDueDayForMonth(card.dueDay, target.daysInMonth);
    if (!resolvedDueDay) return null;

    let status = null;
    if (resolvedDueDay === target.day) status = 'due';
    else if (resolvedDueDay < target.day) status = 'overdue';
    else if ((resolvedDueDay - target.day) <= DUE_SOON_DAYS) status = 'dueSoon';
    if (!status) return null;

    const items = [];
    plans.forEach(plan => {
      if (plan?.cardId !== card.id) return;
      if (plan.status !== PLAN_STATUS.ONGOING) return;
      const schedule = Array.isArray(plan.schedule) ? plan.schedule : [];
      const remaining = schedule.filter(row => row?.paid !== true).length;
      schedule.forEach(row => {
        if (row?.dueMonth !== target.monthKey) return;
        if (row.paid === true) return;
        items.push({ plan, row, remaining });
      });
    });

    // ยอดหมุนเวียนของเดือนเป้าหมาย — แจ้งเฉพาะที่ยังไม่ตัดสินใจชำระ (กติกาเดียวกับงวดผ่อน)
    const chain = buildRevolvingCycles(card, cycles, { throughMonth: target.monthKey });
    const summary = summariseRevolving(chain, { asOfMonth: target.monthKey });
    const cycle = summary.cycle;
    const revolving = cycle && cycle.amountDue > 0 && cycle.paymentAction === null
      ? { amountDue: cycle.amountDue, minPaymentDue: cycle.minPaymentDue, paymentAction: cycle.paymentAction }
      : null;

    if (!items.length && !revolving) return null;

    return {
      card,
      status,
      resolvedDueDay,
      dueDateText: buildDueDateString(target, card.dueDay),
      isEndOfMonth: isEndOfMonthDueDay(card.dueDay),
      diffDays: resolvedDueDay - target.day,
      items,
      revolving,
      total: items.reduce((sum, item) => sum + (Number(item.row.payment) || 0), 0)
        + (revolving?.amountDue ?? 0)
    };
  }).filter(Boolean);
}

function describeCardTiming(event) {
  if (event.isEndOfMonth) return 'สิ้นเดือน';
  if (event.status === 'due') return 'ครบกำหนดวันนี้';
  if (event.status === 'overdue') return `เลยกำหนด ${Math.abs(event.diffDays)} วัน`;
  return `อีก ${event.diffDays} วัน`;
}

/** บรรทัดยอดหมุนเวียน — ภาระหลักของบัตร จึงอยู่เหนือรายการงวดผ่อนเสมอ */
function buildRevolvingLine(revolving) {
  if (!revolving) return null;
  if (revolving.paymentAction === 'minimum') {
    return `   • ยอดใช้จ่ายหมุนเวียน (ขั้นต่ำ) — ${formatAmount(revolving.amountDue)} บาท`;
  }
  return `   • ยอดใช้จ่ายหมุนเวียน — ${formatAmount(revolving.amountDue)} บาท (ขั้นต่ำ ${formatAmount(revolving.minPaymentDue)})`;
}

function buildCardSection(title, events, startIndex) {
  const lines = events.map((event, index) => {
    const last4 = event.card.last4 ? ` (····${event.card.last4})` : '';
    const head = `${startIndex + index + 1}. ${event.card.name}${last4} — ${formatAmount(event.total)} บาท`;
    const dateLine = `   📅 ${event.dueDateText} (${describeCardTiming(event)})`;
    const revolvingLine = buildRevolvingLine(event.revolving);
    const itemLines = event.items.map(item => (
      `   • ${item.plan.itemName} — งวด ${item.row.no}/${item.plan.months} (เหลืออีก ${item.remaining} งวด) ${formatAmount(item.row.payment)} บาท`
    ));
    return [head, dateLine, ...(revolvingLine ? [revolvingLine] : []), ...itemLines].join('\n');
  });
  return [title, ...lines].join('\n');
}

/**
 * สร้างข้อความแจ้งเตือนบัตรเครดิต
 * @param {object} target - ข้อมูลวันเป้าหมาย
 * @param {array} cardEvents - ผลจาก collectCardDueEvents
 * @returns {string|null} null เมื่อไม่มีอะไรต้องแจ้ง (ต้องไม่ส่งข้อความเปล่า)
 */
function buildCreditCardMessage(target, cardEvents) {
  if (!Array.isArray(cardEvents) || !cardEvents.length) return null;

  const overdue = cardEvents.filter(event => event.status === 'overdue');
  const upcoming = cardEvents.filter(event => event.status !== 'overdue');
  const headerTitle = overdue.length && upcoming.length
    ? 'ครบกำหนดชำระ + เลยกำหนด'
    : overdue.length
      ? 'เลยกำหนดชำระ'
      : 'ครบกำหนดชำระ';

  const header = [
    '💳 FinanceTrack แจ้งเตือนบัตรเครดิต',
    headerTitle,
    `เดือน ${formatMonthKeyTH(target.monthKey)}`,
    `วันที่ ${formatThaiDate(target)}`,
    '━━━━━━━━━━━━'
  ].join('\n');

  const sections = [];
  if (overdue.length) sections.push(buildCardSection('⚠️ เลยกำหนดชำระ', overdue, 0));
  if (upcoming.length) sections.push(buildCardSection('📌 ครบกำหนดชำระ', upcoming, overdue.length));

  const grandTotal = cardEvents.reduce((sum, event) => sum + event.total, 0);
  const installmentCount = cardEvents.reduce((sum, event) => sum + event.items.length, 0);
  const revolvingCount = cardEvents.filter(event => event.revolving).length;
  const countParts = [
    `${cardEvents.length} บัตร`,
    `${installmentCount} งวด`,
    ...(revolvingCount ? [`${revolvingCount} ยอดหมุนเวียน`] : [])
  ].join(' · ');
  const footer = [
    '━━━━━━━━━━━━',
    `รวมต้องชำระ: ${formatAmount(grandTotal)} บาท (${countParts})`,
    'จัดการบัตร ➜ https://finance-track-one.vercel.app/credit-cards 💳'
  ].join('\n');

  return [header, ...sections, footer].join('\n\n');
}

/** headerTitle เดียวกับ buildCreditCardMessage() — แยกไว้ให้ altText ของ Flex ใช้ค่าเดียวกัน ไม่ต้อง copy สูตรผิด */
function deriveCardHeaderTitle(overdueCount, upcomingCount) {
  return overdueCount && upcomingCount
    ? 'ครบกำหนดชำระ + เลยกำหนด'
    : overdueCount
      ? 'เลยกำหนดชำระ'
      : 'ครบกำหนดชำระ';
}

/** หนึ่ง block ต่อบัตรในสไตล์ Flex — ชื่อบัตร+ยอดรวมเป็นแถวแนวนอน แล้วตามด้วยเวลา/ยอดหมุนเวียน/รายการงวด */
function buildFlexCardEventBlock(event) {
  const last4 = event.card.last4 ? ` (····${event.card.last4})` : '';
  const headRow = {
    type: 'box', layout: 'horizontal', spacing: 'sm', contents: [
      { ...textComponent(`${event.card.name}${last4}`, 'sm', LINE_THEME.textPrimary, '700'), flex: 3 },
      { ...textComponent(`${formatAmount(event.total)} บาท`, 'sm', LINE_THEME.textPrimary, '700'), flex: 2, align: 'end' }
    ]
  };
  const timingColor = (event.status === 'due' || event.status === 'overdue') ? LINE_THEME.danger : LINE_THEME.warning;
  const timingLine = textComponent(`📅 ${event.dueDateText} (${describeCardTiming(event)})`, 'xs', timingColor);
  // R-7: buildRevolvingLine() คืนสตริงที่มี indent 3 ช่องนำหน้าไว้ใช้ในข้อความ text — ใน Flex ตัดออกด้วย trimStart()
  // ยอมรับ coupling นี้อย่างตั้งใจแทนการรีแฟกเตอร์ buildRevolvingLine() (สเปก R-7, architecture-review finding 1)
  const revolvingLineText = buildRevolvingLine(event.revolving);
  const revolvingLine = revolvingLineText ? textComponent(revolvingLineText.trimStart(), 'xs', LINE_THEME.textSecondary) : null;
  const itemLines = event.items.map(item => textComponent(
    `${item.plan.itemName} — งวด ${item.row.no}/${item.plan.months} (เหลืออีก ${item.remaining} งวด) ${formatAmount(item.row.payment)} บาท`,
    'xs', LINE_THEME.textSecondary
  ));
  return [headRow, timingLine, ...(revolvingLine ? [revolvingLine] : []), ...itemLines];
}

/**
 * สร้างข้อความแจ้งเตือนบัตรเครดิตแบบ Flex (ธีมสว่าง) — โครงสร้าง/ลำดับข้อมูลเหมือน buildCreditCardMessage()
 * ทุกประการ (สเปก AC-16…AC-20) คืน null เมื่อไม่มีอะไรต้องแจ้งเงื่อนไขเดียวกับฉบับข้อความ ห้ามส่งข้อความเปล่า
 * @param {object} target - ข้อมูลวันเป้าหมาย
 * @param {array} cardEvents - ผลจาก collectCardDueEvents
 * @returns {object|null} Flex bubble หรือ null
 */
function buildCreditCardFlex(target, cardEvents) {
  if (!Array.isArray(cardEvents) || !cardEvents.length) return null;

  const overdue = cardEvents.filter(event => event.status === 'overdue');
  const upcoming = cardEvents.filter(event => event.status !== 'overdue');
  const headerTitle = deriveCardHeaderTitle(overdue.length, upcoming.length);
  const statusColor = overdue.length ? LINE_THEME.danger : LINE_THEME.warning;

  const overdueSection = overdue.length
    ? [textComponent('⚠️ เลยกำหนดชำระ', 'md', LINE_THEME.danger, '700'), ...overdue.flatMap(buildFlexCardEventBlock)]
    : null;
  const upcomingSection = upcoming.length
    ? [textComponent('📌 ครบกำหนดชำระ', 'md', LINE_THEME.warning, '700'), ...upcoming.flatMap(buildFlexCardEventBlock)]
    : null;
  const sections = [overdueSection, upcomingSection].filter(Boolean);
  const sectionContents = sections.flatMap((section, index) => [
    ...section,
    ...(index < sections.length - 1 ? [separator('lg')] : [])
  ]);

  const grandTotal = cardEvents.reduce((sum, event) => sum + event.total, 0);
  const installmentCount = cardEvents.reduce((sum, event) => sum + event.items.length, 0);
  const revolvingCount = cardEvents.filter(event => event.revolving).length;
  const countParts = [
    `${cardEvents.length} บัตร`,
    `${installmentCount} งวด`,
    ...(revolvingCount ? [`${revolvingCount} ยอดหมุนเวียน`] : [])
  ].join(' · ');
  const totalsBox = tintBox(LINE_THEME.tintDanger, [
    textComponent('รวมต้องชำระ', 'sm', LINE_THEME.textSecondary),
    textComponent(`${formatAmount(grandTotal)} บาท`, 'xxl', LINE_THEME.danger, '700'),
    textComponent(countParts, 'xs', LINE_THEME.textSecondary)
  ]);

  return {
    type: 'bubble', size: 'mega',
    styles: { body: { backgroundColor: LINE_THEME.surface }, footer: { backgroundColor: LINE_THEME.surfaceFooter } },
    body: {
      type: 'box', layout: 'vertical', paddingAll: 'xl', contents: [
        textComponent('FinanceTrack', 'sm', LINE_THEME.brand, '700'),
        textComponent('💳 แจ้งเตือนบัตรเครดิต', 'xl', LINE_THEME.textPrimary, '700'),
        textComponent(headerTitle, 'md', statusColor, '700'),
        textComponent(`เดือน ${formatMonthKeyTH(target.monthKey)}`, 'sm', LINE_THEME.textSecondary),
        textComponent(`วันที่ ${formatThaiDate(target)}`, 'sm', LINE_THEME.textSecondary),
        separator('xl'),
        ...sectionContents,
        totalsBox
      ]
    },
    footer: {
      type: 'box', layout: 'vertical', spacing: 'sm', contents: [
        ctaButton('จัดการบัตร', 'https://finance-track-one.vercel.app/credit-cards')
      ]
    }
  };
}

/** เทียบสตริงแบบ constant-time เพื่อไม่ให้เวลาตอบกลับบอกใบ้ว่าตรงกันกี่ตัวอักษร */
function secretsMatch(provided, expected) {
  if (typeof provided !== 'string' || typeof expected !== 'string') return false;
  const providedBuf = Buffer.from(provided, 'utf-8');
  const expectedBuf = Buffer.from(expected, 'utf-8');
  // timingSafeEqual โยน error ถ้าความยาวไม่เท่ากัน — เทียบความยาวก่อนไม่ทำให้ปลอดภัยน้อยลง
  // เพราะความยาวของ secret ไม่ใช่ความลับ
  if (providedBuf.length !== expectedBuf.length) return false;
  return crypto.timingSafeEqual(providedBuf, expectedBuf);
}

/**
 * ดึงค่า secret ที่ผู้เรียกส่งมา รองรับ 3 ทาง:
 * - Authorization: Bearer <secret> (Vercel Cron ส่งมาทางนี้อัตโนมัติเมื่อตั้ง CRON_SECRET ไว้)
 * - header x-cron-secret
 * - query.cronSecret (GET) / body.cronSecret (POST) สำหรับเรียกเองด้วย curl
 */
function extractCronSecret(req) {
  const authHeader = req?.headers?.authorization;
  if (typeof authHeader === 'string') {
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    if (match) return match[1].trim();
  }
  const headerSecret = req?.headers?.['x-cron-secret'];
  if (typeof headerSecret === 'string' && headerSecret.trim()) return headerSecret.trim();

  const fromQuery = req?.query?.cronSecret;
  if (typeof fromQuery === 'string' && fromQuery.trim()) return fromQuery.trim();

  const fromBody = req?.body?.cronSecret;
  if (typeof fromBody === 'string' && fromBody.trim()) return fromBody.trim();

  return '';
}

/**
 * ประมวลผลและส่งข้อความแจ้งเตือนค่าใช้จ่ายของผู้ใช้ 1 คน
 * คืน result object เสมอ (ไม่ push เอง) เพื่อให้ผู้เรียกครอบ try/catch รายผู้ใช้ได้ที่จุดเดียว
 */
async function notifyExpenseForUser(user, target, notifyMode) {
  const expenseDoc = await getExpenseDocForMonth(user.id, target.monthKey);
  const prevMonthKey = getPrevMonthKey(target.monthKey);
  const prevExpenseDoc = await getExpenseDocForMonth(user.id, prevMonthKey);

  if (!expenseDoc && !prevExpenseDoc) {
    return { userId: user.id, sent: false, reason: 'no expense data' };
  }

  const groupedItems = { due: [], dueSoon: [], overdue: [], otherUnpaid: [] };

  // classify current month items
  if (expenseDoc) {
    const items = extractExpenseItems(expenseDoc);
    items.filter(item => {
      if (isPaidFlag(item.paid)) return false;
      const amount = Number(item.actual || 0);
      return !Number.isNaN(amount) && amount > 0;
    }).forEach(item => {
      const { status } = getDueStatus(item, target);
      if (status === 'due') { groupedItems.due.push(item); return; }
      if (status === 'overdue') { groupedItems.overdue.push(item); return; }
      if (status === 'dueSoon') { groupedItems.dueSoon.push(item); return; }
      // invalid (no dueDay) หรือ upcoming → otherUnpaid
      groupedItems.otherUnpaid.push(item);
    });
  }

  // prev month: unpaid items ทั้งหมดถือว่าเลยกำหนดแล้ว
  if (prevExpenseDoc) {
    const prevItems = extractExpenseItems(prevExpenseDoc);
    prevItems.filter(item => {
      if (isPaidFlag(item.paid)) return false;
      const amount = Number(item.actual || 0);
      return !Number.isNaN(amount) && amount > 0;
    }).forEach(item => {
      groupedItems.overdue.push({ ...item, _fromMonth: prevMonthKey });
    });
  }

  if (notifyMode === 'due') {
    groupedItems.overdue = [];
    groupedItems.otherUnpaid = [];
  }

  if (notifyMode === 'both') {
    groupedItems.otherUnpaid = [];
  }

  const totalMatched = groupedItems.due.length + groupedItems.dueSoon.length + groupedItems.overdue.length + groupedItems.otherUnpaid.length;

  if (!totalMatched) {
    return { userId: user.id, sent: false, reason: 'no due, near-due, or overdue items' };
  }

  try {
    // ลอง Flex (ธีมสว่าง) ก่อนเสมอ ล้มเหลว (เช่น LINE reject payload) ค่อย fallback เป็นข้อความล้วนเดิม
    // ไม่มี withLineRetry ในไฟล์นี้ — ตั้งใจไม่เพิ่ม (AC-14)
    let format = 'flex';
    try {
      const headerTitle = deriveDueHeaderTitle(groupedItems, notifyMode);
      const altText = `🔔 FinanceTrack ${headerTitle} · ${formatThaiDate(target)}`;
      await sendLineFlexMessage(altText, buildDueNotifyFlex(target, groupedItems, notifyMode), user.LineId);
    } catch (flexError) {
      await sendLineMessage(buildMessage(target, groupedItems, notifyMode), user.LineId);
      format = 'text-fallback';
    }
    return { userId: user.id, sent: true, count: totalMatched, format, breakdown: {
      due: groupedItems.due.length,
      dueSoon: groupedItems.dueSoon.length,
      overdue: groupedItems.overdue.length,
      otherUnpaid: groupedItems.otherUnpaid.length
    } };
  } catch (error) {
    return { userId: user.id, sent: false, reason: error.message };
  }
}

/**
 * ตัวจัดการหลักของ API แจ้งเตือนค่าใช้จ่ายผ่าน LINE
 * ตรวจสอบสิทธิ์ด้วย CRON_SECRET (บังคับเสมอ ไม่มีทางลัดอื่น) และส่งข้อความตามเงื่อนไข
 * @param {object} req - Express request (GET/POST)
 * @param {object} res - Express response
 */
export default async function handler(req, res) {
  // TD-C02 follow-up: CRON_SECRET เป็นด่านเดียวและบังคับ — เดิมมันเป็นแค่ "ทางเลือก" คู่กับ
  // static Bearer token ถ้าไม่ได้ตั้ง env นี้ไว้ endpoint ต้องปิดตาย ไม่ใช่เปิดให้ทุกคน
  const expectedSecret = typeof process.env.CRON_SECRET === 'string' ? process.env.CRON_SECRET.trim() : '';
  if (!expectedSecret) {
    return res.status(500).json({ error: 'CRON_SECRET is not configured' });
  }
  if (!secretsMatch(extractCronSecret(req), expectedSecret)) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const source = req.method === 'GET' ? (req.query || {}) : (req.body || {});
  const { date, userId, mode } = source;
  const target = getCurrentDateInfo(date);
  if (!target) {
    return res.status(400).json({ error: 'invalid date' });
  }

  const notifyMode = mode === 'unpaid' || mode === 'due' ? mode : 'both';

  const users = await getUsersForNotify(userId);
  const results = [];

  for (const user of users) {
    // แยกผู้ใช้ทีละคน: ผู้ใช้คนหนึ่งดึงข้อมูล/สร้างข้อความพัง ต้องไม่ทำให้คนที่เหลือไม่ได้รับแจ้งเตือน
    try {
      results.push(await notifyExpenseForUser(user, target, notifyMode));
    } catch (error) {
      console.error('due notify failed for one user:', error?.message);
      results.push({ userId: user.id, sent: false, reason: 'user processing failed' });
    }
  }

  // ข้อความบัตรเครดิตเป็นฉบับที่สอง ส่งหลังข้อความค่าใช้จ่ายเดิมของทุกผู้ใช้ (BR-CC-011)
  // ผู้ใช้ที่ไม่มีบัตร หรือไม่มีอะไรครบกำหนด/เลยกำหนด จะไม่ได้รับข้อความเลย ไม่ใช่ข้อความเปล่า
  const creditCardResults = [];
  for (const user of users) {
    let creditData;
    try {
      creditData = await getUserCreditData(user.id);
    } catch (error) {
      creditCardResults.push({ userId: user.id, sent: false, reason: 'credit store unavailable' });
      continue;
    }

    try {
      const cardEvents = collectCardDueEvents(creditData, target);
      // null-guard ต้องเช็คก่อนพยายามส่งทั้งสองทาง (Flex/text) — ห้ามส่งข้อความเปล่า (AC-16, AC-21)
      const flexPayload = buildCreditCardFlex(target, cardEvents);
      if (!flexPayload) {
        creditCardResults.push({ userId: user.id, sent: false, reason: 'no credit card due items' });
        continue;
      }

      let format = 'flex';
      try {
        const overdueCount = cardEvents.filter(event => event.status === 'overdue').length;
        const upcomingCount = cardEvents.length - overdueCount;
        const headerTitle = deriveCardHeaderTitle(overdueCount, upcomingCount);
        const altText = `💳 FinanceTrack ${headerTitle} · ${formatThaiDate(target)}`;
        await sendLineFlexMessage(altText, flexPayload, user.LineId);
      } catch (flexError) {
        await sendLineMessage(buildCreditCardMessage(target, cardEvents), user.LineId);
        format = 'text-fallback';
      }
      creditCardResults.push({
        userId: user.id,
        sent: true,
        cardCount: cardEvents.length,
        installmentCount: cardEvents.reduce((sum, event) => sum + event.items.length, 0),
        revolvingCount: cardEvents.filter(event => event.revolving).length,
        format
      });
    } catch (error) {
      creditCardResults.push({ userId: user.id, sent: false, reason: error.message });
    }
  }

  return res.status(200).json({ success: true, results, creditCardResults });
}
