// SavingsSourceSelect (UX_SPEC-savings-loan-withdrawal.md §4.2.1).
// F-S4-5: the disabled-option text for a negative balance must use the project's U+2212 minus-sign convention
// (same as SavingsLedgerPanel.tsx's pool-card figure), not the ASCII '-' that toLocaleString returns.
import { render, screen } from '@testing-library/react';
import SavingsSourceSelect, { buildSavingsSourceOptions } from '../../src/frontend/components/SavingsSourceSelect';

describe('SavingsSourceSelect', () => {
  it('uses U+2212 (not ASCII "-") for a negative available balance in the option text', () => {
    const options = buildSavingsSourceOptions(-1234, []);
    render(
      <SavingsSourceSelect
        id="source"
        options={options}
        value="pool"
        onChange={() => {}}
        className="field"
      />
    );

    const option = screen.getByRole('option', { name: /ยอดกลาง/ }) as HTMLOptionElement;
    expect(option.disabled).toBe(true);
    expect(option.textContent).toBe('ยอดกลาง — ใช้ไม่ได้ (ยอด −1,234.00 ฿)');
    // Guard against a regression back to the ASCII hyphen-minus.
    expect(option.textContent).not.toContain('-1,234.00');
  });

  it('still uses a plain formatted amount (no sign) for a non-negative, enabled option', () => {
    const options = buildSavingsSourceOptions(500, []);
    render(
      <SavingsSourceSelect
        id="source"
        options={options}
        value="pool"
        onChange={() => {}}
        className="field"
      />
    );

    const option = screen.getByRole('option', { name: /ยอดกลาง/ }) as HTMLOptionElement;
    expect(option.disabled).toBe(false);
    expect(option.textContent).toBe('ยอดกลาง — ใช้ได้ 500.00 ฿');
  });
});
