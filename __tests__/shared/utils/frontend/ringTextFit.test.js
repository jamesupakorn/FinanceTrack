import {
  fitRingFontSize,
  estimateEmWidth,
  RING_TEXT_MAX_SIZE,
  RING_TEXT_MIN_SIZE
} from '../../../../src/shared/utils/frontend/ringTextFit';

describe('fitRingFontSize (AC-DLB-11)', () => {
  it('returns max size for short values and empty input', () => {
    expect(fitRingFontSize('+0.00 ฿')).toBe(26);
    expect(fitRingFontSize('')).toBe(26);
    expect(fitRingFontSize(null)).toBe(26);
  });

  it('stays within [14, 26] and is non-increasing as the string gets longer', () => {
    const samples = ['+1,887.47 ฿', '+123,456.78 ฿', '−1,234,567.89 ฿', '−99,999,999.99 ฿'];
    const sizes = samples.map((s) => fitRingFontSize(s));
    sizes.forEach((n) => {
      expect(n).toBeGreaterThanOrEqual(RING_TEXT_MIN_SIZE);
      expect(n).toBeLessThanOrEqual(RING_TEXT_MAX_SIZE);
    });
    for (let i = 1; i < sizes.length; i += 1) expect(sizes[i]).toBeLessThanOrEqual(sizes[i - 1]);
    expect(sizes[0]).toBeLessThan(26);
  });

  it('clamps to the minimum for absurdly long strings and is deterministic', () => {
    expect(fitRingFontSize('9'.repeat(40))).toBe(14);
    expect(fitRingFontSize('+1,887.47 ฿')).toBe(fitRingFontSize('+1,887.47 ฿'));
  });

  it('honours custom options', () => {
    expect(fitRingFontSize('+1,887.47 ฿', { maxWidth: 1000 })).toBe(26);
    expect(fitRingFontSize('+1,887.47 ฿', { maxSize: 20, minSize: 10 })).toBeLessThanOrEqual(20);
  });
});

describe('estimateEmWidth', () => {
  it('matches the UX spec table and ignores Thai combining marks', () => {
    expect(estimateEmWidth('+0.00 ฿')).toBeCloseTo(3.54, 5);
    expect(estimateEmWidth('ั')).toBe(0);
    expect(estimateEmWidth('')).toBe(0);
  });
});
