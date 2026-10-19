import type { NextApiRequest, NextApiResponse } from 'next';
import type { Collection, Document } from 'mongodb';
import { mapInvestmentDoc } from '../../src/shared/utils/backend/apiUtils';
import { assertUserId } from '../../src/shared/utils/backend/userRequest';
import { validateApiRequest } from '../../src/shared/utils/backend/apiRequestValidation';
import {
  isJsonMode,
  withGeneratedId,
  getMongoCollection
} from '../../lib/dataSource';
import {
  enforceSharedMonthWindowJson,
  enforceSharedMonthWindowMongo
} from '../../src/shared/utils/backend/sharedMonthWindow';
import {
  getUserData,
  updateUserData,
} from '../../src/backend/data/userUtils';
import { withAudit } from '../../lib/auditedMutation';

const COLLECTION_NAME = 'investment';
const JSON_FILENAME = 'investment.json';

type InvestmentDoc = { month?: string; investments?: unknown[]; [key: string]: unknown };
type InvestmentBucket = Record<string, InvestmentDoc>;

function handleJsonInvestmentGet(req: NextApiRequest, res: NextApiResponse, userId: string) {
  const bucket = getUserData(JSON_FILENAME, userId) as InvestmentBucket;
  const month = Array.isArray(req.query.month) ? req.query.month[0] : req.query.month;
  if (month) {
    const doc = bucket[month];
    return res.status(200).json(mapInvestmentDoc(doc ? { investments: doc.investments as unknown[] } : null));
  }
  const data: Record<string, unknown[]> = {};
  Object.entries(bucket).forEach(([monthKey, doc]) => {
    if (!doc || !doc.month) return;
    data[monthKey] = mapInvestmentDoc(doc);
  });
  return res.status(200).json(data);
}

function handleJsonInvestmentPost(req: NextApiRequest, res: NextApiResponse, userId: string) {
  const body = req.body && typeof req.body === 'object' ? req.body as Record<string, unknown> : {};
  const { month, investments } = body;
  if (typeof month !== 'string' || !month || !Array.isArray(investments)) {
    return res.status(400).json({ error: 'month and investments required' });
  }
  updateUserData(JSON_FILENAME, userId, (bucket: InvestmentBucket) => {
    const nextBucket: InvestmentBucket = { ...bucket };
    const existing = nextBucket[month] || {};
    const payload = withGeneratedId({ ...existing, month, investments });
    nextBucket[month] = payload;
    return nextBucket;
  });
  // จำกัดหน้าต่าง 15 เดือนแบบรวมทุก collection (expense/income/salary/investment) หลังเขียนไฟล์นี้แล้ว
  enforceSharedMonthWindowJson(userId, { extraMonth: month });
  return res.status(200).json({ success: true });
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const userId = assertUserId(req, res);
  if (!userId) return;
  if (!validateApiRequest(req, res, 'investment')) return;

  if (isJsonMode()) {
    if (req.method === 'GET') {
      return handleJsonInvestmentGet(req, res, userId);
    }
    if (req.method === 'POST') {
      return handleJsonInvestmentPost(req, res, userId);
    }
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const collection: Collection<Document> = await getMongoCollection(COLLECTION_NAME);
  const userFilter = { userId };

  if (req.method === 'GET') {
    const month = Array.isArray(req.query.month) ? req.query.month[0] : req.query.month;
    if (month) {
      const doc = await collection.findOne({ month, ...userFilter });
      return res.status(200).json(mapInvestmentDoc(doc ? { investments: doc.investments as unknown[] } : null));
    } else {
      // ดึงข้อมูลทุกเดือน
      const allDocs = await collection.find({ ...userFilter, month: { $exists: true } }).toArray();
      const data: Record<string, unknown[]> = {};
      allDocs.forEach(doc => {
        if (typeof doc.month === 'string') data[doc.month] = mapInvestmentDoc({ investments: doc.investments as unknown[] });
      });
      return res.status(200).json(data);
    }
  }
  if (req.method === 'POST') {
    const body = req.body && typeof req.body === 'object' ? req.body as Record<string, unknown> : {};
    const { month, investments } = body;
    if (typeof month !== 'string' || !month || !Array.isArray(investments)) {
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

export default withAudit(handler, { source: 'investment' });
