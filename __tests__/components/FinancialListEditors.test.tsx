import { useState } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
  expect(screen.getByText('ชื่อบัญชีซ้ำกับบัญชีอื่น')).toBeInTheDocument();
});

test('bank account summary is read-only, sorted, and links to settings', () => {
  render(<BankAccountTable accounts={['Zulu', 'Alpha']} accountSummary={{ Zulu: 500, Alpha: 200 }} />);

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
