import { calculateTotalSavings, enforceMonthLimit } from '../../src/shared/utils/backend/apiUtils';
import { assertUserId } from '../../src/shared/utils/backend/userRequest';
import {
  isJsonMode,
  withGeneratedId,
  getMongoCollection
} from '../../lib/dataSource';

const {
  getUserData,
  updateUserData,
  limitUserEntries,
} = require('../../src/backend/data/userUtils');

const COLLECTION_NAME = 'savings';
const JSON_FILENAME = 'savings.json';
const MONTH_LIMIT = 15;

function getTotalSavingsInline(list = []) {
  return list.reduce((sum, item) => sum + (parseFloat(item?.จำนวนเงิน || item?.savings_amount || item?.amount || 0)), 0);
}

function enforceUserMonthLimit(bucket = {}) {
  return limitUserEntries(bucket, {
    limit: MONTH_LIMIT,
    keySelector: (_, value) => value?.month || ''
  });
}

function handleJsonSavingsGet(req, res, userId) {
  const bucket = getUserData(JSON_FILENAME, userId);
  const { month } = req.query;
  if (month) {
    const doc = bucket[month];
    const savingsList = doc && Array.isArray(doc.savings_list) ? doc.savings_list : [];
    const response = {
      total_savings: doc && typeof doc.total_savings === 'number' ? doc.total_savings : 0,
      savings_list: savingsList,
      รวมเงินเก็บ: getTotalSavingsInline(savingsList)
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
      รวมเงินเก็บ: getTotalSavingsInline(savingsList)
    };
  });
  return res.status(200).json(data);
}

function handleJsonSavingsPost(req, res, userId) {
  const { month, total_savings, savings_list } = req.body;
  if (!month) {
    return res.status(400).json({ error: 'month required' });
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
        let doc = await collection.findOne({ month, ...userFilter });
        if (!doc) {
          doc = await collection.findOne({ month, userId: { $exists: false } });
        }
        // Always return default structure if not found, to match legacy JSON behavior
        const savingsList = doc && Array.isArray(doc.savings_list) ? doc.savings_list : [];
        // คำนวณยอดรวมเงินเก็บ
        function getTotalSavings(list) {
          return list.reduce((sum, item) => sum + (parseFloat(item.จำนวนเงิน || item.savings_amount || item.amount || 0)), 0);
        }
        const รวมเงินเก็บ = getTotalSavings(savingsList);
        const response = {
          total_savings: doc && typeof doc.total_savings === 'number' ? doc.total_savings : 0,
          savings_list: savingsList,
          รวมเงินเก็บ
        };
        return res.status(200).json(response);
    } else {
      // ดึงข้อมูลทุกเดือน (robust: skip doc ที่ไม่มี month, log error, กัน exception)
      try {
        let allDocs = await collection.find({ ...userFilter, month: { $exists: true } }).toArray();
        if (!allDocs.length) {
          allDocs = await collection.find({ userId: { $exists: false }, month: { $exists: true } }).toArray();
        }
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
              totalSavings
            };
              // คำนวณยอดรวมเงินเก็บ
              function getTotalSavings(list) {
                return list.reduce((sum, item) => sum + (parseFloat(item.จำนวนเงิน || item.savings_amount || item.amount || 0)), 0);
              }
              const รวมเงินเก็บ = getTotalSavings(savingsList);
              data[doc.month].รวมเงินเก็บ = รวมเงินเก็บ;
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
    const { month, total_savings, savings_list } = req.body;
    if (!month) {
      return res.status(400).json({ error: 'month required' });
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