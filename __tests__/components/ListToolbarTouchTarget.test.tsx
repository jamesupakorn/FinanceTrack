import { render, screen } from '@testing-library/react';
import ListToolbar from '../../src/frontend/components/ListToolbar';
import { emptyListCriteria } from '../../src/shared/utils/frontend/listView';

// jsdom does not lay out CSS, so this guards the classes that keep the filter button a >=44px target at 320px
// (it shares a row with the sort field; without min-w-max it was squeezed to 39px and its label wrapped).
test('the filter toggle keeps its label width and a 44px minimum height', () => {
  render(
    <ListToolbar
      label="รายการ"
      criteria={emptyListCriteria()}
      onChange={() => {}}
      filters={[{ key: 'type', label: 'ประเภท', options: [{ value: 'a', label: 'เอ' }] }]}
      orders={[{ value: 'name:asc', label: 'ชื่อ' }]}
      visible={1}
      total={1}
    />
  );
  const toggle = screen.getByRole('button', { name: /ตัวกรอง/ });
  expect(toggle).toHaveClass('min-h-11', '!min-w-max', 'whitespace-nowrap');
});
