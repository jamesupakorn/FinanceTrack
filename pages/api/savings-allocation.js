/**
 * API: pages/api/savings-allocation.js
 * จัดการ allocation buckets ของผู้ใช้ (สัดส่วนการออมรายเดือน)
 * GET  /api/savings-allocation?userId=u001  → { buckets: [...] }
 * PUT  /api/savings-allocation              → { success: true, buckets: [...] }
 */

import crypto from 'crypto';
import { assertUserId } from '../../src/shared/utils/backend/userRequest';
import { isJsonMode, getMongoCollection } from '../../lib/dataSource';

const { getUserData, updateUserData } = require('../../src/backend/data/userUtils');

const ALLOCATION_JSON_FILE = 'savings-allocation.json';
const COLLECTION_NAME = 'savingsAllocations';
const MAX_BUCKETS = 20;

// ────────────────────────────────────────────────────────────
// Validation
// ────────────────────────────────────────────────────────────

function validateBuckets(buckets) {
  if (!Array.isArray(buckets)) {
    return 'buckets ต้องเป็น array';
  }
  if (buckets.length > MAX_BUCKETS) {
    return `มีถังเกิน ${MAX_BUCKETS} ถัง`;
  }
  for (let i = 0; i < buckets.length; i++) {
    const b = buckets[i];
    const name = typeof b.name === 'string' ? b.name.trim() : '';
    if (!name) {
      return `ถังลำดับที่ ${i + 1}: ชื่อถังต้องไม่ว่าง`;
    }
    const pct = Number(b.percentage);
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
      return `ถัง "${b.name}": percentage ต้องเป็นตัวเลข 0–100`;
    }
  }
  return null;
}

function normalizeBucket(b) {
  return {
    id: (typeof b.id === 'string' && b.id.trim()) ? b.id.trim() : crypto.randomBytes(6).toString('hex'),
    name: String(b.name).trim(),
    percentage: Number(b.percentage)
  };
}

// ────────────────────────────────────────────────────────────
// JSON mode helpers
// ────────────────────────────────────────────────────────────

function getJsonAllocation(userId) {
  const bucket = getUserData(ALLOCATION_JSON_FILE, userId);
  return Array.isArray(bucket?.buckets) ? bucket.buckets : [];
}

function setJsonAllocation(userId, buckets) {
  updateUserData(ALLOCATION_JSON_FILE, userId, () => ({
    buckets,
    updatedAt: new Date().toISOString()
  }));
}

// ────────────────────────────────────────────────────────────
// Handler
// ────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  const userId = assertUserId(req, res);
  if (!userId) return;

  if (req.method === 'GET') {
    if (isJsonMode()) {
      const buckets = getJsonAllocation(userId);
      return res.status(200).json({ buckets });
    }
    // MongoDB mode
    try {
      const col = await getMongoCollection(COLLECTION_NAME);
      const doc = await col.findOne({ userId });
      const buckets = doc && Array.isArray(doc.buckets) ? doc.buckets : [];
      return res.status(200).json({ buckets });
    } catch (err) {
      console.error('[savings-allocation GET]', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }

  if (req.method === 'PUT') {
    const rawBuckets = req.body?.buckets;
    const validationError = validateBuckets(rawBuckets);
    if (validationError) {
      return res.status(400).json({ error: validationError });
    }
    const buckets = rawBuckets.map(normalizeBucket);

    if (isJsonMode()) {
      setJsonAllocation(userId, buckets);
      return res.status(200).json({ success: true, buckets });
    }
    // MongoDB mode
    try {
      const col = await getMongoCollection(COLLECTION_NAME);
      await col.findOneAndUpdate(
        { userId },
        { $set: { userId, buckets, updatedAt: new Date().toISOString() } },
        { upsert: true }
      );
      return res.status(200).json({ success: true, buckets });
    } catch (err) {
      console.error('[savings-allocation PUT]', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
