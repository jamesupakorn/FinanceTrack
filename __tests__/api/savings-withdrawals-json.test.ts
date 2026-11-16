/** @jest-environment node */
// /api/savings-withdrawals in JSON mode (real JSON store + audit journal in a temp AUDIT_DATA_DIR, C-6).
// The cases live in the shared suite so Mongo mode runs exactly the same ones (savings-withdrawals.test.ts).
import { defineSavingsWithdrawalsRouteSuite } from '../helpers/savingsWithdrawalsRouteSuite';

defineSavingsWithdrawalsRouteSuite('json');
