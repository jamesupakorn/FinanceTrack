/**
 * API: pages/api/monthly_expense.ts
 * จัดการข้อมูลค่าใช้จ่ายรายเดือน
 * รองรับทั้ง JSON และ MongoDB
 * - GET: อ่านข้อมูลรายเดือนหรือทั้งหมด
 * - POST: บันทึก/อัปเดตข้อมูลและลบรายการที่ถูกลบ
 * - PATCH: ตั้งค่า paid ของแถวเดียว (ADR-028) · แถว ccr_ = ยอดรวมบัตร จ่ายทั้งบัตร (+ paymentAction)
 * - แถวบัตรเครดิตใน GET: ccr_<cardId> หนึ่งแถวต่อบัตร (งวดผ่อนอยู่ใน breakdown) ไม่มีคีย์ cci_ ระดับบน
 *   (spec-credit-card-spend §4.3 — ทั้ง 5 จุดเรียก safeBuildCreditCardRows)
 * - จำกัดข้อมูลย้อนหลังสูงสุด 15 เดือน
 * - คำนวณสรุปยอดตามบัญชีและยอดรวมค่าใช้จ่าย
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import type { Collection, Document } from 'mongodb';
import { mapDocToFlatItemObjectWithTotals, stripKnownTotalFields } from '../../src/shared/utils/backend/apiUtils';
import type { z } from 'zod';
import { parseRequestBody, monthlyExpensePostBodySchema, monthlyExpensePatchBodySchema } from '../../src/shared/utils/backend/pilotRequestSchemas';
import { assertUserId } from '../../src/shared/utils/backend/userRequest';
import { validateApiRequest } from '../../src/shared/utils/backend/apiRequestValidation';
import { getAccountSummary, getExpenseTotals, extractRemovalKeys } from '../../src/shared/utils/commonUtils';
import {
  loadCreditCardContext,
  safeBuildCreditCardRows,
  safeGetCreditCardMonths,
  applyCreditCardPaidFromExpensePayload,
  applyCreditCardPaidForKey,
  stripCreditCardKeys
} from '../../src/shared/utils/backend/creditCardSync';
import { isCreditCardRowKey } from '../../src/shared/utils/creditCardBasics';
import { buildDefaultExpenseRows, DEFAULT_EXPENSE_ITEMS } from '../../src/shared/utils/expenseDefaults';
import { getUserBankAccountNames, getUserBankAccounts } from '../../lib/userStore';
import {
  isJsonMode,
  withGeneratedId,
  getMongoCollection
} from '../../lib/dataSource';
import {
  enforceSharedMonthWindowJson,
  enforceSharedMonthWindowMongo
} from '../../src/shared/utils/backend/sharedMonthWindow';
import {
  getUserData,
  updateUserData,
} from '../../src/backend/data/userUtils';
import { withAudit } from '../../lib/auditedMutation';

type ExpenseData = Record<string, unknown> & {
  month?: string;
  bankAccounts?: string[];
  accountSummary?: Record<string, number>;
  totalActualPaid?: number;
  __removeKeys?: unknown;
};
type ExpenseBucket = Record<string, ExpenseData>;
type CreditCardSyncContext = Awaited<ReturnType<typeof loadCreditCardContext>>;
type DerivedCreditCardRows = ReturnType<typeof safeBuildCreditCardRows>;

const COLLECTION_NAME = 'monthly_expense'; // ชื่อ collection ใน MongoDB
const JSON_FILENAME = 'monthly_expense.json'; // ไฟล์ JSON สำหรับโหมด file-based

function isRecord(value: unknown): value is ExpenseData {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * โหลด context สำหรับ inject แถวบัตรเครดิต (ADR-009 · ADR-011)
 * ความล้มเหลวทุกกรณีถูกกลืนและคืน null — บัตรเครดิตต้องไม่มีทางทำให้หน้ารายจ่ายพัง
 * @param {string} userId
 * @returns {Promise<object|null>}
 */
async function loadCreditCardSyncContext(userId: string): Promise<CreditCardSyncContext> {
  try {
    let bankAccounts: unknown[] = [];
    try {
      bankAccounts = await getUserBankAccounts(userId);
    } catch (err) {
      bankAccounts = [];
    }
    return await loadCreditCardContext(userId, bankAccounts);
  } catch (err) {
    console.error('Credit card sync: context unavailable for user', userId, err);
    return null;
  }
}

/**
 * สร้าง response ของเดือนที่ยังไม่มีเอกสาร แต่มีแถวบัตรเครดิต (Stage 4 MAJOR-1)
 * @param {object} derived - แถวที่ derive มา
 * @returns {object} flat object พร้อมสรุปยอด
 */
function buildDerivedOnlyMonth(derived: DerivedCreditCardRows): ExpenseData {
  const flat: ExpenseData = { ...derived };
  flat.accountSummary = getAccountSummary(flat, []);
  flat.totalActualPaid = getExpenseTotals(flat).totalActualPaid;
  return flat;
}

/**
 * เติมเดือนที่มีเฉพาะแถวบัตรเครดิต (ยังไม่มีเอกสารเก็บไว้) เข้าไปใน map ของ branch "ทุกเดือน"
 * ถ้าไม่ทำขั้นนี้ แผน 10 งวดจะเห็นแค่เดือนที่เคยบันทึกไว้เท่านั้น
 * และเดือนที่มีแต่ยอดหมุนเวียนจะหายไปทั้งเดือน (AC-34 / AC-54)
 * @param {object} withTotals - map เดือน → flat (แก้ไขในที่)
 * @param {object|null} context
 */
function mergeCreditCardOnlyMonths(withTotals: Record<string, ExpenseData>, context: CreditCardSyncContext): void {
  if (!context) return;
  safeGetCreditCardMonths(context).forEach(monthKey => {
    if (withTotals[monthKey]) return;
    const derived = safeBuildCreditCardRows(context, monthKey);
    if (!Object.keys(derived).length) return;
    withTotals[monthKey] = buildDerivedOnlyMonth(derived);
  });
}

/**
 * ขั้นตอน POST: เขียน paid ของงวดผ่อน/ยอดหมุนเวียนกลับเข้าแผน แล้วคืน payload ที่ปลอดคีย์ cci_/ccr_
 * การ sync ล้มเหลวไม่ทำให้การบันทึกรายจ่ายล้มเหลว — log แล้วบันทึกต่อ (R-2)
 * @param {string} userId
 * @param {object} expenseData
 * @param {string} month - บังคับ เพราะคีย์ ccr_ ไม่ได้เข้ารหัสเดือนไว้ในตัวเอง (ADR-011)
 * @returns {Promise<object>} payload ที่พร้อมบันทึก
 */
async function applyCreditCardPaid(userId: string, expenseData: ExpenseData, month: string): Promise<ExpenseData> {
  try {
    await applyCreditCardPaidFromExpensePayload(userId, expenseData, month);
  } catch (err) {
    console.error('Credit card sync: failed to write paid state back to credit card store', err);
  }
  const payload = stripCreditCardKeys(expenseData);
  if (!payload) throw new Error('Credit card sync returned an empty expense payload');
  return payload;
}

/**
 * แปลง Mongo doc เป็น flat object อย่างปลอดภัย (ตัด _id/userId ก่อน map)
 * คืน null ถ้า mapping ล้มเหลว — เรียกใช้ได้ทั้งจาก single-month และ all-months branch
 * เพื่อไม่ให้ GET handler มี try/catch ซ้อนหลายชั้น (TD-M02)
 * @param {object} doc - Mongo document ดิบ (มี _id/userId ติดมาด้วย)
 * @param {string} monthLabel - เดือนของ doc นี้ ใช้สำหรับ log เท่านั้น
 * @returns {object|null}
 */
function safeMapExpenseDoc(doc: Record<string, unknown>, monthLabel: string): ExpenseData | null {
  try {
    const docForMapping = { ...doc };
    delete docForMapping._id;
    delete docForMapping.userId;
    return { ...stripCreditCardKeys(mapDocToFlatItemObjectWithTotals(docForMapping)) };
  } catch (err) {
    console.error('Error mapping expense doc for month:', monthLabel, err, doc);
    return null;
  }
}

/**
 * อ่านข้อมูลค่าใช้จ่ายในโหมด JSON
 * - ถ้ามีเดือน: คืนข้อมูลเดือนนั้นพร้อมสรุปยอด
 * - ถ้าไม่มีเดือน: คืนข้อมูลทุกเดือน
 * @param {object} req - Express request
 * @param {object} res - Express response
 * @param {string} userId - รหัสผู้ใช้
 */
async function handleJsonExpenseGet(req: NextApiRequest, res: NextApiResponse, userId: string) {
  const bucket = getUserData(JSON_FILENAME, userId) as ExpenseBucket;
  const queryMonth = req.query.month;
  const month = Array.isArray(queryMonth) ? queryMonth.join(',') : queryMonth;
  const context = await loadCreditCardSyncContext(userId);

  if (month) {
    const doc = bucket[month];
    const derived = safeBuildCreditCardRows(context, month, doc?.bankAccounts);
    // เดือนที่ยังไม่เคยบันทึก แต่มีงวดผ่อนครบกำหนด ต้องคืนแถวนั้นด้วย (AC-31)
    if (!doc) {
      if (!Object.keys(derived).length) return res.status(200).json({});
      return res.status(200).json(buildDerivedOnlyMonth(derived));
    }
    const flat: ExpenseData = { ...stripCreditCardKeys(mapDocToFlatItemObjectWithTotals(doc)) };
    // merge หลัง mapDocToFlatItemObjectWithTotals เสมอ เพราะ legacy branch ของมัน hardcode paid: false
    Object.assign(flat, derived);
    flat.accountSummary = getAccountSummary(flat, flat.bankAccounts);
    const totals = getExpenseTotals(flat);
    flat.totalActualPaid = totals.totalActualPaid;
    return res.status(200).json(flat);
  }

  const withTotals: Record<string, ExpenseData> = {};
  Object.entries(bucket).forEach(([monthKey, doc]: [string, ExpenseData]) => {
    if (!doc || !doc.month) return;
    const flat: ExpenseData = { ...stripCreditCardKeys(mapDocToFlatItemObjectWithTotals(doc)) };
    Object.assign(flat, safeBuildCreditCardRows(context, monthKey, doc.bankAccounts));
    flat.accountSummary = getAccountSummary(flat, flat.bankAccounts);
    const totals = getExpenseTotals(flat);
    flat.totalActualPaid = totals.totalActualPaid;
    withTotals[monthKey] = flat;
  });
  mergeCreditCardOnlyMonths(withTotals, context);
  return res.status(200).json(withTotals);
}

/**
 * บันทึกข้อมูลค่าใช้จ่ายในโหมด JSON
 * รองรับรายการที่ต้องลบผ่าน __removeKeys
 * @param {object} req - Express request
 * @param {object} res - Express response
 * @param {string} userId - รหัสผู้ใช้
 */
async function handleJsonExpensePost(req: NextApiRequest, res: NextApiResponse, userId: string) {
  const body = parseRequestBody(req, res, monthlyExpensePostBodySchema);
  if (!body) return;
  const { month } = body;
  const expense_data = body.expense_data as ExpenseData;
  // เขียนเฉพาะ paid กลับเข้าแผนผ่อน/ยอดหมุนเวียน แล้วตัดคีย์ cci_/ccr_ ทิ้งก่อนบันทึก
  // (BR-CC-007 · BR-CC-016) — month จำเป็นเพราะคีย์ ccr_ ไม่ได้เข้ารหัสเดือนไว้ในตัวเอง
  const payload = await applyCreditCardPaid(userId, expense_data, month);
  const removalList = extractRemovalKeys(payload);
  const cleanData = stripKnownTotalFields(payload ?? {});
  delete cleanData.__removeKeys;
  updateUserData(JSON_FILENAME, userId, (bucket: ExpenseBucket) => {
    const nextBucket: ExpenseBucket = { ...bucket };
    const existing = nextBucket[month] || {};
    const merged: ExpenseData = { ...existing, ...cleanData, month };
    removalList.forEach(key => {
      if (key in merged) {
        delete merged[key];
      }
    });
    nextBucket[month] = withGeneratedId(merged);
    return nextBucket;
  });
  // จำกัดหน้าต่าง 15 เดือนแบบรวมทุก collection (expense/income/salary/investment) หลังเขียนไฟล์นี้แล้ว
  enforceSharedMonthWindowJson(userId, { extraMonth: month });
  return res.status(200).json({ success: true });
}

type PaidPatchPlan =
  | { kind: 'noop'; paid?: boolean }
  | { kind: 'paid' }
  | { kind: 'init'; rows: Record<string, unknown>; seeded: boolean }
  | { kind: 'error'; status: number; error: string };

interface PaidPatchIo {
  apply: (
    month: string,
    planFn: (doc: ExpenseData | undefined) => PaidPatchPlan,
    key: string,
    paid: boolean
  ) => Promise<PaidPatchPlan>;
}

const NON_ROW_FIELDS = new Set(['month', '_id', 'id', 'userId', 'bankAccounts', 'accountSummary', 'totalActualPaid']);

function isOrdinaryRow(doc: ExpenseData, field: string): boolean {
  return !NON_ROW_FIELDS.has(field) && !isCreditCardRowKey(field) && isRecord(doc[field]);
}

function normalizeAmount(value: unknown): number {
  const num = typeof value === 'number' ? value : Number(String(value ?? '').replace(/,/g, ''));
  return Number.isFinite(num) ? num : 0;
}

/** วางแผนการเขียน paid ของแถวปกติแถวเดียว (ADR-028) — ฟังก์ชันล้วน ไม่มี side effect */
function planPaidPatch(
  doc: ExpenseData | undefined,
  body: z.infer<typeof monthlyExpensePatchBodySchema>,
  bankAccounts: string[]
): PaidPatchPlan {
  const { key, paid, row } = body;
  const existingRow = doc && isOrdinaryRow(doc, key) ? (doc[key] as Record<string, unknown>) : null;
  if (existingRow) {
    if (existingRow.paid === paid) return { kind: 'noop', paid };
    return { kind: 'paid' };
  }
  if (doc && isRecord(doc.actual)) {
    return { kind: 'error', status: 409, error: 'Legacy expense document cannot be updated per row' };
  }

  const hasOrdinaryRows = !!doc && Object.keys(doc).some(field => isOrdinaryRow(doc, field));
  const isDefaultKey = DEFAULT_EXPENSE_ITEMS.some(item => item.key === key);
  if (isDefaultKey && !hasOrdinaryRows) {
    const accounts = (doc?.bankAccounts && Array.isArray(doc.bankAccounts) ? doc.bankAccounts : bankAccounts) as string[];
    const rows: Record<string, unknown> = buildDefaultExpenseRows(accounts);
    rows[key] = { ...(rows[key] as object), paid };
    return { kind: 'init', rows, seeded: true };
  }

  if (!paid) return { kind: 'noop', paid: false };
  if (!row) return { kind: 'error', status: 404, error: 'Expense row not found' };
  return {
    kind: 'init',
    seeded: false,
    rows: {
      [key]: {
        name: row.name,
        actual: normalizeAmount(row.actual),
        account: row.account,
        dueDay: row.dueDay,
        paid: true
      }
    }
  };
}

/**
 * PATCH /api/monthly_expense — ตั้งค่า paid ของแถวเดียวแบบ strict (ADR-028)
 * แถว cci_/ccr_ ไปที่ creditCardSync เท่านั้น ไม่เคยถูกเก็บใน monthly_expense
 */
async function handleExpensePaidPatch(
  req: NextApiRequest,
  res: NextApiResponse,
  userId: string,
  io: PaidPatchIo
) {
  const body = parseRequestBody(req, res, monthlyExpensePatchBodySchema);
  if (!body) return;
  const { month, key, paid, paymentAction } = body;

  if (isCreditCardRowKey(key)) {
    // ccr_ = แถวยอดรวมบัตร: จ่าย/ยกเลิกทั้งบัตรในการเขียนครั้งเดียว (spec-credit-card-spend §5.3)
    const result = await applyCreditCardPaidForKey(userId, key, paid, month, paymentAction);
    if (result.status === 'ok') {
      return res.status(200).json({ success: true, paid: result.paid, initialized: false });
    }
    if (result.status === 'not_found') return res.status(404).json({ error: 'Credit card row not found' });
    if (result.status === 'cancelled') return res.status(409).json({ error: 'Credit card plan is cancelled' });
    if (result.status === 'needs_choice') {
      // ยอดหมุนเวียน totalDue > 0 ยังไม่มีการตัดสินใจ — client ต้องส่ง paymentAction 'full' | 'minimum' (SPEND-5)
      return res.status(409).json({ error: 'needs_choice', message: 'กรุณาเลือกจ่ายเต็มจำนวนหรือขั้นต่ำสำหรับยอดหมุนเวียน' });
    }
    return res.status(409).json({ error: 'Revolving cycle limit reached' });
  }

  let bankAccounts: string[] = [];
  try {
    bankAccounts = await getUserBankAccountNames(userId);
  } catch (err) {
    bankAccounts = [];
  }

  const plan = await io.apply(month, doc => planPaidPatch(doc, body, bankAccounts), key, paid);
  if (plan.kind === 'error') return res.status(plan.status).json({ error: plan.error });
  if (plan.kind === 'noop') return res.status(200).json({ success: true, paid: plan.paid ?? paid, initialized: false });
  return res.status(200).json({
    success: true,
    paid,
    initialized: plan.kind === 'init',
    ...(plan.kind === 'init' && plan.seeded ? { seeded: true } : {})
  });
}

/**
 * ตัวจัดการหลักของ API ค่าใช้จ่ายรายเดือน
 * เลือกเส้นทางตามโหมด (JSON/MongoDB) และ method
 * @param {object} req - Express request
 * @param {object} res - Express response
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  const userId = assertUserId(req, res);
  if (!userId) return;
  if (!validateApiRequest(req, res, 'monthly_expense')) return;

  if (isJsonMode()) {
    if (req.method === 'GET') {
      return await handleJsonExpenseGet(req, res, userId);
    }
    if (req.method === 'POST') {
      return await handleJsonExpensePost(req, res, userId);
    }
    if (req.method === 'PATCH') {
      try {
        return await handleExpensePaidPatch(req, res, userId, {
          apply: async (month, planFn, key, paid) => {
            const holder: { plan: PaidPatchPlan } = { plan: { kind: 'noop' } };
            updateUserData(JSON_FILENAME, userId, (bucket: ExpenseBucket) => {
              const existing = bucket[month];
              const plan = planFn(existing);
              holder.plan = plan;
              if (plan.kind === 'paid') {
                const current = (existing as ExpenseData)[key] as Record<string, unknown>;
                return { ...bucket, [month]: { ...existing, [key]: { ...current, paid } } as ExpenseData };
              }
              if (plan.kind === 'init') {
                return { ...bucket, [month]: withGeneratedId({ ...(existing || {}), ...plan.rows, month }) };
              }
              return bucket;
            });
            const plan = holder.plan;
            if (plan.kind === 'paid' || plan.kind === 'init') {
              enforceSharedMonthWindowJson(userId, { extraMonth: month });
            }
            return plan;
          }
        });
      } catch (error) {
        console.error('Failed to update paid state (json PATCH):', error);
        return res.status(500).json({ error: 'Failed to write monthly expense data' });
      }
      return;
    }
    return res.status(405).end();
  }

  let collection: Collection<Document>;
  try {
    collection = await getMongoCollection(COLLECTION_NAME);
  } catch (err) {
    console.error('DB connection or collection error:', err);
    return res.status(500).json({ error: 'Database connection error' });
  }
  const userFilter = { userId };

  if (req.method === 'GET') {
    try {
      const queryMonth = req.query.month;
      const month = Array.isArray(queryMonth) ? queryMonth.join(',') : queryMonth;
      const context = await loadCreditCardSyncContext(userId);

      if (month) {
        const doc = await collection.findOne({ month, ...userFilter });
        const derived = safeBuildCreditCardRows(context, month, doc?.bankAccounts);
        const derivedOnlyOrEmpty = () => (
          Object.keys(derived).length ? buildDerivedOnlyMonth(derived) : {}
        );

        if (!doc || typeof doc !== 'object') {
          // เดือนที่ยังไม่เคยบันทึก แต่มีงวดผ่อนครบกำหนด ต้องคืนแถวนั้นด้วย (AC-31)
          if (!Object.keys(derived).length) {
            console.error('No expense data found for this month:', month);
          }
          return res.status(200).json(derivedOnlyOrEmpty());
        }

        const mapped = safeMapExpenseDoc(doc, month);
        if (mapped === null) {
          // มี doc แต่ map ไม่สำเร็จ — เสื่อมสภาพเป็น derived-only/empty เหมือนกรณีไม่มี doc (soft-fail)
          return res.status(200).json(derivedOnlyOrEmpty());
        }

        // merge ก่อนเช็คว่าว่างหรือไม่ มิฉะนั้นเดือนที่มีแต่แถวผ่อนจะถูกทิ้ง
        const flat: ExpenseData = { ...mapped, ...derived };
        if (Object.keys(flat).length === 0) {
          console.error('Malformed expense data for this month:', month, flat);
          return res.status(200).json({});
        }

        flat.accountSummary = getAccountSummary(flat, flat.bankAccounts);
        const totals = getExpenseTotals(flat);
        flat.totalActualPaid = totals.totalActualPaid;
        return res.status(200).json(flat);
      }

      const allDocs = await collection.find({ ...userFilter, month: { $exists: true } }).toArray();
      const withTotals: Record<string, ExpenseData> = {};
      allDocs.forEach(doc => {
        // ข้าม document ที่เป็น metadata หรือโครงสร้างไม่ถูกต้อง
        if (!doc || typeof doc !== 'object') return;
        if (!doc.month || doc.months || doc.items) return;
        const flat = safeMapExpenseDoc(doc, doc.month);
        if (!flat || Object.keys(flat).length === 0) return;
        Object.assign(flat, safeBuildCreditCardRows(context, doc.month, doc.bankAccounts));
        flat.accountSummary = getAccountSummary(flat, flat.bankAccounts);
        const totals = getExpenseTotals(flat);
        flat.totalActualPaid = totals.totalActualPaid;
        withTotals[doc.month] = flat;
      });
      // เดือนที่มีเฉพาะงวดผ่อน (ยังไม่มีเอกสาร) ต้องปรากฏใน branch ทุกเดือนด้วย (AC-34)
      mergeCreditCardOnlyMonths(withTotals, context);
      return res.status(200).json(withTotals);
    } catch (error) {
      console.error('Failed to read monthly expense data (mongo GET):', {
        userId,
        month: req.query?.month
      }, error);
      return res.status(500).json({ error: 'Failed to read monthly expense data' });
    }
  } else if (req.method === 'POST') {
    try {
      const body = parseRequestBody(req, res, monthlyExpensePostBodySchema);
      if (!body) return;
      const { month } = body;
      const expense_data = body.expense_data as ExpenseData;
      // เขียนเฉพาะ paid กลับเข้าแผนผ่อน/ยอดหมุนเวียน แล้วตัดคีย์ cci_/ccr_ ทิ้งก่อนบันทึก
      // (BR-CC-007 · BR-CC-016) — month จำเป็นเพราะคีย์ ccr_ ไม่ได้เข้ารหัสเดือนไว้ในตัวเอง
      const payload = await applyCreditCardPaid(userId, expense_data, month);
      // ลบ field summary ก่อนบันทึก
      const removalList = extractRemovalKeys(payload);
      const cleanData = stripKnownTotalFields(payload ?? {});
      delete cleanData.__removeKeys;
      const removalSet = new Set(removalList);
      const setData = Object.fromEntries(
        Object.entries(cleanData).filter(([key]) => !removalSet.has(key))
      );
      const updateOps: Document = {
        $set: { ...setData, month, ...userFilter },
      };
      if (removalList.length) {
        updateOps.$unset = removalList.reduce<Record<string, number>>((acc, key) => {
          acc[key] = 1;
          return acc;
        }, {});
      }
      await collection.updateOne(
        { month, ...userFilter },
        updateOps,
        { upsert: true }
      );
      // จำกัดหน้าต่าง 15 เดือนแบบรวมทุก collection (expense/income/salary/investment)
      await enforceSharedMonthWindowMongo(userId, { extraMonth: month });
      res.status(200).json({ success: true });
    } catch (error) {
      res.status(500).json({ error: 'Failed to write monthly expense data' });
    }
  } else if (req.method === 'PATCH') {
    try {
      return await handleExpensePaidPatch(req, res, userId, {
        apply: async (month, planFn, key, paid) => {
          const doc = await collection.findOne({ month, ...userFilter });
          const plan = planFn(doc ? (doc as ExpenseData) : undefined);
          if (plan.kind === 'paid') {
            await collection.updateOne({ month, ...userFilter }, { $set: { [`${key}.paid`]: paid } });
          } else if (plan.kind === 'init') {
            await collection.updateOne(
              { month, ...userFilter },
              { $set: { ...plan.rows, month, ...userFilter } },
              { upsert: true }
            );
          }
          if (plan.kind === 'paid' || plan.kind === 'init') {
            await enforceSharedMonthWindowMongo(userId, { extraMonth: month });
          }
          return plan;
        }
      });
    } catch (error) {
      console.error('Failed to update paid state (mongo PATCH):', error);
      return res.status(500).json({ error: 'Failed to write monthly expense data' });
    }
  } else {
    res.status(405).end();
  }
}

export default withAudit(handler, { source: 'monthly_expense' });
