import { applyPaidSequentially, findOverdueInstallments } from '../../../src/shared/utils/installmentBackdate';
import { buildInstallmentRowKey } from '../../../src/shared/utils/creditCardUtils';

describe('findOverdueInstallments', () => {
  it('returns only earlier valid months in installment order', () => {
    expect(findOverdueInstallments([
      { no: 4, dueMonth: '2026-09', payment: 400 },
      { no: 1, dueMonth: '2026-06', payment: 100 },
      { no: 5, dueMonth: '2026-10', payment: 500 },
      { no: 6, dueMonth: 'invalid', payment: 600 }
    ], '2026-10')).toEqual([
      { no: 1, dueMonth: '2026-06', payment: 100 },
      { no: 4, dueMonth: '2026-09', payment: 400 }
    ]);
  });

  it('returns an empty list for an invalid current month key', () => {
    expect(findOverdueInstallments([{ no: 1, dueMonth: '2026-01', payment: 1 }], 'not-a-month')).toEqual([]);
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
});
