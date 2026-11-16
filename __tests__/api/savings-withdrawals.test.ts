/** @jest-environment node */
// /api/savings-withdrawals in Mongo mode (in-process replica set; withAudit runs real transactions).
// The cases live in the shared suite so JSON mode runs exactly the same ones (savings-withdrawals-json.test.ts).
import { defineSavingsWithdrawalsRouteSuite } from '../helpers/savingsWithdrawalsRouteSuite';

defineSavingsWithdrawalsRouteSuite('mongo');
