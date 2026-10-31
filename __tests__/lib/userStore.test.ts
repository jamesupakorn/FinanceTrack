/** @jest-environment node */
// Focused regression test for the `assertUserScope(userId)` call added to
// `getUserLastMonthlySummarySent` for the monthly-summary hardening, matching
// the existing convention of its siblings (`getUserMonthlySummaryEnabled`,
// `updateUserMonthlySummaryEnabled`, `markUserMonthlySummarySent`) in the same file.
// The guard throws before any DB access, so no Mongo/JSON fixture setup is needed here.
import { getUserLastMonthlySummarySent } from '../../lib/userStore';

describe('getUserLastMonthlySummarySent — userId scope guard', () => {
  it('throws on an empty/invalid userId instead of reaching getUserById', async () => {
    await expect(getUserLastMonthlySummarySent('')).rejects.toThrow('userStore: userId is required');
  });

  it('throws on a non-string userId (e.g. an object) instead of reaching getUserById', async () => {
    await expect(getUserLastMonthlySummarySent({ $ne: null } as never)).rejects.toThrow('userStore: userId is required');
  });

  it('throws on undefined userId', async () => {
    await expect(getUserLastMonthlySummarySent(undefined as never)).rejects.toThrow('userStore: userId is required');
  });
});

describe('generateUserId', () => {
  it('returns u001 for an empty list and increments past the highest numeric suffix', () => {
    const { generateUserId } = require('../../lib/userStore');
    expect(generateUserId([])).toBe('u001');
    expect(generateUserId([{ id: 'u001' }, { id: 'u009' }, { id: 'custom' }])).toBe('u010');
  });
});
