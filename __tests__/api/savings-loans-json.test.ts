/** @jest-environment node */
// /api/savings-loans in JSON mode (real JSON store + audit journal in a temp AUDIT_DATA_DIR, C-6).
// The cases live in the shared suite so Mongo mode runs exactly the same ones (savings-loans.test.ts).
import { defineSavingsLoansRouteSuite } from '../helpers/savingsLoansRouteSuite';

defineSavingsLoansRouteSuite('json');
