// Loan slice S3 — InstallmentPlanForm loan mode: presets/1–480 (AC-LN-33), no interest/calc radios,
// year+month first-instalment selector, cardType reaches validatePlanInput, the P2-2 rate hint
// (AC-LN-S3-07) and the P0-1 header strip + back tap target (AC-LN-S3-03, form half).
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import InstallmentPlanForm from '../../src/frontend/components/InstallmentPlanForm';
import { getCurrentMonthKey } from '../../src/shared/utils/creditCardUtils';

jest.mock('../../src/shared/utils/frontend/toast', () => ({ showToast: jest.fn() }));

const loan = { id: 'cc_loan_1', name: 'บ้านลาดพร้าว', cardType: 'home_loan', bankIssuer: 'kbank', dueDay: 5, statementDay: 'EOM' };
const credit = { id: 'cc_card_1', name: 'KTC', statementDay: 25, dueDay: 10 };
const nextYear = Number(getCurrentMonthKey().slice(0, 4)) + 1;

async function fillLoan(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/ชื่อสัญญา/), 'สัญญา 123');
  await user.type(screen.getByLabelText(/ยอดเงินกู้/), '1000000');
  await user.type(screen.getByLabelText(/อัตราดอกเบี้ยต่อปี/), '6');
  // a future first instalment keeps the backdated dialog out of the way
  await user.selectOptions(screen.getByRole('combobox', { name: 'ปี (พ.ศ.)' }), String(nextYear));
  await user.selectOptions(screen.getByRole('combobox', { name: 'เดือน' }), '3');
}

describe('InstallmentPlanForm — loan mode', () => {
  test('P0-1 header strip shows issuer · name · due day and the back button calls onEditLockedCard', async () => {
    const user = userEvent.setup();
    const onEditLockedCard = jest.fn();
    render(<InstallmentPlanForm open cards={[loan]} lockedCardId="cc_loan_1" onEditLockedCard={onEditLockedCard} />);
    expect(screen.getByRole('heading', { name: 'ตารางผ่อนสินเชื่อ · ขั้นที่ 2/2' })).toBeInTheDocument();
    expect(screen.getByText('ธนาคารกสิกรไทย · บ้านลาดพร้าว · ครบกำหนดวันที่ 5')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'กลับไปแก้ไขข้อมูลบัตร' }));
    expect(onEditLockedCard).toHaveBeenCalledTimes(1);
  });

  test('without onEditLockedCard the strip renders but no dead back button', () => {
    render(<InstallmentPlanForm open cards={[loan]} lockedCardId="cc_loan_1" />);
    expect(screen.getByText(/บ้านลาดพร้าว · ครบกำหนดวันที่ 5/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'กลับไปแก้ไขข้อมูลบัตร' })).toBeNull();
  });

  test('loan presets, 1–480 custom placeholder, no interest radios, static Effective note, P2-2 rate hint', async () => {
    const user = userEvent.setup();
    render(<InstallmentPlanForm open cards={[loan]} lockedCardId="cc_loan_1" />);
    const months = screen.getByLabelText(/จำนวนงวด/) as HTMLSelectElement;
    const values = Array.from(months.options).map(option => option.value);
    expect(values).toEqual(['12', '24', '36', '48', '60', '84', '120', '180', '240', '300', '360', 'custom']);
    await user.selectOptions(months, 'custom');
    expect(document.querySelector('input[name="months"]')).toHaveAttribute('placeholder', '1–480');

    expect(screen.queryByRole('radiogroup', { name: 'รูปแบบดอกเบี้ย' })).toBeNull();
    expect(screen.queryByRole('radio')).toBeNull();
    expect(screen.getByText('คำนวณแบบลดต้นลดดอก (Effective) ตามมาตรฐานสินเชื่อธนาคาร')).toBeInTheDocument();

    const rate = document.getElementById('ip-rate');
    expect(rate).toHaveAttribute('placeholder', '3.5');
    expect(screen.getByText(/3–8% ต่อปีสำหรับสินเชื่อบ้าน\/ส่วนบุคคล/)).toBeInTheDocument();
    expect(screen.queryByText(/0\.5–1\.5%/)).toBeNull();
  });

  test('year (พ.ศ.) + month selects write a Gregorian YYYY-MM startMonth; submission is calculated + effective', async () => {
    const user = userEvent.setup();
    const onSubmit = jest.fn();
    render(<InstallmentPlanForm open cards={[loan]} lockedCardId="cc_loan_1" onSubmit={onSubmit} />);
    const year = screen.getByRole('combobox', { name: 'ปี (พ.ศ.)' }) as HTMLSelectElement;
    const currentYear = Number(getCurrentMonthKey().slice(0, 4));
    const optionValues = Array.from(year.options).map(option => Number(option.value));
    expect(optionValues[0]).toBe(currentYear + 1);
    expect(optionValues[optionValues.length - 1]).toBe(currentYear - 40);
    expect(within(year).getByRole('option', { name: String(currentYear + 543) })).toBeInTheDocument();
    // pre-filled from the contract date (today) → the current month
    expect(year.value).toBe(String(currentYear));

    await fillLoan(user);
    await user.click(screen.getByRole('button', { name: 'บันทึกสินเชื่อ' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      cardId: 'cc_loan_1', interestMode: 'calculated', calcMethod: 'effective',
      startMonth: `${nextYear}-03`, months: 12, totalPrice: 1000000
    });
  });

  test('cardType reaches validatePlanInput: a loan accepts 480 months, a credit card rejects 61', async () => {
    const user = userEvent.setup();
    const onSubmit = jest.fn();
    const { unmount } = render(<InstallmentPlanForm open cards={[loan]} lockedCardId="cc_loan_1" onSubmit={onSubmit} />);
    await fillLoan(user);
    await user.selectOptions(screen.getByLabelText(/จำนวนงวด/), 'custom');
    const custom = document.querySelector('input[name="months"]') as HTMLInputElement;
    await user.clear(custom);
    await user.type(custom, '480');
    await user.click(screen.getByRole('button', { name: 'บันทึกสินเชื่อ' }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ months: 480 }));
    unmount();

    const cardSubmit = jest.fn();
    render(<InstallmentPlanForm open cards={[credit]} lockedCardId="cc_card_1" onSubmit={cardSubmit} />);
    await user.type(screen.getByLabelText(/ชื่อสินค้า/), 'ทีวี');
    await user.type(screen.getByLabelText(/ราคาสินค้า/), '10000');
    await user.type(document.getElementById('ip-rate') as HTMLElement, '1');
    await user.selectOptions(screen.getByLabelText(/จำนวนงวด/), 'custom');
    await user.type(document.querySelector('input[name="months"]') as HTMLInputElement, '61');
    await user.click(screen.getByRole('button', { name: 'บันทึกแผนผ่อน' }));
    expect(cardSubmit).not.toHaveBeenCalled();
    expect(screen.getByText('จำนวนงวดต้องอยู่ระหว่าง 1–60')).toBeInTheDocument();
  });

  test('loan defaults are re-seeded when the reloaded cards arrive after the form opened (I-5 race)', async () => {
    const user = userEvent.setup();
    const onSubmit = jest.fn();
    const { rerender } = render(<InstallmentPlanForm open cards={[]} lockedCardId="cc_loan_1" onSubmit={onSubmit} />);
    rerender(<InstallmentPlanForm open cards={[loan]} lockedCardId="cc_loan_1" onSubmit={onSubmit} />);
    expect(screen.getByText('คำนวณแบบลดต้นลดดอก (Effective) ตามมาตรฐานสินเชื่อธนาคาร')).toBeInTheDocument();
    await fillLoan(user);
    await user.click(screen.getByRole('button', { name: 'บันทึกสินเชื่อ' }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ calcMethod: 'effective', interestMode: 'calculated' }));
  });
});

describe('InstallmentPlanForm — credit-card mode unchanged', () => {
  test('keeps credit-card presets, rate hint, radios; no loan strip; unlocked picker lists credit cards only', () => {
    render(<InstallmentPlanForm open cards={[loan, credit]} />);
    expect(screen.getByRole('heading', { name: 'เพิ่มแผนผ่อนชำระ' })).toBeInTheDocument();
    expect(screen.getByRole('radiogroup', { name: 'รูปแบบดอกเบี้ย' })).toBeInTheDocument();
    expect(document.getElementById('ip-rate')).toHaveAttribute('placeholder', '0.8');
    expect(screen.queryByText(/ครบกำหนดวันที่/)).toBeNull();
    const picker = document.getElementById('ip-card') as HTMLSelectElement;
    expect(Array.from(picker.options).map(option => option.value)).toEqual(['', 'cc_card_1']);
    expect(picker.value).toBe('cc_card_1');
  });
});
