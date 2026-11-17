/** @jest-environment node */
// savings-loan-withdrawal S2b: `matchedAmountForGoalName` extracted out of `computeCurrentAmounts`'s
// `savingsDocs.forEach` matching loop (spec §5.8 A-0, AC-SLW-37). Pure, order-preserving via the
// `initial` running-total parameter — this is the property S2c's carry-forward fold depends on.
import { matchedAmountForGoalName } from '../../../../src/shared/utils/backend/savingsGoalBalances';

describe('matchedAmountForGoalName', () => {
  it('matches by savings_type, case/trim-insensitive', () => {
    const list = [{ savings_type: '  บ้าน  ', savings_amount: 100 }];
    expect(matchedAmountForGoalName(list, 'บ้าน')).toBe(100);
  });

  it('matches by รายการ (legacy field) when savings_type is absent', () => {
    const list = [{ รายการ: 'บ้าน', จำนวนเงิน: 50 }];
    expect(matchedAmountForGoalName(list, 'บ้าน')).toBe(50);
  });

  it('parses comma-formatted string amounts', () => {
    const list = [{ savings_type: 'บ้าน', savings_amount: '1,234.5' }];
    expect(matchedAmountForGoalName(list, 'บ้าน')).toBe(1234.5);
  });

  it('skips non-matching items and non-numeric junk amounts (reads as 0)', () => {
    const list = [
      { savings_type: 'รถ', savings_amount: 999 },
      { savings_type: 'บ้าน', savings_amount: 'not-a-number' },
    ];
    expect(matchedAmountForGoalName(list, 'บ้าน')).toBe(0);
  });

  it('returns initial unchanged for a non-array savingsList (falsy or otherwise)', () => {
    expect(matchedAmountForGoalName(undefined, 'บ้าน', 42)).toBe(42);
    expect(matchedAmountForGoalName(null, 'บ้าน', 42)).toBe(42);
    expect(matchedAmountForGoalName('not-an-array', 'บ้าน', 42)).toBe(42);
  });

  it('defaults initial to 0 when omitted', () => {
    expect(matchedAmountForGoalName([], 'บ้าน')).toBe(0);
  });

  it('threads initial through as the running total (order-preserving across docs)', () => {
    const doc1 = [{ savings_type: 'บ้าน', savings_amount: 0.1 }];
    const doc2 = [{ savings_type: 'บ้าน', savings_amount: 0.2 }];
    const doc3 = [{ savings_type: 'บ้าน', savings_amount: 0.3 }];

    let total = 0;
    total = matchedAmountForGoalName(doc1, 'บ้าน', total);
    total = matchedAmountForGoalName(doc2, 'บ้าน', total);
    total = matchedAmountForGoalName(doc3, 'บ้าน', total);

    // Manual left-to-right fold over the exact same sequence, as the pre-extraction single
    // flat accumulator would have produced (AC-SLW-37's float-order fixture).
    const manualFold = ((0 + 0.1) + 0.2) + 0.3;
    expect(total).toBe(manualFold);
  });

  it('is byte-for-byte identical to the pre-extraction flat-accumulator loop, including multi-item docs', () => {
    const docs = [
      [{ savings_type: 'บ้าน', savings_amount: 0.1 }, { savings_type: 'รถ', savings_amount: 999 }],
      [{ รายการ: 'บ้าน', จำนวนเงิน: 0.2 }],
      [],
      [{ savings_type: 'บ้าน', savings_amount: 0.3 }, { savings_type: 'บ้าน', savings_amount: '0.4' }],
    ];
    const goalNameLower = 'บ้าน';

    // Reference: the exact pre-extraction inline loop (apiUtils→savingsGoalBalances, pre-S2b).
    let reference = 0;
    docs.forEach(list => {
      list.forEach((item: any) => {
        const itemType = (item.savings_type || item.รายการ || '').trim().toLowerCase();
        if (itemType === goalNameLower) {
          const raw = item.savings_amount ?? item.จำนวนเงิน ?? 0;
          const amt = typeof raw === 'number' ? raw : Number(String(raw).replace(/,/g, '')) || 0;
          reference += amt;
        }
      });
    });

    // Under test: the extracted, order-preserving helper, threaded doc-by-doc.
    let underTest = 0;
    docs.forEach(list => {
      underTest = matchedAmountForGoalName(list, goalNameLower, underTest);
    });

    expect(underTest).toBe(reference);
  });
});
