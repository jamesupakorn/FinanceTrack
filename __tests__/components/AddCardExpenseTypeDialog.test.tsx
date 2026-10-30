import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AddCardExpenseTypeDialog from '../../src/frontend/components/AddCardExpenseTypeDialog';

describe('AddCardExpenseTypeDialog', () => {
  test('renders choices, focuses cancel, Escape cancels', async () => {
    const user = userEvent.setup();
    const onCancel = jest.fn();
    const onChoose = jest.fn();
    render(<AddCardExpenseTypeDialog open cardName="Shopee" onChoose={onChoose} onCancel={onCancel} />);
    const dialog = screen.getByRole('dialog', { name: 'เพิ่มรายจ่าย' });
    expect(dialog).toHaveAccessibleDescription('บัตร Shopee');
    const cancel = screen.getByRole('button', { name: 'ยกเลิก' });
    expect(cancel).toHaveFocus();
    await user.click(screen.getByRole('button', { name: /ผ่อนชำระ/ }));
    expect(onChoose).toHaveBeenCalledWith('installment');
    await user.click(screen.getByRole('button', { name: /รายจ่ายธรรมดา/ }));
    expect(onChoose).toHaveBeenCalledWith('spend');
    await user.keyboard('{Escape}');
    expect(onCancel).toHaveBeenCalled();
  });

  test('renders nothing when closed', () => {
    render(<AddCardExpenseTypeDialog open={false} onChoose={jest.fn()} onCancel={jest.fn()} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
