/**
 * MonthManager — copy-previous-month and the OT contract (salary-ot-calculator, Increment 4)
 *
 * ครอบคลุม AC-OT-15 / BR-OT-007 / BR-OT-008 และกับดัก A-6/A-9 ที่ระดับ "payload ที่ส่งเข้า salaryAPI.save"
 * ไม่ใช่แค่ "save ถูกเรียก" เพราะความผิดพลาดทั้งสองแบบเงียบสนิท:
 *  - ใส่ overtime ผิดตำแหน่ง (ที่ 4 แทนที่ 5) → อาร์เรย์แถว OT ไปลงใน note โดยไม่มี error
 *  - ไม่ส่ง overtime เลย → เซิร์ฟเวอร์เขียน overtime: [] ทับของเดิม (A-9)
 *
 * mock เพียงโมดูลเดียวคือ apiUtils (MonthManager เรียกผ่าน dynamic import) — monthUtils/numberUtils/
 * toast/focusTrap ของจริงทั้งหมด รวมถึง stripLegacyOvertimeKeys ตัวจริง
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MonthManager from '../../src/frontend/components/MonthManager';
import {
  expenseAPI,
  incomeAPI,
  salaryAPI,
  savingsAPI,
  investmentAPI,
  dailyExpenseAPI,
} from '../../src/shared/utils/frontend/apiUtils';

jest.mock('../../src/shared/utils/frontend/apiUtils', () => ({
  expenseAPI: { getAll: jest.fn(), save: jest.fn() },
  incomeAPI: { getAll: jest.fn(), save: jest.fn() },
  salaryAPI: { getByMonth: jest.fn(), save: jest.fn() },
  savingsAPI: { getAll: jest.fn(), saveList: jest.fn() },
  investmentAPI: { getAll: jest.fn(), saveList: jest.fn() },
  dailyExpenseAPI: { getByMonth: jest.fn(), save: jest.fn() },
}));

const MONTHS = ['2026-03', '2026-02'];

// เอกสารเงินเดือนของเดือนก่อนหน้า: มีทั้งคีย์ OT แบบยอดคงที่ของเดิม (พร้อมป้ายของมัน) และแถว OT แบบใหม่
const PREV_SALARY_DOC = {
  income: {
    salary: 30000,
    bonus: 5000,
    overtime_1_5x: 3200,
    __labels: {
      salary: 'เงินเดือน',
      bonus: 'โบนัส',
      overtime_1_5x: 'ค่าล่วงเวลา 1.5 เท่า',
    },
  },
  deduct: { tax: 1500, social_security: 750 },
  note: 'เดือนก่อน',
  overtime: [
    { id: 'ot_prev_a', hours: 10, multiplier: 1.5 },
    { id: 'ot_prev_b', hours: 7.5, multiplier: 3 },
  ],
  overtimeLegacy: [
    { id: 'legacy_overtime_1_5x', key: 'overtime_1_5x', label: 'ค่าล่วงเวลา 1.5 เท่า', amount: 3200 },
  ],
  summary: { total_income: 39688, total_deduct: 2250, net_income: 37438 },
};

function mockAllReads(salaryDoc) {
  expenseAPI.getAll.mockResolvedValue({});
  incomeAPI.getAll.mockResolvedValue({});
  salaryAPI.getByMonth.mockResolvedValue(salaryDoc);
  savingsAPI.getAll.mockResolvedValue({});
  investmentAPI.getAll.mockResolvedValue({});
  dailyExpenseAPI.getByMonth.mockResolvedValue({ items: [] });

  expenseAPI.save.mockResolvedValue({ success: true });
  incomeAPI.save.mockResolvedValue({ success: true });
  salaryAPI.save.mockResolvedValue({ success: true });
  savingsAPI.saveList.mockResolvedValue({ success: true });
  investmentAPI.saveList.mockResolvedValue({ success: true });
  dailyExpenseAPI.save.mockResolvedValue({ success: true });
}

function renderPicker(props = {}) {
  return render(
    <MonthManager
      selectedMonth="2026-03"
      months={MONTHS}
      onMonthSelected={jest.fn()}
      onDataRefresh={jest.fn()}
      open
      onRequestClose={jest.fn()}
      {...props}
    />
  );
}

async function runCopyPrevMonth(user) {
  await user.click(screen.getByLabelText('คัดลอกข้อมูลจากเดือนก่อนหน้า'));
  await user.click(await screen.findByRole('button', { name: 'เขียนทับและคัดลอก' }));
  await waitFor(() => expect(salaryAPI.save).toHaveBeenCalledTimes(1));
}

afterEach(() => {
  jest.clearAllMocks();
});

describe('MonthManager — copy-previous-month OT contract', () => {
  it('AC-OT-15: copies overtime[] as the 5th argument and strips the legacy overtime_* keys and their __labels from income', async () => {
    mockAllReads(PREV_SALARY_DOC);
    const user = userEvent.setup();
    renderPicker();

    await runCopyPrevMonth(user);

    // ยืนยัน payload ทั้งก้อนแบบตรงตัว: income ไม่มี overtime_1_5x และไม่มีป้ายของมันหลงเหลือ
    // (ป้ายที่ไม่มีค่าคู่กันคือข้อมูลค้าง), note ยังอยู่ตำแหน่งที่ 4, แถว OT อยู่ตำแหน่งที่ 5
    expect(salaryAPI.save).toHaveBeenCalledWith(
      '2026-03',
      {
        salary: 30000,
        bonus: 5000,
        __labels: { salary: 'เงินเดือน', bonus: 'โบนัส' },
      },
      { tax: 1500, social_security: 750 },
      'เดือนก่อน',
      [
        { id: 'ot_prev_a', hours: 10, multiplier: 1.5 },
        { id: 'ot_prev_b', hours: 7.5, multiplier: 3 },
      ]
    );

    // อ่านจากเดือนก่อนหน้าจริง ๆ (getPrevMonth ของ 2026-03)
    expect(salaryAPI.getByMonth).toHaveBeenCalledWith('2026-02');
  });

  it('AC-OT-15 (BR-OT-007): the read-only overtimeLegacy rows are never forwarded — no argument of the call contains them', async () => {
    mockAllReads(PREV_SALARY_DOC);
    const user = userEvent.setup();
    renderPicker();

    await runCopyPrevMonth(user);

    const args = salaryAPI.save.mock.calls[0];
    expect(JSON.stringify(args)).not.toContain('overtimeLegacy');
    expect(JSON.stringify(args)).not.toContain('legacy_overtime_1_5x');
    expect(JSON.stringify(args)).not.toContain('overtime_1_5x');
    expect(JSON.stringify(args)).not.toContain('3200');
  });

  it('A-6: the OT rows never land in `note` — argument 4 is the string note, argument 5 is the array', async () => {
    mockAllReads(PREV_SALARY_DOC);
    const user = userEvent.setup();
    renderPicker();

    await runCopyPrevMonth(user);

    const args = salaryAPI.save.mock.calls[0];
    expect(args).toHaveLength(5);
    expect(typeof args[3]).toBe('string');
    expect(Array.isArray(args[4])).toBe(true);
  });

  it('A-9: a previous month with no `overtime` field still sends [] explicitly, never omits the argument', async () => {
    // เอกสารเก่าก่อนฟีเจอร์นี้ไม่มีฟิลด์ overtime เลย — ถ้าไม่ส่งอาร์กิวเมนต์ที่ 5 ค่า default จะช่วยไว้ก็จริง
    // แต่การส่ง undefined/ข้ามตำแหน่งจะทำให้กติกา "ส่งเสมอ" พังเงียบ ๆ ในวันที่ signature เปลี่ยนอีกครั้ง
    mockAllReads({ income: { salary: 30000 }, deduct: {}, note: '' });
    const user = userEvent.setup();
    renderPicker();

    await runCopyPrevMonth(user);

    expect(salaryAPI.save).toHaveBeenCalledWith('2026-03', { salary: 30000 }, {}, '', []);
  });

  it('A-9: a completely missing previous-month document still produces a well-formed 5-argument call', async () => {
    mockAllReads(null);
    const user = userEvent.setup();
    renderPicker();

    await runCopyPrevMonth(user);

    expect(salaryAPI.save).toHaveBeenCalledWith('2026-03', {}, {}, '', []);
  });

  it('AC-OT-23: create-empty-month is unchanged — it still calls save with exactly 4 arguments and the 5th defaults to []', async () => {
    mockAllReads(PREV_SALARY_DOC);
    const user = userEvent.setup();
    renderPicker();

    await user.click(screen.getByLabelText('เพิ่มเดือนใหม่'));
    await user.click(await screen.findByLabelText('เพิ่มเดือนถัดไป (2026-04)'));
    await waitFor(() => expect(salaryAPI.save).toHaveBeenCalledTimes(1));

    expect(salaryAPI.save.mock.calls[0]).toEqual(['2026-04', {}, {}, '']);
  });
});
