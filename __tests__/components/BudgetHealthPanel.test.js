import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import BudgetHealthPanel from '../../src/frontend/components/BudgetHealthPanel';
import { DEFAULT_BUDGET_THRESHOLDS } from '../../src/shared/utils/frontend/monthlySummary';

// Plain object fixtures shaped like getMonthlySummaryModel()'s real return value, run through the
// real (unmocked) evaluateBudgetHealth() — no jest.mock() anywhere in this file (AC-3). Ratios are
// picked relative to DEFAULT_BUDGET_THRESHOLDS so each fixture lands in a known status bucket
// (classifyMaxUsage/classifyMinUsage in monthlySummary.js): usage < 0.8 => 'ok', usage >= 1 (min) =>
// 'on-target'.
function buildHealthyModel() {
  return {
    hasIncome: true,
    totalIncome: 40000,
    generalExpense: 8000, // 20% of 40000, threshold 50 -> usage 0.4 -> ok
    dailyExpense: 2000,   // 5%, threshold 15 -> usage 0.33 -> ok
    savings: 10000,       // 25%, threshold 20 -> usage 1.25 -> on-target
    creditCard: 1000,     // 2.5%, threshold 15 -> usage 0.16 -> ok
    transferableSavings: 5000,
    ratios: {
      generalExpense: 20,
      dailyExpense: 5,
      savings: 25,
      creditCard: 2.5
    }
  };
}

function buildAttentionModel() {
  return {
    hasIncome: true,
    totalIncome: 40000,
    generalExpense: 24000, // 60%, threshold 50 -> usage 1.2 -> critical (attention)
    dailyExpense: 3000,    // ok
    savings: 2000,         // 5%, threshold 20 -> usage 0.25 -> below-target (attention)
    creditCard: 1000,      // ok
    transferableSavings: 0,
    ratios: {
      generalExpense: 60,
      dailyExpense: 7.5,
      savings: 5,
      creditCard: 2.5
    }
  };
}

function buildUnavailableModel() {
  return { hasIncome: false, ratios: null };
}

describe('BudgetHealthPanel', () => {
  describe('unavailable state', () => {
    it('renders the rollup message as trailing text and inside the content, with no BudgetRows and no transfer action', () => {
      render(
        <BudgetHealthPanel
          model={buildUnavailableModel()}
          thresholds={DEFAULT_BUDGET_THRESHOLDS}
          onConfirmTransfer={jest.fn()}
          isConfirmingTransfer={false}
        />
      );

      const toggle = screen.getByRole('button', { name: /สุขภาพงบประมาณ/ });
      expect(toggle).toHaveTextContent('ยังไม่มีข้อมูลรายรับสำหรับเดือนนี้');
      expect(screen.getAllByText('ยังไม่มีข้อมูลรายรับสำหรับเดือนนี้').length).toBeGreaterThanOrEqual(2);
      // Content is collapsed (inert) by default, so query with hidden:true to reach into it.
      expect(screen.getByRole('link', { name: 'เพิ่มรายรับ', hidden: true })).toHaveAttribute('href', '/workspace/income');
      expect(screen.queryByText(/บิลและรายจ่าย|ค่าใช้จ่ายรายวัน|เงินออม|บัตรเครดิต/)).not.toBeInTheDocument();
      expect(screen.queryByText('เพิ่มเข้าเงินออม')).not.toBeInTheDocument();
      expect(screen.queryByText('เงินออมที่โอนได้')).not.toBeInTheDocument();
    });

    it('renders the same unavailable state when model is null', () => {
      render(
        <BudgetHealthPanel
          model={null}
          thresholds={DEFAULT_BUDGET_THRESHOLDS}
          onConfirmTransfer={jest.fn()}
          isConfirmingTransfer={false}
        />
      );
      expect(screen.getAllByText('ยังไม่มีข้อมูลรายรับสำหรับเดือนนี้').length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('default collapsed on mount, no attention items (AC-DB-29)', () => {
    it('mounts with aria-expanded="false" and content aria-hidden="true"', () => {
      const { container } = render(
        <BudgetHealthPanel
          model={buildHealthyModel()}
          thresholds={DEFAULT_BUDGET_THRESHOLDS}
          onConfirmTransfer={jest.fn()}
          isConfirmingTransfer={false}
        />
      );

      const toggle = screen.getByRole('button', { name: /สุขภาพงบประมาณ/ });
      expect(toggle).toHaveAttribute('aria-expanded', 'false');

      const contentDiv = container.querySelector('div[style*="grid-template-rows"]');
      expect(contentDiv).toHaveAttribute('aria-hidden', 'true');
    });
  });

  describe('auto-expand exception (AC-DB-29)', () => {
    it('mounts with aria-expanded="true" when attentionCount > 0', () => {
      const { container } = render(
        <BudgetHealthPanel
          model={buildAttentionModel()}
          thresholds={DEFAULT_BUDGET_THRESHOLDS}
          onConfirmTransfer={jest.fn()}
          isConfirmingTransfer={false}
        />
      );

      const toggle = screen.getByRole('button', { name: /สุขภาพงบประมาณ/ });
      expect(toggle).toHaveAttribute('aria-expanded', 'true');

      const contentDiv = container.querySelector('div[style*="grid-template-rows"]');
      expect(contentDiv).toHaveAttribute('aria-hidden', 'false');
    });
  });

  describe('user toggle wins over auto-expand (userToggled guard)', () => {
    it('stays collapsed after a manual collapse even when a re-render still has attentionCount > 0', async () => {
      const user = userEvent.setup();
      const model = buildAttentionModel();
      const { rerender } = render(
        <BudgetHealthPanel
          model={model}
          thresholds={DEFAULT_BUDGET_THRESHOLDS}
          onConfirmTransfer={jest.fn()}
          isConfirmingTransfer={false}
        />
      );

      const toggle = screen.getByRole('button', { name: /สุขภาพงบประมาณ/ });
      expect(toggle).toHaveAttribute('aria-expanded', 'true'); // auto-expanded first

      await user.click(toggle); // user manually collapses
      expect(toggle).toHaveAttribute('aria-expanded', 'false');

      // Re-render with a new thresholds object identity (still attentionCount > 0 for this model) —
      // the auto-expand effect must NOT fight the user's own collapse.
      rerender(
        <BudgetHealthPanel
          model={model}
          thresholds={{ ...DEFAULT_BUDGET_THRESHOLDS }}
          onConfirmTransfer={jest.fn()}
          isConfirmingTransfer={false}
        />
      );
      expect(toggle).toHaveAttribute('aria-expanded', 'false');
    });
  });

  describe('manual toggle, healthy model', () => {
    it('expands on click and collapses again on a second click', async () => {
      const user = userEvent.setup();
      const { container } = render(
        <BudgetHealthPanel
          model={buildHealthyModel()}
          thresholds={DEFAULT_BUDGET_THRESHOLDS}
          onConfirmTransfer={jest.fn()}
          isConfirmingTransfer={false}
        />
      );

      const toggle = screen.getByRole('button', { name: /สุขภาพงบประมาณ/ });
      const contentDiv = container.querySelector('div[style*="grid-template-rows"]');

      expect(toggle).toHaveAttribute('aria-expanded', 'false');
      await user.click(toggle);
      expect(toggle).toHaveAttribute('aria-expanded', 'true');
      expect(contentDiv).toHaveAttribute('aria-hidden', 'false');

      await user.click(toggle);
      expect(toggle).toHaveAttribute('aria-expanded', 'false');
      expect(contentDiv).toHaveAttribute('aria-hidden', 'true');
    });
  });

  describe('BudgetRow rendering, per-row content', () => {
    it('renders each category row label, formatted amount, ratio percentage, and statusLabel', () => {
      render(
        <BudgetHealthPanel
          model={buildAttentionModel()}
          thresholds={DEFAULT_BUDGET_THRESHOLDS}
          onConfirmTransfer={jest.fn()}
          isConfirmingTransfer={false}
        />
      );

      // generalExpense: amount 24000, ratio 60.0%, status 'critical' -> 'เกินเกณฑ์มาก'
      expect(screen.getByText('บิลและรายจ่าย')).toBeInTheDocument();
      expect(screen.getByText('24,000.00 ฿')).toBeInTheDocument();
      expect(screen.getByText('60.0%')).toBeInTheDocument();
      expect(screen.getByText('เกินเกณฑ์มาก')).toBeInTheDocument();

      // savings: amount 2000, ratio 5.0%, status 'below-target' -> 'ต่ำกว่าเป้าหมาย'
      expect(screen.getByText('เงินออม')).toBeInTheDocument();
      expect(screen.getByText('2,000.00 ฿')).toBeInTheDocument();
      expect(screen.getByText('ต่ำกว่าเป้าหมาย')).toBeInTheDocument();

      // dailyExpense / creditCard remain 'ok' -> 'ปกติ' (appears twice)
      expect(screen.getByText('ค่าใช้จ่ายรายวัน')).toBeInTheDocument();
      expect(screen.getByText('บัตรเครดิต')).toBeInTheDocument();
      expect(screen.getAllByText('ปกติ').length).toBe(2);
    });
  });

  describe('transferable-savings action, available', () => {
    it('calls onConfirmTransfer on click and shows the in-progress label while confirming', async () => {
      const user = userEvent.setup();
      const onConfirmTransfer = jest.fn();
      const { rerender } = render(
        <BudgetHealthPanel
          model={buildHealthyModel()} // transferableSavings: 5000 > 0
          thresholds={DEFAULT_BUDGET_THRESHOLDS}
          onConfirmTransfer={onConfirmTransfer}
          isConfirmingTransfer={false}
        />
      );

      const confirmButton = screen.getByRole('button', { name: 'เพิ่มเข้าเงินออม' });
      expect(confirmButton).not.toBeDisabled();
      await user.click(confirmButton);
      expect(onConfirmTransfer).toHaveBeenCalledTimes(1);

      rerender(
        <BudgetHealthPanel
          model={buildHealthyModel()}
          thresholds={DEFAULT_BUDGET_THRESHOLDS}
          onConfirmTransfer={onConfirmTransfer}
          isConfirmingTransfer
        />
      );
      const inProgressButton = screen.getByRole('button', { name: 'กำลังเพิ่มเข้าเงินออม...' });
      expect(inProgressButton).toBeDisabled();
    });
  });

  describe('transferable-savings action, unavailable', () => {
    it('renders the no-savings-available copy instead of a button when transferableSavings <= 0', () => {
      render(
        <BudgetHealthPanel
          model={buildAttentionModel()} // transferableSavings: 0
          thresholds={DEFAULT_BUDGET_THRESHOLDS}
          onConfirmTransfer={jest.fn()}
          isConfirmingTransfer={false}
        />
      );

      expect(screen.getByText('เดือนนี้ยังไม่มีเงินเหลือพร้อมออม')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /เพิ่มเข้าเงินออม/ })).not.toBeInTheDocument();
    });
  });
});
