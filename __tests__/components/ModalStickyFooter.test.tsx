import { render, screen } from '@testing-library/react';
import CreditCardForm from '../../src/frontend/components/CreditCardForm';
import InstallmentPlanForm from '../../src/frontend/components/InstallmentPlanForm';

const CARDS = [{ id: 'c1', name: 'บัตรทดสอบ', statementDay: 5, dueDay: 25, creditLimit: 50000 }];

function panelOf(root: HTMLElement): HTMLFormElement | null {
  return root.querySelector<HTMLFormElement>('[role="dialog"]');
}

function assertStickyShell(panel: HTMLElement): void {
  expect(panel.className).toContain('flex');
  expect(panel.className).toContain('flex-col');
  expect(panel.className).toContain('overflow-hidden');
  expect(panel.className).toMatch(/max-h-\[95vh\]/);
  const [header, body, footer] = Array.from(panel.children) as HTMLElement[];
  expect(panel.children).toHaveLength(3);
  expect(header.className).toContain('shrink-0');
  expect(body.className).toContain('flex-1');
  expect(body.className).toContain('min-h-0');
  expect(body.className).toContain('overflow-y-auto');
  expect(footer.className).toContain('shrink-0');
  expect(footer.className).toContain('border-t');
  expect(footer).toBe(panel.lastElementChild);
}

describe('CreditCardForm — sticky footer shell', () => {
  it('panel/header/body/footer keep the full flex chain (AC-1..AC-4 precondition)', () => {
    const { container } = render(<CreditCardForm open onClose={jest.fn()} onSubmit={jest.fn()} />);
    assertStickyShell(panelOf(container)!);
  });

  it('the two action buttons live in the footer, after the body, and are last in DOM order', () => {
    const { container } = render(<CreditCardForm open onClose={jest.fn()} onSubmit={jest.fn()} />);
    const panel = panelOf(container)!;
    const footer = panel.lastElementChild as HTMLElement;
    const save = screen.getByRole('button', { name: 'บันทึกบัตร' });
    const cancel = screen.getByRole('button', { name: 'ยกเลิก' });
    expect(footer.contains(save)).toBe(true);
    expect(footer.contains(cancel)).toBe(true);
    const buttons = Array.from(panel.querySelectorAll('button'));
    expect(buttons[buttons.length - 1]).toBe(save);
  });

  it('E-7: submitting disables the primary button and swaps its label, inside the footer', () => {
    const { container } = render(<CreditCardForm open submitting onClose={jest.fn()} onSubmit={jest.fn()} />);
    const footer = panelOf(container)!.lastElementChild as HTMLElement;
    const saving = screen.getByText('กำลังบันทึก...');
    expect(footer.contains(saving)).toBe(true);
    expect(saving.closest('button')).toBeDisabled();
  });
});

describe('InstallmentPlanForm — sticky footer shell', () => {
  it('panel/header/body/footer keep the full flex chain (AC-14 precondition)', () => {
    const { container } = render(<InstallmentPlanForm open cards={CARDS} onClose={jest.fn()} onSubmit={jest.fn()} />);
    assertStickyShell(panelOf(container)!);
  });

  it('the two action buttons live in the footer and are last in DOM order', () => {
    const { container } = render(<InstallmentPlanForm open cards={CARDS} onClose={jest.fn()} onSubmit={jest.fn()} />);
    const panel = panelOf(container)!;
    const save = screen.getByRole('button', { name: 'บันทึกแผนผ่อน' });
    expect((panel.lastElementChild as HTMLElement).contains(save)).toBe(true);
    const buttons = Array.from(panel.querySelectorAll('button'));
    expect(buttons[buttons.length - 1]).toBe(save);
  });

  it('AC-15: financialsLocked warning remains inside the scrolling body', () => {
    const lockedPlan = {
      id: 'p1', cardId: 'c1', itemName: 'มือถือ', totalAmount: 12000, months: 10,
      interestMode: 'flat', schedule: [{ paid: true }, { paid: false }]
    };
    const { container } = render(<InstallmentPlanForm open plan={lockedPlan} cards={CARDS} onClose={jest.fn()} onSubmit={jest.fn()} />);
    const panel = panelOf(container)!;
    const body = panel.children[1] as HTMLElement;
    const banner = screen.getByText(/แก้ไขได้เฉพาะชื่อรายการ|ชำระไปแล้ว/).closest('div')!;
    expect(body.contains(banner)).toBe(true);
    expect(body.firstElementChild?.contains(banner)).toBe(true);
    assertStickyShell(panel);
    expect((panel.lastElementChild as HTMLElement).contains(screen.getByRole('button', { name: 'บันทึกแผนผ่อน' }))).toBe(true);
  });

  it('R-6/E-11: the nested schedule-preview scroll region stays inside the body with its own explicit max-h', () => {
    const { container } = render(<InstallmentPlanForm open cards={CARDS} onClose={jest.fn()} onSubmit={jest.fn()} />);
    const body = panelOf(container)!.children[1] as HTMLElement;
    const nested = body.querySelectorAll<HTMLElement>('[class*="max-h-[260px]"]');
    nested.forEach(element => {
      expect(body.contains(element)).toBe(true);
      expect(element.className).toMatch(/overflow-auto|overflow-y-auto/);
      expect(element.className).not.toContain('flex-1');
    });
  });
});