// Loan slice S3 — BR-CC-037: loans have no billing cycle, so the calendar emits no statement marker for them.
import { buildMonthEvents } from '../../../../src/shared/utils/frontend/expenseEvents';

it('emits a statement marker for a credit card but none for a loan', () => {
  const calendar = buildMonthEvents({
    monthKey: '2026-10',
    monthsMap: { '2026-10': {} },
    cards: [
      { id: 'cc_card_1', name: 'KTC', statementDay: 25 },
      { id: 'cc_loan_1', name: 'บ้าน', statementDay: 25, cardType: 'home_loan' },
      { id: 'cc_loan_2', name: 'รถ', statementDay: 'EOM', cardType: 'personal_loan' }
    ],
    plans: []
  });
  const statements = Array.from(calendar.eventsByDay.values()).flat().filter(event => event.type === 'statement');
  expect(statements.map(event => event.key)).toEqual(['st_cc_card_1']);
});
