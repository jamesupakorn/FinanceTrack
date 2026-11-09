/**
 * Stage 4 tester gap test (bank-account-breakdown, fix round F-3).
 * A negative previous-month total must read the same in the trigger figure and in the panel
 * header ("รวม <x> บาท") in BOTH layouts (md+ table and base-tier card). The implementer's F-3
 * test only checks that '-50.00' appears somewhere in the table panel, which the item row alone
 * satisfies, so it would not catch a header that disagreed with the cell.
 */
import { fireEvent, render, screen, within } from '@testing-library/react';
import BankAccountTable from '../../src/frontend/components/BankAccountTable';

const item = (key: string, name: string, amount: number, account: string) =>
  ({ key, name, amount, account, paid: false });

const current = {
  'กสิกร': { items: [], paidItems: [], total: 0 },
  ttb: { items: [], paidItems: [], total: 0 }
};
// ttb nets to -50 (a 100 row and a -150 refund), so no single item row shows -50.00
const prev = {
  'กสิกร': { items: [item('old', 'ค้างเก่า', 300, 'กสิกร')], paidItems: [], total: 300 },
  ttb: { items: [item('due', 'ค้างจ่าย', 100, 'ttb'), item('refund', 'คืนเงิน', -150, 'ttb')], paidItems: [], total: -50 }
};

describe('BankAccountTable negative previous-month total parity (F-3)', () => {
  test.each([['table', true], ['card', false]])('%s: cell figure === panel header === breakdown.total', (_label, inTable) => {
    render(<BankAccountTable accounts={['กสิกร', 'ttb']} accountBreakdown={current} prevAccountBreakdown={prev} monthKey="2026-11" prevMonthKey="2026-10" />);
    const trigger = screen.getAllByRole('button', { name: /-50\.00 แจกแจงยอดค้างเดือนก่อนของบัญชี ttb$/ })
      .find(button => Boolean(button.closest('table')) === inTable)!;
    expect(trigger).toBeDefined();
    fireEvent.click(trigger);
    const panel = document.getElementById(trigger.getAttribute('aria-controls')!)!;
    expect(panel).not.toBeNull();
    const header = within(panel).getByText(/^รวม/);
    expect(header).toHaveTextContent('รวม -50.00 บาท · 2 รายการ');
    expect(within(panel).queryByText('-50.00', { selector: 'li *' })).toBeNull();
  });
});
