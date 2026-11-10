import fs from 'fs';
import path from 'path';
import { fireEvent, render, screen, within } from '@testing-library/react';
import AccountBreakdownPanel, { toBreakdownView } from '../../src/frontend/components/AccountBreakdownPanel';
import { getAccountBreakdown, type AccountBreakdown, type AccountBreakdownItem } from '../../src/shared/utils/commonUtils';
import { parseToNumber } from '../../src/shared/utils/frontend/numberUtils';

const item = (over: Partial<AccountBreakdownItem> & { key: string }): AccountBreakdownItem => ({
  name: over.key, amount: 0, account: 'กสิกร', paid: false, ...over
});
const bucket = (items: AccountBreakdownItem[], paidItems: AccountBreakdownItem[] = []): AccountBreakdown => ({
  items, paidItems, total: items.reduce((s, i) => s + i.amount, 0)
});

const cardBreakdown = {
  installments: [
    { key: 'cci_1', name: 'โทรศัพท์ งวด 2/10', amount: 1000, paid: false },
    { key: 'cci_2', name: 'ทีวี งวด 1/4', amount: 1500, paid: true }
  ],
  installmentTotal: 2500,
  revolving: { newSpend: 3000, carriedBalance: 500, cashbackAmount: 35.5, totalDue: 3965.34, minPaymentDue: 400, amountDue: 3965.34, paymentAction: 'minimum' as const }
};

const november = () => ({
  beIn: { name: 'Be in', account: 'กสิกร', actual: '349.00', paid: false },
  wed: { name: 'คืนพุธ Membership', account: 'กสิกร', actual: '80.00', paid: false },
  netflix: { name: 'Netflix', account: 'กสิกร', actual: '617.00', paid: false, dueDay: 5 },
  youtube: { name: 'YouTube', account: 'กสิกร', actual: '519.00', paid: false },
  rubsarb: { name: 'Rubsarb Membership', account: 'กสิกร', actual: '200.00', paid: false },
  ccr_kbankShopee: {
    name: 'ยอดบัตร K-bank Shopee', account: 'กสิกร', actual: '6,465.34', paid: false,
    cycleMonth: '2026-11', resolvedDueDate: '2026-11-20', breakdown: cardBreakdown
  },
  ccr_shopeepay: {
    name: 'ยอดบัตร Shopee pay', account: 'กสิกร', actual: '4,475.66', paid: true,
    cycleMonth: '2026-10', resolvedDueDate: '2026-11-10'
  }
});

function renderPanel(breakdown: AccountBreakdown | undefined, onClose = jest.fn()) {
  render(
    <AccountBreakdownPanel
      id="p1" titleId="p1-title" columnLabel="เดือนนี้" account="กสิกร"
      breakdown={breakdown} columnMonthKey="2026-11" onClose={onClose}
    />
  );
  return onClose;
}

describe('toBreakdownView', () => {
  test('sorts by amount desc, then Thai name, then key; splits zero rows; paid zero rows dropped', () => {
    const view = toBreakdownView(bucket([
      item({ key: 'k2', name: 'ข', amount: 10 }),
      item({ key: 'k1', name: 'ก', amount: 10 }),
      item({ key: 'k3', name: 'ก', amount: 10 }),
      item({ key: 'big', name: 'Z', amount: 99 }),
      item({ key: 'zero', amount: 0 }),
      item({ key: 'neg', amount: -5 })
    ], [item({ key: 'p0', amount: 0, paid: true }), item({ key: 'p1', amount: 3, paid: true })]));
    expect(view.listed.map(i => i.key)).toEqual(['big', 'k1', 'k3', 'k2', 'neg']);
    expect(view.zeroCount).toBe(1);
    expect(view.paidListed.map(i => i.key)).toEqual(['p1']);
  });

  test('is NaN-safe and does not mutate its input', () => {
    const items = [item({ key: 'b', amount: NaN }), item({ key: 'a', amount: 2 })];
    const input = bucket(items);
    expect(() => toBreakdownView(input)).not.toThrow();
    expect(input.items.map(i => i.key)).toEqual(['b', 'a']);
    expect(toBreakdownView(undefined)).toEqual({ listed: [], zeroCount: 0, paidListed: [] });
  });
});

describe('AccountBreakdownPanel', () => {
  test('AC-4 worked example: header, order, card caption and collapsed paid group', () => {
    const breakdown = getAccountBreakdown(november(), ['กสิกร'], { parseAmount: parseToNumber })['กสิกร'];
    renderPanel(breakdown);
    const region = screen.getByRole('region', { name: /เดือนนี้ · กสิกร/ });
    expect(region).toHaveTextContent('รวม 8,230.34 บาท · 6 รายการ');
    const rows = within(region).getAllByRole('listitem').map(li => li.textContent ?? '');
    const amounts = ['6,465.34', '617.00', '519.00', '349.00', '200.00', '80.00'];
    amounts.forEach((amount, index) => expect(rows[index]).toContain(amount));
    expect(rows[0]).toContain('รอบบิล พ.ย. 2569');
    expect(rows[0]).toContain('ผ่อน 2 งวด · ไม่ผ่อน 3,965.34');
    expect(rows[2 - 1]).toContain('ครบกำหนดวันที่ 5');
    // sub-lines hidden until activated
    expect(screen.queryByText('ยอดไม่ผ่อนที่ต้องชำระ')).not.toBeInTheDocument();
    const paidToggle = screen.getByRole('button', { name: 'จ่ายแล้ว 1 รายการ (ไม่นับในยอด)' });
    expect(paidToggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('ยอดบัตร Shopee pay')).not.toBeInTheDocument();
    fireEvent.click(paidToggle);
    expect(paidToggle).toHaveAttribute('aria-expanded', 'true');
    const paidList = screen.getByRole('list', { name: 'จ่ายแล้ว ไม่นับรวมในยอด' });
    expect(paidList).toHaveTextContent('ยอดบัตร Shopee pay');
    expect(paidList).toHaveTextContent('4,475.66');
    expect(paidList).toHaveTextContent('รอบบิล ต.ค. 2569 · ครบกำหนด 10 พ.ย. 2569');
    // header total unchanged by expanding
    expect(region).toHaveTextContent('รวม 8,230.34 บาท · 6 รายการ');
    expect(paidToggle.getAttribute('aria-controls')).toBe(paidList.id);
    // no opacity dimming, secondary token used
    expect(paidList.innerHTML).not.toMatch(/opacity-/);
    expect(paidList.innerHTML).toContain('text-secondary');
  });

  test('card row disclosure shows installment lines, clamped non-installment line, spend parts and minimum caption', () => {
    const breakdown = getAccountBreakdown(november(), ['กสิกร'], { parseAmount: parseToNumber })['กสิกร'];
    renderPanel(breakdown);
    const toggle = screen.getByRole('button', { name: /ยอดบัตร K-bank Shopee/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    const controls = toggle.getAttribute('aria-controls')!;
    expect(document.getElementById(controls)).toBeNull();
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const nested = document.getElementById(controls)!;
    expect(nested).not.toBeNull();
    expect(nested).toHaveTextContent('โทรศัพท์ งวด 2/10');
    expect(nested).toHaveTextContent('1,000.00');
    expect(nested).toHaveTextContent('ทีวี งวด 1/4');
    expect(within(nested).getAllByText('ชำระแล้ว')).toHaveLength(1);
    expect(nested).toHaveTextContent('ยอดไม่ผ่อนที่ต้องชำระ');
    expect(nested).toHaveTextContent('3,965.34');
    expect(nested).toHaveTextContent('ใช้จ่ายใหม่ 3,000.00 · ยอดยกมา 500.00 · เงินคืน 35.50');
    expect(nested).toHaveTextContent('ชำระขั้นต่ำแล้ว 400.00');
    fireEvent.click(toggle);
    expect(document.getElementById(controls)).toBeNull();
  });

  test('negative totalDue is clamped to 0 and the non-installment part is omitted', () => {
    const breakdown = bucket([item({
      key: 'ccr_a', name: 'บัตร A', amount: 100,
      breakdown: {
        installments: [{ key: 'cci_x', name: 'งวด', amount: 100, paid: false }], installmentTotal: 100,
        revolving: { newSpend: 0, carriedBalance: 0, cashbackAmount: 0, totalDue: -250, minPaymentDue: 0, amountDue: 0, paymentAction: null }
      }
    })]);
    renderPanel(breakdown);
    const toggle = screen.getByRole('button', { name: /บัตร A/ });
    expect(toggle).toHaveTextContent('ผ่อน 1 งวด');
    expect(toggle).not.toHaveTextContent('ไม่ผ่อน');
    fireEvent.click(toggle);
    expect(screen.queryByText('ยอดไม่ผ่อนที่ต้องชำระ')).not.toBeInTheDocument();
  });

  test('card row without a usable breakdown renders as a plain item (DD-10); legacy credit_ keys are plain', () => {
    renderPanel(bucket([
      item({ key: 'ccr_old', name: 'บัตรเก่า', amount: 50, cycleMonth: '2026-11' }),
      item({ key: 'credit_kbank', name: 'บัตรเดิม', amount: 40 }),
      item({ key: 'ccr_bad', name: 'บัตรพัง', amount: 30, breakdown: { installments: 'x' } as never })
    ]));
    expect(screen.queryByRole('button', { name: /บัตรเก่า|บัตรเดิม|บัตรพัง/ })).not.toBeInTheDocument();
    expect(screen.getByText('บัตรเก่า').closest('li')).toHaveTextContent('รอบบิล พ.ย. 2569');
  });

  test('empty state (R3), zero-amount line, negatives are listed', () => {
    renderPanel(bucket([item({ key: 'z1', amount: 0 }), item({ key: 'z2', amount: 0 })]));
    expect(screen.getByText('ไม่มีรายการค้างจ่าย')).toBeInTheDocument();
    expect(screen.getByRole('region')).toHaveTextContent('รวม 0.00 บาท · 0 รายการ');
    expect(screen.getByText('ยังไม่กรอกยอดอีก 2 รายการ')).toBeInTheDocument();
  });

  test('negative amounts are listed and counted', () => {
    renderPanel(bucket([item({ key: 'n', name: 'คืนเงิน', amount: -20 }), item({ key: 'p', name: 'ปกติ', amount: 5 })]));
    expect(screen.getByText('คืนเงิน')).toBeInTheDocument();
    expect(screen.getByRole('region')).toHaveTextContent('รวม -15.00 บาท · 2 รายการ');
  });

  test('paid group is hidden when there are no paid rows; empty state still shows with paid rows (AC-7)', () => {
    renderPanel(bucket([], [item({ key: 'p', name: 'จ่ายแล้วหนึ่ง', amount: 9, paid: true })]));
    expect(screen.getByText('ไม่มีรายการค้างจ่าย')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'จ่ายแล้ว 1 รายการ (ไม่นับในยอด)' })).toBeInTheDocument();
  });

  test('long Thai names wrap (wrap classes) and the amount stays nowrap', () => {
    const longName = 'ค่าสมาชิกรายปีบริการสตรีมมิ่งพร้อมแพ็กเกจพิเศษสำหรับครอบครัวและเพื่อนสนิทมากมายหลายคน'.repeat(2);
    renderPanel(bucket([item({ key: 'long', name: longName, amount: 12 })]));
    const li = screen.getByText(longName).closest('li')!;
    expect(screen.getByText(longName).className).toMatch(/break-words/);
    expect(within(li).getByText('12.00').className).toMatch(/whitespace-nowrap/);
  });

  test('Escape anywhere in the panel and the hide button call onClose; other keys do not', () => {
    const onClose = renderPanel(bucket([item({ key: 'a', name: 'A', amount: 5 })]));
    fireEvent.keyDown(screen.getByText('A'), { key: 'Enter' });
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByText('A'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'ซ่อนรายละเอียด' }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  test('Escape on a nested disclosure closes the whole panel via onClose (AC-27)', () => {
    const breakdown = getAccountBreakdown(november(), ['กสิกร'], { parseAmount: parseToNumber })['กสิกร'];
    const onClose = renderPanel(breakdown);
    const toggle = screen.getByRole('button', { name: /ยอดบัตร K-bank Shopee/ });
    fireEvent.click(toggle);
    fireEvent.keyDown(toggle, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('every control is >=44px (min-h-11) with the focus ring; numbers use the numeric font', () => {
    const breakdown = getAccountBreakdown(november(), ['กสิกร'], { parseAmount: parseToNumber })['กสิกร'];
    renderPanel(breakdown);
    screen.getAllByRole('button').forEach(button => {
      expect(button.className).toMatch(/min-h-11/);
      expect(button.className).toMatch(/focus-visible:outline-accent/);
    });
    expect(screen.getByText('617.00').className).toMatch(/var\(--font-numeric\)/);
    expect(screen.getByText('617.00').className).toMatch(/tabular-nums/);
    expect(document.querySelector('[aria-hidden="true"]')!.className).toMatch(/motion-reduce:transition-none/);
  });

  test('AC-9 spy: panel and table sources do not import card math', () => {
    const root = path.join(__dirname, '../../src/frontend/components');
    ['AccountBreakdownPanel.tsx', 'BankAccountTable.tsx'].forEach(file => {
      const imports = fs.readFileSync(path.join(root, file), 'utf8')
        .split(/\r?\n/)
        .filter(line => /^import /.test(line))
        .join(' ');
      expect(imports).not.toMatch(/buildSchedule|buildRevolvingCycles|creditCardRevolving|creditCardInstallment/);
    });
  });
});
