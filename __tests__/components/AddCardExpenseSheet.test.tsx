// Ported from AddCardExpenseTypeDialog.test.tsx + CardSpendItemDialog.test.tsx (spec-credit-card-detail-redesign §10, R-1)
// plus the new sheet behaviours: AC-CD13 to AC-CD16, AC-CD19.
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AddCardExpenseSheet, { defaultPurchaseDate, type AddCardExpenseSheetProps } from '../../src/frontend/components/AddCardExpenseSheet';
import { creditCardAPI } from '../../src/shared/utils/frontend/apiUtils';

jest.mock('../../src/shared/utils/frontend/apiUtils', () => ({
  creditCardAPI: { createSpendItem: jest.fn(), updateSpendItem: jest.fn() }
}));

const cardA = { id: 'a', name: 'Shopee', statementDay: 25, dueDay: 10 };
const cardB = { id: 'b', name: 'KTC', statementDay: 5, dueDay: 'EOM' };

beforeEach(() => jest.clearAllMocks());

function renderSheet(overrides: Partial<AddCardExpenseSheetProps> = {}) {
  const props: AddCardExpenseSheetProps = {
    open: true,
    mode: 'create',
    cards: [cardA, cardB],
    card: cardA,
    month: '2026-10',
    item: null,
    initialStep: 'spend',
    onChooseInstallment: jest.fn(),
    onCancel: jest.fn(),
    onSaved: jest.fn(),
    ...overrides
  };
  return { props, ...render(<AddCardExpenseSheet {...props} />) };
}

describe('type step (ported from AddCardExpenseTypeDialog)', () => {
  test('renders choices, focuses cancel, Escape cancels', async () => {
    const user = userEvent.setup();
    const { props } = renderSheet({ card: { ...cardA, name: 'Shopee' }, initialStep: 'type' });
    const dialog = screen.getByRole('dialog', { name: 'เพิ่มรายจ่าย' });
    expect(dialog).toHaveAccessibleDescription('บัตร Shopee');
    expect(screen.getByRole('button', { name: 'ยกเลิก' })).toHaveFocus();
    await user.click(screen.getByRole('button', { name: /ผ่อนชำระ/ }));
    expect(props.onChooseInstallment).toHaveBeenCalledTimes(1);
    await user.keyboard('{Escape}');
    expect(props.onCancel).toHaveBeenCalled();
  });

  test('renders nothing when closed', () => {
    renderSheet({ open: false });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  test('AC-CD13: choosing รายจ่ายธรรมดา keeps the same dialog element, heading gets focus, back keeps values', async () => {
    const user = userEvent.setup();
    renderSheet({ initialStep: 'type' });
    const dialog = screen.getByRole('dialog', { name: 'เพิ่มรายจ่าย' });
    await user.click(screen.getByRole('button', { name: /รายจ่ายธรรมดา/ }));
    expect(screen.getByRole('dialog', { name: 'รายจ่ายธรรมดา' })).toBe(dialog);
    expect(screen.getByRole('heading', { name: 'รายจ่ายธรรมดา' })).toHaveFocus();
    await user.type(screen.getByLabelText('ชื่อรายการ'), 'ข้าว');
    await user.click(screen.getByRole('button', { name: /เปลี่ยนประเภท/ }));
    expect(screen.getByRole('dialog', { name: 'เพิ่มรายจ่าย' })).toBe(dialog);
    expect(screen.getByRole('button', { name: /รายจ่ายธรรมดา/ })).toHaveFocus();
    await user.click(screen.getByRole('button', { name: /รายจ่ายธรรมดา/ }));
    expect(screen.getByLabelText('ชื่อรายการ')).toHaveValue('ข้าว');
  });
});

describe('create step (ported from CardSpendItemDialog)', () => {
  test('preselected card: no select, default focus cancel, body has only 4 fields, onSaved gets server item', async () => {
    const user = userEvent.setup();
    const item = { id: 'i1', cardId: 'a', name: 'ข้าว', amount: 50, month: '2026-11', purchaseDate: '2026-10-26' };
    jest.mocked(creditCardAPI.createSpendItem).mockResolvedValue({ item } as never);
    const { props } = renderSheet();
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.getByRole('button', { name: 'ยกเลิก' })).toHaveFocus();
    await user.type(screen.getByLabelText('ชื่อรายการ'), '  ข้าว ');
    await user.type(screen.getByLabelText('จำนวนเงิน (บาท)'), '50');
    await user.click(screen.getByRole('button', { name: 'บันทึกรายการ' }));
    await waitFor(() => expect(props.onSaved).toHaveBeenCalledWith(item));
    const body = jest.mocked(creditCardAPI.createSpendItem).mock.calls[0][0];
    expect(Object.keys(body).sort()).toEqual(['amount', 'cardId', 'name', 'purchaseDate']);
    expect(body).toMatchObject({ cardId: 'a', name: 'ข้าว', amount: '50' });
  });

  test('dashboard path: select shown, requires card, preview appears after pick, edited date kept', async () => {
    const user = userEvent.setup();
    renderSheet({ card: null });
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
    let reject: (e: Error) => void = () => undefined;
    jest.mocked(creditCardAPI.createSpendItem).mockImplementation(() => new Promise((_, rj) => { reject = rj; }));
    const { props } = renderSheet();
    await user.type(screen.getByLabelText('ชื่อรายการ'), 'abc');
    await user.type(screen.getByLabelText('จำนวนเงิน (บาท)'), 'abc');
    const submit = screen.getByRole('button', { name: 'บันทึกรายการ' });
    await user.click(submit);
    await user.click(submit);
    await user.keyboard('{Escape}');
    expect(props.onCancel).not.toHaveBeenCalled();
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
    renderSheet();
    await user.type(screen.getByLabelText('ชื่อรายการ'), 'abc');
    await user.type(screen.getByLabelText('จำนวนเงิน (บาท)'), 'zz');
    await user.click(screen.getByRole('button', { name: 'บันทึกรายการ' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('ข้อมูลรายการไม่ถูกต้อง');
    await waitFor(() => expect(screen.getByLabelText('จำนวนเงิน (บาท)')).toHaveFocus());
  });

  test('real 400 without a mappable field focuses the re-enabled submit button', async () => {
    const user = userEvent.setup();
    mockReal400({ error: 'ไม่สามารถคำนวณรอบบิลจากวันที่ซื้อและวันสรุปยอดได้' });
    renderSheet();
    await user.type(screen.getByLabelText('ชื่อรายการ'), 'abc');
    await user.click(screen.getByRole('button', { name: 'บันทึกรายการ' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('ไม่สามารถคำนวณรอบบิล');
    await waitFor(() => expect(screen.getByRole('button', { name: 'บันทึกรายการ' })).toHaveFocus());
  });

  describe('Tab wrap (jsdom has no layout, so give elements a client rect)', () => {
    const original = HTMLElement.prototype.getClientRects;
    beforeAll(() => { HTMLElement.prototype.getClientRects = () => [{}] as unknown as DOMRectList; });
    afterAll(() => { HTMLElement.prototype.getClientRects = original; });

    // The sheet header adds a close button ("ปิด") ahead of the first field, so it is the first tabbable.
    test('Tab on last wraps to first; Shift+Tab on first wraps to last', () => {
      renderSheet();
      const first = screen.getByRole('button', { name: 'ปิด' });
      const save = screen.getByRole('button', { name: 'บันทึกรายการ' });
      const dialog = screen.getByRole('dialog');
      save.focus();
      fireEvent.keyDown(dialog, { key: 'Tab' });
      expect(first).toHaveFocus();
      fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
      expect(save).toHaveFocus();
    });
  });
});

describe('edit mode (AC-CD16; ported from the CreditSpendItems inline-form cases)', () => {
  const item = { id: 'si_000000000001', cardId: 'a', month: '2026-10', purchaseDate: '2026-10-10', name: 'อาหาร', amount: 125 };

  test('opens titled "แก้ไขรายจ่าย", pre-filled, with no card select and no change-type link', () => {
    renderSheet({ mode: 'edit', item, initialStep: 'spend' });
    expect(screen.getByRole('dialog', { name: 'แก้ไขรายจ่าย' })).toBeInTheDocument();
    expect(screen.getByLabelText('ชื่อรายการ')).toHaveValue('อาหาร');
    expect(screen.getByLabelText('จำนวนเงิน (บาท)')).toHaveValue('125');
    expect(screen.getByLabelText('วันที่ซื้อ')).toHaveValue('2026-10-10');
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.queryByRole('button', { name: /เปลี่ยนประเภท/ })).toBeNull();
  });

  test('(a) changing only the name sends {id, name, amount} without the unchanged date', async () => {
    jest.mocked(creditCardAPI.updateSpendItem).mockResolvedValue({ item } as never);
    const { props } = renderSheet({ mode: 'edit', item });
    fireEvent.change(screen.getByLabelText('ชื่อรายการ'), { target: { value: 'อาหารเย็น' } });
    fireEvent.click(screen.getByRole('button', { name: 'บันทึกรายการ' }));
    await waitFor(() => expect(creditCardAPI.updateSpendItem).toHaveBeenCalledWith({ id: item.id, name: 'อาหารเย็น', amount: '125' }));
    await waitFor(() => expect(props.onSaved).toHaveBeenCalledWith(item));
    expect(creditCardAPI.createSpendItem).not.toHaveBeenCalled();
  });

  test('(b) a changed date is sent as purchaseDate and the server item is handed to onSaved', async () => {
    const moved = { ...item, month: '2026-12', purchaseDate: '2026-11-16' };
    jest.mocked(creditCardAPI.updateSpendItem).mockResolvedValue({ item: moved } as never);
    const { props } = renderSheet({ mode: 'edit', item, card: { ...cardA, statementDay: 15, dueDay: 20 } });
    fireEvent.change(screen.getByLabelText('วันที่ซื้อ'), { target: { value: '2026-11-16' } });
    fireEvent.click(screen.getByRole('button', { name: 'บันทึกรายการ' }));
    await waitFor(() => expect(creditCardAPI.updateSpendItem).toHaveBeenCalledWith({
      id: item.id, name: item.name, amount: '125', purchaseDate: '2026-11-16'
    }));
    await waitFor(() => expect(props.onSaved).toHaveBeenCalledWith(moved));
  });

  test('(c) a legacy date-less item has an empty, non-required date and sends no date', async () => {
    const legacy = { id: item.id, cardId: 'a', month: item.month, name: item.name, amount: item.amount };
    jest.mocked(creditCardAPI.updateSpendItem).mockResolvedValue({ item: legacy } as never);
    renderSheet({ mode: 'edit', item: legacy });
    expect(screen.getByLabelText('วันที่ซื้อ')).toHaveValue('');
    expect(screen.getByLabelText('วันที่ซื้อ')).not.toBeRequired();
    fireEvent.change(screen.getByLabelText('ชื่อรายการ'), { target: { value: 'อาหารที่แก้แล้ว' } });
    fireEvent.click(screen.getByRole('button', { name: 'บันทึกรายการ' }));
    await waitFor(() => expect(creditCardAPI.updateSpendItem).toHaveBeenCalledWith({
      id: item.id, name: 'อาหารที่แก้แล้ว', amount: '125'
    }));
  });

  test('(d) AC-9 EOM/10 card: billing month 2026-10 is due 10 พ.ย. 2569, not 10 ต.ค.', () => {
    renderSheet({ mode: 'edit', item, card: { id: 'a', name: 'Shopee', statementDay: 'EOM', dueDay: 10 } });
    fireEvent.change(screen.getByLabelText('วันที่ซื้อ'), { target: { value: '2026-10-16' } });
    expect(screen.getByRole('status')).toHaveTextContent('รอบบิล ต.ค. 2569 · ครบกำหนด 10 พ.ย. 2569');
    fireEvent.change(screen.getByLabelText('วันที่ซื้อ'), { target: { value: '2026-12-02' } });
    expect(screen.getByRole('status')).toHaveTextContent('รอบบิล ธ.ค. 2569 · ครบกำหนด 10 ม.ค. 2570');
  });
});

describe('AC-CD19 backdrop', () => {
  test('a tap on the backdrop closes a clean sheet but not a dirty one; Escape closes either', async () => {
    const user = userEvent.setup();
    const { props } = renderSheet();
    const overlay = screen.getByRole('dialog').parentElement as HTMLElement;
    fireEvent.mouseDown(overlay);
    expect(props.onCancel).toHaveBeenCalledTimes(1);
    await user.type(screen.getByLabelText('ชื่อรายการ'), 'x');
    fireEvent.mouseDown(overlay);
    expect(props.onCancel).toHaveBeenCalledTimes(1);
    await user.keyboard('{Escape}');
    expect(props.onCancel).toHaveBeenCalledTimes(2);
  });
});
