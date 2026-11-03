import { randomBase36, randomInt } from '../../../src/shared/utils/randomId';

describe('randomId (Web Crypto)', () => {
  it('randomInt stays inside [0, max)', () => {
    for (let i = 0; i < 500; i++) {
      const value = randomInt(1000);
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1000);
    }
    expect(randomInt(1)).toBe(0);
    expect(randomInt(0)).toBe(0);
  });

  it('randomBase36 returns the requested length of [0-9a-z]', () => {
    for (const length of [1, 5, 12]) {
      const token = randomBase36(length);
      expect(token).toHaveLength(length);
      expect(token).toMatch(/^[0-9a-z]+$/);
    }
  });

  it('does not repeat across many calls', () => {
    const seen = new Set(Array.from({ length: 2000 }, () => randomBase36(8)));
    expect(seen.size).toBe(2000);
  });

  it('never touches Math.random', () => {
    const spy = jest.spyOn(Math, 'random');
    randomBase36(5);
    randomInt(10);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
