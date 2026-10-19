import type { NextApiRequest, NextApiResponse } from 'next';
import type { Collection, Document } from 'mongodb';
import { assertUserId } from '../../src/shared/utils/backend/userRequest';
import { validateApiRequest } from '../../src/shared/utils/backend/apiRequestValidation';
import { parseRequestBody, dailyExpensePutBodySchema } from '../../src/shared/utils/backend/pilotRequestSchemas';
import { enforceMonthLimit } from '../../src/shared/utils/backend/apiUtils';
import { isJsonMode, getMongoCollection } from '../../lib/dataSource';

import { getUserData, updateUserData, enforceUserMonthLimit } from '../../src/backend/data/userUtils';
import { withAudit } from '../../lib/auditedMutation';

const COLLECTION_NAME = 'daily_expenses';
const JSON_FILENAME = 'daily_expenses.json';
const MONTH_LIMIT = 15;

interface DailyExpenseItem {
  name?: string;
  amount?: number | string;
  category?: string;
  frequency?: string | null;
  [key: string]: unknown;
}
interface DailyExpenseDoc {
  month?: string;
  items?: unknown;
  [key: string]: unknown;
}
type DailyExpenseBucket = Record<string, DailyExpenseDoc>;

function getPreviousMonth(monthKey: string): string {
  const [year, month] = monthKey.split('-').map(Number);
  if (month === 1) return `${year - 1}-12`;
  return `${year}-${String(month - 1).padStart(2, '0')}`;
}

function parseAmount(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') {
    const parsed = parseFloat(value.replace(/,/g, ''));
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function calculateTotals(items: unknown = []) {
  let fixedMonthly = 0;
  let miscMonthly = 0;
  if (!Array.isArray(items)) throw new TypeError('items.forEach is not a function');
  (items as DailyExpenseItem[]).forEach(item => {
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

function handleJsonGet(req: NextApiRequest, res: NextApiResponse, userId: string) {
  const month = Array.isArray(req.query.month) ? req.query.month[0] : req.query.month;
  const raw = Array.isArray(req.query.raw) ? req.query.raw[0] : req.query.raw;
  if (typeof month !== 'string' || !month) return res.status(400).json({ error: 'month is required' });

  const bucket = getUserData(JSON_FILENAME, userId) as DailyExpenseBucket;
  let doc: DailyExpenseDoc | undefined = bucket[month];

  // raw=1 skips the fixed-only carry-forward below and returns only what was actually
  // persisted for this month (or nothing) — for callers that need to distinguish
  // "never saved" from "saved as empty", as opposed to the normal editing view's preview.
  if (!doc && raw !== '1') {
    const prevMonth = getPreviousMonth(month);
    const prevDoc = bucket[prevMonth];
    const previousItems = Array.isArray(prevDoc?.items) ? prevDoc.items as DailyExpenseItem[] : [];
    const fixedItems = previousItems
      .filter((item: DailyExpenseItem) => item.category === 'fixed')
      .map((item: DailyExpenseItem) => ({ ...item }));
    doc = { month, items: fixedItems };
  }

  const items = doc?.items || [];
  return res.status(200).json({ month, items, ...calculateTotals(items) });
}

function handleJsonPut(req: NextApiRequest, res: NextApiResponse, userId: string) {
  const body = parseRequestBody(req, res, dailyExpensePutBodySchema);
  if (!body) return;
  const { month, items } = body;

  updateUserData(JSON_FILENAME, userId, (bucket: DailyExpenseBucket) => {
    const next: DailyExpenseBucket = { ...bucket };
    next[month] = { month, items, updatedAt: new Date().toISOString() };
    return enforceUserMonthLimit(next);
  });

  return res.status(200).json({ success: true, ...calculateTotals(items) });
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const userId = assertUserId(req, res);
  if (!userId) return;
  if (!validateApiRequest(req, res, 'daily_expenses')) return;

  if (isJsonMode()) {
    if (req.method === 'GET') return handleJsonGet(req, res, userId);
    if (req.method === 'PUT') return handleJsonPut(req, res, userId);
    return res.status(405).end();
  }

  let collection: Collection<Document>;
  try {
    collection = await getMongoCollection(COLLECTION_NAME);
  } catch {
    return res.status(500).json({ error: 'Database connection error' });
  }

  const userFilter = { userId };

  if (req.method === 'GET') {
    try {
      const month = Array.isArray(req.query.month) ? req.query.month[0] : req.query.month;
      const raw = Array.isArray(req.query.raw) ? req.query.raw[0] : req.query.raw;
      if (typeof month !== 'string' || !month) return res.status(400).json({ error: 'month is required' });

      const doc = await collection.findOne({ month, ...userFilter });
      let items = doc?.items;

      // raw=1 skips the fixed-only carry-forward below — see handleJsonGet's comment above.
      if (!doc && raw !== '1') {
        const prevMonth = getPreviousMonth(month);
        const prevDoc = await collection.findOne({ month: prevMonth, ...userFilter });
        const previousItems = Array.isArray(prevDoc?.items) ? prevDoc.items as DailyExpenseItem[] : [];
        items = previousItems
          .filter((item: DailyExpenseItem) => item.category === 'fixed')
          .map((item: DailyExpenseItem) => ({ ...item }));
      }

      items = items || [];
      return res.status(200).json({ month, items, ...calculateTotals(items) });
    } catch {
      return res.status(500).json({ error: 'Failed to read daily expenses' });
    }
  }

  if (req.method === 'PUT') {
    try {
      const body = parseRequestBody(req, res, dailyExpensePutBodySchema);
      if (!body) return;
      const { month, items } = body;

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

export default withAudit(handler, { source: 'daily_expenses' });
