import { render, waitFor } from '@testing-library/react';
import CreditCardsRedirect from '../../pages/credit-cards';
import { showToast } from '../../src/shared/utils/frontend/toast';

// pages/credit-cards.tsx is now a redirect shim to /credits (ADR-035, loan-installments S1).
// This test only covers I-7 — the shim itself — not any loan-card content (none exist yet).

let mockIsReady = true;
let mockQuery: Record<string, string> = {};
const mockReplace = jest.fn();

jest.mock('next/router', () => ({
  useRouter: () => ({ isReady: mockIsReady, query: mockQuery, replace: mockReplace })
}));
jest.mock('../../src/shared/utils/frontend/toast', () => ({ showToast: jest.fn() }));

beforeEach(() => {
  mockIsReady = true;
  mockQuery = {};
  mockReplace.mockClear();
  (showToast as jest.Mock).mockClear();
});

describe('pages/credit-cards.tsx (redirect shim)', () => {
  it('shows one info toast and replaces to /credits with no query, once router is ready', async () => {
    render(<CreditCardsRedirect />);

    await waitFor(() => expect(mockReplace).toHaveBeenCalledTimes(1));

    expect(showToast).toHaveBeenCalledTimes(1);
    expect(showToast).toHaveBeenCalledWith('ย้ายไปหน้าบัตร & สินเชื่อ', 'info');
    expect(mockReplace).toHaveBeenCalledWith({ pathname: '/credits', query: {} });
  });

  it('preserves the incoming query string on replace (e.g. ?card=...)', async () => {
    mockQuery = { card: 'cc_abc' };
    render(<CreditCardsRedirect />);

    await waitFor(() => expect(mockReplace).toHaveBeenCalledTimes(1));

    expect(mockReplace).toHaveBeenCalledWith({ pathname: '/credits', query: { card: 'cc_abc' } });
  });

  it('does nothing while the router is not yet ready', () => {
    mockIsReady = false;
    render(<CreditCardsRedirect />);

    expect(mockReplace).not.toHaveBeenCalled();
    expect(showToast).not.toHaveBeenCalled();
  });

  it('renders nothing', () => {
    const { container } = render(<CreditCardsRedirect />);
    expect(container).toBeEmptyDOMElement();
  });
});
