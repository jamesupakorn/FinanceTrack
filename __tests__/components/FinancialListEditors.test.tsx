import { useState } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import IncomeTable from '../../src/frontend/components/IncomeTable';
import BankAccountTable from '../../src/frontend/components/BankAccountTable';
import BankAccountManager from '../../src/frontend/components/BankAccountManager';
import { formatCurrency } from '../../src/shared/utils/frontend/numberUtils';
import { incomeAPI, salaryAPI } from '../../src/shared/utils/frontend/apiUtils';

jest.mock('../../src/shared/utils/frontend/apiUtils', () => ({
  incomeAPI: { getByMonth: jest.fn(), save: jest.fn() },
  salaryAPI: { getByMonth: jest.fn() }
}));

const income = jest.mocked(incomeAPI);
const salary = jest.mocked(salaryAPI);

beforeEach(() => {
  jest.clearAllMocks();
  income.getByMonth.mockResolvedValue({ custom_a: 90, custom_b: 1200, __labels: { custom_a: 'Alpha', custom_b: 'Beta' } });
  salary.getByMonth.mockResolvedValue({});
  income.save.mockResolvedValue({ success: true });
  Element.prototype.scrollIntoView = jest.fn();
});

test('income filters retain hidden save rows and original removal tracking', async () => {
  let save: (() => Promise<void>) | null = null;
  const markDirty = jest.fn();
  render(<IncomeTable selectedMonth="2026-01" markDirty={markDirty} onRegisterSave={handler => { save = handler; }} />);
  await screen.findAllByDisplayValue('Alpha');
  await waitFor(() => expect(screen.getByRole('searchbox')).toBeInTheDocument());
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Alpha' } });
  expect(screen.queryByDisplayValue('Beta')).not.toBeInTheDocument();
  fireEvent.change(screen.getAllByDisplayValue('90.00')[0]!, { target: { value: '95' } });
  await act(async () => { await save?.(); });
  expect(income.save).toHaveBeenCalledWith('2026-01', expect.objectContaining({ custom_a: 95, custom_b: 1200 }));
  expect(income.save.mock.calls[0]?.[1]).not.toHaveProperty('__removeKeys');
  expect(markDirty).not.toHaveBeenCalled();
});

test('income typing under a search preserves DOM and Add pins even when no match', async () => {
  render(<IncomeTable selectedMonth="2026-01" />);
  await screen.findAllByDisplayValue('Alpha');
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Alpha' } });
  const input = screen.getAllByDisplayValue('Alpha')[0]!;
  input.focus();
  fireEvent.change(input, { target: { value: 'Changed' } });
  expect(screen.getAllByDisplayValue('Changed')[0]).toBe(input);
  expect(input).toHaveFocus();
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'no match' } });
  fireEvent.click(screen.getByRole('button', { name: '+ เพิ่มรายการรายรับ' }));
  expect(screen.getAllByDisplayValue('รายรับใหม่')).toHaveLength(2);
  expect(screen.getByText(/รายการใหม่ — ยังไม่กรอง/)).toBeInTheDocument();
});

test('failed income save retains pins, edited values and financial error feedback', async () => {
  income.save.mockRejectedValueOnce(new Error('save failed'));
  const log = jest.spyOn(console, 'error').mockImplementation(() => {});
  let save: (() => Promise<void>) | null = null;
  render(<IncomeTable selectedMonth="2026-01" onRegisterSave={handler => { save = handler; }} />);
  await screen.findAllByDisplayValue('Alpha');
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'no match' } });
  fireEvent.click(screen.getByRole('button', { name: '+ เพิ่มรายการรายรับ' }));
  await act(async () => { await save?.(); });
  expect(screen.getAllByDisplayValue('รายรับใหม่')).toHaveLength(2);
  expect(screen.getByText(/รายการใหม่ — ยังไม่กรอง/)).toBeInTheDocument();
  expect(log).toHaveBeenCalledWith('Error saving income data:', expect.any(Error));
  log.mockRestore();
});

const initialAccounts = [
  { id: 'ba_zzzzzzzzzzzz', name: 'Zulu' },
  { id: 'ba_aaaaaaaaaaaa', name: 'Alpha' },
  { id: 'ba_mmmmmmmmmmmm', name: 'Middle' }
];

function Accounts({ onSave }: { onSave: (next: Array<{ id?: string; name: string }>) => Promise<boolean> }) {
  const [accounts] = useState(initialAccounts);
  return <BankAccountManager
    accounts={accounts}
    loading={false}
    loadFailed={false}
    saving={false}
    onSave={onSave}
    onRetryLoad={() => {}}
  />;
}

test('bank manager edits, deletes and adds staged accounts while preserving input focus', async () => {
  const onSave = jest.fn().mockResolvedValue(true);
  render(<Accounts onSave={onSave} />);

  const middle = await screen.findByRole('textbox', { name: 'ชื่อบัญชี 3' });
  middle.focus();
  fireEvent.change(middle, { target: { value: 'Beta' } });
  expect(screen.getByRole('textbox', { name: 'ชื่อบัญชี 3' })).toBe(middle);
  expect(middle).toHaveFocus();
  fireEvent.click(screen.getByRole('button', { name: 'ลบบัญชี Beta' }));
  expect(screen.queryByDisplayValue('Beta')).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: '+ เพิ่มบัญชี' }));
  const added = await screen.findByDisplayValue('บัญชีใหม่');
  expect(added).toHaveFocus();
  expect((added as HTMLInputElement).selectionStart).toBe(0);
  expect((added as HTMLInputElement).selectionEnd).toBe('บัญชีใหม่'.length);

  fireEvent.click(screen.getByRole('button', { name: 'บันทึกบัญชีธนาคาร' }));
  await waitFor(() => expect(onSave).toHaveBeenCalledWith([
    { id: 'ba_zzzzzzzzzzzz', name: 'Zulu' },
    { id: 'ba_aaaaaaaaaaaa', name: 'Alpha' },
    { name: 'บัญชีใหม่' }
  ]));
});

test('bank manager restores an emptied name on blur and blocks duplicate names', async () => {
  const onSave = jest.fn().mockResolvedValue(true);
  render(<Accounts onSave={onSave} />);

  const middle = await screen.findByRole('textbox', { name: 'ชื่อบัญชี 3' });
  fireEvent.change(middle, { target: { value: '' } });
  fireEvent.blur(middle);
  expect(middle).toHaveValue('Middle');

  fireEvent.change(screen.getByRole('textbox', { name: 'ชื่อบัญชี 2' }), { target: { value: 'Zulu' } });
  fireEvent.click(screen.getByRole('button', { name: 'บันทึกบัญชีธนาคาร' }));
  expect(onSave).not.toHaveBeenCalled();
  // Both the original "Zulu" row (1) and the row renamed to "Zulu" (2) must be flagged, not
  // just the later occurrence — regression guard for the group-by-name duplicate fix.
  expect(screen.getAllByText('ชื่อบัญชีซ้ำกับบัญชีอื่น')).toHaveLength(2);
  expect(screen.getByRole('textbox', { name: 'ชื่อบัญชี 1' })).toHaveAttribute('aria-invalid', 'true');
  expect(screen.getByRole('textbox', { name: 'ชื่อบัญชี 2' })).toHaveAttribute('aria-invalid', 'true');
  expect(screen.getByRole('textbox', { name: 'ชื่อบัญชี 3' })).not.toHaveAttribute('aria-invalid', 'true');
});

test('bank manager flags every row when three accounts share the same name', async () => {
  const onSave = jest.fn().mockResolvedValue(true);
  render(<Accounts onSave={onSave} />);

  fireEvent.change(screen.getByRole('textbox', { name: 'ชื่อบัญชี 1' }), { target: { value: 'Middle' } });
  fireEvent.change(screen.getByRole('textbox', { name: 'ชื่อบัญชี 2' }), { target: { value: 'Middle' } });
  fireEvent.click(screen.getByRole('button', { name: 'บันทึกบัญชีธนาคาร' }));

  expect(onSave).not.toHaveBeenCalled();
  expect(screen.getAllByText('ชื่อบัญชีซ้ำกับบัญชีอื่น')).toHaveLength(3);
  expect(screen.getByRole('textbox', { name: 'ชื่อบัญชี 1' })).toHaveAttribute('aria-invalid', 'true');
  expect(screen.getByRole('textbox', { name: 'ชื่อบัญชี 2' })).toHaveAttribute('aria-invalid', 'true');
  expect(screen.getByRole('textbox', { name: 'ชื่อบัญชี 3' })).toHaveAttribute('aria-invalid', 'true');
});

test('bank manager treats names differing only by surrounding whitespace as duplicates', async () => {
  const onSave = jest.fn().mockResolvedValue(true);
  render(<Accounts onSave={onSave} />);

  fireEvent.change(screen.getByRole('textbox', { name: 'ชื่อบัญชี 2' }), { target: { value: 'Middle  ' } });
  fireEvent.click(screen.getByRole('button', { name: 'บันทึกบัญชีธนาคาร' }));

  expect(onSave).not.toHaveBeenCalled();
  expect(screen.getAllByText('ชื่อบัญชีซ้ำกับบัญชีอื่น')).toHaveLength(2);
  expect(screen.getByRole('textbox', { name: 'ชื่อบัญชี 1' })).not.toHaveAttribute('aria-invalid', 'true');
  expect(screen.getByRole('textbox', { name: 'ชื่อบัญชี 2' })).toHaveAttribute('aria-invalid', 'true');
  expect(screen.getByRole('textbox', { name: 'ชื่อบัญชี 3' })).toHaveAttribute('aria-invalid', 'true');
});

const bucket = (total: number) => ({ items: [], paidItems: [], total });

test('bank account summary is read-only, sorted, and links to settings', () => {
  render(<BankAccountTable accounts={['Zulu', 'Alpha']} accountBreakdown={{ Zulu: bucket(500), Alpha: bucket(200) }} />);

  expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '+ เพิ่มบัญชี' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /ลบบัญชี/ })).not.toBeInTheDocument();
  expect(screen.getAllByRole('link').some(link => link.getAttribute('href') === '/settings#bank-accounts')).toBe(true);
  fireEvent.change(screen.getByRole('combobox', { name: 'เรียงตาม — บัญชีธนาคาร' }), { target: { value: 'name:asc' } });
  expect(screen.getAllByRole('row')
    .filter(row => row.querySelector('td'))
    .map(row => row.querySelector('td')?.textContent))
    .toEqual(['Alpha', 'Zulu']);
  expect(screen.getAllByText(formatCurrency(200)).length).toBeGreaterThan(0);
  expect(screen.getAllByText(formatCurrency(500)).length).toBeGreaterThan(0);
});

test('bank account summary empty state links to settings without rendering the toolbar', () => {
  render(<BankAccountTable accounts={[]} />);

  expect(screen.getByText('ยังไม่มีบัญชีธนาคาร')).toBeInTheDocument();
  expect(screen.getByText('เพิ่มบัญชีได้ที่หน้าตั้งค่า')).toHaveAttribute('href', '/settings#bank-accounts');
  expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
});

describe('BankAccountTable breakdown disclosure', () => {
  const item = (key: string, name: string, amount: number, extra: Record<string, unknown> = {}) =>
    ({ key, name, amount, account: 'กสิกร', paid: false, ...extra });
  const current = {
    'กสิกร': { items: [item('netflix', 'Netflix', 617), item('youtube', 'YouTube', 519)], paidItems: [item('ccr_p', 'ยอดบัตร Shopee pay', 4475.66, { paid: true, cycleMonth: '2026-10', resolvedDueDate: '2026-11-10' })], total: 1136 },
    ttb: { items: [], paidItems: [], total: 0 },
    'ไม่ระบุบัญชี': { items: [item('mystery', 'ไม่รู้ที่มา', 12, { account: 'ไม่ระบุบัญชี' })], paidItems: [], total: 12 }
  };
  const prev = {
    'กสิกร': { items: [item('old', 'ค้างเก่า', 300)], paidItems: [], total: 300 },
    ttb: { items: [], paidItems: [], total: 0 },
    'ไม่ระบุบัญชี': { items: [], paidItems: [], total: 0 }
  };
  const accounts = ['กสิกร', 'ttb', 'ไม่ระบุบัญชี'];
  const renderTable = (props: Record<string, unknown> = {}) => render(
    <BankAccountTable accounts={accounts} accountBreakdown={current} prevAccountBreakdown={prev} monthKey="2026-11" prevMonthKey="2026-10" {...props} />
  );
  const tableTrigger = (name: RegExp | string) => screen.getAllByRole('button', { name }).find(b => b.closest('table'))!;

  test('AC-14 trigger name, AC-29 chevron gutter reserved, AC-5 toggles panel row under the account row', () => {
    renderTable();
    const trigger = screen.getByRole('button', { name: /^1,136\.00 แจกแจงยอดเดือนนี้ของบัญชี กสิกร$/ });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(document.getElementById(trigger.getAttribute('aria-controls')!)).toBeNull();
    expect(trigger.className).toMatch(/min-h-11/);
    expect(trigger.querySelector('[aria-hidden="true"]')).not.toBeNull();
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    const panel = document.getElementById(trigger.getAttribute('aria-controls')!)!;
    expect(panel).toHaveTextContent('เดือนนี้ · กสิกร');
    expect(panel.closest('tr')!.previousElementSibling).toBe(trigger.closest('tr'));
    fireEvent.click(trigger);
    expect(document.getElementById(trigger.getAttribute('aria-controls')!)).toBeNull();
  });

  test('zero account and — figure still have enabled triggers (AC-7, AC-29)', () => {
    renderTable();
    const zero = screen.getByRole('button', { name: /^0\.00 แจกแจงยอดเดือนนี้ของบัญชี ttb$/ });
    const dash = screen.getByRole('button', { name: /^— แจกแจงยอดค้างเดือนก่อนของบัญชี ttb$/ });
    expect(zero).toBeEnabled();
    expect(dash).toBeEnabled();
    expect(zero.querySelector('[aria-hidden="true"]')!.className).toBe(dash.querySelector('[aria-hidden="true"]')!.className);
    fireEvent.click(zero);
    expect(screen.getAllByText('ไม่มีรายการค้างจ่าย').length).toBeGreaterThan(0);
  });

  test('F-3: negative prev total shows the signed figure in default tone (table + card); zero stays —; positive stays text-neg', () => {
    const negPrev = {
      'กสิกร': { items: [item('old', 'ค้างเก่า', 300)], paidItems: [], total: 300 },
      ttb: { items: [item('refund', 'คืนเงิน', -50)], paidItems: [], total: -50 },
      'ไม่ระบุบัญชี': { items: [], paidItems: [], total: 0 }
    };
    renderTable({ prevAccountBreakdown: negPrev });
    const buttons = screen.getAllByRole('button', { name: /-50.00 แจกแจงยอดค้างเดือนก่อนของบัญชี ttb$/ });
    expect(buttons.length).toBe(2);
    buttons.forEach(button => {
      const figure = Array.from(button.querySelectorAll('span')).find(span => span.textContent === '-50.00')!;
      expect(figure.className).not.toMatch(/text-neg/);
      expect(figure.className).toMatch(/text-primary/);
    });
    const positive = screen.getAllByRole('button', { name: /300.00 แจกแจงยอดค้างเดือนก่อนของบัญชี กสิกร$/ });
    positive.forEach(button => {
      const figure = Array.from(button.querySelectorAll('span')).find(span => span.textContent === '300.00')!;
      expect(figure.className).toMatch(/text-neg/);
    });
    expect(screen.getAllByRole('button', { name: /— แจกแจงยอดค้างเดือนก่อนของบัญชี ไม่ระบุบัญชี$/ }).length).toBe(2);
    // cell === panel header === breakdown.total
    fireEvent.click(buttons.find(b => b.closest('table'))!);
    const panel = document.getElementById(buttons.find(b => b.closest('table'))!.getAttribute('aria-controls')!)!;
    expect(panel).toHaveTextContent('-50.00');
  });

  test('prev column trigger opens the previous month rows with the prev title (AC-5)', () => {
    renderTable();
    const trigger = tableTrigger(/^300\.00 แจกแจงยอดค้างเดือนก่อนของบัญชี กสิกร$/);
    fireEvent.click(trigger);
    const panel = document.getElementById(trigger.getAttribute('aria-controls')!)!;
    expect(panel).toHaveTextContent('ค้างเดือนก่อน (ต.ค. 2569) · กสิกร');
    expect(panel).toHaveTextContent('ค้างเก่า');
    expect(panel).not.toHaveTextContent('Netflix');
  });

  test('only one panel is open; opening another replaces it', () => {
    renderTable();
    fireEvent.click(tableTrigger(/^1,136\.00 แจกแจงยอดเดือนนี้/));
    fireEvent.click(tableTrigger(/^12\.00 แจกแจงยอดเดือนนี้ของบัญชี ไม่ระบุบัญชี$/));
    // หนึ่ง panel ต่อ layout (table + cards) แต่เป็นบัญชีเดียวกันเสมอ
    const regions = screen.getAllByRole('region');
    expect(regions).toHaveLength(2);
    regions.forEach(region => expect(region).toHaveTextContent('เดือนนี้ · ไม่ระบุบัญชี'));
  });

  test('AC-8 unassigned bucket lists its rows', () => {
    renderTable();
    const trigger = tableTrigger(/ของบัญชี ไม่ระบุบัญชี$/);
    fireEvent.click(trigger);
    expect(document.getElementById(trigger.getAttribute('aria-controls')!)).toHaveTextContent('ไม่รู้ที่มา');
  });

  test('AC-13 Escape on trigger/panel closes and returns focus; Escape elsewhere does nothing; hide button returns focus', () => {
    renderTable();
    const trigger = tableTrigger(/^1,136\.00 แจกแจงยอดเดือนนี้/);
    fireEvent.keyDown(trigger, { key: 'Escape' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    // Escape on a different (closed) trigger does nothing
    fireEvent.keyDown(tableTrigger(/ของบัญชี ttb$/), { key: 'Escape' });
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    trigger.focus();
    fireEvent.keyDown(trigger, { key: 'Escape' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).toHaveFocus();
    fireEvent.click(trigger);
    const hide = screen.getAllByRole('button', { name: 'ซ่อนรายละเอียด' })[0];
    hide.focus();
    fireEvent.keyDown(hide, { key: 'Escape' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).toHaveFocus();
    fireEvent.click(trigger);
    fireEvent.click(screen.getAllByRole('button', { name: 'ซ่อนรายละเอียด' })[0]);
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).toHaveFocus();
  });

  test('AC-12/AC-6 card layout toggles the same content and no IDs are duplicated across layouts', () => {
    renderTable();
    const cardTrigger = screen.getAllByRole('button', { name: /^เดือนนี้.*แจกแจงยอดเดือนนี้ของบัญชี กสิกร$/ })[0];
    expect(cardTrigger.closest('table')).toBeNull();
    fireEvent.click(cardTrigger);
    const panel = document.getElementById(cardTrigger.getAttribute('aria-controls')!)!;
    expect(panel).toHaveTextContent('Netflix');
    expect(cardTrigger.parentElement).toContainElement(panel);
    const ids = Array.from(document.querySelectorAll('[id]')).map(node => node.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(document.querySelectorAll('[role="region"]').length).toBe(2);
  });

  test('AC-11 reset: month change, prev column disappearing, and account filtered out close the panel', () => {
    const { rerender } = renderTable();
    fireEvent.click(tableTrigger(/^1,136\.00 แจกแจงยอดเดือนนี้/));
    expect(screen.getAllByRole('region').length).toBeGreaterThan(0);
    rerender(<BankAccountTable accounts={accounts} accountBreakdown={current} prevAccountBreakdown={prev} monthKey="2026-12" prevMonthKey="2026-11" />);
    expect(screen.queryByRole('region')).not.toBeInTheDocument();

    fireEvent.click(tableTrigger(/^300\.00 แจกแจงยอดค้างเดือนก่อน/));
    expect(screen.getAllByRole('region').length).toBeGreaterThan(0);
    rerender(<BankAccountTable accounts={accounts} accountBreakdown={current} prevAccountBreakdown={{}} monthKey="2026-12" prevMonthKey="2026-11" />);
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /แจกแจงยอดค้างเดือนก่อน/ })).not.toBeInTheDocument();

    fireEvent.click(tableTrigger(/^1,136\.00 แจกแจงยอดเดือนนี้/));
    expect(screen.getAllByRole('region').length).toBeGreaterThan(0);
    rerender(<BankAccountTable accounts={['ttb']} accountBreakdown={current} prevAccountBreakdown={{}} monthKey="2026-12" prevMonthKey="2026-11" />);
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
  });

  test('panel follows live edits while open (AC-10 at table level)', () => {
    const live = {
      'กสิกร': { items: [item('a', 'รายการ A', 100), item('b', 'รายการ B', 50)], paidItems: [], total: 150 }
    };
    const { rerender } = render(<BankAccountTable accounts={['กสิกร']} accountBreakdown={live} monthKey="2026-11" />);
    const trigger = tableTrigger(/^150\.00 แจกแจง/);
    fireEvent.click(trigger);
    expect(screen.getAllByRole('region')[0]).toHaveTextContent('รวม 150.00 บาท · 2 รายการ');
    const afterPaid = {
      'กสิกร': { items: [item('b', 'รายการ B', 50)], paidItems: [item('a', 'รายการ A', 100, { paid: true })], total: 50 }
    };
    rerender(<BankAccountTable accounts={['กสิกร']} accountBreakdown={afterPaid} monthKey="2026-11" />);
    expect(screen.getAllByRole('region')[0]).toHaveTextContent('รวม 50.00 บาท · 1 รายการ');
    expect(screen.getAllByRole('button', { name: 'จ่ายแล้ว 1 รายการ (ไม่นับในยอด)' }).length).toBeGreaterThan(0);
    expect(tableTrigger(/^50\.00 แจกแจง/)).toHaveAttribute('aria-expanded', 'true');
  });

  test('รวมทั้งหมด row has no buttons', () => {
    renderTable();
    const totalRow = screen.getAllByRole('row').find(row => row.textContent?.includes('รวมทั้งหมด'))!;
    expect(within(totalRow).queryAllByRole('button')).toHaveLength(0);
  });
});
