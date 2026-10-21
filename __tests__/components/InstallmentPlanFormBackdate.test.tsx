import { fireEvent, render, screen, within } from '@testing-library/react';
import InstallmentPlanForm from '../../src/frontend/components/InstallmentPlanForm';
import { validatePlanInput } from '../../src/shared/utils/creditCardUtils';
import { PAID_PILL_CLASS, PAID_PILL_ON_CLASS } from '../../src/frontend/components/installmentPaidPill';

jest.mock('../../src/shared/utils/frontend/toast', () => ({ showToast: jest.fn() }));

const CARD = { id: 'c5', name: 'บัตรห้า', statementDay: 5 };

beforeEach(() => {
  jest.useFakeTimers({
    now: new Date(2026, 9, 17, 3, 0, 0),
    doNotFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'queueMicrotask', 'nextTick']
  });
});

afterEach(() => jest.useRealTimers());

function fillBackdatedPlan() {
  fireEvent.change(document.querySelector<HTMLInputElement>('[name="itemName"]')!, { target: { value: 'โทรศัพท์' } });
  fireEvent.change(document.querySelector<HTMLInputElement>('[name="totalPrice"]')!, { target: { value: '45000' } });
  fireEvent.change(document.querySelector<HTMLSelectElement>('[name="startMonth"]')!, { target: { value: '2026-06' } });
  fireEvent.change(document.querySelector<HTMLInputElement>('[name="annualRate"]')!, { target: { value: '0' } });
  fireEvent.click(screen.getByRole('button', { name: 'บันทึกแผนผ่อน' }));
}

describe('InstallmentPlanForm backdated confirmation', () => {
  it('shows only past installments and submits selected installment numbers', () => {
    const onSubmit = jest.fn();
    render(<InstallmentPlanForm open cards={[CARD]} onClose={jest.fn()} onSubmit={onSubmit} />);

    fillBackdatedPlan();

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'มีงวดที่ผ่านมาแล้ว 4 งวด' })).toBeInTheDocument();
    expect(screen.getByText('งวด 1/10 · มิ.ย. 2569 · 4,500.00 บาท')).toBeInTheDocument();
    expect(screen.getByText('งวด 4/10 · ก.ย. 2569 · 4,500.00 บาท')).toBeInTheDocument();
    expect(screen.queryByText(/งวด 5\/10/)).not.toBeInTheDocument();

    const dialog = screen.getByRole('dialog', { name: 'มีงวดที่ผ่านมาแล้ว 4 งวด' });
    const pills = within(dialog).getAllByRole('button', { name: 'ยังไม่ชำระ — แตะเพื่อยืนยัน' });
    expect(pills).toHaveLength(4);
    expect(pills[0]).toHaveAttribute('aria-pressed', 'false');
    expect(pills[0].className).toBe(`${PAID_PILL_CLASS} `);
    fireEvent.click(pills[1]);
    const selectedSecondPill = within(dialog).getByRole('button', { name: '✓ ชำระแล้ว' });
    expect(selectedSecondPill).toHaveAttribute('aria-pressed', 'true');
    expect(selectedSecondPill.className).toBe(`${PAID_PILL_CLASS} ${PAID_PILL_ON_CLASS}`);

    fireEvent.click(pills[0]);
    fireEvent.click(pills[2]);
    fireEvent.click(within(dialog).getByRole('button', { name: 'ยืนยัน' }));

    const expected = validatePlanInput({
      cardId: 'c5',
      itemName: 'โทรศัพท์',
      totalPrice: '45000',
      months: '10',
      startMonth: '2026-06',
      purchaseDate: '2026-10-17',
      interestMode: 'calculated',
      annualRate: '0',
      calcMethod: 'flat'
    }, { requirePurchaseDate: true });
    expect(expected.valid).toBe(true);
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith(expected.value, { paidInstallmentNos: [1, 2, 3] });
  });

  it('cancel preserves form values and resets paid selection on the next open', () => {
    const onSubmit = jest.fn();
    render(<InstallmentPlanForm open cards={[CARD]} onClose={jest.fn()} onSubmit={onSubmit} />);
    fillBackdatedPlan();

    const dialog = screen.getByRole('dialog', { name: 'มีงวดที่ผ่านมาแล้ว 4 งวด' });
    fireEvent.click(within(dialog).getAllByRole('button', { name: 'ยังไม่ชำระ — แตะเพื่อยืนยัน' })[0]);
    fireEvent.click(within(dialog).getByRole('button', { name: 'ยกเลิก' }));
    expect(screen.queryByRole('dialog', { name: 'มีงวดที่ผ่านมาแล้ว 4 งวด' })).not.toBeInTheDocument();
    expect((document.querySelector<HTMLInputElement>('[name="itemName"]'))?.value).toBe('โทรศัพท์');
    expect(onSubmit).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'บันทึกแผนผ่อน' }));
    const reopened = screen.getByRole('dialog', { name: 'มีงวดที่ผ่านมาแล้ว 4 งวด' });
    expect(within(reopened).getAllByRole('button', { name: 'ยังไม่ชำระ — แตะเพื่อยืนยัน' })).toHaveLength(4);
    expect(within(reopened).queryByRole('button', { name: '✓ ชำระแล้ว' })).not.toBeInTheDocument();
  });

  it.each(['escape', 'close-button', 'backdrop'] as const)('cancels via %s without closing the form', method => {
    const onClose = jest.fn();
    const onSubmit = jest.fn();
    render(<InstallmentPlanForm open cards={[CARD]} onClose={onClose} onSubmit={onSubmit} />);
    fillBackdatedPlan();
    const dialog = screen.getByRole('dialog', { name: 'มีงวดที่ผ่านมาแล้ว 4 งวด' });

    if (method === 'escape') {
      fireEvent.keyDown(document, { key: 'Escape' });
    } else if (method === 'close-button') {
      fireEvent.click(within(dialog).getByRole('button', { name: 'ปิด' }));
    } else {
      fireEvent.mouseDown(dialog.parentElement!, { target: dialog.parentElement });
    }

    expect(screen.queryByRole('dialog', { name: 'มีงวดที่ผ่านมาแล้ว 4 งวด' })).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'เพิ่มแผนผ่อนชำระ' })).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'บันทึกแผนผ่อน' }));
  });

  it('keeps the no-overdue path unchanged and calls onSubmit with one argument', () => {
    const onSubmit = jest.fn();
    render(<InstallmentPlanForm open cards={[CARD]} onClose={jest.fn()} onSubmit={onSubmit} />);
    fireEvent.change(document.querySelector<HTMLInputElement>('[name="itemName"]')!, { target: { value: 'โทรศัพท์' } });
    fireEvent.change(document.querySelector<HTMLInputElement>('[name="totalPrice"]')!, { target: { value: '45000' } });
    fireEvent.change(document.querySelector<HTMLSelectElement>('[name="startMonth"]')!, { target: { value: '2026-11' } });
    fireEvent.change(document.querySelector<HTMLInputElement>('[name="annualRate"]')!, { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: 'บันทึกแผนผ่อน' }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0]).toHaveLength(1);
    expect(screen.queryByRole('dialog', { name: /มีงวดที่ผ่านมาแล้ว/ })).not.toBeInTheDocument();
  });

  it('locks all dialog actions and ignores cancel keys while submitting', () => {
    const props = { open: true, cards: [CARD], onClose: jest.fn(), onSubmit: jest.fn() };
    const { rerender } = render(<InstallmentPlanForm {...props} />);
    fillBackdatedPlan();
    rerender(<InstallmentPlanForm {...props} submitting />);

    const dialog = screen.getByRole('dialog', { name: 'มีงวดที่ผ่านมาแล้ว 4 งวด' });
    expect(within(dialog).getByRole('button', { name: 'กำลังบันทึก...' })).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: 'ยกเลิก' })).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: 'ปิด' })).toBeDisabled();
    expect(within(dialog).getAllByRole('button', { name: 'ยังไม่ชำระ — แตะเพื่อยืนยัน' }).every(button => (button as HTMLButtonElement).disabled)).toBe(true);

    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.mouseDown(dialog.parentElement!, { target: dialog.parentElement });
    expect(screen.getByRole('dialog', { name: 'มีงวดที่ผ่านมาแล้ว 4 งวด' })).toBeInTheDocument();
    expect(props.onClose).not.toHaveBeenCalled();
    expect(props.onSubmit).not.toHaveBeenCalled();
  });
});
