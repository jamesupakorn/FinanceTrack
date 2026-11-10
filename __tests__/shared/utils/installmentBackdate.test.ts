import { applyPaidSequentially, findTickableInstallments } from '../../../src/shared/utils/installmentBackdate';
import { buildInstallmentRowKey } from '../../../src/shared/utils/creditCardUtils';

describe('findTickableInstallments', () => {
  it('returns current and earlier valid months in installment order, excluding future', () => {
    expect(findTickableInstallments([
      { no: 4, dueMonth: '2026-09', payment: 400 },
      { no: 1, dueMonth: '2026-06', payment: 100 },
      { no: 5, dueMonth: '2026-10', payment: 500 },
      { no: 6, dueMonth: '2026-11', payment: 600 },
      { no: 7, dueMonth: 'invalid', payment: 700 }
    ], '2026-10')).toEqual([
      { no: 1, dueMonth: '2026-06', payment: 100 },
      { no: 4, dueMonth: '2026-09', payment: 400 },
      { no: 5, dueMonth: '2026-10', payment: 500 }
    ]);
  });

  it('handles the year boundary', () => {
    const schedule = [
      { no: 1, dueMonth: '2026-12', payment: 1 },
      { no: 2, dueMonth: '2027-01', payment: 1 },
      { no: 3, dueMonth: '2027-02', payment: 1 }
    ];
    expect(findTickableInstallments(schedule, '2027-01').map(r => r.no)).toEqual([1, 2]);
    expect(findTickableInstallments(schedule, '2026-12').map(r => r.no)).toEqual([1]);
  });

  it('shifts cycle months to the cash month for cards whose due day falls in the next month', () => {
    const schedule = [
      { no: 1, dueMonth: '2026-10', payment: 394 },
      { no: 2, dueMonth: '2026-11', payment: 394 },
      { no: 3, dueMonth: '2026-12', payment: 394 }
    ];
    expect(findTickableInstallments(schedule, '2026-11', 1).map(r => r.no)).toEqual([1]);
    expect(findTickableInstallments(schedule, '2026-11', 0).map(r => r.no)).toEqual([1, 2]);
    expect(findTickableInstallments(schedule, '2027-01', 1).map(r => r.no)).toEqual([1, 2, 3]);
  });

  it('returns an empty list for an invalid current month key', () => {
    expect(findTickableInstallments([{ no: 1, dueMonth: '2026-01', payment: 1 }], 'not-a-month')).toEqual([]);
  });
});

describe('applyPaidSequentially', () => {
  it('deduplicates and awaits each ascending paid update before starting the next', async () => {
    let finishFirst!: (value: unknown) => void;
    const firstRequest = new Promise(resolve => { finishFirst = resolve; });
    const setPaid = jest.fn()
      .mockImplementationOnce(() => firstRequest)
      .mockResolvedValueOnce({ paid: true })
      .mockResolvedValueOnce({ paid: true });
    const resultPromise = applyPaidSequentially('ip_0123456789ab', [
      { no: 3, dueMonth: '2026-09' },
      { no: 1, dueMonth: '2026-07' },
      { no: 2, dueMonth: '2026-08' },
      { no: 1, dueMonth: '2026-07' }
    ], setPaid);

    expect(setPaid).toHaveBeenCalledTimes(1);
    expect(setPaid).toHaveBeenNthCalledWith(1, '2026-07', buildInstallmentRowKey('ip_0123456789ab', 1), true);
    finishFirst({ paid: true });
    await expect(resultPromise).resolves.toEqual({ succeededNos: [1, 2, 3], failedNos: [] });
    expect(setPaid).toHaveBeenNthCalledWith(2, '2026-08', buildInstallmentRowKey('ip_0123456789ab', 2), true);
    expect(setPaid).toHaveBeenNthCalledWith(3, '2026-09', buildInstallmentRowKey('ip_0123456789ab', 3), true);
  });

  it('continues after rejected requests and treats paid=false as a failure', async () => {
    const setPaid = jest.fn()
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce({ paid: false })
      .mockResolvedValueOnce({ paid: true });
    await expect(applyPaidSequentially('ip_0123456789ab', [
      { no: 1, dueMonth: '2026-07' },
      { no: 2, dueMonth: '2026-08' },
      { no: 3, dueMonth: '2026-09' }
    ], setPaid)).resolves.toEqual({ succeededNos: [3], failedNos: [1, 2] });
    expect(setPaid).toHaveBeenCalledTimes(3);
  });

  it('does not call the setter for malformed key or month inputs', async () => {
    const setPaidWithInvalidKey = jest.fn().mockResolvedValue({ paid: true });
    await expect(applyPaidSequentially('invalid', [
      { no: 1, dueMonth: '2026-07' },
    ], setPaidWithInvalidKey)).resolves.toEqual({ succeededNos: [], failedNos: [1] });
    expect(setPaidWithInvalidKey).not.toHaveBeenCalled();

    const setPaidWithInvalidMonth = jest.fn().mockResolvedValue({ paid: true });
    await expect(applyPaidSequentially('ip_0123456789ab', [
      { no: 2, dueMonth: 'invalid' }
    ], setPaidWithInvalidMonth)).resolves.toEqual({ succeededNos: [], failedNos: [2] });
    expect(setPaidWithInvalidMonth).not.toHaveBeenCalled();
  });

  describe('onProgress (additive)', () => {
    it('calls onProgress once per row, in ascending order, reaching total on an all-success run', async () => {
      const setPaid = jest.fn().mockResolvedValue({ paid: true });
      const onProgress = jest.fn();
      await applyPaidSequentially('ip_0123456789ab', [
        { no: 3, dueMonth: '2026-09' },
        { no: 1, dueMonth: '2026-07' },
        { no: 2, dueMonth: '2026-08' }
      ], setPaid, onProgress);

      expect(onProgress).toHaveBeenCalledTimes(3);
      expect(onProgress).toHaveBeenNthCalledWith(1, 1, 3);
      expect(onProgress).toHaveBeenNthCalledWith(2, 2, 3);
      expect(onProgress).toHaveBeenNthCalledWith(3, 3, 3);
    });

    it('still fires onProgress for a row skipped due to an invalid key, reaching total', async () => {
      const setPaid = jest.fn().mockResolvedValue({ paid: true });
      const onProgress = jest.fn();
      const result = await applyPaidSequentially('invalid', [
        { no: 1, dueMonth: '2026-07' },
        { no: 2, dueMonth: '2026-08' }
      ], setPaid, onProgress);

      expect(setPaid).not.toHaveBeenCalled();
      expect(result).toEqual({ succeededNos: [], failedNos: [1, 2] });
      expect(onProgress).toHaveBeenCalledTimes(2);
      expect(onProgress).toHaveBeenNthCalledWith(1, 1, 2);
      expect(onProgress).toHaveBeenNthCalledWith(2, 2, 2);
    });

    it('is a no-op for existing callers that omit onProgress (no behavior change)', async () => {
      const setPaid = jest.fn()
        .mockRejectedValueOnce(new Error('network'))
        .mockResolvedValueOnce({ paid: true });
      await expect(applyPaidSequentially('ip_0123456789ab', [
        { no: 1, dueMonth: '2026-07' },
        { no: 2, dueMonth: '2026-08' }
      ], setPaid)).resolves.toEqual({ succeededNos: [2], failedNos: [1] });
      expect(setPaid).toHaveBeenCalledTimes(2);
    });
  });

  // D5 (loan-installments-s6): 480-row perf smoke (N-4). R-4's worst case — a loan at
  // `MAX_LOAN_INSTALLMENTS_PER_PLAN` with hundreds of already-past-due rows needing a backdated-paid
  // sequential save. This is a smoke check on the sequential-save util itself (correctness +
  // wall-clock time), not a benchmark gate. `setPaid` is stubbed to resolve on the next microtask,
  // matching the resolved-promise shape a real `cci_` PATCH response takes once network latency is
  // excluded; the point is confirming the loop, dedup, and `onProgress` plumbing scale to 480 rows
  // without hanging or losing the ascending order / dedup guarantees proven at small scale above.
  describe('480-row scale smoke (D5, N-4)', () => {
    it('completes all 480 rows in ascending order, deduping, with onProgress reaching 480/480, in reasonable time', async () => {
      const total = 480;
      const rows = Array.from({ length: total }, (_, index) => ({
        no: index + 1,
        dueMonth: '2026-01'
      }));
      // A handful of rows past-due in two different calendar months, duplicated once each, to also
      // exercise the Map-based dedup at scale (not just correctness at N=4 as above).
      const rowsWithDupes = [...rows, { no: 1, dueMonth: '2026-01' }, { no: 480, dueMonth: '2026-01' }];

      const setPaid = jest.fn().mockImplementation(() => Promise.resolve({ paid: true }));
      const onProgress = jest.fn();

      const startedAt = Date.now();
      const result = await applyPaidSequentially('ip_0123456789ab', rowsWithDupes, setPaid, onProgress);
      const elapsedMs = Date.now() - startedAt;

      expect(result.succeededNos).toHaveLength(total);
      expect(result.failedNos).toEqual([]);
      expect(result.succeededNos).toEqual(Array.from({ length: total }, (_, index) => index + 1));
      expect(setPaid).toHaveBeenCalledTimes(total);

      expect(onProgress).toHaveBeenCalledTimes(total);
      expect(onProgress).toHaveBeenNthCalledWith(1, 1, total);
      expect(onProgress).toHaveBeenNthCalledWith(total, total, total);

      // Not a strict benchmark — a generous ceiling so a real stall (e.g. an accidental O(n^2) scan
      // or a lost `await`) still fails loudly, without making the suite flaky on a loaded machine.
      expect(elapsedMs).toBeLessThan(5000);
    });
  });
});
