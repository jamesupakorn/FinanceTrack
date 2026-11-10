// D2 (loan-installments-s6): loan-only select-all / clear-all toggle (N-2 part a, Decision Q).
// UX_SPEC §J-2: a header toggle above the pill list, shown only for loans with >= 13 tickable
// rows. One state-swapping control, not two buttons — `เลือกทั้งหมด (N งวด)` when not every row
// is selected, `ล้างทั้งหมด` when all are. Credit-card dialogs never show this control.
import { fireEvent, render, screen } from '@testing-library/react';
import BackdatedInstallmentsDialog from '../../src/frontend/components/BackdatedInstallmentsDialog';
import type { TickableInstallment } from '../../src/shared/utils/installmentBackdate';

function makeRows(count: number): TickableInstallment[] {
  return Array.from({ length: count }, (_, index) => ({
    no: index + 1,
    dueMonth: '2026-01',
    payment: 1000
  }));
}

const noop = () => undefined;

describe('BackdatedInstallmentsDialog — loan-only select-all toggle (D2, Decision Q)', () => {
  it('does not render the toggle for a credit card regardless of row count', () => {
    render(
      <BackdatedInstallmentsDialog
        open
        months={20}
        currentMonthKey="2026-01"
        rows={makeRows(20)}
        busy={false}
        loanMode={false}
        onCancel={noop}
        onConfirm={noop}
      />
    );
    expect(screen.queryByRole('button', { name: /เลือกทั้งหมด|ล้างทั้งหมด/ })).not.toBeInTheDocument();
  });

  it('does not render the toggle for a loan below the row threshold (12 rows)', () => {
    render(
      <BackdatedInstallmentsDialog
        open
        months={12}
        currentMonthKey="2026-01"
        rows={makeRows(12)}
        busy={false}
        loanMode
        onCancel={noop}
        onConfirm={noop}
      />
    );
    expect(screen.queryByRole('button', { name: /เลือกทั้งหมด|ล้างทั้งหมด/ })).not.toBeInTheDocument();
  });

  it('renders the toggle for a loan at the row threshold (13 rows) with the select-all label', () => {
    render(
      <BackdatedInstallmentsDialog
        open
        months={13}
        currentMonthKey="2026-01"
        rows={makeRows(13)}
        busy={false}
        loanMode
        onCancel={noop}
        onConfirm={noop}
      />
    );
    expect(screen.getByRole('button', { name: 'เลือกทั้งหมด (13 งวด)' })).toBeInTheDocument();
  });

  it('select-all selects every tickable row, and clicking again (now ล้างทั้งหมด) clears the selection', () => {
    render(
      <BackdatedInstallmentsDialog
        open
        months={13}
        currentMonthKey="2026-01"
        rows={makeRows(13)}
        busy={false}
        loanMode
        onCancel={noop}
        onConfirm={noop}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'เลือกทั้งหมด (13 งวด)' }));
    expect(screen.getByText('ยืนยันว่าชำระแล้ว 13 จาก 13 งวด')).toBeInTheDocument();

    const clearButton = screen.getByRole('button', { name: 'ล้างทั้งหมด' });
    fireEvent.click(clearButton);
    expect(screen.getByText('ยืนยันว่าชำระแล้ว 0 จาก 13 งวด')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'เลือกทั้งหมด (13 งวด)' })).toBeInTheDocument();
  });

  it('existing per-row checkbox pills still work normally alongside the toggle', () => {
    render(
      <BackdatedInstallmentsDialog
        open
        months={13}
        currentMonthKey="2026-01"
        rows={makeRows(13)}
        busy={false}
        loanMode
        onCancel={noop}
        onConfirm={noop}
      />
    );

    const pills = screen.getAllByRole('button', { name: 'ยังไม่ชำระ — แตะเพื่อยืนยัน' });
    fireEvent.click(pills[0]);
    expect(screen.getByText('ยืนยันว่าชำระแล้ว 1 จาก 13 งวด')).toBeInTheDocument();
    // Toggle still reflects "not all selected" after a single row is ticked by hand.
    expect(screen.getByRole('button', { name: 'เลือกทั้งหมด (13 งวด)' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'เลือกทั้งหมด (13 งวด)' }));
    expect(screen.getByText('ยืนยันว่าชำระแล้ว 13 จาก 13 งวด')).toBeInTheDocument();
  });

  it('disables the toggle while busy', () => {
    render(
      <BackdatedInstallmentsDialog
        open
        months={13}
        currentMonthKey="2026-01"
        rows={makeRows(13)}
        busy
        loanMode
        onCancel={noop}
        onConfirm={noop}
      />
    );
    expect(screen.getByRole('button', { name: 'เลือกทั้งหมด (13 งวด)' })).toBeDisabled();
  });
});

// D4 (loan-installments-s6): live per-row progress line (N-2 part b, Decision S). The progress line
// replaces the pre-confirm selection-count line during a loan's sequential save — only one
// `aria-live` region is active at a time — and is loan-only (ADR-033's named mitigation for R-4).
describe('BackdatedInstallmentsDialog — live progress line (D4, Decision S)', () => {
  it('shows the progress line and advances as `progress` changes, for a loan while busy', () => {
    const { rerender } = render(
      <BackdatedInstallmentsDialog
        open
        months={5}
        currentMonthKey="2026-01"
        rows={makeRows(5)}
        busy
        loanMode
        progress={{ done: 1, total: 5 }}
        onCancel={noop}
        onConfirm={noop}
      />
    );
    expect(screen.getByText('กำลังบันทึกงวดที่ชำระแล้ว 1/5…')).toBeInTheDocument();
    // Decision S: only one aria-live region — the selection-count line is not also shown.
    expect(screen.queryByText(/ยืนยันว่าชำระแล้ว/)).not.toBeInTheDocument();

    rerender(
      <BackdatedInstallmentsDialog
        open
        months={5}
        currentMonthKey="2026-01"
        rows={makeRows(5)}
        busy
        loanMode
        progress={{ done: 5, total: 5 }}
        onCancel={noop}
        onConfirm={noop}
      />
    );
    expect(screen.getByText('กำลังบันทึกงวดที่ชำระแล้ว 5/5…')).toBeInTheDocument();
  });

  it('never shows the progress line for a credit card, even while busy with a progress prop', () => {
    render(
      <BackdatedInstallmentsDialog
        open
        months={5}
        currentMonthKey="2026-01"
        rows={makeRows(5)}
        busy
        loanMode={false}
        progress={{ done: 2, total: 5 }}
        onCancel={noop}
        onConfirm={noop}
      />
    );
    expect(screen.queryByText(/กำลังบันทึกงวดที่ชำระแล้ว/)).not.toBeInTheDocument();
    expect(screen.getByText('ยืนยันว่าชำระแล้ว 0 จาก 5 งวด')).toBeInTheDocument();
  });

  it('shows the selection-count line (not the progress line) when not busy, even for a loan', () => {
    render(
      <BackdatedInstallmentsDialog
        open
        months={5}
        currentMonthKey="2026-01"
        rows={makeRows(5)}
        busy={false}
        loanMode
        progress={{ done: 2, total: 5 }}
        onCancel={noop}
        onConfirm={noop}
      />
    );
    expect(screen.queryByText(/กำลังบันทึกงวดที่ชำระแล้ว/)).not.toBeInTheDocument();
    expect(screen.getByText('ยืนยันว่าชำระแล้ว 0 จาก 5 งวด')).toBeInTheDocument();
  });
});

// D5 (loan-installments-s6): 480-row perf smoke (N-4). R-4's worst case — a loan at
// `MAX_LOAN_INSTALLMENTS_PER_PLAN` with (near-)all rows past-due. This is a smoke check, not a
// benchmark: it confirms select-all and the progress line both still work correctly at the row
// ceiling, and that rendering/toggling 480 plain-map pills does not hang. The sequential-save
// performance itself (via `applyPaidSequentially`) is covered separately in
// `__tests__/shared/utils/installmentBackdate.test.ts`.
describe('BackdatedInstallmentsDialog — 480-row perf smoke (D5, N-4)', () => {
  it('renders 480 rows, select-all selects every row, and the progress line reaches 480/480', () => {
    const rows = makeRows(480);

    const { rerender } = render(
      <BackdatedInstallmentsDialog
        open
        months={480}
        currentMonthKey="2026-01"
        rows={rows}
        busy={false}
        loanMode
        onCancel={noop}
        onConfirm={noop}
      />
    );

    // All 480 pills rendered as a plain map (no virtualization), per the architecture review.
    expect(screen.getAllByRole('button', { name: 'ยังไม่ชำระ — แตะเพื่อยืนยัน' })).toHaveLength(480);

    // Select-all toggle picks up every row in one click.
    fireEvent.click(screen.getByRole('button', { name: 'เลือกทั้งหมด (480 งวด)' }));
    expect(screen.getByText('ยืนยันว่าชำระแล้ว 480 จาก 480 งวด')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'ล้างทั้งหมด' })).toBeInTheDocument();

    // Stubbed sequential-save progress sweeps from 1/480 to 480/480 without getting stuck.
    rerender(
      <BackdatedInstallmentsDialog
        open
        months={480}
        currentMonthKey="2026-01"
        rows={rows}
        busy
        loanMode
        progress={{ done: 1, total: 480 }}
        onCancel={noop}
        onConfirm={noop}
      />
    );
    expect(screen.getByText('กำลังบันทึกงวดที่ชำระแล้ว 1/480…')).toBeInTheDocument();

    rerender(
      <BackdatedInstallmentsDialog
        open
        months={480}
        currentMonthKey="2026-01"
        rows={rows}
        busy
        loanMode
        progress={{ done: 240, total: 480 }}
        onCancel={noop}
        onConfirm={noop}
      />
    );
    expect(screen.getByText('กำลังบันทึกงวดที่ชำระแล้ว 240/480…')).toBeInTheDocument();

    rerender(
      <BackdatedInstallmentsDialog
        open
        months={480}
        currentMonthKey="2026-01"
        rows={rows}
        busy
        loanMode
        progress={{ done: 480, total: 480 }}
        onCancel={noop}
        onConfirm={noop}
      />
    );
    expect(screen.getByText('กำลังบันทึกงวดที่ชำระแล้ว 480/480…')).toBeInTheDocument();
  });
});
