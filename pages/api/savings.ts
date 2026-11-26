/**
 * API: pages/api/savings.js
 * จัดการข้อมูลเงินออมรายเดือน
 * รองรับทั้ง JSON และ MongoDB
 * - GET: อ่านข้อมูลรายเดือนหรือทั้งหมด
 * - POST: บันทึก/อัปเดตรายการเงินออมและยอดรวม
 * - คำนวณยอดรวมเงินออมอัตโนมัติ
 * - จำกัดข้อมูลย้อนหลังสูงสุด 15 เดือน
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import type { Collection, Document } from 'mongodb';
import { calculateTotalSavings } from '../../src/shared/utils/backend/apiUtils';
import { assertUserId, asPlainString } from '../../src/shared/utils/backend/userRequest';
import { validateApiRequest } from '../../src/shared/utils/backend/apiRequestValidation';
import {
  isJsonMode,
  withGeneratedId,
  getMongoCollection
} from '../../lib/dataSource';
import {
  getUserData,
  updateUserData,
  enforceUserMonthLimit,
} from '../../src/backend/data/userUtils';
import { withAudit } from '../../lib/auditedMutation';
import {
  CARRY_FORWARD_JSON_FILE,
  assertPrunedMonthsMatchPreview,
  foldPrunedMonths,
  pruneSavingsMonthsWithCarryForward,
  type CarryForwardGoal,
  type PrunedMonthDoc,
} from '../../src/shared/utils/backend/savingsCarryForward';

const COLLECTION_NAME = 'savings';
const JSON_FILENAME = 'savings.json';
const GOALS_JSON_FILENAME = 'savings-goals.json';

type SavingsDoc = { month?: string; total_savings?: unknown; savings_list?: unknown; [key: string]: unknown };
type SavingsBucket = Record<string, SavingsDoc>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * What a JSON savings updater captures for the carry-forward (spec §5.3, C-S2c-2). Filled inside
 * the `savings.json` updater; consumed only after `updateUserData` returns (A-4: no nested write).
 */
interface JsonPruneCapture {
  /** True iff this request created its own month bucket entry (C-S2c-11, F-6). */
  ownMonthCreated: boolean;
  /** Bucket keys handed to `enforceUserMonthLimit`. */
  candidateMonths: string[];
  /** Months `enforceUserMonthLimit` removed, keyed by map key, with their content at prune time. */
  prunedDocs: PrunedMonthDoc[];
}

function newJsonPruneCapture(): JsonPruneCapture {
  return { ownMonthCreated: false, candidateMonths: [], prunedDocs: [] };
}

/** Captured from the updater's input before anything else (C-S2c-2/C-S2c-11). Own keys only, so
 *  any month string, `__proto__` included, is checked safely. */
function didCreateOwnMonth(bucket: SavingsBucket, month: string): boolean {
  return !Object.hasOwn(bucket, month);
}

/**
 * Runs the unchanged `enforceUserMonthLimit` and records, by diffing before/after keys, which
 * months it pruned (spec §5.2 point 5, §5.5). JSON months are identified by map key.
 */
function limitAndCapturePruned(nextBucket: SavingsBucket, capture: JsonPruneCapture): SavingsBucket {
  const limitedBucket = enforceUserMonthLimit(nextBucket) as SavingsBucket;
  capture.candidateMonths = Object.keys(nextBucket);
  capture.prunedDocs = capture.candidateMonths
    .filter(monthKey => !Object.hasOwn(limitedBucket, monthKey))
    .map(monthKey => ({ month: monthKey, savings_list: nextBucket[monthKey]?.savings_list }));
  return limitedBucket;
}

/**
 * Credits the months pruned by this request's `savings.json` write to `savings-carry-forward.json`
 * (spec §5.3 + §5.8 A-1/A-2/A-4, C-S2c-2, C-S2c-11). Must run after the savings `updateUserData`
 * returned, inside the same handler call, so both writes stage into the same `runJsonTransaction`
 * and commit (or roll back) together with the prune.
 *
 * Fail-closed: first cross-checks that the months credited are exactly the months missing from the
 * persisted bucket (C-S2c-1's check, JSON form). A mismatch throws; nothing catches it, so
 * `withAudit` answers 500 and commits neither the savings write nor the carry-forward.
 */
function creditPrunedMonthsJson(
  userId: string,
  month: string,
  capture: JsonPruneCapture,
  storedBucket: unknown
): void {
  const stored = isRecord(storedBucket) ? storedBucket : {};
  const actualPruned = capture.candidateMonths.filter(monthKey => !Object.hasOwn(stored, monthKey));
  assertPrunedMonthsMatchPreview(capture.prunedDocs.map(doc => doc.month as string), actualPruned);
  if (capture.prunedDocs.length === 0) return;

  const storedGoals = getUserData(GOALS_JSON_FILENAME, userId).goals;
  const goals = (Array.isArray(storedGoals) ? storedGoals as CarryForwardGoal[] : [])
    .filter(goal => goal?.status !== 'abandoned');
  const { next, creditedMonths } = foldPrunedMonths(
    getUserData(CARRY_FORWARD_JSON_FILE, userId),
    capture.prunedDocs,
    goals,
    { excludeMonth: capture.ownMonthCreated ? month : null, nowIso: new Date().toISOString() }
  );
  if (creditedMonths.length === 0) return;
  updateUserData(CARRY_FORWARD_JSON_FILE, userId, () => next);
}

/**
 * อ่านข้อมูลเงินออมในโหมด JSON
 * - ถ้ามีเดือน: คืนข้อมูลเดือนนั้นพร้อมยอดรวมที่คำนวณแล้ว
 * - ถ้าไม่มีเดือน: คืนข้อมูลทุกเดือนพร้อมยอดรวม (รวมเงินเก็บ)
 * @param {object} req - Express request
 * @param {object} res - Express response
 * @param {string} userId - รหัสผู้ใช้
 */
function handleJsonSavingsGet(req: NextApiRequest, res: NextApiResponse, userId: string) {
  const bucket = getUserData(JSON_FILENAME, userId) as SavingsBucket;
  const month = Array.isArray(req.query.month) ? req.query.month[0] : req.query.month;
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
  const data: Record<string, Record<string, unknown>> = {};
  Object.entries(bucket).forEach(([monthKey, doc]: [string, SavingsDoc]) => {
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
function handleJsonSavingsPost(req: NextApiRequest, res: NextApiResponse, userId: string) {
  const body = req.body && typeof req.body === 'object' ? req.body as Record<string, unknown> : {};
  const { month, total_savings, savings_list, transfer } = body;
  if (typeof month !== 'string' || !month) {
    return res.status(400).json({ error: 'month required' });
  }
  if (transfer) {
    const transferData = transfer && typeof transfer === 'object' ? transfer as Record<string, unknown> : {};
    const amount = Number(transferData.amount);
    const transferKey = typeof transferData.key === 'string' ? transferData.key.trim() : '';
    if (!Number.isFinite(amount) || amount <= 0 || !transferKey) {
      return res.status(400).json({ error: 'valid transfer amount and key required' });
    }
    let created = false;
    const capture = newJsonPruneCapture();
    const storedBucket = updateUserData(JSON_FILENAME, userId, (bucket: SavingsBucket) => {
      capture.ownMonthCreated = didCreateOwnMonth(bucket, month);
      const nextBucket: SavingsBucket = { ...bucket };
      const existing = nextBucket[month] || { month, savings_list: [] };
      const existingList = Array.isArray(existing.savings_list) ? existing.savings_list : [];
      if (existingList.some(item => isRecord(item) && item.transferKey === transferKey)) return nextBucket;
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
      return limitAndCapturePruned(nextBucket, capture);
    });
    // The idempotent early return above prunes nothing, so it credits nothing (A-4).
    creditPrunedMonthsJson(userId, month, capture, storedBucket);
    return res.status(201).json({ success: true, created });
  }
  const updateObj: SavingsDoc = { month, savings_list };
  if (typeof total_savings !== 'undefined') {
    updateObj.total_savings = total_savings;
  }
  const capture = newJsonPruneCapture();
  const storedBucket = updateUserData(JSON_FILENAME, userId, (bucket: SavingsBucket) => {
    capture.ownMonthCreated = didCreateOwnMonth(bucket, month);
    const nextBucket: SavingsBucket = { ...bucket };
    const existing = nextBucket[month] || {};
    nextBucket[month] = withGeneratedId({ ...existing, ...updateObj });
    return limitAndCapturePruned(nextBucket, capture);
  });
  creditPrunedMonthsJson(userId, month, capture, storedBucket);
  return res.status(201).json({ success: true });
}

/**
 * ตัวจัดการหลักของ API เงินออม
 * รองรับทั้ง JSON และ MongoDB
 * @param {object} req - Express request (GET/POST)
 * @param {object} res - Express response
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  const userId = assertUserId(req, res);
  if (!userId) return;
  if (!validateApiRequest(req, res, 'savings')) return;

  if (isJsonMode()) {
    if (req.method === 'GET') {
      return handleJsonSavingsGet(req, res, userId);
    }
    if (req.method === 'POST') {
      return handleJsonSavingsPost(req, res, userId);
    }
    return res.status(405).end();
  }

  const collection: Collection<Document> = await getMongoCollection(COLLECTION_NAME);
  const userFilter = { userId };

  if (req.method === 'GET') {
    const month = asPlainString(Array.isArray(req.query.month) ? req.query.month[0] : req.query.month);
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
        const data: Record<string, Record<string, unknown>> = {};
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
        return res.status(500).json({ error: 'Internal server error', details: err instanceof Error ? err.message : String(err) });
      }
    }
  } else if (req.method === 'POST') {
    const body = req.body && typeof req.body === 'object' ? req.body as Record<string, unknown> : {};
    const { month, total_savings, savings_list, transfer } = body;
    if (typeof month !== 'string' || !month) {
      return res.status(400).json({ error: 'month required' });
    }
    if (transfer) {
      const transferData = transfer && typeof transfer === 'object' ? transfer as Record<string, unknown> : {};
      const amount = Number(transferData.amount);
      const transferKey = typeof transferData.key === 'string' ? transferData.key.trim() : '';
      if (!Number.isFinite(amount) || amount <= 0 || !transferKey) {
        return res.status(400).json({ error: 'valid transfer amount and key required' });
      }
      // Kept: its upsertedCount says whether this request created the month (C-S2c-11).
      const ensureMonth = await collection.updateOne(
        { month, ...userFilter },
        { $setOnInsert: { month, ...userFilter, savings_list: [] } },
        { upsert: true }
      );
      const transferItem: Document = {
        savings_type: 'เงินออมจากเงินเหลือ',
        savings_amount: amount,
        transferKey,
        source: 'transferable-savings'
      };
      const result = await collection.updateOne(
        { month, ...userFilter, 'savings_list.transferKey': { $ne: transferKey } },
        { $push: { savings_list: transferItem } } as Document
      );
      // Mongo prunes (and credits) even on an idempotent transfer — pre-existing behaviour (F-9).
      await pruneSavingsMonthsWithCarryForward(collection, userId, {
        ownMonth: month,
        ownMonthCreated: ensureMonth.upsertedCount === 1
      });
      return res.status(201).json({ success: true, created: result.modifiedCount === 1 });
    }
    // สร้าง object สำหรับบันทึก โดยไม่ใส่ total_savings ถ้าไม่ได้ส่งมา
    const updateObj: Record<string, unknown> = { month, savings_list };
    if (typeof total_savings !== 'undefined') {
      updateObj.total_savings = total_savings;
    }
    const saved = await collection.updateOne(
      { month, ...userFilter },
      { $set: { ...updateObj, ...userFilter } },
      { upsert: true }
    );
    await pruneSavingsMonthsWithCarryForward(collection, userId, {
      ownMonth: month,
      ownMonthCreated: saved.upsertedCount === 1
    });
    return res.status(201).json({ success: true });
  } else {
    res.status(405).end();
  }
}

export default withAudit(handler, { source: 'savings' });
