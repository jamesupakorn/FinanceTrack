/**
 * API: pages/api/monthly_income.js
 * 
 * Monthly Income Management API
 * 
 * Handles CRUD operations for monthly income tracking
 * Supports both JSON file mode and MongoDB database mode
 * Features:
 * - GET: Retrieve income data for specific month or all months with totals
 * - POST: Save/update income data with custom labels and item deletion
 * - Supports dynamic custom income items with custom labels
 * - Calculates total income per month
 * - Enforces 15-month data limit per user
 */

import { sumValues, removeSummaryFields, enforceMonthLimit } from '../../src/shared/utils/backend/apiUtils';
import { assertUserId } from '../../src/shared/utils/backend/userRequest';
import { extractRemovalKeys } from '../../src/shared/utils/commonUtils.js';
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

const MONTH_LIMIT = 15; // Maximum months of income data to store per user
const JSON_FILENAME = 'monthly_income.json'; // JSON file name for file-based mode

/**
 * Extract custom label updates from payload  
 * Validates label format and filters empty values
 * Used to support custom names for income items
 * @param {object} payload - request payload with __labels property
 * @returns {object} clean label updates
 */
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

/**
 * Sanitize income payload for database storage
 * Removes metadata, labels, and summary fields
 * Ensures only actual income values are stored
 * @param {object} values - income data object
 * @returns {object} cleaned payload ready for save
 */
function sanitizeIncomePayload(values = {}) {
  const cleaned = removeSummaryFields(values, ['รวม']);
  delete cleaned.__removeKeys;
  delete cleaned.__labels;
  delete cleaned.month;
  delete cleaned._id;
  delete cleaned.userId;
  return cleaned;
}

/**
 * Calculate total income from all income items in a month
 * Sums up all numeric values and rounds to 2 decimal places
 * @param {object} data - Income data object with key-value pairs
 * @returns {number} Rounded total income amount (2 decimal places)
 */
function getTotalIncome(data) {
  let sum = 0;
  Object.values(data || {}).forEach(v => {
    if (typeof v === 'number') sum += v;
  });
  return Math.round(sum * 100) / 100;
}

/**
 * Build response object containing all months of income data with totals
 * Generates a response object with monthly income data indexed by month key
 * Calculates and adds the total income (รวม) for each month
 * Removes internal _id field before returning
 * @param {object} bucket - Object containing all months' data indexed by month key
 * @returns {object} Response object with months mapped to income data including totals
 */
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

/**
 * Enforce the 15-month data limit per user
 * Removes oldest month entries when user exceeds the MONTH_LIMIT threshold
 * Uses the month field from each entry to determine age and retention priority
 * @param {object} bucket - Object containing all months of user data
 * @returns {object} Limited bucket with maximum MONTH_LIMIT entries per user
 */
function enforceUserMonthLimit(bucket = {}) {
  return limitUserEntries(bucket, {
    limit: MONTH_LIMIT,
    keySelector: (_, value) => value?.month || ''
  });
}

/**
 * Handle GET requests for income data in JSON file mode
 * Retrieves income data for a specific month or all months
 * If month query parameter provided: returns specific month data with calculated total
 * If no month parameter: returns all months with calculated totals for each
 * @param {object} req - Express request object (query.month optional)
 * @param {object} res - Express response object
 * @param {string} userId - User ID for data retrieval
 * @returns {object} JSON response with income data (200 status)
 */
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

/**
 * Handle POST requests to save income data in JSON file mode
 * Validates required month and values parameters
 * Merges new income data with existing month data
 * Supports custom labels via __labels property and item deletion via __removeKeys
 * Enforces the MONTH_LIMIT after update
 * @param {object} req - Express request object (body.month, body.values required)
 * @param {object} res - Express response object
 * @param {string} userId - User ID for data storage
 * @returns {object} JSON response with success status (201 on success, 400 on validation error)
 */
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

/**
 * Main API handler for monthly income management
 * Supports both JSON file mode and MongoDB database mode
 * 
 * GET requests:
 * - Query parameter ?month=YYYY-MM returns income for specific month
 * - No parameters returns all months with totals
 * 
 * POST requests:
 * - Body: { month: string, values: object }
 * - Saves/updates income data for specified month
 * - Supports custom labels and item deletion
 * 
 * @param {object} req - Express request object (GET/POST methods)
 * @param {object} res - Express response object
 * @returns {void} JSON response with data or error status
 * 
 * Example:
 * GET /api/monthly_income?month=2024-01 -> Returns January 2024 income
 * POST /api/monthly_income with {month: '2024-01', values: {salary: 50000}} -> Saves income
 */
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