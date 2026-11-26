/**
 * SavingsTable S1 (spec-savings-table-ux-fixes.md): load error + retry + data-loss guard.
 * Covers AC-STU-01..06. Modeled on InvestmentTable.test.tsx's "load error" suite.
 * No ListViewContext provider needed — useListCriteria falls back to local state
 * when there's no store (ListViewContext.tsx:11-19).
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import SavingsTable from '../../src/frontend/components/SavingsTable';
import { savingsAPI, savingsGoalsAPI } from '../../src/shared/utils/frontend/apiUtils';

jest.mock('../../src/shared/utils/frontend/apiUtils', () => ({
  savingsAPI: { getByMonth: jest.fn(), saveList: jest.fn() },
  savingsGoalsAPI: { getAll: jest.fn() }
}));
jest.mock('../../src/shared/utils/frontend/toast', () => ({ showToast: jest.fn() }));

const api = jest.mocked(savingsAPI);
const goalsApi = jest.mocked(savingsGoalsAPI);
const MONTH = '2026-08';

beforeEach(() => {
  jest.clearAllMocks();
  Element.prototype.scrollIntoView = jest.fn();
  api.getByMonth.mockResolvedValue({ savings_list: [] } as never);
  api.saveList.mockResolvedValue({ success: true } as never);
  goalsApi.getAll.mockResolvedValue({ goals: [] } as never);
});

describe('load error', () => {
  it('AC-STU-01: shows an alert with retry and no LoadingNotice once the fetch rejects', async () => {
    const log = jest.spyOn(console, 'error').mockImplementation(() => {});
    api.getByMonth.mockRejectedValueOnce(new Error('network'));
    render(<SavingsTable selectedMonth={MONTH} />);

    expect(await screen.findByRole('alert')).toHaveTextContent('โหลดรายการเงินออมไม่สำเร็จ');
    expect(screen.getByRole('button', { name: 'ลองอีกครั้ง' })).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });

  it('AC-STU-02: hides the add button, ListToolbar, row fields, and empty-state text in the error state', async () => {
    api.getByMonth.mockRejectedValueOnce(new Error('network'));
    render(<SavingsTable selectedMonth={MONTH} />);

    await screen.findByRole('alert');
    expect(screen.queryByRole('button', { name: '+ เพิ่มรายการ' })).not.toBeInTheDocument();
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('ประเภทเงินออม')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('จำนวนเงินออม')).not.toBeInTheDocument();
    expect(screen.queryByText('ยังไม่มีรายการเงินออมในเดือนนี้ กด "เพิ่มรายการ" เพื่อเริ่มต้น')).not.toBeInTheDocument();
  });

  it('AC-STU-03: clicking retry calls getByMonth again with the same month, and a resolved retry clears the alert', async () => {
    api.getByMonth.mockRejectedValueOnce(new Error('network'));
    render(<SavingsTable selectedMonth={MONTH} />);
    await screen.findByRole('alert');

    api.getByMonth.mockResolvedValueOnce({ savings_list: [] } as never);
    fireEvent.click(screen.getByRole('button', { name: 'ลองอีกครั้ง' }));

    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    expect(api.getByMonth).toHaveBeenCalledTimes(2);
    expect(api.getByMonth).toHaveBeenLastCalledWith(MONTH);
    expect(screen.getByRole('button', { name: '+ เพิ่มรายการ' })).toBeInTheDocument();
  });

  it('AC-STU-04: if the retry rejects again, the alert is in the DOM again', async () => {
    const log = jest.spyOn(console, 'error').mockImplementation(() => {});
    api.getByMonth.mockRejectedValueOnce(new Error('network'));
    render(<SavingsTable selectedMonth={MONTH} />);
    await screen.findByRole('alert');

    api.getByMonth.mockRejectedValueOnce(new Error('network again'));
    fireEvent.click(screen.getByRole('button', { name: 'ลองอีกครั้ง' }));

    await waitFor(() => expect(api.getByMonth).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole('alert')).toHaveTextContent('โหลดรายการเงินออมไม่สำเร็จ');
    log.mockRestore();
  });

  it('AC-STU-05: after a load error, the registered save handler does not save or call onSaved', async () => {
    api.getByMonth.mockRejectedValueOnce(new Error('network'));
    const onSaved = jest.fn();
    let saveHandler: (() => Promise<void>) | null = null;
    render(
      <SavingsTable
        selectedMonth={MONTH}
        onSaved={onSaved}
        onRegisterSave={(handler) => { saveHandler = handler; }}
      />
    );
    await screen.findByRole('alert');

    expect(saveHandler).not.toBeNull();
    await saveHandler!();

    expect(api.saveList).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('AC-STU-06: on a successful load, behavior is unchanged — no alert, add button present, rows render', async () => {
    api.getByMonth.mockResolvedValueOnce({
      savings_list: [{ id: 'a', savings_type: 'ทริปญี่ปุ่น', savings_amount: 1000 }]
    } as never);
    render(<SavingsTable selectedMonth={MONTH} />);

    // ทั้ง md+ table และ base-tier card เรนเดอร์คู่กันเสมอ (ซ่อนด้วย CSS ไม่ใช่ conditional render)
    expect((await screen.findAllByDisplayValue('ทริปญี่ปุ่น')).length).toBeGreaterThan(0);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '+ เพิ่มรายการ' })).toBeInTheDocument();
  });
});

describe('toolbar gate and accessible names (S2)', () => {
  it('AC-STU-07: with 0 rows loaded, ListToolbar is absent while the add button and empty-state text show', async () => {
    api.getByMonth.mockResolvedValueOnce({ savings_list: [] } as never);
    render(<SavingsTable selectedMonth={MONTH} />);

    await screen.findByText('ยังไม่มีรายการเงินออมในเดือนนี้ กด "เพิ่มรายการ" เพื่อเริ่มต้น');
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '+ เพิ่มรายการ' })).toBeInTheDocument();
  });

  it('AC-STU-08: with at least 1 row loaded, ListToolbar is present', async () => {
    api.getByMonth.mockResolvedValueOnce({
      savings_list: [{ id: 'a', savings_type: 'ทริปญี่ปุ่น', savings_amount: 1000 }]
    } as never);
    render(<SavingsTable selectedMonth={MONTH} />);

    await screen.findAllByDisplayValue('ทริปญี่ปุ่น');
    expect(screen.getByRole('searchbox')).toBeInTheDocument();
  });

  it('AC-STU-09: ListToolbar appears after adding the first row to an empty month, and disappears after deleting the last row', async () => {
    api.getByMonth.mockResolvedValueOnce({ savings_list: [] } as never);
    render(<SavingsTable selectedMonth={MONTH} />);

    await screen.findByText('ยังไม่มีรายการเงินออมในเดือนนี้ กด "เพิ่มรายการ" เพื่อเริ่มต้น');
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '+ เพิ่มรายการ' }));
    expect(await screen.findByRole('searchbox')).toBeInTheDocument();

    const deleteButtons = screen.getAllByRole('button', { name: `ลบ ${'เงินออมใหม่'}` });
    fireEvent.click(deleteButtons[0]);

    await waitFor(() => expect(screen.queryByRole('searchbox')).not.toBeInTheDocument());
  });

  it('AC-STU-10: the select and input accessible names include the row name, in both table and card markup', async () => {
    api.getByMonth.mockResolvedValueOnce({
      savings_list: [{ id: 'a', savings_type: 'ทริปญี่ปุ่น', savings_amount: 1000 }]
    } as never);
    render(<SavingsTable selectedMonth={MONTH} />);

    await screen.findAllByDisplayValue('ทริปญี่ปุ่น');
    expect(screen.getAllByLabelText('ประเภทเงินออม ทริปญี่ปุ่น')).toHaveLength(2);
    expect(screen.getAllByLabelText('จำนวนเงินออม ทริปญี่ปุ่น')).toHaveLength(2);
  });

  it('AC-STU-11: a row with an empty savings_type falls back to NAME_FALLBACK in the accessible names', async () => {
    api.getByMonth.mockResolvedValueOnce({
      savings_list: [{ id: 'a', savings_type: '', savings_amount: 500 }]
    } as never);
    render(<SavingsTable selectedMonth={MONTH} />);

    await screen.findAllByLabelText('ประเภทเงินออม เงินออมใหม่');
    expect(screen.getAllByLabelText('ประเภทเงินออม เงินออมใหม่')).toHaveLength(2);
    expect(screen.getAllByLabelText('จำนวนเงินออม เงินออมใหม่')).toHaveLength(2);
  });

  it('AC-STU-12: changing a row category updates the accessible names to the new name', async () => {
    api.getByMonth.mockResolvedValueOnce({
      savings_list: [{ id: 'a', savings_type: 'ทริปญี่ปุ่น', savings_amount: 1000 }]
    } as never);
    goalsApi.getAll.mockResolvedValueOnce({ goals: [{ goalName: 'บ้าน' }] } as never);
    render(<SavingsTable selectedMonth={MONTH} />);

    await screen.findAllByDisplayValue('ทริปญี่ปุ่น');
    const selects = screen.getAllByLabelText('ประเภทเงินออม ทริปญี่ปุ่น');
    fireEvent.change(selects[0], { target: { value: 'บ้าน' } });

    expect(await screen.findAllByLabelText('ประเภทเงินออม บ้าน')).toHaveLength(2);
    expect(await screen.findAllByLabelText('จำนวนเงินออม บ้าน')).toHaveLength(2);
  });
});

describe('save-timing caption (S3)', () => {
  const CAPTION = 'แก้ไขรายการแล้วกดปุ่มบันทึกที่มุมขวาล่างเพื่อบันทึก';

  it('AC-STU-13: with 0 rows loaded, the save-timing caption is absent', async () => {
    api.getByMonth.mockResolvedValueOnce({ savings_list: [] } as never);
    render(<SavingsTable selectedMonth={MONTH} />);

    await screen.findByText('ยังไม่มีรายการเงินออมในเดือนนี้ กด "เพิ่มรายการ" เพื่อเริ่มต้น');
    expect(screen.queryByText(CAPTION)).not.toBeInTheDocument();
  });

  it('AC-STU-13: with at least 1 row loaded, the save-timing caption shows', async () => {
    api.getByMonth.mockResolvedValueOnce({
      savings_list: [{ id: 'a', savings_type: 'ทริปญี่ปุ่น', savings_amount: 1000 }]
    } as never);
    render(<SavingsTable selectedMonth={MONTH} />);

    await screen.findAllByDisplayValue('ทริปญี่ปุ่น');
    expect(screen.getByText(CAPTION)).toBeInTheDocument();
  });

  it('AC-STU-13: the caption is absent in the load-error state', async () => {
    api.getByMonth.mockRejectedValueOnce(new Error('network'));
    render(<SavingsTable selectedMonth={MONTH} />);

    await screen.findByRole('alert');
    expect(screen.queryByText(CAPTION)).not.toBeInTheDocument();
  });
});
