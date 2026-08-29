/**
 * API: pages/api/monthly_expense.js
 * จัดการข้อมูลค่าใช้จ่ายรายเดือน
 * รองรับทั้ง JSON และ MongoDB
 * - GET: อ่านข้อมูลรายเดือนหรือทั้งหมด
 * - POST: บันทึก/อัปเดตข้อมูลและลบรายการที่ถูกลบ
 * - จำกัดข้อมูลย้อนหลังสูงสุด 15 เดือน
 * - คำนวณสรุปยอดตามบัญชีและยอดรวมค่าใช้จ่าย
 */

import { mapDocToFlatItemObjectWithTotals, removeSummaryFields } from '../../src/shared/utils/backend/apiUtils.js';
import { assertUserId } from '../../src/shared/utils/backend/userRequest.js';
import { getAccountSummary, getExpenseTotals, extractRemovalKeys } from '../../src/shared/utils/commonUtils.js';
import {
  loadCreditCardContext,
  safeBuildCreditCardRows,
  safeGetCreditCardMonths,
  applyCreditCardPaidFromExpensePayload,
  stripCreditCardKeys
} from '../../src/shared/utils/backend/creditCardSync.js';
import { getUserBankAccounts } from '../../lib/userStore.js';
import {
  isJsonMode,
  withGeneratedId,
  getMongoCollection
} from '../../lib/dataSource.js';
import {
  enforceSharedMonthWindowJson,
  enforceSharedMonthWindowMongo
} from '../../src/shared/utils/backend/sharedMonthWindow.js';
import {
  getUserData,
  updateUserData,
} from '../../src/backend/data/userUtils.js';

const COLLECTION_NAME = 'monthly_expense'; // ชื่อ collection ใน MongoDB
const JSON_FILENAME = 'monthly_expense.json'; // ไฟล์ JSON สำหรับโหมด file-based

/**
 * โหลด context สำหรับ inject แถวบัตรเครดิต (ADR-009 · ADR-011)
 * ความล้มเหลวทุกกรณีถูกกลืนและคืน null — บัตรเครดิตต้องไม่มีทางทำให้หน้ารายจ่ายพัง
 * @param {string} userId
 * @returns {Promise<object|null>}
 */
async function loadCreditCardSyncContext(userId) {
  try {
    let bankAccounts = [];
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
function buildDerivedOnlyMonth(derived) {
  const flat = { ...derived };
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
function mergeCreditCardOnlyMonths(withTotals, context) {
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
async function applyCreditCardPaid(userId, expenseData, month) {
  try {
    await applyCreditCardPaidFromExpensePayload(userId, expenseData, month);
  } catch (err) {
    console.error('Credit card sync: failed to write paid state back to credit card store', err);
  }
  return stripCreditCardKeys(expenseData);
}

/**
 * อ่านข้อมูลค่าใช้จ่ายในโหมด JSON
 * - ถ้ามีเดือน: คืนข้อมูลเดือนนั้นพร้อมสรุปยอด
 * - ถ้าไม่มีเดือน: คืนข้อมูลทุกเดือน
 * @param {object} req - Express request
 * @param {object} res - Express response
 * @param {string} userId - รหัสผู้ใช้
 */
async function handleJsonExpenseGet(req, res, userId) {
  const bucket = getUserData(JSON_FILENAME, userId);
  const { month } = req.query;
  const context = await loadCreditCardSyncContext(userId);

  if (month) {
    const doc = bucket[month];
    const derived = safeBuildCreditCardRows(context, month, doc?.bankAccounts);
    // เดือนที่ยังไม่เคยบันทึก แต่มีงวดผ่อนครบกำหนด ต้องคืนแถวนั้นด้วย (AC-31)
    if (!doc) {
      if (!Object.keys(derived).length) return res.status(200).json({});
      return res.status(200).json(buildDerivedOnlyMonth(derived));
    }
    let flat = mapDocToFlatItemObjectWithTotals(doc);
    // merge หลัง mapDocToFlatItemObjectWithTotals เสมอ เพราะ legacy branch ของมัน hardcode paid: false
    Object.assign(flat, derived);
    flat.accountSummary = getAccountSummary(flat, flat.bankAccounts);
    const totals = getExpenseTotals(flat);
    flat.totalActualPaid = totals.totalActualPaid;
    return res.status(200).json(flat);
  }

  const withTotals = {};
  Object.entries(bucket).forEach(([monthKey, doc]) => {
    if (!doc || !doc.month) return;
    let flat = mapDocToFlatItemObjectWithTotals(doc);
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
async function handleJsonExpensePost(req, res, userId) {
  const { month, expense_data } = req.body;
  if (!month || !expense_data) {
    return res.status(400).json({ error: 'month and expense_data required' });
  }
  // เขียนเฉพาะ paid กลับเข้าแผนผ่อน/ยอดหมุนเวียน แล้วตัดคีย์ cci_/ccr_ ทิ้งก่อนบันทึก
  // (BR-CC-007 · BR-CC-016) — month จำเป็นเพราะคีย์ ccr_ ไม่ได้เข้ารหัสเดือนไว้ในตัวเอง
  const payload = await applyCreditCardPaid(userId, expense_data, month);
  const removalList = extractRemovalKeys(payload);
  const cleanData = removeSummaryFields(payload);
  delete cleanData.__removeKeys;
  updateUserData(JSON_FILENAME, userId, (bucket) => {
    const nextBucket = { ...bucket };
    const existing = nextBucket[month] || {};
    const merged = { ...existing, ...cleanData, month };
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

/**
 * ตัวจัดการหลักของ API ค่าใช้จ่ายรายเดือน
 * เลือกเส้นทางตามโหมด (JSON/MongoDB) และ method
 * @param {object} req - Express request
 * @param {object} res - Express response
 */
export default async function handler(req, res) {
  const userId = assertUserId(req, res);
  if (!userId) return;

  if (isJsonMode()) {
    if (req.method === 'GET') {
      return await handleJsonExpenseGet(req, res, userId);
    }
    if (req.method === 'POST') {
      return await handleJsonExpensePost(req, res, userId);
    }
    return res.status(405).end();
  }

  let collection;
  try {
    collection = await getMongoCollection(COLLECTION_NAME);
  } catch (err) {
    console.error('DB connection or collection error:', err);
    return res.status(500).json({ error: 'Database connection error' });
  }
  const userFilter = { userId };

  if (req.method === 'GET') {
    try {
      const { month } = req.query;
      const context = await loadCreditCardSyncContext(userId);

      if (month) {
        let doc;
        try {
          doc = await collection.findOne({ month, ...userFilter });
          if (!doc) {
            doc = await collection.findOne({ month, userId: { $exists: false } });
            if (doc) {
              try {
                await collection.updateOne({ _id: doc._id }, { $set: { userId } });
              } catch (err) {
                console.error('Failed to claim legacy doc for user', userId, month, err);
                // Non-fatal — the read below still succeeds with the (now stale) unscoped copy this request.
              }
            }
          }
        } catch (err) {
          console.error('Error fetching doc for month:', month, err);
          return res.status(500).json({ error: 'Database query error' });
        }
        const derived = safeBuildCreditCardRows(context, month, doc?.bankAccounts);
        if (!doc || typeof doc !== 'object') {
          // เดือนที่ยังไม่เคยบันทึก แต่มีงวดผ่อนครบกำหนด ต้องคืนแถวนั้นด้วย (AC-31)
          if (Object.keys(derived).length) {
            return res.status(200).json(buildDerivedOnlyMonth(derived));
          }
          console.error('No expense data found for this month:', month);
          return res.status(200).json({});
        }
        let flat;
        try {
          const docForMapping = { ...doc };
          delete docForMapping._id;
          delete docForMapping.userId;
          flat = mapDocToFlatItemObjectWithTotals(docForMapping);
        } catch (err) {
          console.error('Error mapping expense doc for month:', month, err, doc);
          if (Object.keys(derived).length) {
            return res.status(200).json(buildDerivedOnlyMonth(derived));
          }
          return res.status(200).json({});
        }
        // merge ก่อนเช็คว่าว่างหรือไม่ มิฉะนั้นเดือนที่มีแต่แถวผ่อนจะถูกทิ้ง
        flat = Object.assign(flat || {}, derived);
        if (Object.keys(flat).length === 0) {
          console.error('Malformed expense data for this month:', month, flat);
          return res.status(200).json({});
        }
        try {
          flat.accountSummary = getAccountSummary(flat, flat.bankAccounts);
        } catch (err) {
          console.error('Error in getAccountSummary:', month, err, flat);
          return res.status(500).json({ error: 'Error in account summary calculation' });
        }
        let totals;
        try {
          totals = getExpenseTotals(flat);
        } catch (err) {
          console.error('Error in getExpenseTotals:', month, err, flat);
          return res.status(500).json({ error: 'Error in expense totals calculation' });
        }
        try {
          flat.totalActualPaid = totals.totalActualPaid;
        } catch (err) {
          console.error('Error setting totals in flat:', month, err, flat, totals);
          return res.status(500).json({ error: 'Error setting totals in response' });
        }
        try {
          res.status(200).json(flat);
        } catch (err) {
          console.error('Error serializing response:', month, err, flat);
          return res.status(500).json({ error: 'Error serializing response' });
        }
      } else {
        let allDocs = await collection.find({ ...userFilter, month: { $exists: true } }).toArray();
        if (!allDocs.length) {
          allDocs = await collection.find({ userId: { $exists: false }, month: { $exists: true } }).toArray();
          if (allDocs.length) {
            try {
              await Promise.all(allDocs.map(d => collection.updateOne({ _id: d._id }, { $set: { userId } })));
            } catch (err) {
              console.error('Failed to claim legacy docs for user', userId, err);
            }
          }
        }
        const withTotals = {};
        allDocs.forEach(doc => {
          // ข้าม document ที่เป็น metadata หรือโครงสร้างไม่ถูกต้อง
          if (!doc || typeof doc !== 'object') return;
          if (!doc.month || doc.months || doc.items) return;
          let flat;
          try {
            const docForMapping = { ...doc };
            delete docForMapping._id;
            delete docForMapping.userId;
            flat = mapDocToFlatItemObjectWithTotals(docForMapping);
          } catch (err) {
            console.error('Error mapping expense doc:', doc.month, err, doc);
            return;
          }
          if (!flat || Object.keys(flat).length === 0) return;
          Object.assign(flat, safeBuildCreditCardRows(context, doc.month, doc.bankAccounts));
          flat.accountSummary = getAccountSummary(flat, flat.bankAccounts);
          const totals = getExpenseTotals(flat);
          flat.totalActualPaid = totals.totalActualPaid;
          withTotals[doc.month] = flat;
        });
        // เดือนที่มีเฉพาะงวดผ่อน (ยังไม่มีเอกสาร) ต้องปรากฏใน branch ทุกเดือนด้วย (AC-34)
        mergeCreditCardOnlyMonths(withTotals, context);
        res.status(200).json(withTotals);
      }
    } catch (error) {
      res.status(500).json({ error: 'Failed to read monthly expense data' });
    }
  } else if (req.method === 'POST') {
    try {
      const { month, expense_data } = req.body;
      if (month && expense_data) {
        // เขียนเฉพาะ paid กลับเข้าแผนผ่อน/ยอดหมุนเวียน แล้วตัดคีย์ cci_/ccr_ ทิ้งก่อนบันทึก
        // (BR-CC-007 · BR-CC-016) — month จำเป็นเพราะคีย์ ccr_ ไม่ได้เข้ารหัสเดือนไว้ในตัวเอง
        const payload = await applyCreditCardPaid(userId, expense_data, month);
        // ลบ field summary ก่อนบันทึก
        const removalList = extractRemovalKeys(payload);
        const cleanData = removeSummaryFields(payload);
        delete cleanData.__removeKeys;
        const removalSet = new Set(removalList);
        const setData = Object.fromEntries(
          Object.entries(cleanData).filter(([key]) => !removalSet.has(key))
        );
        const updateOps = {
          $set: { ...setData, month, ...userFilter },
        };
        if (removalList.length) {
          updateOps.$unset = removalList.reduce((acc, key) => {
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
      } else {
        res.status(400).json({ error: 'month and expense_data required' });
      }
    } catch (error) {
      res.status(500).json({ error: 'Failed to write monthly expense data' });
    }
  } else {
    res.status(405).end();
  }
}
