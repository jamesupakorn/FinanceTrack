// spec-dashboard-upcoming-click-to-view-s1 §Acceptance Criteria AC-10..AC-15 (expense-receiver slice, S1)
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ExpenseTable from '../../src/frontend/components/ExpenseTable';
import { expenseAPI, creditCardAPI } from '../../src/shared/utils/frontend/apiUtils';

jest.mock('../../src/shared/utils/frontend/apiUtils', () => ({
  expenseAPI: { getByMonth: jest.fn(), setPaid: jest.fn() },
  creditCardAPI: { getMonthInstallments: jest.fn(), getRevolving: jest.fn() },
  withCsrfHeaders: (h: unknown) => h,
}));
jest.mock('../../src/shared/utils/frontend/toast', () => ({ showToast: jest.fn() }));
jest.mock('../../src/frontend/contexts/SessionContext', () => {
  const session = { currentUser: { id: 'u1', bankAccounts: ['กรุงศรี'] } };
  return { useSession: () => session };
});

const api = jest.mocked(expenseAPI);
const cards = jest.mocked(creditCardAPI);
const MONTH = '2026-08';
const OTHER_MONTH = '2026-09';

const rows = {
  coffee: { name: 'กาแฟ', actual: 50, account: 'กรุงศรี', paid: false, dueDay: 'EOM' },
  tea: { name: 'ชา', actual: 20, account: 'กรุงศรี', paid: false, dueDay: 'EOM' },
};

// jsdom ไม่ implement scrollIntoView จริง — mock บน prototype เพื่อให้ element ไหนก็เรียกได้ และตรวจ instance ที่ถูกเรียกได้
beforeEach(() => {
  Element.prototype.scrollIntoView = jest.fn();
  api.getByMonth.mockResolvedValue(rows as never);
  cards.getMonthInstallments.mockResolvedValue([] as never);
  cards.getRevolving.mockResolvedValue(null as never);
});

afterEach(() => { jest.clearAllMocks(); jest.useRealTimers(); });

// jsdom ไม่คำนวณ layout จริง — offsetParent เป็น null เสมอ ทำให้ tryScroll's `targets.find(... offsetParent !== null) || targets[0]`
// ตกไปที่ targets[0] เสมอ ซึ่งคือ <tr> เดสก์ท็อป (เรนเดอร์ก่อน <div> มือถือใน JSX) — ยืนยันด้วย tagName ด้านล่าง
const desktopRow = (key: string) => document.querySelectorAll<HTMLElement>(`[data-expense-key="${key}"]`)[0];

describe('ExpenseTable arrival focus (dashboard-upcoming-click-to-view S1)', () => {
  it('AC-10: scrolls to and focuses the matching row (no input focused) when focusMonth matches the loaded month', async () => {
    const onFocusHandled = jest.fn();
    render(<ExpenseTable selectedMonth={MONTH} focusKey="coffee" focusMonth={MONTH} onFocusHandled={onFocusHandled} />);

    await waitFor(() => expect(desktopRow('coffee')).toBeTruthy());
    const row = desktopRow('coffee');
    expect(row.tagName).toBe('TR');

    await waitFor(() => expect(document.activeElement).toBe(row));
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
    expect((Element.prototype.scrollIntoView as jest.Mock).mock.instances).toContain(row);
    // F-9: ต้องไม่โฟกัส input[type=text] ของแถว (จะเปิดคีย์บอร์ดมือถือ)
    expect(document.activeElement?.tagName).not.toBe('INPUT');
    await waitFor(() => expect(onFocusHandled).toHaveBeenCalledTimes(1));
  });

  it('AC-11: highlights the row with outline classes, which clear after 4000ms while focus/tabIndex persist', async () => {
    jest.useFakeTimers();
    render(<ExpenseTable selectedMonth={MONTH} focusKey="coffee" focusMonth={MONTH} />);
    // ไม่ใช้ waitFor (ใช้ setTimeout จริงภายใน polling) เพราะ fake timers ครอบ setTimeout ไว้แล้ว — flush microtask ของ
    // promise (api.getByMonth) ด้วย act(async) ธรรมดาแทน
    await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });

    const row = desktopRow('coffee');
    expect(row).toBeTruthy();
    expect(row).toHaveAttribute('tabindex', '-1');
    expect(row.className).toMatch(/outline-accent/);
    expect(document.activeElement).toBe(row);

    act(() => { jest.advanceTimersByTime(4000); });

    expect(row.className).not.toMatch(/outline-accent/);
    // F-3: tabIndex ต้องคงอยู่แม้ highlight เคลียร์แล้ว ไม่เช่นนั้นโฟกัสจะหลุดไป <body> ตามกฎ focus-fixup ของ HTML
    expect(row).toHaveAttribute('tabindex', '-1');
    expect(document.activeElement).toBe(row);
  });

  it('AC-12: does nothing and calls onFocusHandled once when focusMonth does not match the loaded month', async () => {
    const onFocusHandled = jest.fn();
    render(<ExpenseTable selectedMonth={MONTH} focusKey="coffee" focusMonth={OTHER_MONTH} onFocusHandled={onFocusHandled} />);

    await waitFor(() => expect(desktopRow('coffee')).toBeTruthy());
    await waitFor(() => expect(onFocusHandled).toHaveBeenCalledTimes(1));
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
    expect(document.activeElement).not.toBe(desktopRow('coffee'));
  });

  it('AC-13: silent no-op (no scroll, criteria untouched) when the key is missing from the loaded data, and onFocusHandled fires once', async () => {
    const onFocusHandled = jest.fn();
    render(<ExpenseTable selectedMonth={MONTH} focusKey="does_not_exist" focusMonth={MONTH} onFocusHandled={onFocusHandled} />);

    await waitFor(() => expect(desktopRow('coffee')).toBeTruthy());
    await waitFor(() => expect(onFocusHandled).toHaveBeenCalledTimes(1));
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
    // KL-1: ไม่มีการแก้ filter ของผู้ใช้ — กล่องค้นหายังว่างเหมือนเดิม
    expect(screen.getByPlaceholderText('ค้นหารายการค่าใช้จ่าย…')).toHaveValue('');

    // พิมพ์ในแถวอื่นหลังจากนั้นต้องไม่ trigger scroll อีก (ค้างด้วย handledFocusRef)
    const user = userEvent.setup();
    const teaInput = desktopRow('tea').querySelector('input[type="text"]') as HTMLInputElement;
    await user.clear(teaInput);
    await user.type(teaInput, 'ชาเขียว');
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
  });

  it('AC-14 (regression): the add-row flow still focuses the new row name input', async () => {
    render(<ExpenseTable selectedMonth={MONTH} />);
    await waitFor(() => expect(desktopRow('coffee')).toBeTruthy());

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: '+ เพิ่มรายการค่าใช้จ่าย' }));

    await waitFor(() => expect(document.activeElement?.tagName).toBe('INPUT'));
    expect((document.activeElement as HTMLInputElement).type).toBe('text');
  });

  it('AC-15: with no focusKey, renders and behaves as before (no scroll/focus side effects)', async () => {
    render(<ExpenseTable selectedMonth={MONTH} />);
    await waitFor(() => expect(desktopRow('coffee')).toBeTruthy());
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
    expect(desktopRow('coffee')).not.toHaveAttribute('tabindex');
  });
});
