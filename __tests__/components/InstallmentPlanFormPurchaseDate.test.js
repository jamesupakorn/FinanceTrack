/**
 * Stage 4 (tester) — InstallmentPlanForm purchase-date wiring (task: credit-card-purchase-date-cycle)
 *
 * jsdom covers the behavioural half of the "manual" form ACs (AC-PD-30/31/33/34/36/37/39) plus the
 * C-2 guard and the N-1 card-change path. Layout/overflow at 375px (AC-PD-38) and iOS Safari's native
 * date control still need a real browser.
 *
 * "Today" is pinned to 2026-10-17 03:00 local — inside the 00:00–06:59 window where a toISOString()
 * shortcut would return the previous day in Asia/Bangkok (R-3).
 */

import { render, screen, fireEvent } from '@testing-library/react';
import InstallmentPlanForm from '../../src/frontend/components/InstallmentPlanForm';

jest.mock('../../src/shared/utils/frontend/toast', () => ({ showToast: jest.fn() }));

const CARD_5 = { id: 'c5', name: 'บัตรห้า', statementDay: 5, dueDay: 25, creditLimit: 50000 };
const CARD_25 = { id: 'c25', name: 'บัตรยี่สิบห้า', statementDay: 25, dueDay: 10, creditLimit: 50000 };
const CARD_EOM = { id: 'ceom', name: 'บัตรสิ้นเดือน', statementDay: 'EOM', dueDay: 15, creditLimit: 50000 };

const dateInput = () => document.querySelector('[name="purchaseDate"]');
const cycleSelect = () => document.querySelector('[name="startMonth"]');

function basePlan(overrides = {}) {
  return {
    id: 'ccp_000000000001',
    cardId: 'c5',
    itemName: 'ของเดิม',
    totalPrice: 3000,
    months: 3,
    startMonth: '2026-10',
    interestMode: 'manual',
    manualFeePerMonth: 0,
    schedule: [
      { installmentNo: 1, dueMonth: '2026-10', paid: false },
      { installmentNo: 2, dueMonth: '2026-11', paid: false },
      { installmentNo: 3, dueMonth: '2026-12', paid: false }
    ],
    ...overrides
  };
}

beforeEach(() => {
  jest.useFakeTimers({
    now: new Date(2026, 9, 17, 3, 0, 0),
    doNotFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'queueMicrotask', 'nextTick']
  });
});

afterEach(() => {
  jest.useRealTimers();
});

describe('InstallmentPlanForm — new plan', () => {
  it('AC-PD-30: date defaults to local today and cycle is computed (statementDay 5 → next month)', () => {
    render(<InstallmentPlanForm open cards={[CARD_5]} onClose={jest.fn()} onSubmit={jest.fn()} />);
    expect(dateInput().value).toBe('2026-10-17');
    expect(cycleSelect().value).toBe('2026-11');
  });

  it('AC-PD-31: changing the date across statementDay recomputes the cycle', () => {
    render(<InstallmentPlanForm open cards={[CARD_5]} onClose={jest.fn()} onSubmit={jest.fn()} />);
    fireEvent.change(dateInput(), { target: { value: '2026-10-03' } });
    expect(cycleSelect().value).toBe('2026-10');
  });

  it('N-1: a later date change replaces an earlier manual override (latest action wins)', () => {
    render(<InstallmentPlanForm open cards={[CARD_5]} onClose={jest.fn()} onSubmit={jest.fn()} />);
    fireEvent.change(cycleSelect(), { target: { value: '2026-12' } });
    expect(cycleSelect().value).toBe('2026-12');
    fireEvent.change(dateInput(), { target: { value: '2026-10-20' } });
    expect(cycleSelect().value).toBe('2026-11');
  });

  it('N-1: changing the card (not locked) recomputes with the new card statementDay', () => {
    render(<InstallmentPlanForm open cards={[CARD_5, CARD_25]} onClose={jest.fn()} onSubmit={jest.fn()} />);
    expect(cycleSelect().value).toBe('2026-11');
    fireEvent.change(document.querySelector('[name="cardId"]'), { target: { value: 'c25' } });
    expect(cycleSelect().value).toBe('2026-10');
  });

  it('edge 36: clearing the date keeps the current cycle (no clear on uncomputable input)', () => {
    render(<InstallmentPlanForm open cards={[CARD_5]} onClose={jest.fn()} onSubmit={jest.fn()} />);
    fireEvent.change(dateInput(), { target: { value: '' } });
    expect(dateInput().value).toBe('');
    expect(cycleSelect().value).toBe('2026-11');
  });

  it('AC-PD-35: EOM card keeps the purchase month even on the 31st', () => {
    render(<InstallmentPlanForm open cards={[CARD_EOM]} onClose={jest.fn()} onSubmit={jest.fn()} />);
    expect(cycleSelect().value).toBe('2026-10');
    fireEvent.change(dateInput(), { target: { value: '2026-10-31' } });
    expect(cycleSelect().value).toBe('2026-10');
  });

  it('AC-PD-34: a purchase >12 months ago adds its cycle to the options and selects it', () => {
    render(<InstallmentPlanForm open cards={[CARD_5]} onClose={jest.fn()} onSubmit={jest.fn()} />);
    fireEvent.change(dateInput(), { target: { value: '2024-01-10' } });
    expect(cycleSelect().value).toBe('2024-02');
    const values = Array.from(cycleSelect().options).map(option => option.value);
    expect(values).toContain('2024-02');
    expect(values).toEqual([...values].sort());
    expect(cycleSelect().selectedOptions[0].value).toBe('2024-02');
  });

  it('AC-PD-36: cleared date on a new plan blocks submit with inline error and focuses the date input', () => {
    const onSubmit = jest.fn();
    render(<InstallmentPlanForm open cards={[CARD_5]} onClose={jest.fn()} onSubmit={onSubmit} />);
    fireEvent.change(document.querySelector('[name="itemName"]'), { target: { value: 'ทีวี' } });
    fireEvent.change(document.querySelector('[name="totalPrice"]'), { target: { value: '1000' } });
    fireEvent.change(document.querySelector('[name="annualRate"]'), { target: { value: '0' } });
    fireEvent.change(dateInput(), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'บันทึกแผนผ่อน' }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText('กรุณาเลือกวันที่ซื้อ')).toBeInTheDocument();
    expect(document.activeElement).toBe(dateInput());
    expect(dateInput().getAttribute('aria-invalid')).toBe('true');
  });

  it('C-1: a valid new plan submits purchaseDate together with the computed startMonth', () => {
    const onSubmit = jest.fn();
    render(<InstallmentPlanForm open cards={[CARD_5]} onClose={jest.fn()} onSubmit={onSubmit} />);
    fireEvent.change(document.querySelector('[name="itemName"]'), { target: { value: 'ทีวี' } });
    fireEvent.change(document.querySelector('[name="totalPrice"]'), { target: { value: '1000' } });
    fireEvent.change(document.querySelector('[name="annualRate"]'), { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: 'บันทึกแผนผ่อน' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ purchaseDate: '2026-10-17', startMonth: '2026-11' });
  });

  it('AC-PD-39: helper text matches UX §4 and both controls reference it', () => {
    render(<InstallmentPlanForm open cards={[CARD_5]} onClose={jest.fn()} onSubmit={jest.fn()} />);
    const help = document.getElementById('ip-cycle-help');
    expect(help.textContent).toBe(
      'คำนวณจากวันสรุปยอดของบัตร (วันที่ 5) — ซื้อหลังวันสรุปยอดจะไปรอบบิลเดือนถัดไป เปลี่ยนเองได้ถ้าธนาคารตัดรอบต่างจากนี้'
    );
    expect(dateInput().getAttribute('aria-describedby')).toContain('ip-cycle-help');
    expect(cycleSelect().getAttribute('aria-describedby')).toContain('ip-cycle-help');
    expect(dateInput().getAttribute('aria-required')).toBe('true');
    expect(dateInput().hasAttribute('required')).toBe(false);
  });

  it('AC-PD-39: EOM card helper says (สิ้นเดือน)', () => {
    render(<InstallmentPlanForm open cards={[CARD_EOM]} onClose={jest.fn()} onSubmit={jest.fn()} />);
    expect(document.getElementById('ip-cycle-help').textContent).toContain('(สิ้นเดือน)');
  });
});

describe('InstallmentPlanForm — editing an existing plan', () => {
  it('AC-PD-33: opening a dated plan shows stored values with no recompute on load', () => {
    const plan = basePlan({ purchaseDate: '2026-10-03', startMonth: '2026-12' });
    render(<InstallmentPlanForm open plan={plan} lockedCardId="c5" cards={[CARD_5]} onClose={jest.fn()} onSubmit={jest.fn()} />);
    expect(dateInput().value).toBe('2026-10-03');
    expect(cycleSelect().value).toBe('2026-12');
  });

  it('C-2: on a plan with a stored purchaseDate, editing the date does not move startMonth', () => {
    const plan = basePlan({ purchaseDate: '2026-10-03', startMonth: '2026-10' });
    render(<InstallmentPlanForm open plan={plan} lockedCardId="c5" cards={[CARD_5]} onClose={jest.fn()} onSubmit={jest.fn()} />);
    fireEvent.change(dateInput(), { target: { value: '2026-10-20' } });
    expect(dateInput().value).toBe('2026-10-20');
    expect(cycleSelect().value).toBe('2026-10');
  });

  it('legacy unpaid plan: date empty, not required, legacy helper line shown, saves with empty date', () => {
    const onSubmit = jest.fn();
    render(<InstallmentPlanForm open plan={basePlan()} lockedCardId="c5" cards={[CARD_5]} onClose={jest.fn()} onSubmit={onSubmit} />);
    expect(dateInput().value).toBe('');
    expect(dateInput().hasAttribute('aria-required')).toBe(false);
    expect(document.getElementById('ip-cycle-help').textContent).toContain('แผนนี้สร้างก่อนมีช่องวันที่ซื้อ จะใส่หรือเว้นว่างไว้ก็ได้');
    fireEvent.click(screen.getByRole('button', { name: 'บันทึกแผนผ่อน' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ purchaseDate: '', startMonth: '2026-10' });
  });

  // M-1 fix verification: back-filling a date on a legacy unpaid plan must NOT recompute
  // startMonth (the F-1 schedule-shift the user explicitly vetoed). The guard was corrected from
  // `if (plan && plan.purchaseDate) return next;` to `if (plan) return next;` — any existing plan
  // (legacy or already-dated) skips recompute; only a brand-new plan (no `plan` prop) recomputes.
  it('F-1 fix: back-filling a date on a legacy unpaid plan does not recompute startMonth', () => {
    render(<InstallmentPlanForm open plan={basePlan()} lockedCardId="c5" cards={[CARD_5]} onClose={jest.fn()} onSubmit={jest.fn()} />);
    expect(cycleSelect().value).toBe('2026-10');
    fireEvent.change(dateInput(), { target: { value: '2026-10-20' } });
    expect(cycleSelect().value).toBe('2026-10');
  });

  it('AC-PD-37: locked plan with purchaseDate shows two read-only tiles', () => {
    const plan = basePlan({
      purchaseDate: '2026-10-03',
      schedule: [{ installmentNo: 1, dueMonth: '2026-10', paid: true }, { installmentNo: 2, dueMonth: '2026-11', paid: false }]
    });
    render(<InstallmentPlanForm open plan={plan} lockedCardId="c5" cards={[CARD_5]} onClose={jest.fn()} onSubmit={jest.fn()} />);
    expect(dateInput()).toBeNull();
    expect(cycleSelect()).toBeNull();
    expect(screen.getByText('วันที่ซื้อ')).toBeInTheDocument();
    expect(screen.getByText('รอบบิลเดือน')).toBeInTheDocument();
    expect(screen.getByText('3 ต.ค. 2569')).toBeInTheDocument();
  });

  it('AC-PD-37: locked legacy plan shows only the รอบบิลเดือน tile (no empty วันที่ซื้อ tile)', () => {
    const plan = basePlan({
      schedule: [{ installmentNo: 1, dueMonth: '2026-10', paid: true }, { installmentNo: 2, dueMonth: '2026-11', paid: false }]
    });
    render(<InstallmentPlanForm open plan={plan} lockedCardId="c5" cards={[CARD_5]} onClose={jest.fn()} onSubmit={jest.fn()} />);
    expect(screen.queryByText('วันที่ซื้อ')).toBeNull();
    expect(screen.getByText('รอบบิลเดือน')).toBeInTheDocument();
    expect(screen.queryByText('เริ่มผ่อนเดือน')).toBeNull();
  });
});
