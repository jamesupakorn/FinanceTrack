import { fireEvent, render, screen } from '@testing-library/react';
import CardTotalPaymentDialog from '../../src/frontend/components/CardTotalPaymentDialog';

const row = { name: 'บัตร A', breakdown: {
  installments: [], installmentTotal: 300,
  revolving: { newSpend: 1000, carriedBalance: 0, cashbackAmount: 0, totalDue: 1000, minPaymentDue: 100, amountDue: 1000, paymentAction: null }
} };

beforeEach(() => {
  jest.spyOn(HTMLElement.prototype, 'offsetParent', 'get').mockReturnValue(document.body);
});
afterEach(() => jest.restoreAllMocks());

it('defaults to cancel/full, traps focus, cancels on Escape and restores the trigger', () => {
  const trigger = document.createElement('button');
  document.body.appendChild(trigger);
  trigger.focus();
  const cancel = jest.fn();
  const { unmount } = render(<CardTotalPaymentDialog row={row} paid busy={false} onCancel={cancel} onConfirm={jest.fn()} />);
  const cancelButton = screen.getByRole('button', { name: 'ยกเลิก' });
  const confirmButton = screen.getByRole('button', { name: 'ยืนยัน' });
  expect(cancelButton).toHaveFocus();
  expect(screen.getByRole('radio', { name: /จ่ายเต็ม/ })).toBeChecked();
  confirmButton.focus();
  fireEvent.keyDown(confirmButton, { key: 'Tab' });
  expect(screen.getByRole('radio', { name: /จ่ายเต็ม/ })).toHaveFocus();
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
  expect(cancel).toHaveBeenCalledTimes(1);
  unmount();
  expect(trigger).toHaveFocus();
  trigger.remove();
});

it('sends explicit minimum and shows no choice for a credit/settled cycle', () => {
  const confirm = jest.fn();
  const { rerender } = render(<CardTotalPaymentDialog row={row} paid busy={false} onCancel={jest.fn()} onConfirm={confirm} />);
  fireEvent.click(screen.getByRole('radio', { name: /จ่ายขั้นต่ำ/ }));
  fireEvent.click(screen.getByRole('button', { name: 'ยืนยัน' }));
  expect(confirm).toHaveBeenCalledWith('minimum');
  rerender(<CardTotalPaymentDialog row={{ ...row, breakdown: { ...row.breakdown, revolving: { ...row.breakdown.revolving, totalDue: -50 } } }} paid busy={false} onCancel={jest.fn()} onConfirm={confirm} />);
  expect(screen.queryByRole('radio')).not.toBeInTheDocument();
});

it('uses alertdialog for undo and never confirms when Escape is pressed', () => {
  const confirm = jest.fn(), cancel = jest.fn();
  render(<CardTotalPaymentDialog row={row} paid={false} busy={false} onCancel={cancel} onConfirm={confirm} />);
  fireEvent.keyDown(screen.getByRole('alertdialog'), { key: 'Escape' });
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(confirm).not.toHaveBeenCalled();
});
