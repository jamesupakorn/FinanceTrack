/**
 * API: /api/savings-loans  (spec-savings-loan-withdrawal §4.4, R-SLW-4/9/13/14, D-SLW-16/20/21)
 * GET    - the user's loans (newest first, derived `repayments[].balanceAfter`) plus the pool `summary`
 * POST   - borrow from the pool or one goal: { source, amount, note? }
 * DELETE - mistake correction only (D-SLW-21): a loan with zero repayments; `loanId` in body or query
 *
 * Money is never trusted from the client: only `source`, `amount` and `note` are read from the POST body.
 * `principalAmount`/`outstandingAmount`/`status`/`repayments`/`available`/`userId`/`_id` sent by the client are
 * ignored, and the available balance is recomputed on the server inside the request's transaction.
 *
 * POST check order (the first failure returns; nothing is written on any failure):
 * source (400) → amount (400) → note (400) → acquireLedgerGuard → fresh loadLedgerContext
 * → goal exists (404) → open-loan cap (409) → available balance (409) → insert → 201
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
  computeLedgerSummary,
  deleteLoan,
  insertLoan,
  loadLedgerContext,
  type LedgerSummaryTotals,
} from '../../src/shared/utils/backend/savingsLedgerStore';
import {
  MAX_OPEN_LOANS_PER_USER,
  normalizeLedgerNote,
  parseLedgerSource,
  summarizeLedger,
  toLedgerAmount,
  withBalanceAfter,
  type SavingsLoan,
  type SavingsLoanWithBalance,
} from '../../src/shared/utils/savingsLedger';

export interface SavingsLoansGetResponse {
  loans: SavingsLoanWithBalance[];
  summary: LedgerSummaryTotals;
}

function byNewestFirst(a: SavingsLoan, b: SavingsLoan): number {
  if (a.createdAt === b.createdAt) return 0;
  return a.createdAt < b.createdAt ? 1 : -1;
}

async function handleGet(res: NextApiResponse, userId: string) {
  try {
    const ctx = await loadLedgerContext(userId, { includeSavings: true });
    const body: SavingsLoansGetResponse = {
      loans: [...ctx.loans].sort(byNewestFirst).map(withBalanceAfter),
      summary: computeLedgerSummary(ctx),
    };
    return res.status(200).json(body);
  } catch (error) {
    console.error('savings-loans GET failed', (error as Error)?.message);
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

  const { openLoanCount } = summarizeLedger(ctx.loans, ctx.withdrawals);
  if (openLoanCount >= MAX_OPEN_LOANS_PER_USER) {
    return res.status(409).json({ error: 'open_loan_limit' });
  }

  const available = computeAvailableBalance(ctx, source);
  if (available === null) return res.status(404).json({ error: 'goal_not_found' });
  if (amount > available) {
    return res.status(409).json({ error: 'insufficient_balance', available });
  }

  const now = new Date().toISOString();
  const loan = await insertLoan(userId, {
    _id: crypto.randomBytes(12).toString('hex'),
    userId,
    source,
    principalAmount: amount,
    outstandingAmount: amount,
    status: 'open',
    note: parsedNote.note,
    createdAt: now,
    updatedAt: now,
    closedAt: null,
    repayments: [],
  });
  return res.status(201).json({ success: true, loan });
}

async function handleDelete(req: NextApiRequest, res: NextApiResponse, userId: string) {
  const loanId = asPlainString(req.body?.loanId) || asPlainString(req.query?.loanId);
  if (!loanId) return res.status(400).json({ error: 'loan_id_required' });

  // No guard: a delete can only raise a balance (spec §4.4).
  const { loans } = await loadLedgerContext(userId);
  const loan = loans.find(entry => entry._id === loanId);
  if (!loan) return res.status(404).json({ error: 'loan_not_found' });
  if (loan.repayments.length > 0) return res.status(409).json({ error: 'loan_has_repayments' });

  // deleteLoan re-applies the zero-repayment rule in its own filter; false here means the loan changed or
  // vanished after the read above, so report it as gone rather than deleting anything.
  if (!(await deleteLoan(userId, loanId))) return res.status(404).json({ error: 'loan_not_found' });
  return res.status(200).json({ success: true });
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const userId = assertUserId(req, res);
  if (!userId) return;
  if (!validateApiRequest(req, res, 'savings-loans')) return;

  if (req.method === 'GET') return handleGet(res, userId);
  if (req.method === 'POST') return handlePost(req, res, userId);
  if (req.method === 'DELETE') return handleDelete(req, res, userId);
  return res.status(405).end();
}

export default withAudit(handler, { source: 'savings_loans' });
