/** @jest-environment node */
// Focused regression test for the `assertUserScope(userId)` call added to
// `getUserLastMonthlySummarySent` in .pipeline/spec-line-monthly-summary-hardening.md, matching
// the existing convention of its siblings (`getUserMonthlySummaryEnabled`,
// `updateUserMonthlySummaryEnabled`, `markUserMonthlySummarySent`) in the same file.
// The guard throws before any DB access, so no Mongo/JSON fixture setup is needed here.
import { getUserLastMonthlySummarySent } from '../../lib/userStore';

describe('getUserLastMonthlySummarySent — userId scope guard', () => {
  it('throws on an empty/invalid userId instead of reaching getUserById', async () => {
    await expect(getUserLastMonthlySummarySent('')).rejects.toThrow('userStore: userId is required');
  });

  it('throws on a non-string userId (e.g. an object) instead of reaching getUserById', async () => {
    await expect(getUserLastMonthlySummarySent({ $ne: null })).rejects.toThrow('userStore: userId is required');
  });

  it('throws on undefined userId', async () => {
    await expect(getUserLastMonthlySummarySent(undefined)).rejects.toThrow('userStore: userId is required');
  });
});
