import { render, screen, within, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DailyExpenseTable from '../../src/frontend/components/DailyExpenseTable';
import { dailyExpenseAPI } from '../../src/shared/utils/frontend/apiUtils';
import { formatCurrency } from '../../src/shared/utils/frontend/numberUtils';

// The only collaborator this file mocks — apiUtils' dailyExpenseAPI export (getByMonth/save). Every
// other collaborator (showToast, Icons, formatCurrency/parseToNumber) is real, per spec §Scope
// ("no other module is mocked") and AC-3 ("exactly one jest.mock() call").
jest.mock('../../src/shared/utils/frontend/apiUtils', () => ({
  dailyExpenseAPI: {
    getByMonth: jest.fn(),
    save: jest.fn(),
  },
}));

const SELECTED_MONTH = '2026-01';
const FIXED_NAME_FALLBACK = 'รายวันใหม่';
const MISC_NAME_FALLBACK = 'รายจ่ายหยิบหย่อยใหม่';

// The component renders every item through two parallel DOM branches at once under jsdom
// (ItemRowTable for md+ / ItemRowCard for base — real CSS media queries never apply in jsdom, so
// both `hidden md:block` and `md:hidden` trees are present simultaneously). Every item therefore has
// exactly two matching inputs/buttons/monthly-amount nodes; queries below account for this
// consistently (getAllBy* + length assertions, or picking `[0]` for interactions).
function renderTable(props = {}) {
  return render(
    <DailyExpenseTable selectedMonth={SELECTED_MONTH} {...props} />
  );
}

// Locates the bottom live-total band by its fixed label text, then scopes assertions to its
// containing row so this doesn't collide with the two per-section subtotal rows above it.
function getTotalBand() {
  return screen.getByText('ยอดรวมค่าใช้จ่ายรายวัน/เดือน').closest('div');
}

afterEach(() => {
  jest.clearAllMocks();
});

describe('DailyExpenseTable', () => {
  it('renders the loading state while getByMonth is still pending', () => {
    dailyExpenseAPI.getByMonth.mockReturnValue(new Promise(() => {})); // never resolves
    renderTable();

    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('กำลังโหลดข้อมูล...');
    expect(screen.queryByText('รายจ่ายประจำ')).not.toBeInTheDocument();
  });

  it('renders both empty-state sections and a ฿0 total when getByMonth resolves an empty list', async () => {
    dailyExpenseAPI.getByMonth.mockResolvedValue({ items: [] });
    renderTable();

    const emptyBlocks = await screen.findAllByText('ยังไม่มีรายการ');
    expect(emptyBlocks).toHaveLength(2); // รายจ่ายประจำ + รายจ่ายหยิบหย่อย
    expect(screen.getByText('รายจ่ายประจำ')).toBeInTheDocument();
    expect(screen.getByText('รายจ่ายหยิบหย่อย')).toBeInTheDocument();

    expect(within(getTotalBand()).getByText(formatCurrency(0))).toBeInTheDocument();
  });

  it('falls back to an empty list (not an error message) when getByMonth rejects', async () => {
    dailyExpenseAPI.getByMonth.mockRejectedValue(new Error('network down'));
    renderTable();

    const emptyBlocks = await screen.findAllByText('ยังไม่มีรายการ');
    expect(emptyBlocks).toHaveLength(2);
    expect(within(getTotalBand()).getByText(formatCurrency(0))).toBeInTheDocument();
    // No error UI branch exists in this component — confirm nothing error-shaped leaked through.
    expect(screen.queryByText(/error/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/ผิดพลาด/)).not.toBeInTheDocument();
  });

  it('renders a populated fixed (daily) item and a misc item in their own sections', async () => {
    const fixedItem = { id: 'f1', category: 'fixed', name: 'ค่าเช่า', amount: 100, frequency: 'daily' };
    const miscItem = { id: 'm1', category: 'misc', name: 'กาแฟ', amount: 50, frequency: null };
    dailyExpenseAPI.getByMonth.mockResolvedValue({ items: [fixedItem, miscItem] });
    renderTable();

    // Wait past loading before asserting on loaded content.
    await screen.findAllByDisplayValue('ค่าเช่า');

    expect(screen.getAllByDisplayValue('ค่าเช่า')).toHaveLength(2); // table row + card
    expect(screen.getAllByDisplayValue(100)).toHaveLength(2);
    expect(screen.getAllByDisplayValue('กาแฟ')).toHaveLength(2);
    expect(screen.getAllByDisplayValue(50)).toHaveLength(2);

    // fixed/daily monthly amount: 100 * 30 = 3000. (This equals the section/total subtotals too,
    // since it's the only item, so at least 2 — not exactly 2 — is the correct bound here.)
    const monthlyText = formatCurrency(Math.round(100 * 30));
    expect(screen.getAllByText(new RegExp(monthlyText.replace('.', '\\.'))).length).toBeGreaterThanOrEqual(2);

    // misc row has no frequency <select>; only the fixed row's two (table + card) selects exist.
    expect(screen.getAllByRole('combobox')).toHaveLength(2);
  });

  it('computes the weekly frequency monthly amount as amount * 4.33 (distinct from the daily branch)', async () => {
    const weeklyItem = { id: 'w1', category: 'fixed', name: 'ค่าทำความสะอาด', amount: 100, frequency: 'weekly' };
    dailyExpenseAPI.getByMonth.mockResolvedValue({ items: [weeklyItem] });
    renderTable();

    await screen.findAllByDisplayValue('ค่าทำความสะอาด');

    const monthlyText = formatCurrency(Math.round(100 * 4.33)); // 433.00
    expect(screen.getAllByText(new RegExp(monthlyText.replace('.', '\\.'))).length).toBeGreaterThanOrEqual(2);
  });

  it('K12: adding a fixed/misc row gives it a non-empty fallback name, not an empty string', async () => {
    dailyExpenseAPI.getByMonth.mockResolvedValue({ items: [] });
    const user = userEvent.setup();
    renderTable();
    await screen.findAllByText('ยังไม่มีรายการ');

    await user.click(screen.getByRole('button', { name: '+ เพิ่มรายการประจำ' }));
    expect(screen.getAllByDisplayValue(FIXED_NAME_FALLBACK)).toHaveLength(2);

    await user.click(screen.getByRole('button', { name: '+ เพิ่มรายจ่ายหยิบหย่อย' }));
    expect(screen.getAllByDisplayValue(MISC_NAME_FALLBACK)).toHaveLength(2);
  });

  it('K17: markDirty fires on add/delete clicks but not while typing into an input', async () => {
    dailyExpenseAPI.getByMonth.mockResolvedValue({ items: [] });
    const markDirty = jest.fn();
    const user = userEvent.setup();
    renderTable({ markDirty });
    await screen.findAllByText('ยังไม่มีรายการ');

    await user.click(screen.getByRole('button', { name: '+ เพิ่มรายการประจำ' }));
    expect(markDirty).toHaveBeenCalledTimes(1);

    const nameInputs = screen.getAllByDisplayValue(FIXED_NAME_FALLBACK);
    await user.type(nameInputs[0], 'x');
    expect(markDirty).toHaveBeenCalledTimes(1); // typing must not call markDirty again

    const amountInputs = screen.getAllByDisplayValue('');
    await user.type(amountInputs[0], '5');
    expect(markDirty).toHaveBeenCalledTimes(1); // still just the one add-click call

    const deleteButtons = screen.getAllByLabelText(`ลบ ${FIXED_NAME_FALLBACK}x`);
    await user.click(deleteButtons[0]);
    expect(markDirty).toHaveBeenCalledTimes(2);
  });

  it('K16: the live total updates from typed input without a save round-trip', async () => {
    const miscItem = { id: 'm1', category: 'misc', name: 'กาแฟ', amount: 50, frequency: null };
    dailyExpenseAPI.getByMonth.mockResolvedValue({ items: [miscItem] });
    const user = userEvent.setup();
    renderTable();
    await screen.findAllByDisplayValue('กาแฟ');

    expect(within(getTotalBand()).getByText(formatCurrency(50))).toBeInTheDocument();

    const amountInputs = screen.getAllByDisplayValue(50);
    await user.clear(amountInputs[0]);
    await user.type(amountInputs[0], '200');

    expect(within(getTotalBand()).getByText(formatCurrency(200))).toBeInTheDocument();
    expect(dailyExpenseAPI.save).not.toHaveBeenCalled();
  });

  it('K13: deleting the middle row of three removes exactly that row, by identity not index', async () => {
    const items = [
      { id: 'a', category: 'misc', name: 'A', amount: 10, frequency: null },
      { id: 'b', category: 'misc', name: 'B', amount: 20, frequency: null },
      { id: 'c', category: 'misc', name: 'C', amount: 30, frequency: null },
    ];
    dailyExpenseAPI.getByMonth.mockResolvedValue({ items });
    const user = userEvent.setup();
    renderTable();
    await screen.findAllByDisplayValue('B');

    const deleteMiddleButtons = screen.getAllByLabelText('ลบ B');
    await user.click(deleteMiddleButtons[0]);

    expect(screen.queryByDisplayValue('B')).not.toBeInTheDocument();
    expect(screen.getAllByDisplayValue('A')).toHaveLength(2);
    expect(screen.getAllByDisplayValue('C')).toHaveLength(2);
  });

  it('saves via the handleSave function captured through onRegisterSave, and calls onSaved on success', async () => {
    const savedItem = { id: 'x1', category: 'misc', name: 'ทดสอบ', amount: 100, frequency: null };
    dailyExpenseAPI.getByMonth.mockResolvedValue({ items: [savedItem] });
    dailyExpenseAPI.save.mockResolvedValue(undefined);
    const onRegisterSave = jest.fn();
    const onSaved = jest.fn();
    renderTable({ onRegisterSave, onSaved });
    await screen.findAllByDisplayValue('ทดสอบ');

    expect(onRegisterSave).toHaveBeenCalled();
    const handleSave = onRegisterSave.mock.calls[onRegisterSave.mock.calls.length - 1][0];

    await act(async () => {
      await handleSave();
    });

    expect(dailyExpenseAPI.save).toHaveBeenCalledWith(SELECTED_MONTH, [savedItem]);
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it('does not call onSaved when the save call rejects', async () => {
    const savedItem = { id: 'x2', category: 'misc', name: 'ทดสอบ2', amount: 100, frequency: null };
    dailyExpenseAPI.getByMonth.mockResolvedValue({ items: [savedItem] });
    dailyExpenseAPI.save.mockRejectedValue(new Error('save failed'));
    const onRegisterSave = jest.fn();
    const onSaved = jest.fn();
    renderTable({ onRegisterSave, onSaved });
    await screen.findAllByDisplayValue('ทดสอบ2');

    const handleSave = onRegisterSave.mock.calls[onRegisterSave.mock.calls.length - 1][0];

    await act(async () => {
      await handleSave();
    });

    expect(dailyExpenseAPI.save).toHaveBeenCalledWith(SELECTED_MONTH, [savedItem]);
    expect(onSaved).not.toHaveBeenCalled();
  });
});
