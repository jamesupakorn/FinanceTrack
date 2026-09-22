/**
 * SalaryModal — sticky footer / portal mechanism (task: save-button-sticky-footer)
 *
 * ครอบคลุมข้อจำกัด M-1..M-4 ของ spec ในระดับ DOM (jsdom) เท่าที่ตรวจได้โดยไม่ต้องมี layout engine:
 * - M-1 มีปุ่ม ล้างข้อมูล/บันทึกเงินเดือน อย่างละ 1 ตัวใน document เสมอ (ไม่มีคู่แฝดที่ซ่อนอยู่)
 * - M-2 ปุ่มทั้งสองอยู่ใน role="dialog" และอยู่ "หลัง" body region ตามลำดับ DOM (= ลำดับ Tab)
 * - M-3 handler/state ยังอยู่ที่ SalaryCalculator (กดปุ่มใน footer แล้ว salaryAPI.save ถูกเรียก)
 * - M-4 path ที่ไม่มี footerTarget ยัง render ปุ่ม inline ที่ตำแหน่งเดิม
 *
 * สิ่งที่ตรวจไม่ได้ในไฟล์นี้: geometry/scroll/hit-test/visual (AC-1..AC-4, AC-12) — ต้องเบราว์เซอร์จริง
 */

import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SalaryModal from '../../src/frontend/components/SalaryModal';
import SalaryCalculator from '../../src/frontend/components/SalaryCalculator';
import { salaryAPI, incomeAPI, taxAPI } from '../../src/shared/utils/frontend/apiUtils';
import { FOCUSABLE_SELECTOR } from '../../src/shared/utils/frontend/focusTrap';

jest.mock('../../src/shared/utils/frontend/apiUtils', () => ({
  salaryAPI: { getByMonth: jest.fn(), save: jest.fn() },
  incomeAPI: { save: jest.fn() },
  taxAPI: { updateMonthlyDeductionFields: jest.fn() },
}));

beforeAll(() => {
  Element.prototype.scrollIntoView = jest.fn();
});

beforeEach(() => {
  salaryAPI.getByMonth.mockResolvedValue({ income: {}, deduct: {} });
  salaryAPI.save.mockResolvedValue({ success: true });
  incomeAPI.save.mockResolvedValue({});
  taxAPI.updateMonthlyDeductionFields.mockResolvedValue({});
});

afterEach(() => {
  jest.clearAllMocks();
});

function getDialog() {
  return document.querySelector('[role="dialog"]');
}

function getFooter() {
  return getDialog().lastElementChild;
}

function getBody() {
  return getDialog().children[1];
}

describe('SalaryModal — sticky footer structure', () => {
  it('M-1: exactly one ล้างข้อมูล and one บันทึกเงินเดือน button exist in the document', async () => {
    render(<SalaryModal open selectedMonth="2026-01" onClose={jest.fn()} onSaved={jest.fn()} />);
    await screen.findByLabelText('บันทึกเงินเดือน');

    expect(screen.getAllByLabelText('บันทึกเงินเดือน')).toHaveLength(1);
    expect(screen.getAllByLabelText('ล้างข้อมูล')).toHaveLength(1);
    expect(document.querySelectorAll('button[aria-label="บันทึกเงินเดือน"]')).toHaveLength(1);
    expect(document.querySelectorAll('button[aria-label="ล้างข้อมูล"]')).toHaveLength(1);
  });

  it('M-1 under StrictMode double-invoke: still exactly one of each button', async () => {
    render(
      <React.StrictMode>
        <SalaryModal open selectedMonth="2026-01" onClose={jest.fn()} onSaved={jest.fn()} />
      </React.StrictMode>
    );
    await screen.findByLabelText('บันทึกเงินเดือน');

    expect(document.querySelectorAll('button[aria-label="บันทึกเงินเดือน"]')).toHaveLength(1);
    expect(document.querySelectorAll('button[aria-label="ล้างข้อมูล"]')).toHaveLength(1);
    // และยังต้องอยู่ใน footer จริง ไม่ใช่ตกค้างใน body จาก mount รอบแรกของ StrictMode
    expect(getFooter().contains(screen.getByLabelText('บันทึกเงินเดือน'))).toBe(true);
  });

  it('M-2: both buttons are inside role="dialog", in the footer, after the body in DOM order', async () => {
    render(<SalaryModal open selectedMonth="2026-01" onClose={jest.fn()} onSaved={jest.fn()} />);
    const save = await screen.findByLabelText('บันทึกเงินเดือน');
    const clear = screen.getByLabelText('ล้างข้อมูล');
    const dialog = getDialog();

    expect(dialog.contains(save)).toBe(true);
    expect(dialog.contains(clear)).toBe(true);

    const footer = getFooter();
    expect(footer.contains(save)).toBe(true);
    expect(footer.contains(clear)).toBe(true);

    const body = getBody();
    expect(body.contains(save)).toBe(false);
    // footer ตามหลัง body ตาม DOM order
    // eslint-disable-next-line no-bitwise
    expect(body.compareDocumentPosition(footer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('AC-5 (DOM-order part): footer buttons come after the last body input in document order', async () => {
    render(<SalaryModal open selectedMonth="2026-01" onClose={jest.fn()} onSaved={jest.fn()} />);
    await screen.findByLabelText('บันทึกเงินเดือน');

    const ordered = Array.from(getDialog().querySelectorAll(FOCUSABLE_SELECTOR));
    const lastBodyInputIndex = ordered.reduce(
      (acc, el, i) => (getBody().contains(el) ? i : acc),
      -1
    );
    const clearIndex = ordered.indexOf(screen.getByLabelText('ล้างข้อมูล'));
    const saveIndex = ordered.indexOf(screen.getByLabelText('บันทึกเงินเดือน'));

    expect(lastBodyInputIndex).toBeGreaterThan(-1);
    expect(clearIndex).toBeGreaterThan(lastBodyInputIndex);
    expect(saveIndex).toBeGreaterThan(clearIndex);
    // ปุ่มบันทึกเป็น element สุดท้ายที่ Tab ไปถึงใน dialog (E-8)
    expect(saveIndex).toBe(ordered.length - 1);
    // ✕ ยังเป็นตัวแรก
    expect(ordered[0]).toBe(screen.getByLabelText('ปิด'));
  });

  it('M-3: clicking the portaled save button runs SalaryCalculator handlers (React-tree event path)', async () => {
    const user = userEvent.setup();
    const onSaved = jest.fn();
    render(<SalaryModal open selectedMonth="2026-01" onClose={jest.fn()} onSaved={onSaved} />);
    const save = await screen.findByLabelText('บันทึกเงินเดือน');

    await user.click(save);

    await waitFor(() => expect(salaryAPI.save).toHaveBeenCalledTimes(1));
    // 5 arguments since the OT feature — note stays 4th ('' on every save), overtime is 5th (A-6/V-6)
    expect(salaryAPI.save).toHaveBeenCalledWith('2026-01', expect.any(Object), expect.any(Object), '', []);
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });

  it('M-3: clicking the portaled clear button clears body inputs', async () => {
    const user = userEvent.setup();
    // selectedMonth = null → ไม่มีการ load async มา reset รายการกลางคัน (เทสต์ deterministic)
    render(<SalaryModal open selectedMonth={null} onClose={jest.fn()} onSaved={jest.fn()} />);
    await screen.findByLabelText('บันทึกเงินเดือน');
    expect(salaryAPI.getByMonth).not.toHaveBeenCalled();
    // รอ initial-focus timer (setTimeout 40ms ของ SalaryModal) ยิงให้เสร็จก่อน ไม่งั้นมันจะแย่งโฟกัส
    // กลางการพิมพ์ แล้ว blur handler จะ format ค่าทิ้งกลางคัน (artifact ของเทสต์ ไม่ใช่บั๊กของโปรดักต์)
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('ปิด')));

    // แถวแรกของรายได้คือแถวเงินเดือนที่ล็อกไว้ — aria-label ของช่องจำนวนเงินเป็น `จำนวนเงินเงินเดือน`
    // (เฉพาะแถวนั้น) ไม่ใช่ `จำนวนเงินรายการรายได้` ของแถวทั่วไป (UX spec §3)
    const salaryRow = () => getBody().querySelector('[data-salary-type="income"]');
    await user.type(within(salaryRow()).getByLabelText('จำนวนเงินเงินเดือน'), '1000');
    expect(within(salaryRow()).getByLabelText('จำนวนเงินเงินเดือน')).toHaveValue('1000');

    await user.click(screen.getByLabelText('ล้างข้อมูล'));
    expect(within(salaryRow()).getByLabelText('จำนวนเงินเงินเดือน')).toHaveValue('');
  });

  it('E-7: while saving, the footer button shows กำลังบันทึก... and is disabled', async () => {
    const user = userEvent.setup();
    let resolveSave;
    salaryAPI.save.mockImplementation(() => new Promise((resolve) => { resolveSave = resolve; }));
    render(<SalaryModal open selectedMonth="2026-01" onClose={jest.fn()} onSaved={jest.fn()} />);
    const save = await screen.findByLabelText('บันทึกเงินเดือน');

    await user.click(save);

    const saving = await screen.findByText('กำลังบันทึก...');
    expect(saving.closest('button')).toBeDisabled();
    expect(getFooter().contains(saving)).toBe(true);

    resolveSave({ success: true });
    await waitFor(() => expect(screen.getByLabelText('บันทึกเงินเดือน')).not.toBeDisabled());
  });

  it('close then reopen re-portals into the fresh footer node (no stale detached target)', async () => {
    const { rerender } = render(
      <SalaryModal open selectedMonth="2026-01" onClose={jest.fn()} onSaved={jest.fn()} />
    );
    await screen.findByLabelText('บันทึกเงินเดือน');

    rerender(<SalaryModal open={false} selectedMonth="2026-01" onClose={jest.fn()} onSaved={jest.fn()} />);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.querySelectorAll('button[aria-label="บันทึกเงินเดือน"]')).toHaveLength(0);

    rerender(<SalaryModal open selectedMonth="2026-01" onClose={jest.fn()} onSaved={jest.fn()} />);
    const save = await screen.findByLabelText('บันทึกเงินเดือน');
    expect(document.querySelectorAll('button[aria-label="บันทึกเงินเดือน"]')).toHaveLength(1);
    expect(getFooter().contains(save)).toBe(true);
    expect(document.body.contains(save)).toBe(true);
  });

  it('AC-11 guard: dialog panel keeps the flex-column/overflow-hidden shell and body/footer flex classes', async () => {
    render(<SalaryModal open selectedMonth="2026-01" onClose={jest.fn()} onSaved={jest.fn()} />);
    await screen.findByLabelText('บันทึกเงินเดือน');

    const dialog = getDialog();
    expect(dialog.className).toContain('flex-col');
    expect(dialog.className).toContain('overflow-hidden');
    expect(dialog.className).toMatch(/max-h-\[95vh\]/);

    expect(dialog.children[0].className).toContain('shrink-0'); // header
    const body = getBody();
    expect(body.className).toContain('flex-1');
    expect(body.className).toContain('min-h-0');
    expect(body.className).toContain('overflow-y-auto');
    expect(getFooter().className).toContain('shrink-0');
    expect(dialog.children).toHaveLength(3); // header, body, footer
  });
});

describe('SalaryCalculator — M-4 inline path unchanged', () => {
  it('renders both buttons inline as the last child of its own column when footerTarget is absent', async () => {
    const { container } = render(<SalaryCalculator />);
    const save = screen.getByLabelText('บันทึกเงินเดือน');
    const root = container.firstElementChild;

    expect(root.lastElementChild.contains(save)).toBe(true);
    expect(document.querySelectorAll('button[aria-label="บันทึกเงินเดือน"]')).toHaveLength(1);
  });

  it('inModal without footerTarget still renders the buttons inline (no silent disappearance)', () => {
    const { container } = render(<SalaryCalculator inModal />);
    const root = container.firstElementChild;

    expect(root.lastElementChild.contains(screen.getByLabelText('บันทึกเงินเดือน'))).toBe(true);
    expect(root.lastElementChild.contains(screen.getByLabelText('ล้างข้อมูล'))).toBe(true);
  });

  it('explicit footerTarget node receives the buttons and nothing renders inline', () => {
    const target = document.createElement('div');
    document.body.appendChild(target);

    const { container } = render(<SalaryCalculator footerTarget={target} />);
    const save = screen.getByLabelText('บันทึกเงินเดือน');

    expect(target.contains(save)).toBe(true);
    expect(container.contains(save)).toBe(false);
    expect(document.querySelectorAll('button[aria-label="บันทึกเงินเดือน"]')).toHaveLength(1);

    target.remove();
  });
});
