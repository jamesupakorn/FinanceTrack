/** @jest-environment node */
// /api/savings-loans in Mongo mode (in-process replica set; withAudit runs real transactions).
// The cases live in the shared suite so JSON mode runs exactly the same ones (savings-loans-json.test.ts).
import { defineSavingsLoansRouteSuite } from '../helpers/savingsLoansRouteSuite';

defineSavingsLoansRouteSuite('mongo');
