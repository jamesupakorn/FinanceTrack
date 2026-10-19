import {
  fitRingFontSize,
  estimateEmWidth,
  RING_TEXT_MAX_SIZE,
  RING_TEXT_MIN_SIZE
} from '../../../../src/shared/utils/frontend/ringTextFit';
import {
  estimateMonoEmWidth,
  fitFontSizeCss
} from '../../../../src/shared/utils/frontend/ringTextFit';

describe('fitRingFontSize (AC-DLB-11)', () => {
  it('returns max size for short values and empty input', () => {
    expect(fitRingFontSize('+0.00 ฿')).toBe(26);
    expect(fitRingFontSize('')).toBe(26);
    expect(fitRingFontSize(null)).toBe(26);
  });

  it('stays within [14, 26] and is non-increasing as the string gets longer', () => {
    const samples = ['+1,887.47 ฿', '+123,456.78 ฿', '−1,234,567.89 ฿', '−99,999,999.99 ฿'];
    const sizes = samples.map(sample => fitRingFontSize(sample));
    sizes.forEach(size => {
      expect(size).toBeGreaterThanOrEqual(RING_TEXT_MIN_SIZE);
      expect(size).toBeLessThanOrEqual(RING_TEXT_MAX_SIZE);
    });
    for (let index = 1; index < sizes.length; index += 1) expect(sizes[index]).toBeLessThanOrEqual(sizes[index - 1]);
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

  it('keeps numeric coercion and supplementary Unicode glyph widths unchanged', () => {
    expect(estimateEmWidth(123)).toBe(estimateEmWidth('123'));
    expect(estimateEmWidth('😀')).toBeCloseTo(0.6, 5);
    expect(estimateMonoEmWidth('😀')).toBeCloseTo(0.62, 5);
  });
});

describe('estimateMonoEmWidth (AC-CLO-01)', () => {
  it('counts every glyph, including punctuation, at 0.62em', () => {
    expect(estimateMonoEmWidth('1,234,567.89')).toBeCloseTo(7.44, 5);
  });

  it('returns 0 for empty, null and undefined', () => {
    expect(estimateMonoEmWidth('')).toBe(0);
    expect(estimateMonoEmWidth(null)).toBe(0);
    expect(estimateMonoEmWidth(undefined)).toBe(0);
  });

  it('counts a base glyph plus a Thai combining mark as 1 glyph', () => {
    expect(estimateMonoEmWidth('ก' + 'ั')).toBeCloseTo(0.62, 5);
  });
});

describe('fitFontSizeCss (AC-CLO-02)', () => {
  it('returns the exact clamp() string for a long amount', () => {
    expect(fitFontSizeCss('1,234,567.89')).toBe('clamp(14px, calc(100cqi / 7.44), var(--text-2xl))');
  });

  it('returns the maxCss cap unchanged for empty input', () => {
    expect(fitFontSizeCss('')).toBe('var(--text-2xl)');
  });

  it('is deterministic for the same input', () => {
    expect(fitFontSizeCss('1,234,567.89')).toBe(fitFontSizeCss('1,234,567.89'));
  });

  it('honours custom minPx and maxCss verbatim', () => {
    expect(fitFontSizeCss('1,234,567.89', { minPx: 12, maxCss: '20px' })).toBe('clamp(12px, calc(100cqi / 7.44), 20px)');
  });

  it('uses the supplied estimator and preserves its empty-width fallback', () => {
    const estimate = jest.fn(() => 4);
    expect(fitFontSizeCss('test', { estimate })).toBe('clamp(14px, calc(100cqi / 4), var(--text-2xl))');
    expect(estimate).toHaveBeenCalledWith('test');
    expect(fitFontSizeCss('test', { estimate: () => 0, maxCss: '20px' })).toBe('20px');
  });
});