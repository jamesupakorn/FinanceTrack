/**
 * API: /api/savings-goals
 * จัดการเป้าหมายเงินออมต่อ user
 * GET  - ดึงเป้าหมายทั้งหมด พร้อมคำนวณ currentAmount จากข้อมูล savings จริง
 * POST - สร้างเป้าหมายใหม่
 * PUT  - อัปเดตเป้าหมาย
 * DELETE - ลบเป้าหมาย
 */

import { assertApiToken } from '../../src/shared/utils/backend/apiTokenAuth';
import { isJsonMode, getMongoCollection } from '../../lib/dataSource';
import crypto from 'crypto';

const {
  getUserData,
  updateUserData,
} = require('../../src/backend/data/userUtils');

const GOALS_JSON_FILE = 'savings-goals.json';
const SAVINGS_JSON_FILE = 'savings.json';

function assertAuth(req, res) {
  return assertApiToken(req, res);
}

function getUserId(req) {
  const id =
    req.query?.userId ||
    req.body?.userId ||
    req.headers?.['x-user-id'];
  return typeof id === 'string' ? id.trim() : null;
}

function toAllocationPercent(value) {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.min(100, Math.round(parsed * 100) / 100);
}

/**
 * คำนวณ currentAmount ของแต่ละ goal โดยรวมจาก savings collection
 * ตรงกับ goalName (case-insensitive trim match)
 * @param {Array} goals - goals array
 * @param {Array} savingsDocs - savings docs array (all months for this user)
 */
function computeCurrentAmounts(goals, savingsDocs) {
  return goals.map(goal => {
    const goalName = (goal.goalName || '').trim().toLowerCase();
    let currentAmount = 0;

    savingsDocs.forEach(doc => {
      if (!doc || !doc.savings_list || !Array.isArray(doc.savings_list)) return;
      doc.savings_list.forEach(item => {
        const itemType = (item?.savings_type || item?.รายการ || '').trim().toLowerCase();
        if (itemType === goalName) {
          const raw = item.savings_amount ?? item.จำนวนเงิน ?? 0;
          const amt = typeof raw === 'number'
            ? raw
            : Number(String(raw).replace(/,/g, '')) || 0;
          currentAmount += amt;
        }
      });
    });

    const targetAmount = Number(goal.targetAmount) || 0;
    const progressPercentage = targetAmount > 0
      ? Math.min(100, Math.round((currentAmount / targetAmount) * 10000) / 100)
      : 0;
    const remainingAmount = Math.max(0, targetAmount - currentAmount);

    return {
      ...goal,
      currentAmount,
      metadata: {
        ...(goal.metadata || {}),
        progressPercentage,
        remainingAmount,
      }
    };
  });
}

// ---- JSON mode helpers ----

function getJsonGoals(userId) {
  const bucket = getUserData(GOALS_JSON_FILE, userId);
  return Array.isArray(bucket?.goals) ? bucket.goals : [];
}

function setJsonGoals(userId, goals) {
  updateUserData(GOALS_JSON_FILE, userId, () => ({ goals }));
}

function computeCurrentAmountsFromJson(goals, userId) {
  const savingsBucket = getUserData(SAVINGS_JSON_FILE, userId);
  const savingsDocs = Object.values(savingsBucket || {});
  return computeCurrentAmounts(goals, savingsDocs);
}

function handleJsonMode(req, res, userId) {
  if (req.method === 'GET') {
    const goals = getJsonGoals(userId).filter(g => g.status !== 'abandoned');
    const goalsWithProgress = computeCurrentAmountsFromJson(goals, userId);
    return res.status(200).json({ goals: goalsWithProgress });
  }

  if (req.method === 'POST') {
    const { goalName, description, targetAmount, category, priority, endDate, notes, allocationPercent } = req.body;
    if (!goalName || !targetAmount) {
      return res.status(400).json({ error: 'goalName and targetAmount are required' });
    }
    const now = new Date().toISOString();
    const newGoal = {
      _id: crypto.randomBytes(12).toString('hex'),
      userId,
      goalName: String(goalName).trim(),
      description: description || null,
      targetAmount: Number(targetAmount),
      currency: 'THB',
      category: category || 'other',
      priority: priority || 'medium',
      status: 'active',
      endDate: endDate || null,
      notes: notes || null,
      allocationPercent: toAllocationPercent(allocationPercent),
      createdAt: now,
      updatedAt: now,
    };
    const goals = getJsonGoals(userId);
    goals.push(newGoal);
    setJsonGoals(userId, goals);
    return res.status(201).json({ success: true, goal: newGoal });
  }

  if (req.method === 'PUT') {
    const allocations = Array.isArray(req.body?.allocations) ? req.body.allocations : null;
    if (allocations) {
      const goals = getJsonGoals(userId);
      const updatesById = new Map();
      allocations.forEach((item) => {
        const goalId = item?.goalId || item?.id;
        if (!goalId) return;
        updatesById.set(goalId, toAllocationPercent(item?.allocationPercent));
      });

      const now = new Date().toISOString();
      const nextGoals = goals.map((goal) => {
        if (!updatesById.has(goal._id)) return goal;
        return {
          ...goal,
          allocationPercent: updatesById.get(goal._id),
          updatedAt: now,
        };
      });

      setJsonGoals(userId, nextGoals);
      return res.status(200).json({ success: true, updatedCount: updatesById.size });
    }

    const goalId = req.body?.goalId || req.body?.id;
    const { goalName, description, targetAmount, category, priority, status, endDate, notes, allocationPercent } = req.body;
    if (!goalId) {
      return res.status(400).json({ error: 'goalId required' });
    }
    const goals = getJsonGoals(userId);
    const idx = goals.findIndex(g => g._id === goalId);
    if (idx === -1) {
      return res.status(404).json({ error: 'Goal not found' });
    }
    const updates = { updatedAt: new Date().toISOString() };
    if (goalName !== undefined) updates.goalName = String(goalName).trim();
    if (description !== undefined) updates.description = description;
    if (targetAmount !== undefined) updates.targetAmount = Number(targetAmount);
    if (category !== undefined) updates.category = category;
    if (priority !== undefined) updates.priority = priority;
    if (status !== undefined) updates.status = status;
    if (endDate !== undefined) updates.endDate = endDate || null;
    if (notes !== undefined) updates.notes = notes;
    if (allocationPercent !== undefined) updates.allocationPercent = toAllocationPercent(allocationPercent);
    goals[idx] = { ...goals[idx], ...updates };
    setJsonGoals(userId, goals);
    return res.status(200).json({ success: true });
  }

  if (req.method === 'DELETE') {
    const goalId = req.body?.goalId || req.body?.id || req.query?.goalId || req.query?.id;
    if (!goalId) {
      return res.status(400).json({ error: 'goalId required' });
    }
    const goals = getJsonGoals(userId);
    const idx = goals.findIndex(g => g._id === goalId);
    if (idx === -1) {
      return res.status(404).json({ error: 'Goal not found' });
    }
    goals.splice(idx, 1);
    setJsonGoals(userId, goals);
    return res.status(200).json({ success: true });
  }

  return res.status(405).end();
}

// ---- main handler ----

export default async function handler(req, res) {
  if (!assertAuth(req, res)) return;

  const userId = getUserId(req);
  if (!userId) {
    return res.status(400).json({ error: 'userId required' });
  }

  if (isJsonMode()) {
    return handleJsonMode(req, res, userId);
  }

  const goalsCol = await getMongoCollection('savingsGoals');
  const savingsCol = await getMongoCollection('savings');

  // ดึง savings ทุกเดือนของ user มาใช้คำนวณ currentAmount
  async function getAllSavings() {
    return savingsCol.find({ userId, month: { $exists: true } }).toArray();
  }

  // ------- GET -------
  if (req.method === 'GET') {
    const goals = await goalsCol
      .find({ userId, status: { $ne: 'abandoned' } })
      .sort({ createdAt: -1 })
      .toArray();

    const savingsDocs = await getAllSavings();
    const goalsWithProgress = computeCurrentAmounts(
      goals.map(g => ({ ...g, _id: g._id?.toString() })),
      savingsDocs
    );

    return res.status(200).json({ goals: goalsWithProgress });
  }

  // ------- POST (create) -------
  if (req.method === 'POST') {
    const { goalName, description, targetAmount, category, priority, endDate, notes, allocationPercent } = req.body;

    if (!goalName || !targetAmount) {
      return res.status(400).json({ error: 'goalName and targetAmount are required' });
    }

    const now = new Date();
    const doc = {
      _id: crypto.randomBytes(12).toString('hex'),
      userId,
      goalName: String(goalName).trim(),
      description: description || null,
      targetAmount: Number(targetAmount),
      currentAmount: 0,
      currency: 'THB',
      category: category || 'other',
      priority: priority || 'medium',
      status: 'active',
      endDate: endDate ? new Date(endDate) : null,
      notes: notes || null,
      allocationPercent: toAllocationPercent(allocationPercent),
      createdAt: now,
      updatedAt: now,
      metadata: {
        progressPercentage: 0,
        remainingAmount: Number(targetAmount),
        monthlyContribution: null,
        estimatedCompletionDate: null,
      }
    };

    await goalsCol.insertOne(doc);
    return res.status(201).json({ success: true, goal: { ...doc, _id: doc._id.toString() } });
  }

  // ------- PUT (update) -------
  if (req.method === 'PUT') {
    const allocations = Array.isArray(req.body?.allocations) ? req.body.allocations : null;
    if (allocations) {
      const now = new Date();
      const operations = allocations
        .map((item) => {
          const goalId = item?.goalId || item?.id;
          if (!goalId) return null;
          return {
            updateOne: {
              filter: { _id: goalId, userId },
              update: {
                $set: {
                  allocationPercent: toAllocationPercent(item?.allocationPercent),
                  updatedAt: now,
                }
              }
            }
          };
        })
        .filter(Boolean);

      if (operations.length === 0) {
        return res.status(400).json({ error: 'allocations payload is empty' });
      }

      const result = await goalsCol.bulkWrite(operations, { ordered: false });
      return res.status(200).json({
        success: true,
        matchedCount: result.matchedCount,
        modifiedCount: result.modifiedCount,
      });
    }

    const goalId = req.body?.goalId || req.body?.id;
    const { goalName, description, targetAmount, category, priority, status, endDate, notes, allocationPercent } = req.body;

    if (!goalId) {
      return res.status(400).json({ error: 'goalId required' });
    }

    const updates = { updatedAt: new Date() };
    if (goalName !== undefined) updates.goalName = String(goalName).trim();
    if (description !== undefined) updates.description = description;
    if (targetAmount !== undefined) updates.targetAmount = Number(targetAmount);
    if (category !== undefined) updates.category = category;
    if (priority !== undefined) updates.priority = priority;
    if (status !== undefined) updates.status = status;
    if (endDate !== undefined) updates.endDate = endDate ? new Date(endDate) : null;
    if (notes !== undefined) updates.notes = notes;
    if (allocationPercent !== undefined) updates.allocationPercent = toAllocationPercent(allocationPercent);

    const result = await goalsCol.updateOne(
      { _id: goalId, userId },
      { $set: updates }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ error: 'Goal not found' });
    }

    return res.status(200).json({ success: true });
  }

  // ------- DELETE -------
  if (req.method === 'DELETE') {
    const goalId = req.body?.goalId || req.body?.id || req.query?.goalId || req.query?.id;
    if (!goalId) {
      return res.status(400).json({ error: 'goalId required' });
    }

    const result = await goalsCol.deleteOne({ _id: goalId, userId });

    if (result.deletedCount === 0) {
      return res.status(404).json({ error: 'Goal not found' });
    }

    return res.status(200).json({ success: true });
  }

  return res.status(405).end();
}
