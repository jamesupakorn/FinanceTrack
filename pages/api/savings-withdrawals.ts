/**
 * API: /api/savings-withdrawals  (spec-savings-loan-withdrawal §4.5, R-SLW-4/13, D-SLW-16/21)
 * GET    - the user's withdrawals, newest first
 * POST   - withdraw from the pool or one goal: { source, amount, note? }
 * DELETE - mistake correction (D-SLW-21): any withdrawal of the user; `withdrawalId` in body or query
 *
 * Money is never trusted from the client: only `source`, `amount` and `note` are read from the POST body.
 * `available`/`userId`/`_id`/`createdAt` sent by the client are ignored, and the available balance is
 * recomputed on the server inside the request's transaction.
 *
 * POST check order (the first failure returns; nothing is written on any failure). Same as the loans route
 * minus the open-loan cap (withdrawals are uncapped, D-SLW-20):
 * source (400) → amount (400) → note (400) → acquireLedgerGuard → fresh loadLedgerContext
 * → goal exists (404) → available balance (409) → insert → 201
 *
 * Store errors are deliberately not caught in mutating paths: a Mongo WriteConflict on the guard document must
 * reach withAudit's withTransaction so the losing request retries against fresh state (D-SLW-16).
 * withAudit turns any other thrown error into a 500 with nothing committed.
 */

import crypto from 'crypto';
import type { NextApiRequest, NextApiResponse } from 'next';
import { assertUserId, asPlainString } from '../../src/shared/utils/backend/userRequest';
import { validateApiRequest } from '../../src/shared/utils/backend/apiRequestValidation';
import { withAudit } from '../../lib/auditedMutation';
import {
  acquireLedgerGuard,
  computeAvailableBalance,
  deleteWithdrawal,
  insertWithdrawal,
  loadLedgerContext,
} from '../../src/shared/utils/backend/savingsLedgerStore';
import {
  normalizeLedgerNote,
  parseLedgerSource,
  toLedgerAmount,
  type SavingsWithdrawal,
} from '../../src/shared/utils/savingsLedger';

export interface SavingsWithdrawalsGetResponse {
  withdrawals: SavingsWithdrawal[];
}

function byNewestFirst(a: SavingsWithdrawal, b: SavingsWithdrawal): number {
  if (a.createdAt === b.createdAt) return 0;
  return a.createdAt < b.createdAt ? 1 : -1;
}

async function handleGet(res: NextApiResponse, userId: string) {
  try {
    const { withdrawals } = await loadLedgerContext(userId);
    const body: SavingsWithdrawalsGetResponse = { withdrawals: [...withdrawals].sort(byNewestFirst) };
    return res.status(200).json(body);
  } catch (error) {
    console.error('savings-withdrawals GET failed', (error as Error)?.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function handlePost(req: NextApiRequest, res: NextApiResponse, userId: string) {
  const body = (req.body ?? {}) as Record<string, unknown>;

  const parsedSource = parseLedgerSource(body.source);
  if (!parsedSource.ok) return res.status(400).json({ error: parsedSource.error });
  const { source } = parsedSource;

  const amount = toLedgerAmount(body.amount);
  if (amount === null) return res.status(400).json({ error: 'invalid_amount' });

  const parsedNote = normalizeLedgerNote(body.note);
  if (!parsedNote.ok) return res.status(400).json({ error: parsedNote.error });

  // First write of the transaction, before any balance read (DATA_MODEL invariant 4).
  await acquireLedgerGuard(userId);
  const ctx = await loadLedgerContext(userId, { includeGoals: true, includeSavings: true });

  if (source.type === 'goal' && !ctx.goals?.some(goal => String(goal._id) === source.goalId)) {
    return res.status(404).json({ error: 'goal_not_found' });
  }

  const available = computeAvailableBalance(ctx, source);
  if (available === null) return res.status(404).json({ error: 'goal_not_found' });
  if (amount > available) {
    return res.status(409).json({ error: 'insufficient_balance', available });
  }

  const withdrawal = await insertWithdrawal(userId, {
    _id: crypto.randomBytes(12).toString('hex'),
    userId,
    source,
    amount,
    note: parsedNote.note,
    createdAt: new Date().toISOString(),
  });
  return res.status(201).json({ success: true, withdrawal });
}

async function handleDelete(req: NextApiRequest, res: NextApiResponse, userId: string) {
  const withdrawalId = asPlainString(req.body?.withdrawalId) || asPlainString(req.query?.withdrawalId);
  if (!withdrawalId) return res.status(400).json({ error: 'withdrawal_id_required' });

  // No guard: a delete can only raise a balance (spec §4.4). Any withdrawal of this user is deletable
  // (D-SLW-21), so the store's own user-scoped filter is the whole check.
  if (!(await deleteWithdrawal(userId, withdrawalId))) {
    return res.status(404).json({ error: 'withdrawal_not_found' });
  }
  return res.status(200).json({ success: true });
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const userId = assertUserId(req, res);
  if (!userId) return;
  if (!validateApiRequest(req, res, 'savings-withdrawals')) return;

  if (req.method === 'GET') return handleGet(res, userId);
  if (req.method === 'POST') return handlePost(req, res, userId);
  if (req.method === 'DELETE') return handleDelete(req, res, userId);
  return res.status(405).end();
}

export default withAudit(handler, { source: 'savings_withdrawals' });
