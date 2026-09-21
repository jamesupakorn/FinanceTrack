import { withLineRetry, isTransientLineError } from '../../../../src/shared/utils/backend/lineRetry';

describe('isTransientLineError', () => {
  it('treats missing status (network error) and 5xx as transient', () => {
    expect(isTransientLineError(new TypeError('fetch failed'))).toBe(true);
    expect(isTransientLineError({ status: 503 })).toBe(true);
  });
  it('treats 4xx as permanent', () => {
    expect(isTransientLineError({ status: 400 })).toBe(false);
    expect(isTransientLineError({ status: 401 })).toBe(false);
  });
});

describe('withLineRetry', () => {
  it('returns immediately on success', async () => {
    const send = jest.fn().mockResolvedValue('ok');
    await expect(withLineRetry(send, 0)).resolves.toBe('ok');
    expect(send).toHaveBeenCalledTimes(1);
  });
  it('makes at most 2 attempts', async () => {
    const send = jest.fn().mockRejectedValue({ status: 500 });
    await expect(withLineRetry(send, 0)).rejects.toEqual({ status: 500 });
    expect(send).toHaveBeenCalledTimes(2);
  });
  it('does not retry a 4xx', async () => {
    const send = jest.fn().mockRejectedValue({ status: 403 });
    await expect(withLineRetry(send, 0)).rejects.toEqual({ status: 403 });
    expect(send).toHaveBeenCalledTimes(1);
  });
});
