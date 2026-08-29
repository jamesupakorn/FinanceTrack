import { mapInvestmentDoc } from '../../src/shared/utils/backend/apiUtils';
import { assertUserId } from '../../src/shared/utils/backend/userRequest';
import {
  isJsonMode,
  withGeneratedId,
  getMongoCollection
} from '../../lib/dataSource';
import {
  enforceSharedMonthWindowJson,
  enforceSharedMonthWindowMongo
} from '../../src/shared/utils/backend/sharedMonthWindow.js';

const {
  getUserData,
  updateUserData,
} = require('../../src/backend/data/userUtils');

const COLLECTION_NAME = 'investment';
const JSON_FILENAME = 'investment.json';

function handleJsonInvestmentGet(req, res, userId) {
  const bucket = getUserData(JSON_FILENAME, userId);
  const { month } = req.query;
  if (month) {
    const doc = bucket[month];
    return res.status(200).json(mapInvestmentDoc(doc));
  }
  const data = {};
  Object.entries(bucket).forEach(([monthKey, doc]) => {
    if (!doc || !doc.month) return;
    data[monthKey] = mapInvestmentDoc(doc);
  });
  return res.status(200).json(data);
}

function handleJsonInvestmentPost(req, res, userId) {
  const { month, investments } = req.body;
  if (!month || !Array.isArray(investments)) {
    return res.status(400).json({ error: 'month and investments required' });
  }
  updateUserData(JSON_FILENAME, userId, (bucket) => {
    const nextBucket = { ...bucket };
    const existing = nextBucket[month] || {};
    const payload = withGeneratedId({ ...existing, month, investments });
    nextBucket[month] = payload;
    return nextBucket;
  });
  // จำกัดหน้าต่าง 15 เดือนแบบรวมทุก collection (expense/income/salary/investment) หลังเขียนไฟล์นี้แล้ว
  enforceSharedMonthWindowJson(userId, { extraMonth: month });
  return res.status(200).json({ success: true });
}

export default async function handler(req, res) {
  const userId = assertUserId(req, res);
  if (!userId) return;

  if (isJsonMode()) {
    if (req.method === 'GET') {
      return handleJsonInvestmentGet(req, res, userId);
    }
    if (req.method === 'POST') {
      return handleJsonInvestmentPost(req, res, userId);
    }
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const collection = await getMongoCollection(COLLECTION_NAME);
  const userFilter = { userId };

  if (req.method === 'GET') {
    const { month } = req.query;
    if (month) {
      let doc = await collection.findOne({ month, ...userFilter });
      if (!doc) {
        doc = await collection.findOne({ month, userId: { $exists: false } });
        if (doc) {
          try {
            await collection.updateOne({ _id: doc._id }, { $set: { userId } });
          } catch (err) {
            console.error('Failed to claim legacy doc for user', userId, month, err);
          }
        }
      }
      return res.status(200).json(mapInvestmentDoc(doc));
    } else {
      // ดึงข้อมูลทุกเดือน
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
      const data = {};
      allDocs.forEach(doc => {
        data[doc.month] = mapInvestmentDoc(doc);
      });
      return res.status(200).json(data);
    }
  }
  if (req.method === 'POST') {
    const { month, investments } = req.body;
    if (!month || !Array.isArray(investments)) {
      return res.status(400).json({ error: 'month and investments required' });
    }
    await collection.updateOne(
      { month, ...userFilter },
      { $set: { month, investments, ...userFilter } },
      { upsert: true }
    );
    // จำกัดหน้าต่าง 15 เดือนแบบรวมทุก collection (expense/income/salary/investment)
    await enforceSharedMonthWindowMongo(userId, { extraMonth: month });
    return res.status(200).json({ success: true });
  }
  res.status(405).json({ error: 'Method not allowed' });
}
