import { sumValues, removeSummaryFields, enforceMonthLimit } from '../../src/shared/utils/backend/apiUtils';
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

const MONTH_LIMIT = 15;
const JSON_FILENAME = 'monthly_income.json';

function extractRemovalKeys(payload = {}) {
  const raw = payload?.__removeKeys;
  if (!Array.isArray(raw)) return [];
  return raw.filter(key => typeof key === 'string' && key.length > 0);
}

function extractLabelUpdates(payload = {}) {
  const raw = payload?.__labels;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  return Object.entries(raw).reduce((acc, [key, value]) => {
    if (typeof key !== 'string') return acc;
    const cleanValue = typeof value === 'string' ? value.trim() : value;
    if (typeof cleanValue === 'string' && cleanValue.length > 0) {
      acc[key] = cleanValue;
    }
    return acc;
  }, {});
}

function sanitizeIncomePayload(values = {}) {
  const cleaned = removeSummaryFields(values, ['รวม']);
  delete cleaned.__removeKeys;
  delete cleaned.__labels;
  delete cleaned.month;
  delete cleaned._id;
  delete cleaned.userId;
  return cleaned;
}

function getTotalIncome(data) {
  let sum = 0;
  Object.values(data || {}).forEach(v => {
    if (typeof v === 'number') sum += v;
  });
  return Math.round(sum * 100) / 100;
}

function buildJsonAllMonthsResponse(bucket = {}) {
  const data = {};
  Object.entries(bucket).forEach(([monthKey, doc]) => {
    if (!doc || !doc.month) return;
    const monthData = { ...doc };
    delete monthData._id;
    const รวม = getTotalIncome(monthData);
    data[monthKey] = { ...monthData, รวม };
  });
  return data;
}

function enforceUserMonthLimit(bucket = {}) {
  return limitUserEntries(bucket, {
    limit: MONTH_LIMIT,
    keySelector: (_, value) => value?.month || ''
  });
}

function handleJsonGet(req, res, userId) {
  const bucket = getUserData(JSON_FILENAME, userId);
  const { month } = req.query;
  if (month) {
    const doc = bucket[month];
    if (!doc) {
      return res.status(200).json({});
    }
    const monthData = { ...doc };
    delete monthData._id;
    const รวม = getTotalIncome(monthData);
    return res.status(200).json({ month, ...monthData, รวม });
  }
  return res.status(200).json(buildJsonAllMonthsResponse(bucket));
}

function handleJsonPost(req, res, userId) {
  const { month, values } = req.body;
  if (!month || !values) {
    return res.status(400).json({ error: 'month and values required' });
  }
  const removalList = extractRemovalKeys(values);
  const labelUpdates = extractLabelUpdates(values);
  const cleanValues = sanitizeIncomePayload(values);
  updateUserData(JSON_FILENAME, userId, (bucket) => {
    const nextBucket = { ...bucket };
    const existing = nextBucket[month] || {};
    const existingLabels = (existing.__labels && typeof existing.__labels === 'object' && !Array.isArray(existing.__labels))
      ? { ...existing.__labels }
      : {};
    let mergedLabels = { ...existingLabels };
    const merged = { ...existing, ...cleanValues, month };
    removalList.forEach(key => {
      if (key in merged) delete merged[key];
      if (key in mergedLabels) delete mergedLabels[key];
    });
    if (Object.keys(labelUpdates).length) {
      mergedLabels = { ...mergedLabels, ...labelUpdates };
    }
    if (Object.keys(mergedLabels).length) {
      merged.__labels = mergedLabels;
    } else {
      delete merged.__labels;
    }
    nextBucket[month] = withGeneratedId(merged);
    return enforceUserMonthLimit(nextBucket);
  });
  return res.status(201).json({ success: true });
}

export default async function handler(req, res) {
  const userId = assertUserId(req, res);
  if (!userId) return;

  if (isJsonMode()) {
    if (req.method === 'GET') {
      return handleJsonGet(req, res, userId);
    }
    if (req.method === 'POST') {
      return handleJsonPost(req, res, userId);
    }
    return res.status(405).end();
  }

  const collection = await getMongoCollection('monthly_income');
  const userFilter = { userId };

  if (req.method === 'GET') {
    const { month } = req.query;
    if (month) {
      let doc = await collection.findOne({ month, ...userFilter });
      if (!doc) {
        const monthsDoc = await collection.findOne({ obj: 'months', ...userFilter })
          || await collection.findOne({ obj: 'months', userId: { $exists: false } });
        if (monthsDoc && monthsDoc.months && monthsDoc.months[month]) {
          doc = { month, ...monthsDoc.months[month] };
        }
        if (!doc) {
          doc = await collection.findOne({ month, userId: { $exists: false } });
        }
      }
      const monthData = doc ? { ...doc } : {};
      delete monthData._id;
      delete monthData.userId;
        // คำนวณยอดรวมรายรับ
        function getTotalIncome(data) {
          let sum = 0;
          Object.values(data).forEach(v => {
            if (typeof v === 'number') sum += v;
          });
          return Math.round(sum * 100) / 100;
        }
        const รวม = getTotalIncome(monthData);
      const response = {
        month,
        ...monthData,
        รวม
      };
      return res.status(200).json(response);
    } else {
      let allDocs = await collection.find({ ...userFilter, month: { $exists: true } }).toArray();
      if (!allDocs.length) {
        allDocs = await collection.find({ userId: { $exists: false }, month: { $exists: true } }).toArray();
      }
      const data = {};
      allDocs.forEach(doc => {
        const monthData = { ...doc };
        delete monthData._id;
        delete monthData.userId;
          function getTotalIncome(data) {
            let sum = 0;
            Object.values(data).forEach(v => {
              if (typeof v === 'number') sum += v;
            });
            return Math.round(sum * 100) / 100;
          }
          const รวม = getTotalIncome(monthData);
        data[doc.month] = {
          ...monthData,
          รวม
        };
      });
      const monthsDoc = await collection.findOne({ obj: 'months', ...userFilter })
        || await collection.findOne({ obj: 'months', userId: { $exists: false } });
      if (monthsDoc && monthsDoc.months) {
        for (const [m, values] of Object.entries(monthsDoc.months)) {
          if (!data[m]) {
            data[m] = { month: m, ...values };
            data[m].รวม = sumValues(values, ['รวม']);
          }
        }
      }
      return res.status(200).json(data);
    }
  } else if (req.method === 'POST') {
    const { month, values } = req.body;
    if (!month || !values) {
      return res.status(400).json({ error: 'month and values required' });
    }
    const removalList = extractRemovalKeys(values);
    const labelUpdates = extractLabelUpdates(values);
    const cleanValues = sanitizeIncomePayload(values);
    await collection.updateOne(
      { month, ...userFilter },
      (() => {
        const updateOps = {
          $set: { ...cleanValues, month, ...userFilter }
        };
        if (Object.keys(labelUpdates).length) {
          Object.entries(labelUpdates).forEach(([key, value]) => {
            updateOps.$set[`__labels.${key}`] = value;
          });
        }
        if (removalList.length) {
          updateOps.$unset = removalList.reduce((acc, key) => {
            acc[key] = '';
            acc[`__labels.${key}`] = '';
            return acc;
          }, {});
        }
        return updateOps;
      })(),
      { upsert: true }
    );
    const monthsDoc = await collection.findOne({ obj: 'months', ...userFilter });
    const additionalMonths = monthsDoc && monthsDoc.months ? Object.keys(monthsDoc.months) : [];
    const { retainedMonths } = await enforceMonthLimit(collection, 15, {
      filter: userFilter,
      additionalMonths,
    });
    if (monthsDoc && monthsDoc.months) {
      const prunedMonths = {};
      retainedMonths.forEach(m => {
        if (monthsDoc.months[m]) {
          prunedMonths[m] = monthsDoc.months[m];
        }
      });
      await collection.updateOne(
        { obj: 'months', ...userFilter },
        { $set: { months: prunedMonths, obj: 'months', ...userFilter } },
        { upsert: true }
      );
    }
    return res.status(201).json({ success: true });
  } else {
    res.status(405).end();
  }
}