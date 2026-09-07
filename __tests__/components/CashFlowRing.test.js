import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CashFlowRing from '../../src/frontend/components/CashFlowRing';

// Plain object fixtures shaped like getMonthlySummaryModel()'s real return value — no jest.mock()
// anywhere in this file (per spec §"Test data shape", AC-3). CashFlowRing has zero Context/router/
// API dependency, so a plain model literal fully exercises every branch.
function buildModel(overrides = {}) {
  const base = {
    hasIncome: true,
    totalIncome: 40000,
    totalOutflow: 30000,
    netCashFlow: 10000,
    generalExpense: 15000,
    dailyExpense: 5000,
    savings: 8000,
    creditCard: 2000,
    ratios: {
      generalExpense: 37.5,
      dailyExpense: 12.5,
      savings: 20,
      creditCard: 5
    }
  };
  return { ...base, ...overrides };
}

describe('CashFlowRing', () => {
  describe('no-income empty state', () => {
    it('renders empty-state copy and the "เพิ่มรายรับ" link when model.hasIncome is falsy', () => {
      render(<CashFlowRing model={buildModel({ hasIncome: false })} />);

      expect(screen.getByText('ยังคำนวณสัดส่วนไม่ได้')).toBeInTheDocument();
      expect(screen.getByText('ยังไม่มีรายรับในเดือนนี้')).toBeInTheDocument();
      const link = screen.getByRole('link', { name: 'เพิ่มรายรับ' });
      expect(link).toHaveAttribute('href', '/workspace/income');
      expect(screen.queryByRole('img')).not.toBeInTheDocument();
    });

    it('renders the same empty state when model itself is null', () => {
      render(<CashFlowRing model={null} />);

      expect(screen.getByText('ยังคำนวณสัดส่วนไม่ได้')).toBeInTheDocument();
      expect(screen.queryByRole('img')).not.toBeInTheDocument();
    });
  });

  describe('populated state, under-income', () => {
    it('renders the ring svg with a descriptive aria-label and a non-neg outer stroke', () => {
      const model = buildModel();
      render(<CashFlowRing model={model} monthLabel="กันยายน 2569" />);

      const svg = screen.getByRole('img');
      const label = svg.getAttribute('aria-label');
      expect(label).toContain('รายรับ 40,000.00 บาท');
      expect(label).toContain('รายจ่ายทั่วไป 15,000.00 บาท คิดเป็น 37.5% ของรายรับ');
      expect(label).toContain('เงินออม 8,000.00 บาท คิดเป็น 20.0% ของรายรับ');

      const outerRing = svg.querySelector('circle[stroke-width="6"]');
      expect(outerRing).toHaveAttribute('stroke', 'var(--border-default)');
      expect(outerRing).not.toHaveAttribute('stroke', 'var(--neg)');

      // Under-income: no "เกินรายรับ" over-amount text should render.
      expect(screen.queryByText(/เกินรายรับ/)).not.toBeInTheDocument();
    });
  });

  describe('over-income re-normalization (AC-DB-3/E8/E9)', () => {
    it('renders the over-income text with the correct over-amount and flips the outer ring to var(--neg)', () => {
      // totalOutflow (36,000) > totalIncome (30,000) — the re-normalization branch (source lines 79-80).
      const model = buildModel({
        totalIncome: 30000,
        totalOutflow: 36000,
        netCashFlow: -6000,
        generalExpense: 20000,
        dailyExpense: 6000,
        savings: 8000,
        creditCard: 2000
      });
      render(<CashFlowRing model={model} />);

      // 36000 - 30000 = 6000
      expect(screen.getByText('เกินรายรับ 6,000.00 ฿')).toBeInTheDocument();

      const svg = screen.getByRole('img');
      const outerRing = svg.querySelector('circle[stroke-width="6"]');
      expect(outerRing).toHaveAttribute('stroke', 'var(--neg)');
    });
  });

  describe('MIN_ARC_RATIO floor (ADR-015)', () => {
    it('a tiny non-zero segment still gets a non-zero dasharray, but a genuinely-zero segment does not', () => {
      // 1 บาทออกจากยอดรวม 100,000 บาท (< 1.5% MIN_ARC_RATIO) — must still be visible.
      // creditCard is exactly 0 — must NOT get the floor applied (arcRatio must stay 0).
      const model = buildModel({
        totalIncome: 100000,
        totalOutflow: 100000,
        netCashFlow: 0,
        generalExpense: 1,
        dailyExpense: 79999,
        savings: 20000,
        creditCard: 0,
        ratios: { generalExpense: 0.001, dailyExpense: 79.999, savings: 20, creditCard: 0 }
      });
      const { container } = render(<CashFlowRing model={model} interactive={false} />);

      // Arc circles are the colored (non-hit-ring) circles inside the aria-hidden <g>, one per segment,
      // in SEGMENT_DEFS order: generalExpense, dailyExpense, savings, creditCard.
      const hiddenGroup = container.querySelector('svg g[aria-hidden="true"]');
      const arcCircles = Array.from(hiddenGroup.querySelectorAll('circle'));
      expect(arcCircles).toHaveLength(4); // interactive=false → no hit rings, one arc circle per segment

      const [generalExpenseArc, , , creditCardArc] = arcCircles;
      const generalExpenseDashLen = parseFloat(generalExpenseArc.getAttribute('stroke-dasharray'));
      expect(generalExpenseDashLen).toBeGreaterThan(0); // floor applied — never fully invisible

      const creditCardDasharray = creditCardArc.getAttribute('stroke-dasharray');
      expect(creditCardDasharray.startsWith('0 ')).toBe(true); // genuinely-zero amount — floor must NOT apply
    });
  });

  describe('interactive=true (default)', () => {
    it('clicking a legend row calls onSelect with the segment id, and toggles off when already selected', async () => {
      const user = userEvent.setup();
      const onSelect = jest.fn();
      const model = buildModel();
      const { rerender } = render(<CashFlowRing model={model} onSelect={onSelect} selected={null} />);

      const row = screen.getByRole('button', { name: /รายจ่ายทั่วไป/ });
      await user.click(row);
      expect(onSelect).toHaveBeenCalledWith('generalExpense');

      onSelect.mockClear();
      // Re-render as if that segment is now selected — clicking again should toggle off (call with null).
      rerender(<CashFlowRing model={model} onSelect={onSelect} selected="generalExpense" />);
      const rowAgain = screen.getByRole('button', { name: /รายจ่ายทั่วไป/ });
      await user.click(rowAgain);
      expect(onSelect).toHaveBeenCalledWith(null);
    });

    it('renders a hit-ring circle with pointerEvents:auto for a segment with arcRatio > 0', () => {
      const model = buildModel();
      const { container } = render(<CashFlowRing model={model} interactive />);
      const circles = Array.from(container.querySelectorAll('svg g[aria-hidden="true"] circle'));
      const hitRings = circles.filter((c) => c.style.pointerEvents === 'auto');
      expect(hitRings.length).toBeGreaterThan(0);
    });
  });

  describe('interactive=false', () => {
    it('renders legend rows as plain divs (no role="button") and no hit-ring circles', () => {
      const model = buildModel();
      const { container } = render(<CashFlowRing model={model} interactive={false} />);

      expect(screen.queryAllByRole('button')).toHaveLength(0);

      const circles = Array.from(container.querySelectorAll('svg g[aria-hidden="true"] circle'));
      const hitRings = circles.filter((c) => c.style.pointerEvents === 'auto');
      expect(hitRings).toHaveLength(0); // AC-DB-32: no invisible-but-clickable ring left behind
    });
  });

  describe('selected prop dims non-selected segments', () => {
    it('renders the selected arc at opacity 1 and the rest at opacity 0.45', () => {
      const model = buildModel();
      const { container } = render(<CashFlowRing model={model} selected="savings" />);

      const arcCircles = Array.from(container.querySelectorAll('svg g[aria-hidden="true"] circle')).filter(
        (c) => c.style.pointerEvents === 'none'
      );
      expect(arcCircles).toHaveLength(4);

      // Order follows SEGMENT_DEFS: generalExpense, dailyExpense, savings, creditCard.
      const [generalExpenseArc, dailyExpenseArc, savingsArc, creditCardArc] = arcCircles;
      expect(savingsArc).toHaveAttribute('opacity', '1');
      expect(generalExpenseArc).toHaveAttribute('opacity', '0.45');
      expect(dailyExpenseArc).toHaveAttribute('opacity', '0.45');
      expect(creditCardArc).toHaveAttribute('opacity', '0.45');
    });
  });
});
