import { useState } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import IncomeTable from '../../src/frontend/components/IncomeTable';
import BankAccountTable from '../../src/frontend/components/BankAccountTable';
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

function Accounts() {
  const [accounts, setAccounts] = useState(['Zulu', 'Alpha', 'Middle']);
  return <><BankAccountTable accounts={accounts} onChangeAccounts={setAccounts} /><output data-testid="canonical">{JSON.stringify(accounts)}</output></>;
}

test('sorted bank rename/delete target canonical identity, not visible position', () => {
  render(<Accounts />);
  fireEvent.change(screen.getByRole('combobox', { name: 'เรียงตาม — บัญชีธนาคาร' }), { target: { value: 'name:asc' } });
  const inputs = screen.getAllByPlaceholderText('ชื่อบัญชี');
  expect(inputs.slice(0, 3).map(input => (input as HTMLInputElement).value)).toEqual(['Alpha', 'Middle', 'Zulu']);
  const middle = inputs[1]!;
  middle.focus();
  fireEvent.change(middle, { target: { value: 'Beta' } });
  expect(screen.getByTestId('canonical')).toHaveTextContent('["Zulu","Alpha","Beta"]');
  expect(screen.getAllByPlaceholderText('ชื่อบัญชี')[1]).toBe(middle);
  expect(middle).toHaveFocus();
  fireEvent.click(screen.getAllByRole('button', { name: 'ลบบัญชี Beta' })[0]!);
  expect(screen.getByTestId('canonical')).toHaveTextContent('["Zulu","Alpha"]');
  expect(screen.getAllByDisplayValue('Zulu')).toHaveLength(2);
});

test('bank hidden rows survive rename, and normalization preserves retained row keys', () => {
  render(<Accounts />);
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Middle' } });
  const input = screen.getAllByDisplayValue('Middle')[0]!;
  fireEvent.change(input, { target: { value: 'Middle updated' } });
  fireEvent.blur(input);
  expect(screen.getByTestId('canonical')).toHaveTextContent('["Zulu","Alpha","Middle updated"]');
  expect(screen.getAllByDisplayValue('Middle updated')[0]).toBe(input);
  fireEvent.click(screen.getByRole('button', { name: '+ เพิ่มบัญชี' }));
  expect(screen.getAllByDisplayValue('บัญชีใหม่')).toHaveLength(2);
  expect(screen.getByTestId('canonical')).toHaveTextContent('["Zulu","Alpha","Middle updated","บัญชีใหม่"]');
});
