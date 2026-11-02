// AC-CD5: stepping, reset target (payable cycle, not the calendar month), badge, no "เดือนนี้".
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import BillingMonthSwitcher from '../../src/frontend/components/BillingMonthSwitcher';

it('labels the group and the live month, and has no month input or "เดือนนี้" control', () => {
  const { container } = render(<BillingMonthSwitcher month="2026-10" payableCycle="2026-10" onChange={jest.fn()} />);
  expect(screen.getByRole('group', { name: 'เดือนรอบบิล' })).toBeInTheDocument();
  const label = screen.getByText('รอบบิล ต.ค. 2569');
  expect(label).toHaveAttribute('data-month', '2026-10');
  expect(label).toHaveAttribute('aria-live', 'polite');
  expect(container.querySelector('input[type="month"]')).toBeNull();
  expect(screen.queryByRole('button', { name: 'เดือนนี้' })).toBeNull();
});

it('prev/next names carry the target month and step across year boundaries', async () => {
  const user = userEvent.setup();
  const onChange = jest.fn();
  const { rerender } = render(<BillingMonthSwitcher month="2026-12" payableCycle="2026-12" onChange={onChange} />);
  await user.click(screen.getByRole('button', { name: 'เดือนถัดไป (ม.ค. 2570)' }));
  expect(onChange).toHaveBeenLastCalledWith('2027-01');
  rerender(<BillingMonthSwitcher month="2027-01" payableCycle="2026-12" onChange={onChange} />);
  await user.click(screen.getByRole('button', { name: 'เดือนก่อนหน้า (ธ.ค. 2569)' }));
  expect(onChange).toHaveBeenLastCalledWith('2026-12');
});

it('shows the payable badge only on the payable cycle, and the reset only off it', () => {
  const { rerender } = render(<BillingMonthSwitcher month="2026-10" payableCycle="2026-10" onChange={jest.fn()} />);
  expect(screen.getByText('ต้องชำระเดือนนี้')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /กลับไปรอบบิลที่ต้องชำระ/ })).toBeNull();
  rerender(<BillingMonthSwitcher month="2026-09" payableCycle="2026-10" onChange={jest.fn()} />);
  expect(screen.queryByText('ต้องชำระเดือนนี้')).toBeNull();
  expect(screen.getByRole('button', { name: 'กลับไปรอบบิลที่ต้องชำระ (ต.ค. 2569)' })).toHaveTextContent('รอบที่ต้องชำระ');
});

it('reset goes to the payable cycle (not the calendar month) and moves focus to the label', async () => {
  const user = userEvent.setup();
  const onChange = jest.fn();
  render(<BillingMonthSwitcher month="2026-09" payableCycle="2026-10" onChange={onChange} />);
  await user.click(screen.getByRole('button', { name: /กลับไปรอบบิลที่ต้องชำระ/ }));
  expect(onChange).toHaveBeenCalledWith('2026-10');
  expect(screen.getByText('รอบบิล ก.ย. 2569')).toHaveFocus();
});

it('uses onReset instead of onChange when provided', async () => {
  const user = userEvent.setup();
  const onChange = jest.fn();
  const onReset = jest.fn();
  render(<BillingMonthSwitcher month="2026-09" payableCycle="2026-10" onChange={onChange} onReset={onReset} />);
  await user.click(screen.getByRole('button', { name: /กลับไปรอบบิลที่ต้องชำระ/ }));
  expect(onReset).toHaveBeenCalledTimes(1);
  expect(onChange).not.toHaveBeenCalled();
});
