/**
 * Regression guard สำหรับโครง "header pinned / body scroll / footer pinned" ของโมดัลยาวทั้งสาม
 * (task: save-button-sticky-footer — spec R-5 ระบุว่าไม่มีเทสต์คุม CSS ชั้นนี้เลย ไฟล์นี้คือชั้นกันชน
 * ระดับ DOM/class ที่ทำได้ใน jsdom)
 *
 * jsdom ไม่มี layout engine → ตรวจ geometry/scroll จริงไม่ได้ (AC-1..AC-4, AC-12, AC-14 ยังต้องเช็ก
 * ในเบราว์เซอร์จริง) แต่ตรวจได้ว่า "โซ่ flex" ยังครบ: panel = flex flex-col + overflow-hidden + max-h,
 * header/footer = shrink-0, body = flex-1 min-h-0 overflow-y-auto และ footer เป็นลูกคนสุดท้าย
 */

import { render, screen } from '@testing-library/react';
import CreditCardForm from '../../src/frontend/components/CreditCardForm';
import InstallmentPlanForm from '../../src/frontend/components/InstallmentPlanForm';

const CARDS = [{ id: 'c1', name: 'บัตรทดสอบ', statementDay: 5, dueDay: 25, creditLimit: 50000 }];

function panelOf(root) {
  return root.querySelector('[role="dialog"]');
}

function assertStickyShell(panel) {
  expect(panel.className).toContain('flex');
  expect(panel.className).toContain('flex-col');
  expect(panel.className).toContain('overflow-hidden');
  expect(panel.className).toMatch(/max-h-\[95vh\]/);

  const [header, body, footer] = panel.children;
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
    const { container } = render(
      <CreditCardForm open onClose={jest.fn()} onSubmit={jest.fn()} />
    );
    assertStickyShell(panelOf(container));
  });

  it('the two action buttons live in the footer, after the body, and are last in DOM order', () => {
    const { container } = render(
      <CreditCardForm open onClose={jest.fn()} onSubmit={jest.fn()} />
    );
    const panel = panelOf(container);
    const footer = panel.lastElementChild;

    const save = screen.getByRole('button', { name: 'บันทึกบัตร' });
    const cancel = screen.getByRole('button', { name: 'ยกเลิก' });
    expect(footer.contains(save)).toBe(true);
    expect(footer.contains(cancel)).toBe(true);

    const buttons = Array.from(panel.querySelectorAll('button'));
    expect(buttons[buttons.length - 1]).toBe(save);
  });

  it('E-7: submitting disables the primary button and swaps its label, inside the footer', () => {
    const { container } = render(
      <CreditCardForm open submitting onClose={jest.fn()} onSubmit={jest.fn()} />
    );
    const footer = panelOf(container).lastElementChild;
    const saving = screen.getByText('กำลังบันทึก...');

    expect(footer.contains(saving)).toBe(true);
    expect(saving.closest('button')).toBeDisabled();
  });
});

describe('InstallmentPlanForm — sticky footer shell', () => {
  it('panel/header/body/footer keep the full flex chain (AC-14 precondition)', () => {
    const { container } = render(
      <InstallmentPlanForm open cards={CARDS} onClose={jest.fn()} onSubmit={jest.fn()} />
    );
    assertStickyShell(panelOf(container));
  });

  it('the two action buttons live in the footer and are last in DOM order', () => {
    const { container } = render(
      <InstallmentPlanForm open cards={CARDS} onClose={jest.fn()} onSubmit={jest.fn()} />
    );
    const panel = panelOf(container);
    const save = screen.getByRole('button', { name: 'บันทึกแผนผ่อน' });

    expect(panel.lastElementChild.contains(save)).toBe(true);
    const buttons = Array.from(panel.querySelectorAll('button'));
    expect(buttons[buttons.length - 1]).toBe(save);
  });

  it('AC-15: financialsLocked warning banner is still the first child of the scrolling body, not of the panel', () => {
    const lockedPlan = {
      id: 'p1',
      cardId: 'c1',
      itemName: 'มือถือ',
      totalAmount: 12000,
      months: 10,
      interestMode: 'flat',
      schedule: [{ paid: true }, { paid: false }]
    };
    const { container } = render(
      <InstallmentPlanForm open plan={lockedPlan} cards={CARDS} onClose={jest.fn()} onSubmit={jest.fn()} />
    );
    const panel = panelOf(container);
    const body = panel.children[1];
    const banner = screen.getByText(/แก้ไขได้เฉพาะชื่อรายการ|ชำระไปแล้ว/).closest('div');

    expect(body.contains(banner)).toBe(true);
    expect(body.firstElementChild.contains(banner)).toBe(true);
    // ยังมี footer แยกและยังเป็นลูกคนสุดท้ายของ panel
    assertStickyShell(panel);
    expect(panel.lastElementChild.contains(screen.getByRole('button', { name: 'บันทึกแผนผ่อน' }))).toBe(true);
  });

  it('R-6/E-11: the nested schedule-preview scroll region stays inside the body with its own explicit max-h', () => {
    const { container } = render(
      <InstallmentPlanForm open cards={CARDS} onClose={jest.fn()} onSubmit={jest.fn()} />
    );
    const body = panelOf(container).children[1];
    const nested = body.querySelectorAll('[class*="max-h-[260px]"]');

    // เงื่อนไข: ถ้ามี nested scroll region มันต้องอยู่ใน body และใช้ max-h ของตัวเอง (ไม่พึ่ง flex height)
    nested.forEach((el) => {
      expect(body.contains(el)).toBe(true);
      expect(el.className).toMatch(/overflow-auto|overflow-y-auto/);
      expect(el.className).not.toContain('flex-1');
    });
  });
});
