/**
 * API: pages/api/monthly_expense.js
 * จัดการข้อมูลค่าใช้จ่ายรายเดือน
 * รองรับทั้ง JSON และ MongoDB
 * - GET: อ่านข้อมูลรายเดือนหรือทั้งหมด
 * - POST: บันทึก/อัปเดตข้อมูลและลบรายการที่ถูกลบ
 * - จำกัดข้อมูลย้อนหลังสูงสุด 15 เดือน
 * - คำนวณสรุปยอดตามบัญชีและยอดรวมค่าใช้จ่าย
 */

import { mapDocToFlatItemObjectWithTotals, removeSummaryFields, enforceMonthLimit } from '../../src/shared/utils/backend/apiUtils.js';
import { assertUserId } from '../../src/shared/utils/backend/userRequest.js';
import { getAccountSummary, getExpenseTotals, extractRemovalKeys } from '../../src/shared/utils/commonUtils.js';
import {
  isJsonMode,
  withGeneratedId,
  getMongoCollection
} from '../../lib/dataSource.js';

const {
  getUserData,
  updateUserData,
  limitUserEntries,
} = require('../../src/backend/data/userUtils');

const COLLECTION_NAME = 'monthly_expense'; // ชื่อ collection ใน MongoDB
const JSON_FILENAME = 'monthly_expense.json'; // ไฟล์ JSON สำหรับโหมด file-based
const MONTH_LIMIT = 15; // จำกัดข้อมูลย้อนหลังสูงสุด 15 เดือนต่อผู้ใช้

/**
 * จำกัดจำนวนเดือนข้อมูลต่อผู้ใช้ไว้ที่ 15 เดือน
 * @param {object} bucket - ข้อมูลรายเดือนของผู้ใช้
 * @returns {object} bucket ที่ถูกจำกัดจำนวนเดือนแล้ว
 */
function enforceUserMonthLimit(bucket = {}) {
  return limitUserEntries(bucket, {
    limit: MONTH_LIMIT,
    keySelector: (_, value) => value?.month || ''
  });
}

/**
 * อ่านข้อมูลค่าใช้จ่ายในโหมด JSON
 * - ถ้ามีเดือน: คืนข้อมูลเดือนนั้นพร้อมสรุปยอด
 * - ถ้าไม่มีเดือน: คืนข้อมูลทุกเดือน
 * @param {object} req - Express request
 * @param {object} res - Express response
 * @param {string} userId - รหัสผู้ใช้
 */
function handleJsonExpenseGet(req, res, userId) {
  const bucket = getUserData(JSON_FILENAME, userId);
  const { month } = req.query;
  if (month) {
    const doc = bucket[month];
    if (!doc) return res.status(200).json({});
    let flat = mapDocToFlatItemObjectWithTotals(doc);
    flat.accountSummary = getAccountSummary(flat);
    const totals = getExpenseTotals(flat);
    flat.totalEstimate = totals.totalEstimate;
    flat.totalActualPaid = totals.totalActualPaid;
    return res.status(200).json(flat);
  }
  const withTotals = {};
  Object.entries(bucket).forEach(([monthKey, doc]) => {
    if (!doc || !doc.month) return;
    let flat = mapDocToFlatItemObjectWithTotals(doc);
    flat.accountSummary = getAccountSummary(flat);
    const totals = getExpenseTotals(flat);
    flat.totalEstimate = totals.totalEstimate;
    flat.totalActualPaid = totals.totalActualPaid;
    withTotals[monthKey] = flat;
  });
  return res.status(200).json(withTotals);
}

/**
 * บันทึกข้อมูลค่าใช้จ่ายในโหมด JSON
 * รองรับรายการที่ต้องลบผ่าน __removeKeys
 * @param {object} req - Express request
 * @param {object} res - Express response
 * @param {string} userId - รหัสผู้ใช้
 */
function handleJsonExpensePost(req, res, userId) {
  const { month, expense_data } = req.body;
  if (!month || !expense_data) {
    return res.status(400).json({ error: 'month and expense_data required' });
  }
  const removalList = extractRemovalKeys(expense_data);
  const cleanData = removeSummaryFields(expense_data);
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
    return enforceUserMonthLimit(nextBucket);
  });
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
      return handleJsonExpenseGet(req, res, userId);
    }
    if (req.method === 'POST') {
      return handleJsonExpensePost(req, res, userId);
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

      if (month) {
        let doc;
        try {
          doc = await collection.findOne({ month, ...userFilter });
          if (!doc) {
            doc = await collection.findOne({ month, userId: { $exists: false } });
          }
        } catch (err) {
          console.error('Error fetching doc for month:', month, err);
          return res.status(500).json({ error: 'Database query error' });
        }
        if (!doc || typeof doc !== 'object') {
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
          return res.status(200).json({});
        }
        if (!flat || Object.keys(flat).length === 0) {
          console.error('Malformed expense data for this month:', month, flat);
          return res.status(200).json({});
        }
        try {
          flat.accountSummary = getAccountSummary(flat);
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
          flat.totalEstimate = totals.totalEstimate;
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
          flat.accountSummary = getAccountSummary(flat);
          const totals = getExpenseTotals(flat);
          flat.totalEstimate = totals.totalEstimate;
          flat.totalActualPaid = totals.totalActualPaid;
          withTotals[doc.month] = flat;
        });
        res.status(200).json(withTotals);
      }
    } catch (error) {
      res.status(500).json({ error: 'Failed to read monthly expense data' });
    }
  } else if (req.method === 'POST') {
    try {
      const { month, expense_data } = req.body;
      if (month && expense_data) {
        // ลบ field summary ก่อนบันทึก
        const removalList = extractRemovalKeys(expense_data);
        const cleanData = removeSummaryFields(expense_data);
        delete cleanData.__removeKeys;
        const updateOps = {
          $set: { ...cleanData, month, ...userFilter },
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
        await enforceMonthLimit(collection, 15, { filter: userFilter });
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
