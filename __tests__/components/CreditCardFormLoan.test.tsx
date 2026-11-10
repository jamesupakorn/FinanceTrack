// Loan slice S3 — CreditCardForm: type radiogroup (AC-LN-33), loan field hiding, read-only type chip on edit,
// the F-1 fix (edit payload never carries cardType → no 409, AC-LN-S3-01) and the P2-1 label fix (AC-LN-S3-06).
// The server half of AC-LN-S3-01 (edit without cardType keeps the stored loan type, 200) is
// __tests__/api/credit-cards/loans.test.ts › AC-LN-04.
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CreditCardForm from '../../src/frontend/components/CreditCardForm';

jest.mock('../../src/shared/utils/frontend/toast', () => ({ showToast: jest.fn() }));

const loanCard = {
  id: 'cc_loan_1', name: 'บ้านลาดพร้าว', bankIssuer: 'kbank', bankName: '', last4: '', color: '#138f2d',
  creditLimit: 0, annualRate: 16, minPaymentPercent: 10, statementDay: 'EOM', dueDay: 5, cardType: 'home_loan'
};

describe('CreditCardForm — card type (create)', () => {
  test('radiogroup has 3 options and defaults to บัตรเครดิต with credit-card fields visible', () => {
    render(<CreditCardForm open onSubmit={jest.fn()} />);
    const group = screen.getByRole('radiogroup', { name: 'ประเภท' });
    const radios = within(group).getAllByRole('radio');
    expect(radios.map(radio => radio.textContent)).toEqual(['บัตรเครดิต', 'สินเชื่อส่วนบุคคล', 'สินเชื่อบ้าน']);
    expect(within(group).getByRole('radio', { name: 'บัตรเครดิต' })).toHaveAttribute('aria-checked', 'true');
    expect(group.className).toContain('grid-cols-1');
    expect(group.className).toContain('md:grid-cols-3');
    expect(screen.getByRole('heading', { name: 'เพิ่มบัตรเครดิต' })).toBeInTheDocument();
    expect(document.getElementById('cc-limit')).not.toBeNull();
    expect(document.getElementById('cc-statement')).not.toBeNull();
    expect(document.getElementById('cc-annual-rate')).not.toBeNull();
    expect(document.getElementById('cc-min-percent')).not.toBeNull();
  });

  test('choosing a loan hides limit/statement/revolving fields, keeps due day, and updates the step title', async () => {
    const user = userEvent.setup();
    const onSubmit = jest.fn();
    render(<CreditCardForm open onSubmit={onSubmit} />);
    await user.click(screen.getByRole('radio', { name: 'สินเชื่อบ้าน' }));
    expect(screen.getByRole('radio', { name: 'สินเชื่อบ้าน' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('heading', { name: 'เพิ่มสินเชื่อ · ขั้นที่ 1/2' })).toBeInTheDocument();
    expect(document.getElementById('cc-limit')).toBeNull();
    expect(document.getElementById('cc-statement')).toBeNull();
    expect(document.getElementById('cc-annual-rate')).toBeNull();
    expect(document.getElementById('cc-min-percent')).toBeNull();
    expect(document.getElementById('cc-due')).not.toBeNull();

    await user.type(screen.getByLabelText(/ชื่อบัตร/), 'บ้านลาดพร้าว');
    await user.click(screen.getByRole('button', { name: 'บันทึกบัตร' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ name: 'บ้านลาดพร้าว', cardType: 'home_loan', creditLimit: 0 });
    expect(onSubmit.mock.calls[0][0]).not.toHaveProperty('id');
  });

  test('switching back to บัตรเครดิต restores the credit-card title and fields', async () => {
    const user = userEvent.setup();
    render(<CreditCardForm open onSubmit={jest.fn()} />);
    await user.click(screen.getByRole('radio', { name: 'สินเชื่อส่วนบุคคล' }));
    await user.click(screen.getByRole('radio', { name: 'บัตรเครดิต' }));
    expect(screen.getByRole('heading', { name: 'เพิ่มบัตรเครดิต' })).toBeInTheDocument();
    expect(document.getElementById('cc-limit')).not.toBeNull();
  });
});

describe('CreditCardForm — edit', () => {
  test('a loan shows the read-only type chip, no radiogroup, loan title and hidden credit-only fields', () => {
    render(<CreditCardForm open card={loanCard} onSubmit={jest.fn()} />);
    expect(screen.queryByRole('radiogroup', { name: 'ประเภท' })).toBeNull();
    expect(screen.getByText('ประเภท: สินเชื่อบ้าน (เปลี่ยนไม่ได้)')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'แก้ไขสินเชื่อบ้าน' })).toBeInTheDocument();
    expect(document.getElementById('cc-limit')).toBeNull();
    expect(document.getElementById('cc-statement')).toBeNull();
  });

  test('F-1: editing a loan submits no cardType key (server keeps the stored type, no 409)', async () => {
    const user = userEvent.setup();
    const onSubmit = jest.fn();
    render(<CreditCardForm open card={loanCard} onSubmit={onSubmit} />);
    await user.click(screen.getByRole('button', { name: 'บันทึกบัตร' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    const payload = onSubmit.mock.calls[0][0];
    expect(payload).toMatchObject({ id: 'cc_loan_1', name: 'บ้านลาดพร้าว', dueDay: 5 });
    expect(payload).not.toHaveProperty('cardType');
  });

  test('F-1: editing a legacy credit card (no stored cardType) also submits no cardType key', async () => {
    const user = userEvent.setup();
    const onSubmit = jest.fn();
    const { cardType: _omit, ...legacy } = { ...loanCard, id: 'cc_old', name: 'KTC', creditLimit: 50000 };
    render(<CreditCardForm open card={legacy} onSubmit={onSubmit} />);
    expect(screen.getByText('ประเภท: บัตรเครดิต (เปลี่ยนไม่ได้)')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'แก้ไขบัตรเครดิต' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'บันทึกบัตร' }));
    expect(onSubmit.mock.calls[0][0]).not.toHaveProperty('cardType');
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ id: 'cc_old', creditLimit: 50000 });
  });
});

test('P2-1: the cc-bank label is a single concept; the product-name concept stays in its helper line', () => {
  render(<CreditCardForm open onSubmit={jest.fn()} />);
  const label = document.querySelector('label[for="cc-bank"]');
  expect(label).toHaveTextContent(/^ชื่อบัญชีที่ใช้รวมยอด \(ไม่บังคับ\)$/);
  expect(document.getElementById('cc-bank-help-2')).toHaveTextContent('ใส่ชื่อผลิตภัณฑ์เพิ่มได้ เช่น SPayLater');
});
