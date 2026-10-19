import { useEffect, useRef, useState } from 'react';
import { isListViewControl, projectList } from './listView';

interface ProjectionOptions<T> {
  rows: readonly T[];
  getId: (row: T) => string;
  matches: (row: T) => boolean;
  compare?: (a: T, b: T) => number;
  group?: (row: T) => string;
  criteriaKey: string;
  datasetKey: string;
  editable?: boolean;
}

interface Snapshot {
  key: string;
  ids: string[];
  knownIds: Set<string>;
  pinnedIds: Set<string>;
}

/** Freeze identities, not values: financial inputs and totals always use live canonical rows. */
export function useListProjection<T>({
  rows, getId, matches, compare, group, criteriaKey, datasetKey, editable = false
}: ProjectionOptions<T>) {
  const [revision, setRevision] = useState(0);
  const snapshot = useRef<Snapshot | null>(null);
  const pendingBlur = useRef<(() => void) | null>(null);
  useEffect(() => () => pendingBlur.current?.(), []);
  const projected = projectList(rows, matches, compare, group);
  const projectedIds = projected.map(getId);
  const key = JSON.stringify([criteriaKey, datasetKey, revision]);
  if (!editable || snapshot.current?.key !== key) {
    const previousKnownIds = snapshot.current?.knownIds ?? new Set<string>();
    const newPinnedIds = rows
      .filter(row => !projectedIds.includes(getId(row)) && !previousKnownIds.has(getId(row)))
      .map(getId);
    snapshot.current = {
      key,
      ids: [...new Set([...projectedIds, ...newPinnedIds])],
      knownIds: new Set(rows.map(getId)),
      pinnedIds: new Set(newPinnedIds)
    };
  }
  const state = snapshot.current!;
  const byId = new Map(rows.map(row => [getId(row), row]));
  rows.forEach(row => {
    const id = getId(row);
    if (!state.knownIds.has(id)) {
      state.knownIds.add(id);
      state.ids.push(id);
      state.pinnedIds.add(id);
    }
  });
  let items = state.ids.flatMap(id => {
    const row = byId.get(id);
    return row === undefined ? [] : [row];
  });
  // Append a new row inside its original group, without reordering existing group members.
  if (group) {
    const groupOrder = new Map<string, number>();
    rows.forEach(row => {
      if (!groupOrder.has(group(row))) groupOrder.set(group(row), groupOrder.size);
    });
    items = items.slice().sort((a, b) => (groupOrder.get(group(a)) ?? 0) - (groupOrder.get(group(b)) ?? 0));
  }
  const changed = JSON.stringify(items.map(getId)) !== JSON.stringify(projected.map(getId));
  const refresh = () => {
    pendingBlur.current?.();
    pendingBlur.current = null;
    setRevision(value => value + 1);
  };
  return {
    items, pinnedIds: state.pinnedIds, changed,
    refresh
  };
}
