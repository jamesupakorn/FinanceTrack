/**
 * API: pages/api/savings.js
 * จัดการข้อมูลเงินออมรายเดือน
 * รองรับทั้ง JSON และ MongoDB
 * - GET: อ่านข้อมูลรายเดือนหรือทั้งหมด
 * - POST: บันทึก/อัปเดตรายการเงินออมและยอดรวม
 * - คำนวณยอดรวมเงินออมอัตโนมัติ
 * - จำกัดข้อมูลย้อนหลังสูงสุด 15 เดือน
 */

import { calculateTotalSavings, enforceMonthLimit } from '../../src/shared/utils/backend/apiUtils';
import { assertUserId } from '../../src/shared/utils/backend/userRequest';
import {
  isJsonMode,
  withGeneratedId,
  getMongoCollection
} from '../../lib/dataSource';
import {
  getUserData,
  updateUserData,
  limitUserEntries,
} from '../../src/backend/data/userUtils.js';

const COLLECTION_NAME = 'savings';
const JSON_FILENAME = 'savings.json';
const MONTH_LIMIT = 15;

/**
 * Enforce the 15-month data limit per user
 * Removes oldest month entries when user exceeds MONTH_LIMIT threshold
 * Uses the month field from each entry to determine age and retention priority
 * @param {object} bucket - Object containing all months of user savings data
 * @returns {object} Limited bucket with maximum MONTH_LIMIT entries per user
 */
function enforceUserMonthLimit(bucket = {}) {
  return limitUserEntries(bucket, {
    limit: MONTH_LIMIT,
    keySelector: (_, value) => value?.month || ''
  });
}

/**
 * อ่านข้อมูลเงินออมในโหมด JSON
 * - ถ้ามีเดือน: คืนข้อมูลเดือนนั้นพร้อมยอดรวมที่คำนวณแล้ว
 * - ถ้าไม่มีเดือน: คืนข้อมูลทุกเดือนพร้อมยอดรวม (รวมเงินเก็บ)
 * @param {object} req - Express request
 * @param {object} res - Express response
 * @param {string} userId - รหัสผู้ใช้
 */
function handleJsonSavingsGet(req, res, userId) {
  const bucket = getUserData(JSON_FILENAME, userId);
  const { month } = req.query;
  if (month) {
    const doc = bucket[month];
    const savingsList = doc && Array.isArray(doc.savings_list) ? doc.savings_list : [];
    const response = {
      total_savings: doc && typeof doc.total_savings === 'number' ? doc.total_savings : 0,
      savings_list: savingsList,
      รวมเงินเก็บ: calculateTotalSavings(savingsList)
    };
    return res.status(200).json(response);
  }
  const data = {};
  Object.entries(bucket).forEach(([monthKey, doc]) => {
    if (!doc || !doc.month) return;
    const savingsList = doc.savings_list || [];
    const totalSavings = calculateTotalSavings(savingsList);
    data[monthKey] = {
      total_savings: doc.total_savings || 0,
      savings_list: savingsList,
      totalSavings,
      รวมเงินเก็บ: totalSavings
    };
  });
  return res.status(200).json(data);
}

/**
 * บันทึกข้อมูลเงินออมในโหมด JSON
 * ต้องระบุ month และสามารถส่ง savings_list/total_savings ได้
 * @param {object} req - Express request
 * @param {object} res - Express response
 * @param {string} userId - รหัสผู้ใช้
 */
function handleJsonSavingsPost(req, res, userId) {
  const { month, total_savings, savings_list, transfer } = req.body;
  if (!month) {
    return res.status(400).json({ error: 'month required' });
  }
  if (transfer) {
    const amount = Number(transfer.amount);
    const transferKey = typeof transfer.key === 'string' ? transfer.key.trim() : '';
    if (!Number.isFinite(amount) || amount <= 0 || !transferKey) {
      return res.status(400).json({ error: 'valid transfer amount and key required' });
    }
    let created = false;
    updateUserData(JSON_FILENAME, userId, (bucket) => {
      const nextBucket = { ...bucket };
      const existing = nextBucket[month] || { month, savings_list: [] };
      const existingList = Array.isArray(existing.savings_list) ? existing.savings_list : [];
      if (existingList.some(item => item?.transferKey === transferKey)) return nextBucket;
      created = true;
      nextBucket[month] = withGeneratedId({
        ...existing,
        month,
        savings_list: [...existingList, {
          savings_type: 'เงินออมจากเงินเหลือ',
          savings_amount: amount,
          transferKey,
          source: 'transferable-savings'
        }]
      });
      return enforceUserMonthLimit(nextBucket);
    });
    return res.status(201).json({ success: true, created });
  }
  const updateObj = { month, savings_list };
  if (typeof total_savings !== 'undefined') {
    updateObj.total_savings = total_savings;
  }
  updateUserData(JSON_FILENAME, userId, (bucket) => {
    const nextBucket = { ...bucket };
    const existing = nextBucket[month] || {};
    nextBucket[month] = withGeneratedId({ ...existing, ...updateObj });
    return enforceUserMonthLimit(nextBucket);
  });
  return res.status(201).json({ success: true });
}

/**
 * ตัวจัดการหลักของ API เงินออม
 * รองรับทั้ง JSON และ MongoDB
 * @param {object} req - Express request (GET/POST)
 * @param {object} res - Express response
 */
export default async function handler(req, res) {
  const userId = assertUserId(req, res);
  if (!userId) return;

  if (isJsonMode()) {
    if (req.method === 'GET') {
      return handleJsonSavingsGet(req, res, userId);
    }
    if (req.method === 'POST') {
      return handleJsonSavingsPost(req, res, userId);
    }
    return res.status(405).end();
  }

  const collection = await getMongoCollection(COLLECTION_NAME);
  const userFilter = { userId };

  if (req.method === 'GET') {
    const { month } = req.query;
      if (month) {
        const doc = await collection.findOne({ month, ...userFilter });
        // Always return default structure if not found, to match legacy JSON behavior
        const savingsList = doc && Array.isArray(doc.savings_list) ? doc.savings_list : [];
        const รวมเงินเก็บ = calculateTotalSavings(savingsList);
        const response = {
          total_savings: doc && typeof doc.total_savings === 'number' ? doc.total_savings : 0,
          savings_list: savingsList,
          รวมเงินเก็บ
        };
        return res.status(200).json(response);
    } else {
      // ดึงข้อมูลทุกเดือน (robust: skip doc ที่ไม่มี month, log error, กัน exception)
      try {
        const allDocs = await collection.find({ ...userFilter, month: { $exists: true } }).toArray();
        const data = {};
        allDocs.forEach(doc => {
          if (!doc || !doc.month) {
            console.error('[savings API] Skipping doc with missing month:', doc);
            return;
          }
          try {
            const savingsList = doc.savings_list || [];
            const totalSavings = calculateTotalSavings(savingsList);
            data[doc.month] = {
              total_savings: doc.total_savings || 0,
              savings_list: savingsList,
              totalSavings,
              รวมเงินเก็บ: totalSavings
            };
          } catch (err) {
            console.error('[savings API] Error processing doc:', doc, err);
          }
        });
        return res.status(200).json(data);
      } catch (err) {
        console.error('[savings API] Error in getAll:', err);
        return res.status(500).json({ error: 'Internal server error', details: err.message });
      }
    }
  } else if (req.method === 'POST') {
    const { month, total_savings, savings_list, transfer } = req.body;
    if (!month) {
      return res.status(400).json({ error: 'month required' });
    }
    if (transfer) {
      const amount = Number(transfer.amount);
      const transferKey = typeof transfer.key === 'string' ? transfer.key.trim() : '';
      if (!Number.isFinite(amount) || amount <= 0 || !transferKey) {
        return res.status(400).json({ error: 'valid transfer amount and key required' });
      }
      await collection.updateOne(
        { month, ...userFilter },
        { $setOnInsert: { month, ...userFilter, savings_list: [] } },
        { upsert: true }
      );
      const result = await collection.updateOne(
        { month, ...userFilter, 'savings_list.transferKey': { $ne: transferKey } },
        {
          $push: {
            savings_list: {
              savings_type: 'เงินออมจากเงินเหลือ',
              savings_amount: amount,
              transferKey,
              source: 'transferable-savings'
            }
          }
        }
      );
      await enforceMonthLimit(collection, 15, { filter: userFilter });
      return res.status(201).json({ success: true, created: result.modifiedCount === 1 });
    }
    // สร้าง object สำหรับบันทึก โดยไม่ใส่ total_savings ถ้าไม่ได้ส่งมา
    const updateObj = { month, savings_list };
    if (typeof total_savings !== 'undefined') {
      updateObj.total_savings = total_savings;
    }
    await collection.updateOne(
      { month, ...userFilter },
      { $set: { ...updateObj, ...userFilter } },
      { upsert: true }
    );
    await enforceMonthLimit(collection, 15, { filter: userFilter });
    return res.status(201).json({ success: true });
  } else {
    res.status(405).end();
  }
}