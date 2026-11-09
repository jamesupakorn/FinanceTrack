import { formatDueDayText, getValidResolvedDueDate, formatRowDueText } from '../../../../src/shared/utils/frontend/expenseDueText';

describe('expenseDueText', () => {
  test('formatDueDayText: day number, end-of-month, empty', () => {
    expect(formatDueDayText(5)).toBe('วันที่ 5');
    expect(formatDueDayText('EOM')).toBe('วันสิ้นเดือน');
    expect(formatDueDayText(undefined)).toBe('');
    expect(formatDueDayText('')).toBe('');
  });

  test('getValidResolvedDueDate rejects impossible/malformed dates', () => {
    expect(getValidResolvedDueDate('2026-11-10')).toBe('2026-11-10');
    expect(getValidResolvedDueDate('2026-02-30')).toBeNull();
    expect(getValidResolvedDueDate('nope')).toBeNull();
    expect(getValidResolvedDueDate(undefined)).toBeNull();
  });

  test('formatRowDueText: same month uses dueDay text, cross month uses full Thai date, invalid date falls back', () => {
    expect(formatRowDueText({ dueDay: 20, resolvedDueDate: '2026-11-20' }, '2026-11')).toBe('วันที่ 20');
    expect(formatRowDueText({ dueDay: 10, resolvedDueDate: '2026-11-10' }, '2026-10')).toBe('10 พ.ย. 2569');
    expect(formatRowDueText({ dueDay: 'EOM' }, '2026-11')).toBe('วันสิ้นเดือน');
    expect(formatRowDueText({ dueDay: 7, resolvedDueDate: '2026-02-30' }, '2026-03')).toBe('วันที่ 7');
    expect(formatRowDueText({}, '2026-11')).toBe('');
  });
});
