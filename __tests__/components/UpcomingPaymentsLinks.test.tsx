/**
 * Stage 4 — spec-dashboard-upcoming-click-to-view-s3.md, dashboard-only ACs (AC-1..AC-9).
 * Covers UpcomingPayments.tsx's new Link wiring: plain whole-card link, installment/revolving/card
 * inner info-block link with the existing buttons kept as non-descendant siblings, aria-label copy,
 * FOCUS_RING/cursor-pointer/hover classes, and the null-href fallback (no <a> at all).
 */
import { describe, expect, it } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react';
import UpcomingPayments from '../../src/frontend/components/UpcomingPayments';

type Props = React.ComponentProps<typeof UpcomingPayments>;

const cardA = { id: 'cc_a', name: 'บัตร A', color: '#336699' };
const mk = (over: Record<string, unknown>) => ({
  type: 'expense', paid: false, isoDate: '2026-11-10', daysDiff: 3, account: 'KBank', cycleMonth: '2026-10', card: cardA, ...over
});
const upcomingOf = (...soon: unknown[]) => ({ overdue: [], dueToday: [], dueSoon: soon, total: soon.length }) as unknown as Props['upcoming'];

const NO_NESTING_SELECTOR = 'a a, a button, button a, button button';

describe('UpcomingPayments dashboard links (S3)', () => {
  it('AC-1: a plain item renders one <a> to /workspace/expense with month+focus', () => {
    const plain = { type: 'expense', paid: false, isoDate: '2026-11-10', daysDiff: 3, account: 'SCB', cycleMonth: '2026-11', card: null, id: 'rent', key: 'rent', source: 'plain', name: 'ค่าเช่า', amount: 5000 };
    render(<UpcomingPayments upcoming={upcomingOf(plain)} />);
    const link = screen.getByRole('link', { name: /เปิดดูรายการ ค่าเช่า/ });
    expect(link).toHaveAttribute('href', '/workspace/expense?month=2026-11&focus=rent');
    expect(link.tagName).toBe('A');
  });

  it('AC-2: an installment item renders an <a> to /credits?card&focus=planId, button not a descendant', () => {
    // installment/revolving with a resolved card are always grouped into an UpcomingCard (even solo) —
    // expand it first to reach the compact UpcomingItem row (see OQ-4 in UpcomingPaymentsCardTotalsReview.test.tsx).
    const inst = mk({ id: '2026-10_cci_1', key: 'cci_1', source: 'installment', name: 'ผ่อนทีวี', amount: 600, plan: { id: 'plan_1' } });
    const { container } = render(<UpcomingPayments upcoming={upcomingOf(inst)} />);
    fireEvent.click(screen.getByRole('button', { name: /กางดูรายการ/ }));
    const link = screen.getByRole('link', { name: 'เปิดดูรายการ ผ่อนทีวี 600.00 บาท' });
    expect(link).toHaveAttribute('href', '/credits?card=cc_a&focus=plan_1');
    expect(link.querySelector('button')).toBeNull();
    const button = screen.getByRole('button', { name: 'ยังไม่ชำระ — แตะเพื่อยืนยัน' });
    expect(link.contains(button)).toBe(false);
    expect(container.querySelector(NO_NESTING_SELECTOR)).toBeNull();
  });

  it('AC-3: a revolving item with a valid cycleMonth links to /credits?card&focus=card_month, buttons not descendants', () => {
    const rev = mk({ id: '2026-10_ccr_a', key: 'ccr_a', source: 'revolving', name: 'บัตร A', amount: 1000 });
    const { container } = render(<UpcomingPayments upcoming={upcomingOf(rev)} />);
    fireEvent.click(screen.getByRole('button', { name: /กางดูรายการ/ }));
    const link = screen.getByRole('link', { name: 'เปิดดูรายการ บัตร A 1,000.00 บาท' });
    expect(link).toHaveAttribute('href', '/credits?card=cc_a&focus=cc_a_2026-10');
    const fullBtn = screen.getByRole('button', { name: /จ่ายเต็มจำนวน/ });
    const minBtn = screen.getByRole('button', { name: 'จ่ายขั้นต่ำ' });
    expect(link.contains(fullBtn)).toBe(false);
    expect(link.contains(minBtn)).toBe(false);
    expect(container.querySelector(NO_NESTING_SELECTOR)).toBeNull();
  });

  it('AC-4: an UpcomingCard renders an <a> to /credits?card (no focus); toggle + panel not descendants', () => {
    const inst1 = mk({ id: '2026-10_cci_1', key: 'cci_1', source: 'installment', name: 'ผ่อนทีวี', amount: 600, plan: { id: 'plan_1' } });
    const inst2 = mk({ id: '2026-10_cci_2', key: 'cci_2', source: 'installment', name: 'ผ่อนตู้เย็น', amount: 300, plan: { id: 'plan_2' } });
    const { container } = render(<UpcomingPayments upcoming={upcomingOf(inst1, inst2)} />);
    const link = screen.getByRole('link', { name: /เปิดดูบัตร บัตร A ยอดที่ต้องชำระ/ });
    expect(link).toHaveAttribute('href', '/credits?card=cc_a');
    const toggle = screen.getByRole('button', { name: /กางดูรายการ/ });
    expect(link.contains(toggle)).toBe(false);
    const panel = container.querySelector('[id^="upcoming-card-panel-"]');
    expect(panel).not.toBeNull();
    expect(link.contains(panel)).toBe(false);
    expect(container.querySelector(NO_NESTING_SELECTOR)).toBeNull();
  });

  it('AC-5: no <a> ever nests an <a>/<button>, and no <button> nests an <a>, across every group + the expanded card', () => {
    const plain = { type: 'expense', paid: false, isoDate: '2026-11-10', daysDiff: 3, account: 'SCB', cycleMonth: '2026-11', card: null, id: 'rent', key: 'rent', source: 'plain', name: 'ค่าเช่า', amount: 5000 };
    const inst = mk({ id: '2026-10_cci_1', key: 'cci_1', source: 'installment', name: 'ผ่อนทีวี', amount: 600, plan: { id: 'plan_1' } });
    const rev = mk({ id: '2026-10_ccr_a', key: 'ccr_a', source: 'revolving', name: 'บัตร A', amount: 1000 });
    const { container } = render(<UpcomingPayments upcoming={upcomingOf(plain, inst, rev)} />);
    fireEvent.click(screen.getByRole('button', { name: /กางดูรายการ/ }));
    expect(container.querySelector(NO_NESTING_SELECTOR)).toBeNull();
  });

  it('AC-6: clicking each existing button still calls the same handler with the same argument, no navigation', () => {
    const onToggleInstallment = jest.fn();
    const onRevolvingFull = jest.fn();
    const onRevolvingMinimum = jest.fn();
    const inst = mk({ id: '2026-10_cci_1', key: 'cci_1', source: 'installment', name: 'ผ่อนทีวี', amount: 600, plan: { id: 'plan_1' } });
    const rev = mk({ id: '2026-10_ccr_a', key: 'ccr_a', source: 'revolving', name: 'บัตร A', amount: 1000 });
    render(<UpcomingPayments upcoming={upcomingOf(inst, rev)} {...{ onToggleInstallment, onRevolvingFull, onRevolvingMinimum }} />);
    fireEvent.click(screen.getByRole('button', { name: /กางดูรายการ/ }));
    fireEvent.click(screen.getByRole('button', { name: 'ยังไม่ชำระ — แตะเพื่อยืนยัน' }));
    expect(onToggleInstallment).toHaveBeenCalledWith(expect.objectContaining({ key: 'cci_1' }));
    fireEvent.click(screen.getByRole('button', { name: /จ่ายเต็มจำนวน/ }));
    expect(onRevolvingFull).toHaveBeenCalledWith(expect.objectContaining({ key: 'ccr_a' }));
    fireEvent.click(screen.getByRole('button', { name: 'จ่ายขั้นต่ำ' }));
    expect(onRevolvingMinimum).toHaveBeenCalledWith(expect.objectContaining({ key: 'ccr_a' }));
    expect(window.location.pathname).toBe('/');
  });

  it('AC-7: new <a> elements carry aria-label, FOCUS_RING, cursor-pointer, hover:bg-surface-3; outer card div has no cursor-pointer', () => {
    const inst = mk({ id: '2026-10_cci_1', key: 'cci_1', source: 'installment', name: 'ผ่อนทีวี', amount: 600, plan: { id: 'plan_1' } });
    const rev = mk({ id: '2026-10_ccr_a', key: 'ccr_a', source: 'revolving', name: 'บัตร A', amount: 1000 });
    const { container } = render(<UpcomingPayments upcoming={upcomingOf(inst, rev)} />);
    fireEvent.click(screen.getByRole('button', { name: /กางดูรายการ/ }));
    const instLink = screen.getByRole('link', { name: 'เปิดดูรายการ ผ่อนทีวี 600.00 บาท' });
    expect(instLink).toHaveAttribute('aria-label');
    expect(instLink.className).toContain('focus-visible:outline-accent');
    expect(instLink.className).toContain('cursor-pointer');
    expect(instLink.className).toContain('hover:bg-surface-3');

    const outerItemDiv = container.querySelector('#upcoming-item-cci_1') as HTMLElement;
    expect(outerItemDiv.tagName).toBe('DIV');
    expect(outerItemDiv.className).not.toContain('cursor-pointer');

    const cardLink = screen.getByRole('link', { name: /เปิดดูบัตร บัตร A/ });
    expect(cardLink.className).toContain('focus-visible:outline-accent');
    expect(cardLink.className).toContain('cursor-pointer');
    expect(cardLink.className).toContain('hover:bg-surface-3');
    const outerCardDiv = container.querySelector('[id^="upcoming-card-"]') as HTMLElement;
    expect(outerCardDiv.tagName).toBe('DIV');
    expect(outerCardDiv.className).not.toContain('cursor-pointer');
  });

  it('AC-8: a plain item whose href cannot be resolved renders no <a>', () => {
    // key ว่าง -> upcomingItemHref คืน null (เดือนถูกต้องแต่ key ว่าง)
    const unresolvable = { type: 'expense', paid: false, isoDate: '2026-11-10', daysDiff: 3, account: 'SCB', cycleMonth: '2026-11', card: null, id: 'o', key: '', source: 'plain', name: 'ไม่ทราบที่ไป', amount: 1 };
    const { container } = render(<UpcomingPayments upcoming={upcomingOf(unresolvable)} />);
    expect(screen.getByText('ไม่ทราบที่ไป')).toBeInTheDocument();
    expect(container.querySelector('a')).toBeNull();
  });

  it('AC-9: PaidItem renders no <a>', () => {
    const paidEvents = [
      { id: 'a', type: 'expense', source: 'revolving', key: 'rev1', name: 'บัตร A ยอดหมุนเวียน', amount: 1200, paid: true, card: { id: 'c1', name: 'บัตร A' }, isoDate: '2026-10-05' }
    ] as unknown as Props['paidEvents'];
    const { container } = render(<UpcomingPayments upcoming={{ overdue: [], dueToday: [], dueSoon: [], total: 0 } as unknown as Props['upcoming']} paidEvents={paidEvents} />);
    fireEvent.click(screen.getByRole('button', { name: /ชำระแล้วเดือนนี้/ }));
    expect(screen.getByText(/บัตร A ยอดหมุนเวียน/)).toBeInTheDocument();
    expect(container.querySelector('a')).toBeNull();
  });
});
