export interface ListCriteria {
  query: string;
  order: string;
  filters: Record<string, string>;
}

export const emptyListCriteria = (): ListCriteria => ({ query: '', order: '', filters: {} });

export function matchesListQuery(label: string, query: string): boolean {
  const normalize = (value: string) => value.normalize('NFC').trim().toLocaleLowerCase('th');
  return normalize(label).includes(normalize(query));
}

export function compareListValues(
  a: string | number | null | undefined,
  b: string | number | null | undefined,
  descending = false
): number {
  const missing = (value: typeof a) => value == null || value === '' || (typeof value === 'number' && !Number.isFinite(value));
  if (missing(a)) return missing(b) ? 0 : 1;
  if (missing(b)) return -1;
  const result = typeof a === 'number' && typeof b === 'number'
    ? a - b
    : String(a).localeCompare(String(b), 'th', { numeric: true });
  return descending ? -result : result;
}

export function projectList<T>(
  rows: readonly T[],
  matches: (row: T) => boolean,
  compare?: (a: T, b: T) => number,
  group?: (row: T) => string
): T[] {
  const groupOrder = new Map<string, number>();
  rows.forEach(row => {
    const key = group?.(row) ?? '';
    if (!groupOrder.has(key)) groupOrder.set(key, groupOrder.size);
  });
  return rows.map((row, index) => ({ row, index })).filter(({ row }) => matches(row))
    .sort((a, b) => {
      const groupDelta = (groupOrder.get(group?.(a.row) ?? '') ?? 0) - (groupOrder.get(group?.(b.row) ?? '') ?? 0);
      return groupDelta || compare?.(a.row, b.row) || a.index - b.index;
    }).map(({ row }) => row);
}

export function isListViewControl(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('[data-list-view-controls]') !== null;
}
