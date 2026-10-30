import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CardSpendItemDialog, { defaultPurchaseDate } from '../../src/frontend/components/CardSpendItemDialog';
import { creditCardAPI } from '../../src/shared/utils/frontend/apiUtils';

jest.mock('../../src/shared/utils/frontend/apiUtils', () => ({
  creditCardAPI: { createSpendItem: jest.fn() }
}));

const cardA = { id: 'a', name: 'Shopee', statementDay: 25, dueDay: 10 };
const cardB = { id: 'b', name: 'KTC', statementDay: 5, dueDay: 'EOM' };

beforeEach(() => jest.clearAllMocks());

test('preselected card: no select, default focus cancel, body has only 4 fields, onSaved gets server item', async () => {
  const user = userEvent.setup();
  const item = { id: 'i1', cardId: 'a', name: 'ข้าว', amount: 50, month: '2026-11', purchaseDate: '2026-10-26' };
  jest.mocked(creditCardAPI.createSpendItem).mockResolvedValue({ item } as never);
  const onSaved = jest.fn();
  render(<CardSpendItemDialog cards={[cardA, cardB]} card={cardA} month="2026-10" onCancel={jest.fn()} onSaved={onSaved} />);
  expect(screen.queryByRole('combobox')).toBeNull();
  expect(screen.getByRole('button', { name: 'ยกเลิก' })).toHaveFocus();
  await user.type(screen.getByLabelText('ชื่อรายการ'), '  ข้าว ');
  await user.type(screen.getByLabelText('จำนวนเงิน (บาท)'), '50');
  await user.click(screen.getByRole('button', { name: 'บันทึกรายการ' }));
  await waitFor(() => expect(onSaved).toHaveBeenCalledWith(item));
  const body = jest.mocked(creditCardAPI.createSpendItem).mock.calls[0][0];
  expect(Object.keys(body).sort()).toEqual(['amount', 'cardId', 'name', 'purchaseDate']);
  expect(body).toMatchObject({ cardId: 'a', name: 'ข้าว', amount: '50' });
});

test('dashboard path: select shown, requires card, preview appears after pick, edited date kept', async () => {
  const user = userEvent.setup();
  render(<CardSpendItemDialog cards={[cardA, cardB]} card={null} month="2026-10" onCancel={jest.fn()} onSaved={jest.fn()} />);
  expect(screen.queryByRole('status')).toBeNull();
  await user.type(screen.getByLabelText('ชื่อรายการ'), 'x');
  await user.click(screen.getByRole('button', { name: 'บันทึกรายการ' }));
  expect(screen.getByRole('alert')).toHaveTextContent('กรุณาเลือกบัตร');
  expect(creditCardAPI.createSpendItem).not.toHaveBeenCalled();
  await user.selectOptions(screen.getByLabelText('บัตร'), 'a');
  expect(screen.getByRole('status')).toHaveTextContent('รอบบิล');
  const date = screen.getByLabelText('วันที่ซื้อ') as HTMLInputElement;
  await user.clear(date);
  await user.type(date, '2026-03-01');
  await user.selectOptions(screen.getByLabelText('บัตร'), 'b');
  expect(date.value).toBe('2026-03-01');
});

test('server error stays open with values; Escape ignored while busy; double submit sends once', async () => {
  const user = userEvent.setup();
  const onCancel = jest.fn();
  let reject: (e: Error) => void = () => undefined;
  jest.mocked(creditCardAPI.createSpendItem).mockImplementation(() => new Promise((_, rj) => { reject = rj; }));
  render(<CardSpendItemDialog cards={[cardA]} card={cardA} month="2026-10" onCancel={onCancel} onSaved={jest.fn()} />);
  await user.type(screen.getByLabelText('ชื่อรายการ'), 'abc');
  await user.type(screen.getByLabelText('จำนวนเงิน (บาท)'), 'abc');
  const submit = screen.getByRole('button', { name: 'บันทึกรายการ' });
  await user.click(submit);
  await user.click(submit);
  await user.keyboard('{Escape}');
  expect(onCancel).not.toHaveBeenCalled();
  expect(creditCardAPI.createSpendItem).toHaveBeenCalledTimes(1);
  reject(new Error('รายการเต็มแล้ว'));
  expect(await screen.findByRole('alert')).toHaveTextContent('รายการเต็มแล้ว');
  expect(screen.getByLabelText('ชื่อรายการ')).toHaveValue('abc');
  expect(screen.getByLabelText('จำนวนเงิน (บาท)')).toHaveValue('abc');
});

function mockReal400(body: unknown): void {
  const actual = jest.requireActual('../../src/shared/utils/frontend/apiUtils');
  jest.requireActual('../../src/shared/utils/frontend/sessionClient').setActiveUserId('u001');
  document.cookie = 'ft_csrf=csrf-token-value_123';
  global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 400, json: async () => body }) as unknown as typeof fetch;
  jest.mocked(creditCardAPI.createSpendItem).mockImplementation(actual.creditCardAPI.createSpendItem);
}

test('defaultPurchaseDate: card without statementDay uses last day of month M (AC-AE5)', () => {
  expect(defaultPurchaseDate({ id: 'n', name: 'N', statementDay: null }, '2020-02')).toBe('2020-02-29');
  expect(defaultPurchaseDate({ id: 'n', name: 'N' }, '2021-02')).toBe('2021-02-28');
});

test('real 400 body {error, errors:{amount}} through jsonFetch focuses the amount field (§5.3.2)', async () => {
  const user = userEvent.setup();
  mockReal400({ error: 'ข้อมูลรายการไม่ถูกต้อง', errors: { amount: 'ยอดเงินต้องเป็นตัวเลขไม่ติดลบ' } });
  render(<CardSpendItemDialog cards={[cardA]} card={cardA} month="2026-10" onCancel={jest.fn()} onSaved={jest.fn()} />);
  await user.type(screen.getByLabelText('ชื่อรายการ'), 'abc');
  await user.type(screen.getByLabelText('จำนวนเงิน (บาท)'), 'zz');
  await user.click(screen.getByRole('button', { name: 'บันทึกรายการ' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('ข้อมูลรายการไม่ถูกต้อง');
  await waitFor(() => expect(screen.getByLabelText('จำนวนเงิน (บาท)')).toHaveFocus());
});

test('real 400 without a mappable field focuses the re-enabled submit button', async () => {
  const user = userEvent.setup();
  mockReal400({ error: 'ไม่สามารถคำนวณรอบบิลจากวันที่ซื้อและวันสรุปยอดได้' });
  render(<CardSpendItemDialog cards={[cardA]} card={cardA} month="2026-10" onCancel={jest.fn()} onSaved={jest.fn()} />);
  await user.type(screen.getByLabelText('ชื่อรายการ'), 'abc');
  await user.click(screen.getByRole('button', { name: 'บันทึกรายการ' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('ไม่สามารถคำนวณรอบบิล');
  await waitFor(() => expect(screen.getByRole('button', { name: 'บันทึกรายการ' })).toHaveFocus());
});

describe('Tab wrap (jsdom has no layout, so give elements a client rect)', () => {
  const original = HTMLElement.prototype.getClientRects;
  beforeAll(() => { HTMLElement.prototype.getClientRects = () => [{}] as unknown as DOMRectList; });
  afterAll(() => { HTMLElement.prototype.getClientRects = original; });

  test('Tab on last wraps to first; Shift+Tab on first wraps to last', () => {
    render(<CardSpendItemDialog cards={[cardA]} card={cardA} month="2026-10" onCancel={jest.fn()} onSaved={jest.fn()} />);
    const first = screen.getByLabelText('ชื่อรายการ');
    const save = screen.getByRole('button', { name: 'บันทึกรายการ' });
    const dialog = screen.getByRole('dialog');
    save.focus();
    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(first).toHaveFocus();
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
    expect(save).toHaveFocus();
  });
});
