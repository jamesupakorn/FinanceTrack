/**
 * sharedMonthWindow.js
 * รวมการบังคับ "หน้าต่าง 15 เดือนล่าสุด" ให้เป็นชุดเดียวกันข้าม 4 collection ที่เกี่ยวข้องกับ
 * dropdown เลือกเดือน (expense, income, salary, investment) แทนที่การจำกัด 15 เดือนแบบแยกอิสระ
 * ต่อ collection แบบเดิม ซึ่งเป็นสาเหตุที่ collection ที่ถูกเขียนน้อย (เช่น investment) ไม่เคยถึง
 * เพดาน 15 รายการ และไม่เคยตัดเดือนเก่าทิ้ง ทำให้เดือนเก่ามาก ๆ โผล่ใน union ของ dropdown ได้
 *
 * หลักการ: ไม่แก้ primitive เดิม (`limitUserEntries` ใน userUtils.js, `enforceMonthLimit` ใน
 * apiUtils.js) เพราะทั้งคู่ยังถูกใช้อยู่โดย savings.js/daily_expenses.js (นอกขอบเขตงานนี้)
 * ไฟล์นี้แค่ "ประกอบ" primitive ทั้งสองเข้าด้วยกันให้มองเห็น 4 collection พร้อมกัน
 *
 * ขอบเขต: expense, income, salary, investment เท่านั้น — savings/daily_expenses ไม่แตะ
 */

import { enforceMonthLimit } from './apiUtils';
import { getMongoCollection } from '../../../../lib/dataSource';

// require(), not import, for userUtils.js — matches the exact interop pattern already used by
// every one of the 4 API handlers this module is called from (monthly_expense.js, monthly_income.js,
// salary.js, investment.js all `const {...} = require('.../userUtils')` + ESM `import` for
// apiUtils.js in the same file). This is the codebase's established, unavoidable CJS/ESM split
// (TD-H01 in TECH_DEBT.md), not a new instance of it.
const { getUserData, setUserData } = require('../../../backend/data/userUtils');

const SHARED_WINDOW_LIMIT = 15;
const JSON_FILES = ['monthly_expense.json', 'monthly_income.json', 'salary.json', 'investment.json'];
const MONGO_COLLECTIONS = ['monthly_expense', 'monthly_income', 'salary', 'investment'];

/**
 * JSON mode: prune all 4 "range-relevant" collections' buckets for one user down to a single
 * shared newest-15 window. Call AFTER the calling handler's own updateUserData() has already
 * persisted its write, so this pass sees its own new month on disk.
 * @param {string} userId
 * @param {{extraMonth?: string}} [opts] - belt-and-suspenders; the caller's own month is normally
 *   already on disk by the time this runs (see call-site note above), but passing it defensively
 *   costs nothing (Set dedups) and protects against future call-order refactors.
 * @returns {{allowedMonths: Set<string>}}
 */
export function enforceSharedMonthWindowJson(userId, { extraMonth } = {}) {
  // อ่านทั้ง 4 ไฟล์ของผู้ใช้คนนี้ แล้วรวม key เดือนทั้งหมดเป็น union เดียว
  const buckets = JSON_FILES.map(file => getUserData(file, userId));
  const allMonthsSet = new Set();
  buckets.forEach(bucket => {
    Object.keys(bucket).forEach(month => allMonthsSet.add(month));
  });
  if (typeof extraMonth === 'string' && extraMonth.length > 0) {
    allMonthsSet.add(extraMonth);
  }

  // เรียงใหม่ -> เก่า แล้วเก็บแค่ 15 เดือนล่าสุด — นี่คือหน้าต่างที่ใช้ร่วมกันทั้ง 4 collection
  const allowedMonths = new Set(
    Array.from(allMonthsSet)
      .sort((a, b) => b.localeCompare(a))
      .slice(0, SHARED_WINDOW_LIMIT)
  );

  // ตัดแต่ละไฟล์ให้เหลือเฉพาะเดือนที่อยู่ใน allowedMonths แล้วเขียนกลับ
  JSON_FILES.forEach((file, index) => {
    const bucket = buckets[index];
    const prunedBucket = {};
    Object.entries(bucket).forEach(([month, value]) => {
      if (allowedMonths.has(month)) {
        prunedBucket[month] = value;
      }
    });
    setUserData(file, userId, prunedBucket);
  });

  return { allowedMonths };
}

/**
 * Mongo mode: prune all 4 collections for one user down to a single shared newest-15 window,
 * by calling the existing, unmodified enforceMonthLimit() once per collection with the SAME
 * additionalMonths array (the full cross-collection union), so all 4 independently compute and
 * apply the identical newest-15 cut.
 * @param {string} userId
 * @param {{extraMonth?: string}} [opts]
 * @returns {{allowedMonths: string[]}} - sorted desc, length <= 15; equivalent to the old
 *   per-collection `retainedMonths` return value, for callers (monthly_income.js's legacy
 *   `obj: 'months'` sub-doc handling) that already consume that shape.
 */
export async function enforceSharedMonthWindowMongo(userId, { extraMonth } = {}) {
  const collections = await Promise.all(
    MONGO_COLLECTIONS.map(name => getMongoCollection(name))
  );

  // รวม key เดือนจากทั้ง 4 collection (เฉพาะของ userId นี้) เป็น union เดียว
  const monthSet = new Set();
  await Promise.all(
    collections.map(async (collection) => {
      const docs = await collection
        .find({ userId, month: { $exists: true } }, { projection: { month: 1 } })
        .toArray();
      docs.forEach(doc => {
        if (doc && typeof doc.month === 'string' && doc.month.length > 0) {
          monthSet.add(doc.month);
        }
      });
    })
  );
  if (typeof extraMonth === 'string' && extraMonth.length > 0) {
    monthSet.add(extraMonth);
  }
  const additionalMonths = Array.from(monthSet);

  // เรียก enforceMonthLimit เดิม (ไม่แก้ไข) ทีละ collection ด้วย additionalMonths ชุดเดียวกันทุกครั้ง
  // เพราะ enforceMonthLimit รวม union ของตัวเองกับ additionalMonths ก่อนตัด 15 อันดับแรกอยู่แล้ว
  // ทั้ง 4 collection จึงคำนวณ top-15 ชุดเดียวกันได้เองโดยไม่ต้องแก้ primitive
  await Promise.all(
    collections.map(collection =>
      enforceMonthLimit(collection, SHARED_WINDOW_LIMIT, {
        filter: { userId },
        additionalMonths,
      })
    )
  );

  const allowedMonths = additionalMonths
    .sort((a, b) => b.localeCompare(a))
    .slice(0, SHARED_WINDOW_LIMIT);

  return { allowedMonths };
}
