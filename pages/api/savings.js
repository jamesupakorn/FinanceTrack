/**
 * API: pages/api/savings.js
 * 
 * Savings Tracking Management API
 * 
 * Handles CRUD operations for user savings data
 * Supports both JSON file mode and MongoDB database mode
 * Features:
 * - GET: Retrieve savings data for specific month or all months
 * - POST: Save/update savings list and total amounts
 * - Calculates total savings across all items in a month
 * - Enforces 15-month data limit per user
 * - Returns auto-calculated totals (รวมเงินเก็บ) for display
 */

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
 * Handle GET requests for savings data in JSON file mode
 * Retrieves savings data for a specific month or all months with calculations
 * If month query parameter provided: returns specific month with calculated totals
 * If no month parameter: returns all months with individual totals (รวมเงินเก็บ)
 * @param {object} req - Express request object (query.month optional)
 * @param {object} res - Express response object
 * @param {string} userId - User ID for data retrieval
 * @returns {object} JSON response with savings data and calculated totals (200 status)
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
 * Handle POST requests to save savings data in JSON file mode
 * Validates required month parameter and updates data
 * Stores savings_list array and optional total_savings amount
 * Enforces MONTH_LIMIT after update
 * @param {object} req - Express request object (body.month required, body.total_savings optional, body.savings_list)
 * @param {object} res - Express response object
 * @param {string} userId - User ID for data storage
 * @returns {object} JSON response with success status (201 on success, 400 on validation error)
 */
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

/**
 * Main API handler for savings management
 * Supports both JSON file mode and MongoDB database mode
 * 
 * GET requests:
 * - Query parameter ?month=YYYY-MM returns savings for specific month
 * - No parameters returns all months with calculated totals
 * - Always includes รวมเงินเก็บ (calculated total) in response
 * 
 * POST requests:
 * - Body: { month: string, total_savings?: number, savings_list: array }
 * - Saves/updates savings data for specified month
 * - Calculates total automatically if not provided
 * 
 * @param {object} req - Express request object (GET/POST methods)
 * @param {object} res - Express response object
 * @returns {void} JSON response with savings data or error status
 * 
 * Example:
 * GET /api/savings?month=2024-01 -> Returns January 2024 savings
 * POST /api/savings with {month: '2024-01', savings_list: [{name: 'Bank', amount: 50000}]} -> Saves savings
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
        let doc = await collection.findOne({ month, ...userFilter });
        if (!doc) {
          doc = await collection.findOne({ month, userId: { $exists: false } });
        }
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