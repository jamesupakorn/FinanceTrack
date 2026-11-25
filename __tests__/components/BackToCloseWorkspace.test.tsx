/**
 * BackToCloseWorkspace.test.tsx — D6 (I5b): useBackToClose wired into MonthManager's 4 overlays
 * (picker, add form, copy confirm, prune confirm) and TaxTable's delete-confirm dialog
 * (spec-salary-row-and-back-close.md §I5 table rows 7-11). Covers AC-SBC-50, 52, 55, 56.
 *
 * AC-SBC-51 is N/A for this dispatch: none of these 5 surfaces take a `blocked` option (the §I5
 * table lists "—" for all of them), so there is nothing to test here. Not claimed as a pass.
 *
 * Harness contract (binding, same as BackToCloseShell.test.tsx / overlayHistory.test.ts): fake
 * timers, settle ONLY through createOverlayHistoryHarness()'s bounded HISTORY_SETTLE_MS advance
 * (t.pressBack()/t.settleHistory()), and assert pop/call counts beside every negative assertion.
 *
 * AC-SBC-55 ("existing Escape/backdrop/✕ tests pass unedited") is proven by the full Jest run, not
 * by anything in this file — this file only adds Back coverage, per the "don't touch existing
 * tests" rule. `MonthManagerCreateMonth.test.tsx`/`MonthManagerOvertime.test.tsx` already cover
 * Escape/backdrop/✕ for these surfaces and are not edited here.
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import MonthManager from '../../src/frontend/components/MonthManager';
import TaxTable from '../../src/frontend/components/TaxTable';
import { expenseAPI, incomeAPI, salaryAPI, savingsAPI, investmentAPI, taxAPI } from '../../src/shared/utils/frontend/apiUtils';
import { __resetOverlayHistoryForTests } from '../../src/shared/utils/frontend/overlayHistory';
import { createOverlayHistoryHarness, type OverlayHistoryHarness } from '../helpers/overlayHistoryHarness';

jest.mock('../../src/shared/utils/frontend/apiUtils', () => ({
  expenseAPI: { getAll: jest.fn(), save: jest.fn() },
  incomeAPI: { getAll: jest.fn(), save: jest.fn() },
  salaryAPI: { getByMonth: jest.fn(), save: jest.fn(), getAll: jest.fn() },
  savingsAPI: { getAll: jest.fn(), saveList: jest.fn() },
  investmentAPI: { getAll: jest.fn(), saveList: jest.fn() },
  dailyExpenseAPI: { getByMonth: jest.fn(), save: jest.fn() },
  taxAPI: { getAll: jest.fn(), getByYear: jest.fn(), saveYearly: jest.fn(), deleteYear: jest.fn() }
}));
jest.mock('../../src/shared/utils/frontend/toast', () => ({ showToast: jest.fn() }));

const mockedExpenseAPI = jest.mocked(expenseAPI);
const mockedIncomeAPI = jest.mocked(incomeAPI);
const mockedSalaryAPI = jest.mocked(salaryAPI);
const mockedSavingsAPI = jest.mocked(savingsAPI);
const mockedInvestmentAPI = jest.mocked(investmentAPI);
const mockedTaxAPI = jest.mocked(taxAPI);

function monthRange(from: string, count: number): string[] {
  const out: string[] = [];
  let [y, m] = from.split('-').map(Number);
  for (let i = 0; i < count; i += 1) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return out.sort((a, b) => b.localeCompare(a));
}

let h: OverlayHistoryHarness | null = null;
function harness(options: { asPath?: string } = {}): OverlayHistoryHarness {
  h = createOverlayHistoryHarness(options);
  return h;
}

beforeEach(() => {
  jest.useFakeTimers({ now: new Date(2026, 9, 29, 10, 0, 0) });
  mockedExpenseAPI.save.mockResolvedValue({ success: true });
  mockedIncomeAPI.save.mockResolvedValue({ success: true });
  mockedSalaryAPI.save.mockResolvedValue({ success: true });
  mockedSavingsAPI.saveList.mockResolvedValue({ success: true });
  mockedInvestmentAPI.saveList.mockResolvedValue({ success: true });
});

afterEach(() => {
  h?.cleanup();
  h = null;
  __resetOverlayHistoryForTests();
  jest.restoreAllMocks();
  jest.useRealTimers();
});

// ---- MonthManager ------------------------------------------------------

/** Mirrors the real call site: the shell owns `open` and flips it off in onRequestClose. A
 * "shell-close" button, separate from onRequestClose, simulates the shell closing the picker
 * programmatically (not via Back) — the AC-SBC-52 3-deep case this file must cover. */
function MonthManagerHarness({ months, onRequestCloseSpy }: { months: string[]; onRequestCloseSpy: () => void }) {
  const [open, setOpen] = useState(true);
  return (
    <>
      <button type="button" onClick={() => setOpen(false)}>shell-close</button>
      <MonthManager
        selectedMonth="2026-10"
        months={months}
        onMonthSelected={jest.fn()}
        onDataRefresh={jest.fn()}
        open={open}
        onRequestClose={() => { onRequestCloseSpy(); setOpen(false); }}
      />
    </>
  );
}

describe('MonthManager picker (table row 7)', () => {
  it('AC-SBC-50: Back runs onRequestClose, no navigation', () => {
    const t = harness();
    const onRequestClose = jest.fn();
    render(<MonthManagerHarness months={['2026-10']} onRequestCloseSpy={onRequestClose} />);
    expect(screen.getByRole('dialog', { name: 'เลือกเดือน' })).toBeInTheDocument();

    expect(t.pressBack()).toBe(1);

    expect(onRequestClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog', { name: 'เลือกเดือน' })).not.toBeInTheDocument();
    expect(t.router.replace).not.toHaveBeenCalled();
  });

  it('AC-SBC-56: Escape-closing the picker releases its entry with one history.go(-1) and no double close', () => {
    const t = harness();
    const onRequestClose = jest.fn();
    render(<MonthManagerHarness months={['2026-10']} onRequestCloseSpy={onRequestClose} />);
    expect(screen.getByRole('dialog', { name: 'เลือกเดือน' })).toBeInTheDocument();

    const go = jest.spyOn(window.history, 'go');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onRequestClose).toHaveBeenCalledTimes(1);
    expect(go).toHaveBeenCalledTimes(1);

    expect(t.settleHistory()).toBe(1);
    expect(onRequestClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog', { name: 'เลือกเดือน' })).not.toBeInTheDocument();
  });
});

describe('MonthManager add form + picker (table row 8, AC-SBC-52 pair)', () => {
  it('AC-SBC-50/52: Back closes one layer at a time, top (add form) first', () => {
    const t = harness();
    const onRequestClose = jest.fn();
    render(<MonthManagerHarness months={['2026-10']} onRequestCloseSpy={onRequestClose} />);
    fireEvent.click(screen.getByLabelText('เพิ่มเดือนใหม่'));
    expect(screen.getByRole('dialog', { name: 'เพิ่มเดือนใหม่' })).toBeInTheDocument();

    // Back 1: closes the top layer (the add form) only — the picker stays open
    expect(t.pressBack()).toBe(1);
    expect(screen.queryByRole('dialog', { name: 'เพิ่มเดือนใหม่' })).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'เลือกเดือน' })).toBeInTheDocument();
    expect(onRequestClose).not.toHaveBeenCalled();

    // Back 2: closes the picker
    expect(t.pressBack()).toBe(1);
    expect(onRequestClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog', { name: 'เลือกเดือน' })).not.toBeInTheDocument();
  });
});

describe('MonthManager copy confirm + picker (table row 9, AC-SBC-52 pair)', () => {
  it('AC-SBC-50/52: Back closes one layer at a time, top (copy confirm) first', () => {
    const t = harness();
    const onRequestClose = jest.fn();
    render(<MonthManagerHarness months={['2026-10', '2026-09']} onRequestCloseSpy={onRequestClose} />);
    fireEvent.click(screen.getByLabelText('คัดลอกข้อมูลจากเดือนก่อนหน้า'));
    expect(screen.getByRole('alertdialog', { name: 'เขียนทับข้อมูลเดือนนี้?' })).toBeInTheDocument();

    // Back 1: closes the top layer (the copy confirm) only — the picker stays open
    expect(t.pressBack()).toBe(1);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'เลือกเดือน' })).toBeInTheDocument();
    expect(onRequestClose).not.toHaveBeenCalled();

    // Back 2: closes the picker
    expect(t.pressBack()).toBe(1);
    expect(onRequestClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog', { name: 'เลือกเดือน' })).not.toBeInTheDocument();
  });
});

describe('MonthManager prune confirm + add form + picker (table row 10, AC-SBC-52 triple)', () => {
  it('AC-SBC-50/52: three Back presses peel prune confirm, then add form, then picker — one layer per press', () => {
    const t = harness();
    const onRequestClose = jest.fn();
    const months = monthRange('2025-08', 15); // at the 15-month window limit
    render(<MonthManagerHarness months={months} onRequestCloseSpy={onRequestClose} />);
    fireEvent.click(screen.getByLabelText('เพิ่มเดือนใหม่'));
    fireEvent.click(screen.getByRole('button', { name: 'เพิ่มเดือนถัดไป (2026-11)' }));
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();

    // Back 1: closes the top layer (prune confirm) only — add form and picker stay open
    expect(t.pressBack()).toBe(1);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'เพิ่มเดือนใหม่' })).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'เลือกเดือน' })).toBeInTheDocument();

    // Back 2: closes the add form — picker stays open
    expect(t.pressBack()).toBe(1);
    expect(screen.queryByRole('dialog', { name: 'เพิ่มเดือนใหม่' })).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'เลือกเดือน' })).toBeInTheDocument();
    expect(onRequestClose).not.toHaveBeenCalled();

    // Back 3: closes the picker
    expect(t.pressBack()).toBe(1);
    expect(onRequestClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog', { name: 'เลือกเดือน' })).not.toBeInTheDocument();
  });

  it('AC-SBC-52 (architecture-review.md Check 2, 3-deep case): the shell closing the picker programmatically while add form + prune confirm are also open collapses to exactly one history.go(-3) and zero onBack calls', () => {
    const t = harness();
    const onRequestClose = jest.fn();
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
    const months = monthRange('2025-08', 15); // at the 15-month window limit
    render(<MonthManagerHarness months={months} onRequestCloseSpy={onRequestClose} />);
    fireEvent.click(screen.getByLabelText('เพิ่มเดือนใหม่'));
    fireEvent.click(screen.getByRole('button', { name: 'เพิ่มเดือนถัดไป (2026-11)' }));
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'เพิ่มเดือนใหม่' })).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'เลือกเดือน' })).toBeInTheDocument();

    const go = jest.spyOn(window.history, 'go');
    // the shell closes the picker directly (not via onRequestClose/Back) — all three open conditions
    // (`open`, `open && showAddForm`, `open && showPruneConfirm`) recompute false in the same commit
    fireEvent.click(screen.getByRole('button', { name: 'shell-close' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(go).toHaveBeenCalledTimes(1);
    expect(go).toHaveBeenCalledWith(-3);
    // onBack is never called on a programmatic release (R-SBC-8/architecture-review.md Check 2) —
    // none of our own close callbacks ran a second time, and no "update on unmounted component"
    // warning fired from a stray onBack-driven setState after MonthManager unmounted
    expect(onRequestClose).not.toHaveBeenCalled();

    expect(t.settleHistory()).toBe(1);
    expect(go).toHaveBeenCalledTimes(1);
    expect(onRequestClose).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });
});

// ---- TaxTable -----------------------------------------------------------

const TAX_YEAR = '2026';

function renderTaxTable() {
  mockedTaxAPI.getAll.mockResolvedValue({ tax_by_year: { [TAX_YEAR]: {} } });
  mockedTaxAPI.getByYear.mockResolvedValue({
    [TAX_YEAR]: { monthly_tax: {}, monthly_income: {}, monthly_provident: {} }
  });
  return render(<TaxTable />);
}

describe('TaxTable delete-confirm dialog (table row 11)', () => {
  it('AC-SBC-50: Back runs setConfirmDeleteOpen(false), no navigation', async () => {
    const t = harness();
    renderTaxTable();
    const yearBE = parseInt(TAX_YEAR) + 543;
    await act(async () => { await Promise.resolve(); });
    fireEvent.click(await screen.findByRole('button', { name: `ลบข้อมูลปี พ.ศ. ${yearBE}` }));
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();

    expect(t.pressBack()).toBe(1);

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(t.router.replace).not.toHaveBeenCalled();
  });

  it('AC-SBC-56: Escape-closing the dialog releases its entry with one history.go(-1) and no double close', async () => {
    const t = harness();
    renderTaxTable();
    const yearBE = parseInt(TAX_YEAR) + 543;
    await act(async () => { await Promise.resolve(); });
    fireEvent.click(await screen.findByRole('button', { name: `ลบข้อมูลปี พ.ศ. ${yearBE}` }));
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();

    const go = jest.spyOn(window.history, 'go');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(go).toHaveBeenCalledTimes(1);

    expect(t.settleHistory()).toBe(1);
    expect(go).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });
});
