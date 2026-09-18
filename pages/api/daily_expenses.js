import { assertUserId } from '../../src/shared/utils/backend/userRequest';
import { enforceMonthLimit } from '../../src/shared/utils/backend/apiUtils';
import { isJsonMode, getMongoCollection } from '../../lib/dataSource.js';

import { getUserData, updateUserData, enforceUserMonthLimit } from '../../src/backend/data/userUtils.js';

const COLLECTION_NAME = 'daily_expenses';
const JSON_FILENAME = 'daily_expenses.json';
const MONTH_LIMIT = 15;

function getPreviousMonth(monthKey) {
  const [year, month] = monthKey.split('-').map(Number);
  if (month === 1) return `${year - 1}-12`;
  return `${year}-${String(month - 1).padStart(2, '0')}`;
}

function parseAmount(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') {
    const parsed = parseFloat(value.replace(/,/g, ''));
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function calculateTotals(items = []) {
  let fixedMonthly = 0;
  let miscMonthly = 0;
  items.forEach(item => {
    const amount = parseAmount(item.amount);
    if (item.category === 'fixed') {
      if (item.frequency === 'daily') fixedMonthly += amount * 30;
      else if (item.frequency === 'weekly') fixedMonthly += amount * 4.33;
    } else if (item.category === 'misc') {
      miscMonthly += amount;
    }
  });
  return {
    fixedMonthly: Math.round(fixedMonthly * 100) / 100,
    miscMonthly: Math.round(miscMonthly * 100) / 100,
    totalMonthly: Math.round((fixedMonthly + miscMonthly) * 100) / 100,
  };
}

function validateItems(items) {
  if (!Array.isArray(items)) return 'items must be an array';
  for (const item of items) {
    if (!item.name || !String(item.name).trim()) return 'item name is required';
    if (parseAmount(item.amount) < 0) return 'item amount must be >= 0';
    if (item.category === 'fixed' && !['daily', 'weekly'].includes(item.frequency)) {
      return 'fixed items must have frequency: daily or weekly';
    }
    if (item.category === 'misc' && item.frequency != null) {
      return 'misc items must have frequency: null';
    }
  }
  return null;
}

function handleJsonGet(req, res, userId) {
  const { month, raw } = req.query;
  if (!month) return res.status(400).json({ error: 'month is required' });

  const bucket = getUserData(JSON_FILENAME, userId);
  let doc = bucket[month];

  // raw=1 skips the fixed-only carry-forward below — used by "copy from previous month"
  // (MonthManager.js), which wants the previous month's actually-saved items (or none),
  // not a synthesized, never-persisted preview meant for the normal editing view.
  if (!doc && raw !== '1') {
    const prevMonth = getPreviousMonth(month);
    const prevDoc = bucket[prevMonth];
    const fixedItems = (prevDoc?.items || [])
      .filter(item => item.category === 'fixed')
      .map(item => ({ ...item }));
    doc = { month, items: fixedItems };
  }

  const items = doc?.items || [];
  return res.status(200).json({ month, items, ...calculateTotals(items) });
}

function handleJsonPut(req, res, userId) {
  const { month, items } = req.body;
  if (!month) return res.status(400).json({ error: 'month is required' });

  const validationError = validateItems(items);
  if (validationError) return res.status(400).json({ error: validationError });

  updateUserData(JSON_FILENAME, userId, (bucket) => {
    const next = { ...bucket };
    next[month] = { month, items, updatedAt: new Date().toISOString() };
    return enforceUserMonthLimit(next);
  });

  return res.status(200).json({ success: true, ...calculateTotals(items) });
}

export default async function handler(req, res) {
  const userId = assertUserId(req, res);
  if (!userId) return;

  if (isJsonMode()) {
    if (req.method === 'GET') return handleJsonGet(req, res, userId);
    if (req.method === 'PUT') return handleJsonPut(req, res, userId);
    return res.status(405).end();
  }

  let collection;
  try {
    collection = await getMongoCollection(COLLECTION_NAME);
  } catch {
    return res.status(500).json({ error: 'Database connection error' });
  }

  const userFilter = { userId };

  if (req.method === 'GET') {
    try {
      const { month, raw } = req.query;
      if (!month) return res.status(400).json({ error: 'month is required' });

      let doc = await collection.findOne({ month, ...userFilter });

      // raw=1 skips the fixed-only carry-forward below — see handleJsonGet's comment.
      if (!doc && raw !== '1') {
        const prevMonth = getPreviousMonth(month);
        const prevDoc = await collection.findOne({ month: prevMonth, ...userFilter });
        const fixedItems = (prevDoc?.items || [])
          .filter(item => item.category === 'fixed')
          .map(item => ({ ...item }));
        doc = { month, items: fixedItems };
      }

      const items = doc?.items || [];
      return res.status(200).json({ month, items, ...calculateTotals(items) });
    } catch {
      return res.status(500).json({ error: 'Failed to read daily expenses' });
    }
  }

  if (req.method === 'PUT') {
    try {
      const { month, items } = req.body;
      if (!month) return res.status(400).json({ error: 'month is required' });

      const validationError = validateItems(items);
      if (validationError) return res.status(400).json({ error: validationError });

      await collection.updateOne(
        { month, ...userFilter },
        { $set: { month, items, updatedAt: new Date().toISOString(), ...userFilter } },
        { upsert: true }
      );
      await enforceMonthLimit(collection, MONTH_LIMIT, { filter: userFilter });

      return res.status(200).json({ success: true, ...calculateTotals(items) });
    } catch {
      return res.status(500).json({ error: 'Failed to save daily expenses' });
    }
  }

  return res.status(405).end();
}
