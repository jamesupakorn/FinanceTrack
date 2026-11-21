/**
 * savings-loan-withdrawal S6 (C-S6-1/AC-SLW-44's label half) — the six new `RESOURCE_LABELS` keys
 * added for loan/withdrawal/carry-forward audit events (architecture review §2(f)/§3 C-S6-1). A new
 * sibling test file per D-S6-2 — ActivityHistory.test.tsx itself is not edited.
 */
import { afterEach, describe, expect, it } from '@jest/globals';
import { render, screen } from '@testing-library/react';
import ActivityHistory from '../../src/frontend/components/ActivityHistory';
import { auditLogAPI } from '../../src/shared/utils/frontend/apiUtils';

jest.mock('../../src/shared/utils/frontend/apiUtils', () => ({
  auditLogAPI: { list: jest.fn() },
}));

const list = jest.mocked(auditLogAPI.list);

const item = (id: string, resource: string) => ({
  eventId: id, occurredAt: '2026-03-01T10:00:00.000Z', actorType: 'user', source: 'savings_loans',
  resource, action: 'created', changedFields: [],
});

afterEach(() => { jest.clearAllMocks(); jest.restoreAllMocks(); });

describe('ActivityHistory — savings-loan-withdrawal resource labels (C-S6-1)', () => {
  it.each([
    ['savings-loans', 'การยืมเงินออม'],
    ['savingsLoans', 'การยืมเงินออม'],
    ['savings-withdrawals', 'การถอนเงินออม'],
    ['savingsWithdrawals', 'การถอนเงินออม'],
    ['savings-carry-forward', 'ยอดยกมาจากเงินออมเก่า'],
    ['savingsCarryForward', 'ยอดยกมาจากเงินออมเก่า'],
  ])('renders the Thai label for resource %s', async (resource, label) => {
    list.mockResolvedValueOnce({ items: [item('1', resource)], nextCursor: null } as never);
    render(<ActivityHistory />);
    expect(await screen.findByText(new RegExp(label))).toBeTruthy();
    expect(screen.queryByText(/ข้อมูลอื่น/)).toBeNull();
  });

  it('does NOT add the underscore `source` strings as resource keys (they are not reachable item.resource values)', async () => {
    list.mockResolvedValueOnce({ items: [item('1', 'savings_loans')], nextCursor: null } as never);
    render(<ActivityHistory />);
    // 'savings_loans' (underscore) is the withAudit `source`, never the real `item.resource` —
    // it must fall through to the generic label, not resolve to the loan label above.
    expect(await screen.findByText(/ข้อมูลอื่น/)).toBeTruthy();
  });
});
