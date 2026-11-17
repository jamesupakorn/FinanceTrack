/**
 * API: /api/savings-goals
 * จัดการเป้าหมายเงินออมต่อ user
 * GET  - ดึงเป้าหมายทั้งหมด พร้อมคำนวณ currentAmount จากข้อมูล savings จริง
 * POST - สร้างเป้าหมายใหม่
 * PUT  - อัปเดตเป้าหมาย / allocations แบบ bulk / ปรับยอด (action: addAdjustment | editAdjustment | deleteAdjustment)
 * DELETE - ลบเป้าหมาย
 */

import { assertUserId, asPlainString } from '../../src/shared/utils/backend/userRequest';
import { validateApiRequest } from '../../src/shared/utils/backend/apiRequestValidation';
import { isJsonMode, getMongoCollection } from '../../lib/dataSource';
import type { NextApiRequest, NextApiResponse } from 'next';
import type { Document, ObjectId } from 'mongodb';
import crypto from 'crypto';
import {
  getUserData,
  updateUserData,
} from '../../src/backend/data/userUtils';
import { withAudit } from '../../lib/auditedMutation';
import {
  applyAdjustmentAction,
  isAdjustmentAction,
  isAdjustmentAmountWithinCap,
  normalizeAdjustmentNote,
  readAdjustments,
  toAdjustmentAmount,
  type AdjustmentRequest,
  type SavingsGoalAdjustment,
} from '../../src/shared/utils/savingsGoalAdjustments';
import {
  computeCurrentAmounts,
  type SavingsGoal,
} from '../../src/shared/utils/backend/savingsGoalBalances';
import { acquireLedgerGuard, loadLedgerContext } from '../../src/shared/utils/backend/savingsLedgerStore';
import { summarizeLedger } from '../../src/shared/utils/savingsLedger';

const GOALS_JSON_FILE = 'savings-goals.json';

interface MongoSavingsGoal extends Document {
  _id: string | ObjectId;
  goalName: string;
  targetAmount: number;
  status: string;
  allocationPercent?: number | null;
  metadata?: Record<string, unknown>;
  adjustments?: unknown;
  [key: string]: unknown;
}

function toAllocationPercent(value: unknown): number | null {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.min(100, Math.round(parsed * 100) / 100);
}

// ---- adjustment actions (shared by JSON + Mongo PUT) ----

type ParsedAdjustmentRequest =
  | { ok: true; goalId: string; request: AdjustmentRequest }
  | { ok: false; error: string };

/** Steps 2-6 of the action contract; reads only action/goalId/adjustmentId/amount/note. */
function parseAdjustmentRequest(body: Record<string, unknown> | undefined): ParsedAdjustmentRequest {
  const action = body?.action;
  if (!isAdjustmentAction(action)) return { ok: false, error: 'unknown action' };

  const goalId = asPlainString(body?.goalId);
  if (!goalId) return { ok: false, error: 'goalId required' };

  let adjustmentId = '';
  if (action !== 'addAdjustment') {
    adjustmentId = asPlainString(body?.adjustmentId) || '';
    if (!adjustmentId) return { ok: false, error: 'adjustmentId required' };
  }

  if (action === 'deleteAdjustment') {
    return { ok: true, goalId, request: { action, adjustmentId } };
  }

  const amount = toAdjustmentAmount(body?.amount);
  if (amount === null) return { ok: false, error: 'amount must be a non-zero number' };
  if (!isAdjustmentAmountWithinCap(amount)) return { ok: false, error: 'amount too large' };

  const rawNote = body?.note;
  if (typeof rawNote !== 'string' || rawNote.trim().length === 0) return { ok: false, error: 'note required' };
  const note = normalizeAdjustmentNote(rawNote);
  if (note === null) return { ok: false, error: 'note too long' };

  return action === 'addAdjustment'
    ? { ok: true, goalId, request: { action, amount, note } }
    : { ok: true, goalId, request: { action, adjustmentId, amount, note } };
}

interface AdjustmentStore {
  /** Owner-scoped lookup; null when the goal doesn't exist for this user. */
  load(goalId: string): Promise<{ adjustments?: unknown } | null>;
  /** Persist exactly `adjustments` + the goal's `updatedAt`; nothing derived. */
  save(goalId: string, adjustments: SavingsGoalAdjustment[], now: Date): Promise<void>;
}

async function handleAdjustmentAction(req: NextApiRequest, res: NextApiResponse, store: AdjustmentStore) {
  const parsed = parseAdjustmentRequest(req.body);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });

  const goal = await store.load(parsed.goalId);
  if (!goal) return res.status(404).json({ error: 'Goal not found' });

  const now = new Date();
  const newId = crypto.randomBytes(12).toString('hex');
  const result = applyAdjustmentAction(readAdjustments(goal), parsed.request, now.toISOString(), newId);
  if (!result.ok) return res.status(result.status).json({ error: result.error });

  await store.save(parsed.goalId, result.adjustments, now);
  return result.adjustment
    ? res.status(200).json({ success: true, adjustment: result.adjustment })
    : res.status(200).json({ success: true });
}

// ---- JSON mode helpers ----

function getJsonGoals(userId: string): SavingsGoal[] {
  const bucket = getUserData(GOALS_JSON_FILE, userId);
  return Array.isArray(bucket?.goals) ? bucket.goals : [];
}

function setJsonGoals(userId: string, goals: SavingsGoal[]) {
  updateUserData(GOALS_JSON_FILE, userId, () => ({ goals }));
}

// ---- GET (shared by JSON + Mongo) ----

/**
 * Savings months and the carry-forward come from one loadLedgerContext read (C-S2c-10 revision
 * bracket), so a concurrent prune is never seen half-applied; the ledger term (S2-F-1) and the
 * carried term (S2c) both enter through computeCurrentAmounts, the single goal formula.
 */
async function computeGoalsWithProgress(goals: SavingsGoal[], userId: string) {
  const ctx = await loadLedgerContext(userId, { includeSavings: true });
  const ledgerByGoal = summarizeLedger(ctx.loans, ctx.withdrawals).byGoal;
  return computeCurrentAmounts(goals, ctx.savingsDocs ?? [], ledgerByGoal, ctx.carryForward?.goalAmounts);
}

/** GET only: the bracket throws after repeated concurrent prunes; answer 500, never skewed numbers. */
async function respondWithGoals(res: NextApiResponse, userId: string, loadGoals: () => Promise<SavingsGoal[]>) {
  try {
    const goals = await loadGoals();
    return res.status(200).json({ goals: await computeGoalsWithProgress(goals, userId) });
  } catch (error) {
    console.error('savings-goals GET failed', (error as Error)?.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function handleJsonMode(req: NextApiRequest, res: NextApiResponse, userId: string) {
  if (req.method === 'GET') {
    return respondWithGoals(res, userId, async () => getJsonGoals(userId).filter(g => g.status !== 'abandoned'));
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
    if (req.body?.action !== undefined) {
      return await handleAdjustmentAction(req, res, {
        load: async (goalId) => getJsonGoals(userId).find(g => g._id === goalId) ?? null,
        save: async (goalId, adjustments, now) => {
          const goals = getJsonGoals(userId);
          const idx = goals.findIndex(g => g._id === goalId);
          goals[idx] = { ...goals[idx], adjustments, updatedAt: now.toISOString() };
          setJsonGoals(userId, goals);
        },
      });
    }

    const allocations = Array.isArray(req.body?.allocations) ? req.body.allocations : null;
    if (allocations) {
      const goals = getJsonGoals(userId);
      const updatesById = new Map<unknown, number | null>();
      allocations.forEach((item: Record<string, unknown>) => {
        const goalId = item?.goalId || item?.id;
        if (!goalId) return;
        updatesById.set(goalId, toAllocationPercent(item?.allocationPercent));
      });

      const now = new Date().toISOString();
      const nextGoals = goals.map((goal: SavingsGoal) => {
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
    const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() };
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
    const goalId = asPlainString(req.body?.goalId || req.body?.id || req.query?.goalId || req.query?.id);
    if (!goalId) {
      return res.status(400).json({ error: 'goalId required' });
    }

    // S2 / C-S2-4: guard first (no-op in JSON mode, kept for parity with the Mongo branch),
    // then the existing 404 lookup, then the open-loan check — in that order, so a goalId that
    // no longer exists still answers 404, never 409, even if a stray open loan references it
    // (S2-F-3 / E-SLW-16's "เป้าหมายที่ลบแล้ว" case).
    await acquireLedgerGuard(userId);

    const goals = getJsonGoals(userId);
    const idx = goals.findIndex(g => g._id === goalId);
    if (idx === -1) {
      return res.status(404).json({ error: 'Goal not found' });
    }

    const { loans } = await loadLedgerContext(userId);
    const openLoans = loans.filter(
      l => l.status === 'open' && l.source.type === 'goal' && l.source.goalId === goalId
    );
    if (openLoans.length > 0) {
      const outstanding = Math.round(openLoans.reduce((sum, l) => sum + l.outstandingAmount, 0) * 100) / 100;
      return res.status(409).json({ error: 'goal_has_open_loans', outstanding });
    }

    goals.splice(idx, 1);
    setJsonGoals(userId, goals);
    return res.status(200).json({ success: true });
  }

  return res.status(405).end();
}

// ---- main handler ----

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const userId = assertUserId(req, res);
  if (!userId) return;
  if (!validateApiRequest(req, res, 'savings-goals')) return;

  if (isJsonMode()) {
    return handleJsonMode(req, res, userId);
  }

  const goalsCol = await getMongoCollection<MongoSavingsGoal>('savingsGoals');

  // ------- GET -------
  if (req.method === 'GET') {
    return respondWithGoals(res, userId, async () => {
      const goals = await goalsCol
        .find<MongoSavingsGoal>({ userId, status: { $ne: 'abandoned' } })
        .sort({ createdAt: -1 })
        .toArray();
      return goals.map(g => ({ ...g, _id: g._id.toString() }) as SavingsGoal);
    });
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
    // findOne/updateOne run in withAudit's transaction (session bound by getMongoCollection)
    if (req.body?.action !== undefined) {
      return await handleAdjustmentAction(req, res, {
        load: (goalId) => goalsCol.findOne({ _id: goalId, userId }),
        save: async (goalId, adjustments, now) => {
          await goalsCol.updateOne({ _id: goalId, userId }, { $set: { adjustments, updatedAt: now } });
        },
      });
    }

    const allocations = Array.isArray(req.body?.allocations)
      ? req.body.allocations as Array<Record<string, unknown>>
      : null;
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
        .filter((operation): operation is NonNullable<typeof operation> => operation !== null);

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

    const goalId = asPlainString(req.body?.goalId || req.body?.id);
    const { goalName, description, targetAmount, category, priority, status, endDate, notes, allocationPercent } = req.body;

    if (!goalId) {
      return res.status(400).json({ error: 'goalId required' });
    }

    const updates: Record<string, unknown> = { updatedAt: new Date() };
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
    const goalId = asPlainString(req.body?.goalId || req.body?.id || req.query?.goalId || req.query?.id);
    if (!goalId) {
      return res.status(400).json({ error: 'goalId required' });
    }

    // S2 / C-S2-4: guard first (first write in this branch, D-SLW-16), then a dedicated
    // owner-scoped lookup for 404 (Mongo had none before S2 — the old code derived 404 purely
    // from deleteOne's deletedCount), then the open-loan check, then the existing delete. This
    // ordering keeps a nonexistent goalId answering 404 even if a stray open loan's
    // source.goalId happens to equal it (S2-F-3 / E-SLW-16's "เป้าหมายที่ลบแล้ว" case) — the
    // open-loan check must never run before the existence check.
    await acquireLedgerGuard(userId);

    const existing = await goalsCol.findOne({ _id: goalId, userId });
    if (!existing) {
      return res.status(404).json({ error: 'Goal not found' });
    }

    const { loans } = await loadLedgerContext(userId);
    const openLoans = loans.filter(
      l => l.status === 'open' && l.source.type === 'goal' && l.source.goalId === goalId
    );
    if (openLoans.length > 0) {
      const outstanding = Math.round(openLoans.reduce((sum, l) => sum + l.outstandingAmount, 0) * 100) / 100;
      return res.status(409).json({ error: 'goal_has_open_loans', outstanding });
    }

    const result = await goalsCol.deleteOne({ _id: goalId, userId });

    if (result.deletedCount === 0) {
      return res.status(404).json({ error: 'Goal not found' });
    }

    return res.status(200).json({ success: true });
  }

  return res.status(405).end();
}

export default withAudit(handler, { source: 'savings_goals' });
