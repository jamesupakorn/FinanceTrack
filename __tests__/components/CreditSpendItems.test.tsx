// CreditSpendItems is list-only after the detail redesign: rows, row menu -> onEdit, delete confirm, total, states.
// The add / edit / date-move / legacy / EOM-10 preview cases moved to AddCardExpenseSheet.test.tsx (AC-CD16).
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CreditSpendItems from '../../src/frontend/components/CreditSpendItems';
import { creditCardAPI } from '../../src/shared/utils/frontend/apiUtils';
import { showToast } from '../../src/shared/utils/frontend/toast';

jest.mock('../../src/shared/utils/frontend/apiUtils', () => ({
  creditCardAPI: { listSpendItems: jest.fn(), deleteSpendItem: jest.fn() }
}));
jest.mock('../../src/shared/utils/frontend/toast', () => ({ showToast: jest.fn() }));

const CARD_ID = 'cc_000000000001';
const makeItem = (n: number, extra: Record<string, unknown> = {}) => ({
  id: `si_00000000000${n}`, cardId: CARD_ID, month: '2026-10', purchaseDate: `2026-10-0${n}`, name: `รายการ${n}`, amount: 100 * n, ...extra
});
const item = { ...makeItem(1), name: 'อาหาร', amount: 125 };

const list = (items: unknown[], total = 125) => ({ items, totals: { [CARD_ID]: total } });

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(creditCardAPI.listSpendItems).mockResolvedValue(list([item]) as never);
});

const renderList = (props: Partial<React.ComponentProps<typeof CreditSpendItems>> = {}) => render(
  <CreditSpendItems cardId={CARD_ID} month="2026-10" onEdit={jest.fn()} onChanged={jest.fn()} {...props} />
);

const openMenu = async (user: ReturnType<typeof userEvent.setup>, name: string) => {
  const trigger = screen.getByRole('button', { name: `ตัวเลือกของรายการ ${name}` });
  await user.click(trigger);
  return trigger;
};

it('shows the month in the heading, the rows with purchase dates, the server total, and no inline form', async () => {
  const { container } = renderList();
  await screen.findByText('อาหาร');
  expect(screen.getByRole('heading', { name: 'รายการไม่ผ่อน · ต.ค. 2569' })).toBeInTheDocument();
  expect(screen.getByText('1 ต.ค. 2569')).toBeInTheDocument();
  expect(screen.getByText('125.00 ฿')).toBeInTheDocument();
  expect(screen.getByText('รวมรายการไม่ผ่อน 125.00 ฿')).toBeInTheDocument();
  expect(container.querySelector('form')).toBeNull();
  expect(screen.queryByLabelText('ชื่อรายการไม่ผ่อน')).toBeNull();
});

it('shows a loading skeleton first', () => {
  jest.mocked(creditCardAPI.listSpendItems).mockReturnValue(new Promise(() => undefined) as never);
  renderList();
  expect(screen.getByRole('status')).toHaveTextContent('กำลังโหลดรายการ...');
});

it('row menu: แก้ไขรายการ calls onEdit(item) with the trigger as the focused opener', async () => {
  const user = userEvent.setup();
  let focusAtEdit: Element | null = null;
  const onEdit = jest.fn(() => { focusAtEdit = document.activeElement; });
  renderList({ onEdit });
  await screen.findByText('อาหาร');
  const trigger = await openMenu(user, 'อาหาร');
  await user.click(screen.getByRole('menuitem', { name: 'แก้ไขรายการ' }));
  expect(onEdit).toHaveBeenCalledWith(item);
  expect(focusAtEdit).toBe(trigger);
});

it('AC-CD17 deletion defaults to cancel and Escape returns focus to the row trigger', async () => {
  const user = userEvent.setup();
  renderList();
  await screen.findByText('อาหาร');
  const trigger = await openMenu(user, 'อาหาร');
  await user.click(screen.getByRole('menuitem', { name: 'ลบรายการ' }));
  const dialog = screen.getByRole('alertdialog', { name: 'ยืนยันลบรายการไม่ผ่อน' });
  expect(dialog).toHaveTextContent('ลบรายการ อาหาร?');
  expect(screen.getByRole('button', { name: 'ยกเลิกการลบ' })).toHaveFocus();
  fireEvent.keyDown(dialog, { key: 'Escape' });
  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
  expect(creditCardAPI.deleteSpendItem).not.toHaveBeenCalled();
});

it('AC-CD17 a confirmed delete re-fetches, reports the change, toasts, and focuses the next row trigger', async () => {
  const user = userEvent.setup();
  const first = makeItem(1);
  const second = makeItem(2);
  const third = makeItem(3);
  jest.mocked(creditCardAPI.listSpendItems)
    .mockResolvedValueOnce(list([first, second, third], 600) as never)
    .mockResolvedValueOnce(list([first, third], 400) as never);
  jest.mocked(creditCardAPI.deleteSpendItem).mockResolvedValue({ deletedId: second.id, cycle: null });
  const onChanged = jest.fn();
  renderList({ onChanged });
  await screen.findByText('รายการ2');
  await openMenu(user, 'รายการ2');
  await user.click(screen.getByRole('menuitem', { name: 'ลบรายการ' }));
  await user.click(screen.getByRole('button', { name: 'ยืนยันลบ' }));
  await waitFor(() => expect(onChanged).toHaveBeenCalledWith('2026-10'));
  expect(creditCardAPI.deleteSpendItem).toHaveBeenCalledWith(second.id);
  expect(showToast).toHaveBeenCalledWith('ลบรายการแล้ว');
  await waitFor(() => expect(screen.queryByText('รายการ2')).not.toBeInTheDocument());
  expect(screen.getByText('รวมรายการไม่ผ่อน 400.00 ฿')).toBeInTheDocument();
  await waitFor(() => expect(screen.getByRole('button', { name: 'ตัวเลือกของรายการ รายการ3' })).toHaveFocus());
});

it('AC-CD17 deleting the last row focuses the previous row; deleting the only row focuses the heading', async () => {
  const user = userEvent.setup();
  const first = makeItem(1);
  const second = makeItem(2);
  jest.mocked(creditCardAPI.listSpendItems)
    .mockResolvedValueOnce(list([first, second], 300) as never)
    .mockResolvedValueOnce(list([first], 100) as never)
    .mockResolvedValueOnce(list([], 0) as never);
  jest.mocked(creditCardAPI.deleteSpendItem).mockResolvedValue({ deletedId: 'x', cycle: null });
  renderList();
  await screen.findByText('รายการ2');
  await openMenu(user, 'รายการ2');
  await user.click(screen.getByRole('menuitem', { name: 'ลบรายการ' }));
  await user.click(screen.getByRole('button', { name: 'ยืนยันลบ' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'ตัวเลือกของรายการ รายการ1' })).toHaveFocus());
  await openMenu(user, 'รายการ1');
  await user.click(screen.getByRole('menuitem', { name: 'ลบรายการ' }));
  await user.click(screen.getByRole('button', { name: 'ยืนยันลบ' }));
  await waitFor(() => expect(screen.getByRole('heading', { name: /รายการไม่ผ่อน/ })).toHaveFocus());
  expect(screen.getByText('รวมรายการไม่ผ่อน 0.00 ฿')).toBeInTheDocument();
});

it('empty state: message, total 0.00, and the add-simple action only when provided', async () => {
  jest.mocked(creditCardAPI.listSpendItems).mockResolvedValue(list([], 0) as never);
  const onAddSimple = jest.fn();
  renderList({ onAddSimple });
  expect(await screen.findByText('ยังไม่มีรายการไม่ผ่อนในรอบบิลนี้')).toBeInTheDocument();
  expect(screen.getByText('รวมรายการไม่ผ่อน 0.00 ฿')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '+ เพิ่มรายจ่ายธรรมดา' }));
  expect(onAddSimple).toHaveBeenCalledTimes(1);
});

it('error state: alert + retry re-fetches and recovers', async () => {
  jest.mocked(creditCardAPI.listSpendItems).mockRejectedValueOnce(new Error('x'));
  renderList();
  expect(await screen.findByRole('alert')).toHaveTextContent('โหลดรายการไม่ผ่อนไม่สำเร็จ');
  expect(showToast).toHaveBeenCalledWith('โหลดรายการไม่ผ่อนไม่สำเร็จ', 'error');
  fireEvent.click(screen.getByRole('button', { name: 'ลองใหม่' }));
  expect(await screen.findByText('อาหาร')).toBeInTheDocument();
  expect(creditCardAPI.listSpendItems).toHaveBeenCalledTimes(2);
});

it('C-3 a refreshKey change re-fetches silently without remounting (the row trigger node survives)', async () => {
  const { rerender } = renderList();
  await screen.findByText('อาหาร');
  const trigger = screen.getByRole('button', { name: 'ตัวเลือกของรายการ อาหาร' });
  jest.mocked(creditCardAPI.listSpendItems).mockResolvedValue(list([{ ...item, name: 'อาหารเย็น' }]) as never);
  rerender(<CreditSpendItems cardId={CARD_ID} month="2026-10" refreshKey={1} onEdit={jest.fn()} onChanged={jest.fn()} />);
  expect(screen.queryByRole('status')).toBeNull();
  await screen.findByText('อาหารเย็น');
  expect(creditCardAPI.listSpendItems).toHaveBeenCalledTimes(2);
  expect(trigger.isConnected).toBe(true);
});

it('I-34 focusItemId focuses that row trigger once after load and reports it handled', async () => {
  const onFocusHandled = jest.fn();
  renderList({ focusItemId: item.id, onFocusHandled });
  await screen.findByText('อาหาร');
  await waitFor(() => expect(screen.getByRole('button', { name: 'ตัวเลือกของรายการ อาหาร' })).toHaveFocus());
  expect(onFocusHandled).toHaveBeenCalledTimes(1);
});

it('L-3 / I-33 on mobile only the first 5 rows show until "แสดงทั้งหมด"; desktop shows all', async () => {
  const many = [1, 2, 3, 4, 5, 6, 7].map(n => makeItem(n));
  jest.mocked(creditCardAPI.listSpendItems).mockResolvedValue(list(many, 2800) as never);
  const { unmount } = renderList({ isMobileView: true });
  await screen.findByText('รายการ1');
  expect(screen.queryByText('รายการ6')).toBeNull();
  const showAll = screen.getByRole('button', { name: 'แสดงทั้งหมด (7 รายการ)' });
  fireEvent.click(showAll);
  expect(screen.getByText('รายการ7')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'แสดงน้อยลง' })).toHaveAttribute('aria-expanded', 'true');
  unmount();
  renderList({ isMobileView: false });
  await screen.findByText('รายการ7');
  expect(screen.queryByRole('button', { name: /แสดงทั้งหมด/ })).toBeNull();
});
