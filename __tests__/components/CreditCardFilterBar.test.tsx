import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CreditCardFilterBar from '../../src/frontend/components/CreditCardFilterBar';

const counts = [{ key: 'kbank' as const, count: 2 }, { key: 'scb' as const, count: 1 }];

describe('CreditCardFilterBar', () => {
  test('group semantics, ทั้งหมด (N) pressed when none selected, per-bank counts', () => {
    render(<CreditCardFilterBar counts={counts} total={3} selected={[]} onToggle={jest.fn()} onClear={jest.fn()} />);
    const group = screen.getByRole('group', { name: 'กรองตามธนาคาร' });
    expect(group.className).toMatch(/flex-nowrap/);
    expect(group.className).toMatch(/overflow-x-auto/);
    expect(screen.getByRole('button', { name: /ทั้งหมด \(3\)/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /ธนาคารกสิกรไทย \(2\)/ })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: /ธนาคารไทยพาณิชย์ \(1\)/ })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByTestId('cc-filter-live')).toHaveAttribute('aria-live', 'polite');
    expect(screen.getByTestId('cc-filter-live')).toHaveTextContent('');
  });

  test('selected chip shows check icon (not colour alone) and toggles/clears call back', async () => {
    const user = userEvent.setup();
    const onToggle = jest.fn();
    const onClear = jest.fn();
    render(<CreditCardFilterBar counts={counts} total={3} selected={['kbank']} onToggle={onToggle} onClear={onClear} />);
    const kbank = screen.getByRole('button', { name: /ธนาคารกสิกรไทย/ });
    expect(kbank).toHaveAttribute('aria-pressed', 'true');
    expect(kbank.querySelector('svg')).not.toBeNull();
    expect(kbank.className).toMatch(/border-2/);
    expect(screen.getByRole('button', { name: /ทั้งหมด/ })).toHaveAttribute('aria-pressed', 'false');
    await user.click(screen.getByRole('button', { name: /ธนาคารไทยพาณิชย์/ }));
    expect(onToggle).toHaveBeenCalledWith('scb');
    await user.click(screen.getByRole('button', { name: /ทั้งหมด/ }));
    expect(onClear).toHaveBeenCalled();
  });

  test('chips are 44px targets', () => {
    render(<CreditCardFilterBar counts={counts} total={3} selected={[]} onToggle={jest.fn()} onClear={jest.fn()} />);
    screen.getAllByRole('button').forEach(button => expect(button.className).toMatch(/min-h-11/));
  });
});
