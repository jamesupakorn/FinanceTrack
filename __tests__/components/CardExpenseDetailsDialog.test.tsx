import { afterEach } from '@jest/globals';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { useRef, useState } from 'react';
import type { CardTotalExpenseRow } from '../../src/shared/utils/backend/creditCardSync';
import { formatCurrency } from '../../src/shared/utils/frontend/numberUtils';
import { formatMonthKeyTH } from '../../src/shared/utils/dateUtils';
import CardExpenseDetailsDialog from '../../src/frontend/components/CardExpenseDetailsDialog';

const MONTH = '2026-08';
const DETAILS = {
  installments: [
    { key: 'cci_1_01', name: 'เครื่องใช้ไฟฟ้ารายการยาวสำหรับทดสอบการตัดบรรทัด', amount: 300, paid: false },
    { key: 'cci_1_02', name: 'รายการที่ชำระแล้ว', amount: 0, paid: true }
  ],
  installmentTotal: 300,
  revolving: {
    newSpend: 1000,
    carriedBalance: 0,
    cashbackAmount: 0,
    totalDue: 1000,
    minPaymentDue: 100,
    amountDue: 1000,
    paymentAction: null
  }
} satisfies CardTotalExpenseRow['breakdown'];

function DialogHarness({ breakdown = DETAILS }: { breakdown?: CardTotalExpenseRow['breakdown'] }) {
  const [open, setOpen] = useState(false);
  const openerRef = useRef<HTMLButtonElement>(null);
  const fallbackRef = useRef<HTMLHeadingElement>(null);

  return (
    <main>
      <button ref={openerRef} type="button" onClick={() => setOpen(true)}>เปิดรายละเอียด</button>
      <h1 ref={fallbackRef} tabIndex={-1}>รายการค่าใช้จ่าย</h1>
      {open && (
        <CardExpenseDetailsDialog
          cardId="card/123"
          cardName="บัตรชื่อยาว"
          month={MONTH}
          total={1300}
          breakdown={breakdown}
          opener={openerRef.current}
          fallback={fallbackRef.current}
          onClose={() => setOpen(false)}
        />
      )}
    </main>
  );
}

function openDialog() {
  const view = render(<DialogHarness />);
  const main = view.container.querySelector('main')!;
  main.style.overflowY = 'auto';
  const opener = screen.getByRole('button', { name: 'เปิดรายละเอียด' });
  fireEvent.click(opener);
  return { ...view, main, opener, dialog: screen.getByRole('dialog', { name: 'บัตรชื่อยาว' }) };
}

afterEach(() => { document.body.style.overflow = ''; });

describe('CardExpenseDetailsDialog', () => {
  it('shows the unchanged monthly total and existing installment and revolving details', () => {
    const { dialog } = openDialog();

    expect(dialog).toHaveAttribute('aria-modal', 'true');
    // subtitle = billing cycle the row shows (spec-credit-card-due-month-placement §UX)
    expect(within(dialog).getByText(`รอบบิล ${formatMonthKeyTH(MONTH)}`)).toBeInTheDocument();
    expect(within(dialog).getByText(`${formatCurrency(1300)} ฿`)).toBeInTheDocument();
    expect(within(dialog).getByText('เครื่องใช้ไฟฟ้ารายการยาวสำหรับทดสอบการตัดบรรทัด')).toBeInTheDocument();
    expect(within(dialog).getByText('ยังไม่ชำระ')).toBeInTheDocument();
    expect(within(dialog).getByText(`${formatCurrency(0)} ฿`)).toBeInTheDocument();
    expect(within(dialog).getByText(`${formatCurrency(1000)} ฿`)).toBeInTheDocument();
    expect(within(dialog).queryByText(/ชำระขั้นต่ำแล้ว/)).not.toBeInTheDocument();
    expect(within(dialog).getByRole('link', { name: 'ไปหน้าจัดการบัตร' })).toHaveAttribute('href', '/credit-cards?card=card%2F123');
    expect(within(dialog).queryByRole('button', { name: /แก้ไข|บันทึก|ลบ|ชำระ/ })).not.toBeInTheDocument();
  });

  it('keeps an empty installment section and zero spend visible; shows minimum payment only for that action', () => {
    const emptyDetails: CardTotalExpenseRow['breakdown'] = {
      installments: [],
      installmentTotal: 0,
      revolving: { ...DETAILS.revolving, newSpend: 0 }
    };
    const { dialog, rerender } = openDialog();
    rerender(<DialogHarness breakdown={emptyDetails} />);

    expect(within(dialog).getByText('ไม่มีรายการผ่อนชำระในเดือนนี้')).toBeInTheDocument();
    expect(within(dialog).getByText(`${formatCurrency(0)} ฿`)).toBeInTheDocument();
    expect(within(dialog).queryByText(/ชำระขั้นต่ำแล้ว/)).not.toBeInTheDocument();

    const minimumDetails: CardTotalExpenseRow['breakdown'] = {
      ...emptyDetails,
      revolving: { ...emptyDetails.revolving, paymentAction: 'minimum' }
    };
    rerender(<DialogHarness breakdown={minimumDetails} />);
    expect(screen.getByText(`ชำระขั้นต่ำแล้ว ${formatCurrency(100)} ฿`)).toBeInTheDocument();
  });

  it('provides a responsive scrollable surface, safe-area footer, focus trap, and close behavior', () => {
    const { opener, dialog, main } = openDialog();
    const closeButton = within(dialog).getByRole('button', { name: 'ปิดรายละเอียดบัตร' });
    const managementLink = within(dialog).getByRole('link', { name: 'ไปหน้าจัดการบัตร' });
    const backdrop = dialog.parentElement as HTMLElement;

    expect(closeButton).toHaveFocus();
    expect(backdrop.className).toContain('items-end');
    expect(backdrop.className).toContain('md:items-center');
    expect(dialog.className).toContain('md:max-h-[90dvh]');
    expect(dialog.className).toContain('rounded-t-lg');
    expect(dialog.className).not.toMatch(/animate-|transition-/);
    expect(dialog.querySelector('.overflow-y-auto')).toBeInTheDocument();
    expect(managementLink.parentElement?.className).toContain('safe-area-inset-bottom');
    expect(within(dialog).getByRole('button', { name: 'ปิดรายละเอียดบัตร' })).toHaveClass('h-11', 'w-11');
    expect(managementLink).toHaveClass('min-h-11');

    dialog.querySelectorAll<HTMLElement>('button, a[href]').forEach(element => {
      Object.defineProperty(element, 'offsetParent', { configurable: true, value: document.body });
    });
    managementLink.focus();
    fireEvent.keyDown(managementLink, { key: 'Tab' });
    expect(closeButton).toHaveFocus();
    fireEvent.keyDown(closeButton, { key: 'Tab', shiftKey: true });
    expect(managementLink).toHaveFocus();

    fireEvent.click(dialog);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.keyDown(closeButton, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
    expect(main.style.overflowY).toBe('auto');
  });

  it('closes on backdrop activation and restores the previous body scroll style', () => {
    document.body.style.overflow = 'clip';
    const { opener, dialog, main } = openDialog();
    const backdrop = dialog.parentElement as HTMLElement;

    expect(document.body.style.overflow).toBe('hidden');
    expect(main.style.overflowY).toBe('hidden');
    fireEvent.click(backdrop);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.body.style.overflow).toBe('clip');
    expect(main.style.overflowY).toBe('auto');
    expect(opener).toHaveFocus();
  });

  it('restores background scrolling when unmounted while open', () => {
    document.body.style.overflow = 'scroll';
    const { unmount, main } = openDialog();

    expect(document.body.style.overflow).toBe('hidden');
    expect(main.style.overflowY).toBe('hidden');
    unmount();
    expect(document.body.style.overflow).toBe('scroll');
    expect(main.style.overflowY).toBe('auto');
  });
});