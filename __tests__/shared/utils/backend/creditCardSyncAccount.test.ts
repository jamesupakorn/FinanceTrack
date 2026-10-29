import { buildInstallmentRowKey, buildRevolvingRowKey } from '../../../../src/shared/utils/creditCardUtils';
import {
  buildInstallmentExpenseRows,
  buildRevolvingExpenseRows,
  safeBuildCreditCardRows
} from '../../../../src/shared/utils/backend/creditCardSync';
import { deriveLegacyBankAccountId, normaliseBankAccounts } from '../../../../src/shared/utils/backend/bankAccountIds';
import { UNASSIGNED_ACCOUNT_LABEL } from '../../../../src/shared/utils/bankAccountShape';

jest.mock('../../../../src/shared/utils/backend/creditCardStore', () => ({
  getUserCreditData: jest.fn(),
  updateUserCreditData: jest.fn()
}));

const MONTH = '2026-08';

function installmentRow(card: Record<string, unknown>, accounts: unknown[]) {
  const rows = buildInstallmentExpenseRows({
    cards: [card],
    plans: [{
      id: 'ip_test',
      cardId: 'cc_test',
      itemName: 'ของใช้',
      months: 1,
      schedule: [{ no: 1, dueMonth: MONTH, payment: 300 }]
    }]
  }, MONTH, accounts);
  return rows[buildInstallmentRowKey('ip_test', 1)];
}

describe('credit card account resolution', () => {
  it('resolves the explicit account id before bankName', () => {
    expect(installmentRow({
      id: 'cc_test',
      name: 'บัตร A',
      bankAccountId: 'ba_aaaaaaaaaaaa',
      bankName: 'ttb',
      dueDay: 20
    }, [
      { id: 'ba_aaaaaaaaaaaa', name: 'กสิกร' },
      { id: 'ba_bbbbbbbbbbbb', name: 'ttb' }
    ]).account).toBe('กสิกร');
  });

  it('falls back to bankName when the id is dangling, otherwise to the fixed bucket', () => {
    expect(installmentRow({
      id: 'cc_test',
      name: 'บัตร A',
      bankAccountId: 'ba_deleted0000',
      bankName: 'ttb',
      dueDay: 20
    }, [{ id: 'ba_bbbbbbbbbbbb', name: 'ttb' }]).account).toBe('ttb');

    expect(installmentRow({
      id: 'cc_test',
      name: 'บัตร A',
      bankAccountId: 'ba_deleted0000',
      bankName: '',
      dueDay: 20
    }, []).account).toBe(UNASSIGNED_ACCOUNT_LABEL);
  });

  it('matches a legacy-derived id only after account entries have been normalized', () => {
    const legacyId = deriveLegacyBankAccountId('กรุงศรี');
    const card = {
      id: 'cc_test',
      name: 'บัตร A',
      bankAccountId: legacyId,
      bankName: '',
      dueDay: 20
    };

    expect(installmentRow(card, normaliseBankAccounts(['กรุงศรี'])).account).toBe('กรุงศรี');
    expect(installmentRow(card, ['กรุงศรี']).account).toBe(UNASSIGNED_ACCOUNT_LABEL);
  });

  it('does not let a month snapshot name capture a renamed account id', () => {
    const rows = safeBuildCreditCardRows({
      creditData: {
        cards: [{
          id: 'cc_test',
          name: 'บัตร A',
          bankAccountId: 'bal_0123456789abcdef',
          bankName: '',
          dueDay: 20
        }],
        plans: [{
          id: 'ip_test',
          cardId: 'cc_test',
          itemName: 'ของใช้',
          months: 1,
          schedule: [{ no: 1, dueMonth: MONTH, payment: 300 }]
        }]
      },
      bankAccounts: [{ id: 'bal_0123456789abcdef', name: 'บัญชีใหม่' }]
    }, MONTH, ['บัญชีเดิม']);

    // spec-credit-card-spend §4.3: safeBuildCreditCardRows returns one card-total ccr_ row per card
    expect(rows[buildInstallmentRowKey('ip_test', 1)]).toBeUndefined();
    expect(rows[buildRevolvingRowKey('cc_test')].account).toBe('บัญชีใหม่');
  });

  it('uses the same account resolution for revolving rows', () => {
    const rows = buildRevolvingExpenseRows({
      cards: [{
        id: 'cc_test',
        name: 'บัตร A',
        bankAccountId: 'ba_aaaaaaaaaaaa',
        bankName: '',
        dueDay: 20
      }],
      cycles: [{ cardId: 'cc_test', month: MONTH, newSpend: 1000, paymentAction: null }]
    }, MONTH, [{ id: 'ba_aaaaaaaaaaaa', name: 'กสิกร' }]);

    expect(rows[buildRevolvingRowKey('cc_test')].account).toBe('กสิกร');
  });
});
