/**
 * API: pages/api/monthly_income.ts
 * จัดการข้อมูลรายรับรายเดือน
 * รองรับทั้ง JSON และ MongoDB
 * - GET: อ่านข้อมูลรายเดือนหรือทั้งหมดพร้อมยอดรวม
 * - POST: บันทึก/อัปเดตข้อมูลพร้อม label แบบกำหนดเองและรายการลบ
 * - รองรับรายการรายรับแบบ dynamic
 * - จำกัดข้อมูลย้อนหลังสูงสุด 15 เดือน
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import type { Collection, Document } from 'mongodb';
import { sumValues, stripKnownTotalFields } from '../../src/shared/utils/backend/apiUtils';
import { assertUserId } from '../../src/shared/utils/backend/userRequest';
import { validateApiRequest } from '../../src/shared/utils/backend/apiRequestValidation';
import { extractRemovalKeys } from '../../src/shared/utils/commonUtils';
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

const JSON_FILENAME = 'monthly_income.json'; // ไฟล์ JSON สำหรับโหมด file-based

type IncomeData = Record<string, unknown> & {
  month?: string;
  __labels?: Record<string, unknown>;
  __removeKeys?: unknown;
};
type IncomeBucket = Record<string, IncomeData>;

function isRecord(value: unknown): value is IncomeData {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * ดึงและตรวจสอบ label แบบกำหนดเองจาก payload
 * @param {object} payload - ข้อมูลที่มี __labels
 * @returns {object} label ที่ผ่านการกรองแล้ว
 */
function extractLabelUpdates(payload: IncomeData = {}): Record<string, string> {
  const raw = payload?.__labels;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  return Object.entries(raw as Record<string, unknown>).reduce<Record<string, string>>((acc, [key, value]) => {
    if (typeof key !== 'string') return acc;
    const cleanValue = typeof value === 'string' ? value.trim() : value;
    if (typeof cleanValue === 'string' && cleanValue.length > 0) {
      acc[key] = cleanValue;
    }
    return acc;
  }, {});
}

/**
 * ทำความสะอาด payload ก่อนบันทึก
 * ลบ metadata, label และฟิลด์สรุปยอด
 * @param {object} values - ข้อมูลรายรับ
 * @returns {object} ข้อมูลที่พร้อมบันทึก
 */
function sanitizeIncomePayload(values: IncomeData = {}): IncomeData {
  const cleaned = stripKnownTotalFields(values, ['รวม']);
  delete cleaned.__removeKeys;
  delete cleaned.__labels;
  delete cleaned.month;
  delete cleaned._id;
  delete cleaned.userId;
  return cleaned;
}

/**
 * คำนวณยอดรวมรายรับของเดือน
 * @param {object} data - ข้อมูลรายรับ
 * @returns {number} ยอดรวม (ปัดทศนิยม 2 ตำแหน่ง)
 */
function getTotalIncome(data: IncomeData): number {
  let sum = 0;
  Object.values(data || {}).forEach(v => {
    if (typeof v === 'number') sum += v;
  });
  return Math.round(sum * 100) / 100;
}

/**
 * สร้างผลลัพธ์รายเดือนทั้งหมดพร้อมยอดรวม
 * @param {object} bucket - ข้อมูลรายเดือนทั้งหมด
 * @returns {object} ข้อมูลรายเดือนพร้อมยอดรวม
 */
function buildJsonAllMonthsResponse(bucket: IncomeBucket = {}): Record<string, IncomeData> {
  const data: Record<string, IncomeData> = {};
  Object.entries(bucket).forEach(([monthKey, doc]: [string, IncomeData]) => {
    if (!doc || !doc.month) return;
    const monthData = { ...doc };
    delete monthData._id;
    const รวม = getTotalIncome(monthData);
    data[monthKey] = { ...monthData, รวม };
  });
  return data;
}

/**
 * อ่านข้อมูลรายรับในโหมด JSON
 * - ถ้ามีเดือน: คืนข้อมูลเดือนนั้นพร้อมยอดรวม
 * - ถ้าไม่มีเดือน: คืนข้อมูลทุกเดือนพร้อมยอดรวม
 * @param {object} req - Express request
 * @param {object} res - Express response
 * @param {string} userId - รหัสผู้ใช้
 */
function handleJsonGet(req: NextApiRequest, res: NextApiResponse, userId: string) {
  const bucket = getUserData(JSON_FILENAME, userId) as IncomeBucket;
  const queryMonth = req.query.month;
  const month = Array.isArray(queryMonth) ? queryMonth.join(',') : queryMonth;
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
 * บันทึกข้อมูลรายรับในโหมด JSON
 * ตรวจสอบ month/values และรองรับ label แบบกำหนดเองกับรายการที่ต้องลบ
 * @param {object} req - Express request
 * @param {object} res - Express response
 * @param {string} userId - รหัสผู้ใช้
 */
function handleJsonPost(req: NextApiRequest, res: NextApiResponse, userId: string) {
  const body = isRecord(req.body) ? req.body : {};
  const { month, values } = body;
  if (typeof month !== 'string' || !month || !isRecord(values)) {
    return res.status(400).json({ error: 'month and values required' });
  }
  const removalList = extractRemovalKeys(values);
  const labelUpdates = extractLabelUpdates(values);
  const cleanValues = sanitizeIncomePayload(values);
  updateUserData(JSON_FILENAME, userId, (bucket: IncomeBucket) => {
    const nextBucket: IncomeBucket = { ...bucket };
    const existing = nextBucket[month] || {};
    const existingLabels = (existing.__labels && typeof existing.__labels === 'object' && !Array.isArray(existing.__labels))
      ? { ...existing.__labels as Record<string, unknown> }
      : {};
    let mergedLabels = { ...existingLabels };
    const merged: IncomeData = { ...existing, ...cleanValues, month };
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
    return nextBucket;
  });
  // จำกัดหน้าต่าง 15 เดือนแบบรวมทุก collection (expense/income/salary/investment) หลังเขียนไฟล์นี้แล้ว
  enforceSharedMonthWindowJson(userId, { extraMonth: month });
  return res.status(201).json({ success: true });
}

/**
 * ตัวจัดการหลักของ API รายรับรายเดือน
 * รองรับทั้ง JSON และ MongoDB
 * @param {object} req - Express request
 * @param {object} res - Express response
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  const userId = assertUserId(req, res);
  if (!userId) return;
  if (!validateApiRequest(req, res, 'monthly_income')) return;

  if (isJsonMode()) {
    if (req.method === 'GET') {
      return handleJsonGet(req, res, userId);
    }
    if (req.method === 'POST') {
      return handleJsonPost(req, res, userId);
    }
    return res.status(405).end();
  }

  const collection: Collection<Document> = await getMongoCollection('monthly_income');
  const userFilter = { userId };

  if (req.method === 'GET') {
    const queryMonth = req.query.month;
    const month = Array.isArray(queryMonth) ? queryMonth.join(',') : queryMonth;
    if (month) {
      let doc = await collection.findOne({ month, ...userFilter });
      if (!doc) {
        const monthsDoc = await collection.findOne({ obj: 'months', ...userFilter });
        if (monthsDoc && monthsDoc.months && monthsDoc.months[month]) {
          doc = { month, ...monthsDoc.months[month] };
          // เอกสาร monthsDoc (ของผู้ใช้คนนี้เอง) เก็บหลายเดือนรวมกัน — ทำสำเนาเฉพาะเดือนนี้ออกมาเป็น doc เดี่ยว
          // ไม่แก้เอกสารเดิม เพราะเดือนอื่นในเอกสารเดียวกันยังต้องอ่านได้ตามปกติ
          try {
            const rest: IncomeData = { ...doc };
            delete rest._id;
            delete rest.userId;
            await collection.updateOne(
              { month, ...userFilter },
              { $set: { ...rest, month, ...userFilter } },
              { upsert: true }
            );
          } catch (err) {
            console.error('Failed to materialize legacy monthsDoc entry for user', userId, month, err);
          }
        }
      }
      const monthData: IncomeData = doc ? { ...doc } : {};
      delete monthData._id;
      delete monthData.userId;
      const รวม = getTotalIncome(monthData);
      const response = {
        month,
        ...monthData,
        รวม
      };
      return res.status(200).json(response);
    } else {
      const allDocs = await collection.find({ ...userFilter, month: { $exists: true } }).toArray();
      const data: Record<string, IncomeData> = {};
      allDocs.forEach(doc => {
        const monthData: IncomeData = { ...doc };
        delete monthData._id;
        delete monthData.userId;
        const รวม = getTotalIncome(monthData);
        const monthKey = typeof doc.month === 'string' ? doc.month : String(doc.month);
        data[monthKey] = {
          ...monthData,
          รวม
        };
      });
      const monthsDoc = await collection.findOne({ obj: 'months', ...userFilter });
      if (monthsDoc && isRecord(monthsDoc.months)) {
      const legacyMonths = monthsDoc.months;
      for (const [m, rawValues] of Object.entries(legacyMonths)) {
        const values = rawValues as IncomeData;
          if (!data[m]) {
            data[m] = { month: m, ...values };
            data[m].รวม = sumValues(values, ['รวม']);
            // ทำสำเนาเฉพาะเดือนนี้ออกมาเป็น doc เดี่ยว ไม่แก้เอกสาร monthsDoc เดิมของผู้ใช้คนนี้
            try {
              await collection.updateOne(
                { month: m, ...userFilter },
                { $set: { ...values, month: m, ...userFilter } },
                { upsert: true }
              );
            } catch (err) {
              console.error('Failed to materialize legacy monthsDoc entry for user', userId, m, err);
            }
          }
        }
      }
      return res.status(200).json(data);
    }
  } else if (req.method === 'POST') {
    const body = isRecord(req.body) ? req.body : {};
    const { month, values } = body;
    if (typeof month !== 'string' || !month || !isRecord(values)) {
      return res.status(400).json({ error: 'month and values required' });
    }
    const removalList = extractRemovalKeys(values);
    const labelUpdates = extractLabelUpdates(values);
    const cleanValues = sanitizeIncomePayload(values);
    const removalSet = new Set(removalList);
    const setValues = Object.fromEntries(
      Object.entries(cleanValues).filter(([key]) => !removalSet.has(key))
    );
    const filteredLabelUpdates = Object.fromEntries(
      Object.entries(labelUpdates).filter(([key]) => !removalSet.has(key))
    );
    await collection.updateOne(
      { month, ...userFilter },
      (() => {
        const updateOps: Document = {
          $set: { ...setValues, month, ...userFilter }
        };
        if (Object.keys(filteredLabelUpdates).length) {
          Object.entries(filteredLabelUpdates).forEach(([key, value]) => {
            updateOps.$set[`__labels.${key}`] = value;
          });
        }
        if (removalList.length) {
          updateOps.$unset = removalList.reduce<Record<string, string>>((acc, key) => {
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
    // จำกัดหน้าต่าง 15 เดือนแบบรวมทุก collection (expense/income/salary/investment)
    const { allowedMonths } = await enforceSharedMonthWindowMongo(userId, { extraMonth: month });
    if (monthsDoc && isRecord(monthsDoc.months)) {
      const prunedMonths: IncomeData = {};
      allowedMonths.forEach(m => {
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

export default withAudit(handler, { source: 'monthly_income' });
