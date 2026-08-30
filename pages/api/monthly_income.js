/**
 * API: pages/api/monthly_income.js
 * จัดการข้อมูลรายรับรายเดือน
 * รองรับทั้ง JSON และ MongoDB
 * - GET: อ่านข้อมูลรายเดือนหรือทั้งหมดพร้อมยอดรวม
 * - POST: บันทึก/อัปเดตข้อมูลพร้อม label แบบกำหนดเองและรายการลบ
 * - รองรับรายการรายรับแบบ dynamic
 * - จำกัดข้อมูลย้อนหลังสูงสุด 15 เดือน
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

const MONTH_LIMIT = 15; // จำกัดข้อมูลย้อนหลังสูงสุด 15 เดือนต่อผู้ใช้
const JSON_FILENAME = 'monthly_income.json'; // ไฟล์ JSON สำหรับโหมด file-based

/**
 * ดึงและตรวจสอบ label แบบกำหนดเองจาก payload
 * @param {object} payload - ข้อมูลที่มี __labels
 * @returns {object} label ที่ผ่านการกรองแล้ว
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
 * ทำความสะอาด payload ก่อนบันทึก
 * ลบ metadata, label และฟิลด์สรุปยอด
 * @param {object} values - ข้อมูลรายรับ
 * @returns {object} ข้อมูลที่พร้อมบันทึก
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
 * คำนวณยอดรวมรายรับของเดือน
 * @param {object} data - ข้อมูลรายรับ
 * @returns {number} ยอดรวม (ปัดทศนิยม 2 ตำแหน่ง)
 */
function getTotalIncome(data) {
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
 * จำกัดจำนวนเดือนข้อมูลรายรับต่อผู้ใช้ไว้ที่ 15 เดือน
 * @param {object} bucket - ข้อมูลรายเดือนของผู้ใช้
 * @returns {object} bucket ที่ถูกจำกัดจำนวนเดือนแล้ว
 */
function enforceUserMonthLimit(bucket = {}) {
  return limitUserEntries(bucket, {
    limit: MONTH_LIMIT,
    keySelector: (_, value) => value?.month || ''
  });
}

/**
 * อ่านข้อมูลรายรับในโหมด JSON
 * - ถ้ามีเดือน: คืนข้อมูลเดือนนั้นพร้อมยอดรวม
 * - ถ้าไม่มีเดือน: คืนข้อมูลทุกเดือนพร้อมยอดรวม
 * @param {object} req - Express request
 * @param {object} res - Express response
 * @param {string} userId - รหัสผู้ใช้
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
 * บันทึกข้อมูลรายรับในโหมด JSON
 * ตรวจสอบ month/values และรองรับ label แบบกำหนดเองกับรายการที่ต้องลบ
 * @param {object} req - Express request
 * @param {object} res - Express response
 * @param {string} userId - รหัสผู้ใช้
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
 * ตัวจัดการหลักของ API รายรับรายเดือน
 * รองรับทั้ง JSON และ MongoDB
 * @param {object} req - Express request
 * @param {object} res - Express response
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
        const monthsDoc = await collection.findOne({ obj: 'months', ...userFilter });
        if (monthsDoc && monthsDoc.months && monthsDoc.months[month]) {
          doc = { month, ...monthsDoc.months[month] };
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
      const monthsDoc = await collection.findOne({ obj: 'months', ...userFilter });
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