/** @jest-environment node */
// Loan TD cleanup D3 (§I4, AC-TDC-16) — parity between the rate-revisions route and the dialog preview for a
// stored plan whose schedule is malformed (one tail row's payment stored as a string). The route rejects it
// with 409 and the preview classifies the same plan as 'malformed_schedule', so the dialog never offers a
// confirm the server would refuse. JSON mode only; the full JSON+Mongo route suite is rate-revisions.test.ts.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createMocks } from 'node-mocks-http';
import type { NextApiHandler } from 'next';
import { summarisePlan } from '../../../src/shared/utils/creditCardRevolving';
import { computeLoanRateRevisionPreview } from '../../../src/frontend/components/LoanRateRevisionDialog';
import {
  buildRevisionFixturePlan,
  FIXTURE_LOAN_CARD_ID,
  FIXTURE_LOAN_PLAN_ID,
  REVISION_FIXTURE_INPUTS
} from '../../helpers/loanRateRevisionFixture';

type Row = Record<string, unknown>;
type PreviewPlan = Parameters<typeof computeLoanRateRevisionPreview>[0];

const TEST_SECRET = 'test-secret-do-not-use-in-prod';
const USER_ID = 'rr-parity-user';
const JSON_FILENAME = 'credit_cards.json';
const AUDIT_JOURNAL = 'audit_journal.json';
const { effectiveMonth, annualRate } = REVISION_FIXTURE_INPUTS[0];

const loanCard: Row = {
  id: FIXTURE_LOAN_CARD_ID,
  name: 'บ้านหลังแรก',
  creditLimit: 0,
  annualRate: 16,
  minPaymentPercent: 10,
  statementDay: 'EOM',
  dueDay: 5,
  color: '#5d5bff',
  bankName: '',
  last4: '',
  cardType: 'home_loan'
};

/** The shared fixture with tail row 21 (after k = 13) storing payment as a numeric string. */
function malformedPlan() {
  const plan = buildRevisionFixturePlan();
  const schedule = plan.schedule.map(row => ({ ...row }));
  schedule[20] = { ...schedule[20], payment: (schedule[20].payment as number).toFixed(2) };
  return { ...plan, schedule };
}

describe('rate revisions — malformed stored schedule parity (route vs dialog preview)', () => {
  let handler: NextApiHandler;
  let sessionCookie: typeof import('../../../src/shared/utils/backend/sessionCookie');
  let dir = '';

  beforeAll(() => {
    process.env.SESSION_SECRET = TEST_SECRET;
    process.env.DATA_MODE = 'json';
    delete process.env.MONGODB_URI;
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rate-rev-parity-'));
    process.env.AUDIT_DATA_DIR = dir;
    jest.resetModules();
    handler = require('../../../pages/api/credit-cards/rate-revisions').default;
    sessionCookie = require('../../../src/shared/utils/backend/sessionCookie');
  });

  afterAll(() => {
    delete process.env.AUDIT_DATA_DIR;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function seed(plan: Row) {
    const doc = { cards: [loanCard], plans: [plan], cycles: [], spendItems: [], updatedAt: '2026-01-01T00:00:00.000Z' };
    fs.writeFileSync(path.join(dir, JSON_FILENAME), JSON.stringify({ [USER_ID]: doc }));
  }

  async function post(body: Row) {
    const { signSession, createSessionId, signCsrfToken, SESSION_COOKIE_NAME } = sessionCookie;
    const sid = createSessionId();
    const { req, res } = createMocks({
      method: 'POST',
      body,
      cookies: { [SESSION_COOKIE_NAME]: signSession(USER_ID, sid) },
      headers: { 'x-csrf-token': signCsrfToken(sid) }
    });
    await handler(req, res);
    const raw = res._getData();
    return { status: res._getStatusCode(), body: raw ? JSON.parse(raw) : null };
  }

  it('control: the unmodified fixture previews ok at the same month/rate', () => {
    const preview = computeLoanRateRevisionPreview(summarisePlan(buildRevisionFixturePlan()) as unknown as PreviewPlan, effectiveMonth, annualRate);
    expect(preview.ok).toBe(true);
  });

  it('AC-TDC-16: the route returns 409 "plan schedule is malformed" and writes nothing', async () => {
    const plan = malformedPlan();
    seed(plan);
    const before = fs.readFileSync(path.join(dir, JSON_FILENAME), 'utf8');

    const res = await post({ planId: FIXTURE_LOAN_PLAN_ID, effectiveMonth, annualRate });

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'plan schedule is malformed' });
    expect(fs.readFileSync(path.join(dir, JSON_FILENAME), 'utf8')).toBe(before);
    expect(fs.existsSync(path.join(dir, AUDIT_JOURNAL))
      ? JSON.parse(fs.readFileSync(path.join(dir, AUDIT_JOURNAL), 'utf8')).events ?? []
      : []).toEqual([]);
  });

  it('AC-TDC-16: the dialog preview classifies the same stored plan as malformed_schedule', () => {
    // summarisePlan is what the dialog receives from the API; it keeps the stored string as is
    const preview = computeLoanRateRevisionPreview(summarisePlan(malformedPlan()) as unknown as PreviewPlan, effectiveMonth, annualRate);
    expect(preview).toEqual({ ok: false, reason: 'malformed_schedule' });
  });
});
