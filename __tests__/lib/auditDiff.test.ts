import {
  changedFieldNames,
  diffMongoDoc,
  diffUserBucket,
  diffUserRecord,
  finalizeEvents,
  safeFieldNames,
  safeResourceKey
} from '../../lib/auditDiff';

describe('auditDiff', () => {
  it('nested housekeeping timestamps alone are not a change; real nested edits still are', () => {
    const before = { cards: [{ id: 'a', name: 'x', updatedAt: '1' }], updatedAt: '1' };
    expect(diffUserBucket('credit_cards', 'u1', before, { cards: [{ id: 'a', name: 'x', updatedAt: '2' }], updatedAt: '2' }, new Set())).toEqual([]);
    expect(diffMongoDoc('credit_cards', { userId: 'u1', ...before }, { userId: 'u1', cards: [{ id: 'a', name: 'x', updatedAt: '2' }], updatedAt: '2' }, () => false)).toEqual([]);
    const changed = diffUserBucket('credit_cards', 'u1', before, { cards: [{ id: 'a', name: 'y', updatedAt: '2' }], updatedAt: '2' }, new Set());
    expect(changed).toMatchObject([{ action: 'updated', changedFields: ['cards'] }]);
  });

  it('collapses dynamic custom_* field names to one generic name', () => {
    expect(safeFieldNames(['custom_1712345_0', 'custom_1712345_1', 'amount'])).toEqual(['amount', 'custom']);
  });

  it('records changed field names only, never values', () => {
    const fields = changedFieldNames({ a: 1, b: 2, c: 3 }, { a: 1, b: 9, c: 3 });
    expect(fields).toEqual(['b']);
  });

  it('ignores housekeeping fields and no-ops', () => {
    expect(safeFieldNames(['_id', 'updatedAt', 'lastMonthlySummarySent'])).toEqual([]);
    expect(diffMongoDoc('salary', { userId: 'u', month: '2025-01', a: 1, updatedAt: 1 }, { userId: 'u', month: '2025-01', a: 1, updatedAt: 2 }, () => false)).toEqual([]);
  });

  it('drops field names that could carry data', () => {
    expect(safeFieldNames(['ok_field', 'has space', '1bad', 'x'.repeat(80)])).toEqual(['ok_field']);
  });

  it('only accepts month/year resource keys', () => {
    expect(safeResourceKey('2025-03')).toBe('2025-03');
    expect(safeResourceKey('secret-note')).toBeUndefined();
  });

  it('password change records no secret and no hash', () => {
    const drafts = diffUserRecord('u1', { id: 'u1', passwordHash: 'old' }, { id: 'u1', passwordHash: 'new' });
    expect(drafts).toEqual([
      { subjectUserId: 'u1', resource: 'account', action: 'password_changed', changedFields: ['password'] }
    ]);
    expect(JSON.stringify(drafts)).not.toMatch(/old|new/);
  });

  it('LINE linking records field name only, never the LINE id', () => {
    const drafts = diffUserRecord('u1', { id: 'u1' }, { id: 'u1', LineId: 'Uabc123' });
    expect(drafts).toEqual([{ subjectUserId: 'u1', resource: 'line_link', action: 'updated', changedFields: ['lineId'] }]);
    expect(JSON.stringify(drafts)).not.toContain('Uabc123');
  });

  it('bucket diff: created / updated / deleted / retention_pruned', () => {
    const before = { '2024-01': { amount: 1 }, '2024-02': { amount: 2 }, '2024-03': { amount: 3 } };
    const after = { '2024-02': { amount: 5 }, '2024-03': { amount: 3 }, '2024-04': { amount: 4 } };
    const drafts = diffUserBucket('salary', 'u', before, after, new Set(['2024-01']));
    const byKey = Object.fromEntries(drafts.map(d => [d.resourceKey, d.action]));
    expect(byKey).toEqual({ '2024-01': 'retention_pruned', '2024-02': 'updated', '2024-04': 'created' });
    const del = diffUserBucket('salary', 'u', before, {}, new Set());
    expect(del.every(d => d.action === 'deleted')).toBe(true);
  });

  it('finalizeEvents marks retention and LINE webhook as system actor, users as user actor', () => {
    const events = finalizeEvents(
      [
        { subjectUserId: 'u', resource: 'salary', action: 'retention_pruned', resourceKey: '2024-01', changedFields: [] },
        { subjectUserId: 'u', resource: 'salary', action: 'updated', resourceKey: '2024-02', changedFields: ['a'] }
      ],
      'salary',
      'u'
    );
    expect(events[0]).toMatchObject({ actorType: 'system', source: 'shared_month_window' });
    expect(events[0].actorUserId).toBeUndefined();
    expect(events[1]).toMatchObject({ actorType: 'user', actorUserId: 'u', source: 'salary' });
    const line = finalizeEvents([{ subjectUserId: 'u', resource: 'line_link', action: 'updated', changedFields: ['lineId'] }], 'line_webhook', null);
    expect(line[0].actorType).toBe('system');
  });
});
