import { fireEvent, render, screen } from '@testing-library/react';
import { compareListValues, emptyListCriteria, isListViewControl, matchesListQuery, projectList } from '../../src/shared/utils/frontend/listView';
import { useListProjection } from '../../src/shared/utils/frontend/useListProjection';
import { ListViewProvider, useListCriteria } from '../../src/frontend/contexts/ListViewContext';
import ListToolbar from '../../src/frontend/components/ListToolbar';

test('search normalizes Unicode and Latin case without removing Thai marks', () => {
  expect(matchesListQuery('ค่าไฟ Café', ' CAFE\u0301 ')).toBe(true);
  expect(matchesListQuery('ค่าไฟ', 'คาไฟ')).toBe(false);
});

test('numeric zero is valid, missing values sort last in both directions and ties preserve source', () => {
  for (const descending of [false, true]) {
    expect(compareListValues(undefined, 0, descending)).toBeGreaterThan(0);
    expect(compareListValues(0, null, descending)).toBeLessThan(0);
    expect(compareListValues(NaN, 90, descending)).toBeGreaterThan(0);
  }
  const rows = Object.freeze([{ id: 'a', amount: 90 }, { id: 'b', amount: 1200 }, { id: 'c', amount: 90 }]);
  expect(projectList(rows, () => true, (a, b) => compareListValues(a.amount, b.amount)).map(row => row.id)).toEqual(['a', 'c', 'b']);
  expect(rows.map(row => row.id)).toEqual(['a', 'b', 'c']);
});

test('group ordering survives sorting and AND restrictions', () => {
  const rows = [{ id: 'a', group: 'first', amount: 10 }, { id: 'b', group: 'second', amount: 100 }, { id: 'c', group: 'first', amount: 20 }];
  expect(projectList(rows, row => row.amount > 10, (a, b) => b.amount - a.amount, row => row.group).map(row => row.id)).toEqual(['c', 'b']);
});

function Editor({ rows, dataset = 'month' }: { rows: { id: string; name: string }[]; dataset?: string }) {
  const [criteria, setCriteria] = useListCriteria('test');
  const projection = useListProjection({
    rows, getId: row => row.id, matches: row => matchesListQuery(row.name, criteria.query),
    criteriaKey: JSON.stringify(criteria), datasetKey: dataset, editable: true
  });
  return <>
    <ListToolbar label="รายการ" criteria={criteria} onChange={setCriteria}
      orders={[{ value: 'name', label: 'ชื่อ' }]} visible={projection.items.length} total={rows.length}
      changed={projection.changed} onRefresh={projection.refresh} pinned={projection.pinnedIds.size} />
    {projection.items.map(row => <input key={row.id} aria-label={row.id} value={row.name} readOnly />)}
  </>;
}

test('editing freezes identities and positions; added rows pin; explicit update refreshes', () => {
  const initial = [{ id: 'a', name: 'match' }, { id: 'b', name: 'hidden' }];
  const { rerender } = render(<Editor rows={initial} />);
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'match' } });
  const active = screen.getByLabelText('a');
  active.focus();
  rerender(<Editor rows={[{ id: 'a', name: 'changed' }, initial[1]!, { id: 'c', name: 'new' }]} />);
  expect(screen.getByLabelText('a')).toBe(active);
  expect(active).toHaveFocus();
  expect(screen.queryByLabelText('b')).not.toBeInTheDocument();
  expect(screen.getByLabelText('c')).toBeInTheDocument();
  expect(screen.getByText(/รายการใหม่ — ยังไม่กรอง/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'อัปเดตรายการ' }));
  expect(screen.queryByLabelText('a')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('c')).not.toBeInTheDocument();
});

test('month-keyed children retain criteria, scope provider remount resets them', () => {
  const rows = [{ id: 'a', name: 'match' }];
  const { rerender } = render(<ListViewProvider key="user-a"><Editor key="jan" rows={rows} /></ListViewProvider>);
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'saved locally' } });
  rerender(<ListViewProvider key="user-a"><Editor key="feb" rows={rows} /></ListViewProvider>);
  expect(screen.getByRole('searchbox')).toHaveValue('saved locally');
  rerender(<ListViewProvider key="user-b"><Editor key="feb" rows={rows} /></ListViewProvider>);
  expect(screen.getByRole('searchbox')).toHaveValue('');
});

test('clear restrictions keeps order, reset restores default, only toolbar events are view controls', () => {
  const changes = jest.fn();
  render(<ListToolbar label="รายการ" criteria={{ query: 'test', order: 'name', filters: {} }}
    onChange={changes} orders={[{ value: 'name', label: 'ชื่อ' }]} visible={0} total={2} />);
  expect(isListViewControl(screen.getByRole('searchbox'))).toBe(true);
  expect(isListViewControl(document.body)).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'ล้างตัวกรอง' }));
  expect(changes).toHaveBeenLastCalledWith({ ...emptyListCriteria(), order: 'name' });
  fireEvent.click(screen.getByRole('button', { name: 'คืนค่าเริ่มต้น' }));
  expect(changes).toHaveBeenLastCalledWith(emptyListCriteria());
});

test('filter dropdown shows a styled listbox and updates the selected filter', () => {
  const changes = jest.fn();
  render(<ListToolbar label="รายการ" criteria={{ query: '', order: '', filters: { account: '' } }}
    onChange={changes} filters={[{ key: 'account', label: 'บัญชี', options: [{ value: 'ttb', label: 'ttb' }] }]}
    search={false} visible={2} total={2} />);

  fireEvent.click(screen.getByRole('button', { name: 'ตัวกรอง' }));
  const filter = screen.getByRole('combobox', { name: 'บัญชี' });
  fireEvent.click(filter);
  expect(screen.getByRole('listbox', { name: 'บัญชี' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('option', { name: 'ttb' }));

  expect(changes).toHaveBeenCalledWith({ query: '', order: '', filters: { account: 'ttb' } });
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
});

test('filter dropdown supports keyboard selection and restores focus on escape', () => {
  const changes = jest.fn();
  render(<ListToolbar label="รายการ" criteria={{ query: '', order: '', filters: { account: '' } }}
    onChange={changes} filters={[{ key: 'account', label: 'บัญชี', options: [{ value: 'ttb', label: 'ttb' }] }]}
    search={false} visible={2} total={2} />);

  fireEvent.click(screen.getByRole('button', { name: 'ตัวกรอง' }));
  const filter = screen.getByRole('combobox', { name: 'บัญชี' });
  fireEvent.keyDown(filter, { key: 'ArrowDown' });
  expect(screen.getByRole('listbox', { name: 'บัญชี' })).toHaveFocus();
  fireEvent.keyDown(screen.getByRole('listbox'), { key: 'ArrowDown' });
  fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Enter' });
  expect(changes).toHaveBeenCalledWith({ query: '', order: '', filters: { account: 'ttb' } });

  fireEvent.keyDown(filter, { key: 'ArrowDown' });
  fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Escape' });
  expect(filter).toHaveFocus();
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
});
