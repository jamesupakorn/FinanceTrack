// AC-CD22 (disabled items with visible reasons) and AC-CD23 (keyboard, Escape, Tab, opener = trigger, flip above).
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import RowActionMenu from '../../src/frontend/components/RowActionMenu';

function setup(extra: { bottomInset?: number } = {}) {
  const onRename = jest.fn();
  const onEdit = jest.fn();
  const onDelete = jest.fn();
  const utils = render(
    <div>
      <RowActionMenu
        triggerLabel="ตัวเลือกของแผน iPhone"
        {...extra}
        items={[
          { key: 'rename', label: 'แก้ไขชื่อรายการ', onSelect: onRename },
          { key: 'edit', label: 'แก้ไขแผน', disabled: true, disabledReason: 'แก้ไขไม่ได้เพราะชำระไปแล้ว 2 งวด — ให้ยกเลิกแผนแล้วสร้างใหม่', onSelect: onEdit },
          { key: 'delete', label: 'ลบแผน', danger: true, onSelect: onDelete }
        ]}
      />
      <button type="button">หลังเมนู</button>
    </div>
  );
  return { onRename, onEdit, onDelete, ...utils };
}

it('trigger exposes menu semantics and opens with focus on the first item', async () => {
  const user = userEvent.setup();
  setup();
  const trigger = screen.getByRole('button', { name: 'ตัวเลือกของแผน iPhone' });
  expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
  expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await user.click(trigger);
  expect(trigger).toHaveAttribute('aria-expanded', 'true');
  expect(screen.getByRole('menu')).toBeInTheDocument();
  expect(screen.getByRole('menuitem', { name: 'แก้ไขชื่อรายการ' })).toHaveFocus();
});

it('AC-CD22: a disabled item is aria-disabled, described by visible reason text, and clicking it does nothing', async () => {
  const user = userEvent.setup();
  const { onEdit } = setup();
  await user.click(screen.getByRole('button', { name: 'ตัวเลือกของแผน iPhone' }));
  const edit = screen.getByRole('menuitem', { name: 'แก้ไขแผน' });
  expect(edit).toHaveAttribute('aria-disabled', 'true');
  expect(edit).toHaveAccessibleDescription('แก้ไขไม่ได้เพราะชำระไปแล้ว 2 งวด — ให้ยกเลิกแผนแล้วสร้างใหม่');
  expect(screen.getByText('แก้ไขไม่ได้เพราะชำระไปแล้ว 2 งวด — ให้ยกเลิกแผนแล้วสร้างใหม่')).toBeVisible();
  expect(edit).not.toHaveAttribute('title');
  await user.click(edit);
  expect(onEdit).not.toHaveBeenCalled();
  expect(screen.getByRole('menu')).toBeInTheDocument();
});

it('AC-CD23: arrows, Home and End move between items (wrapping)', async () => {
  const user = userEvent.setup();
  setup();
  await user.click(screen.getByRole('button', { name: 'ตัวเลือกของแผน iPhone' }));
  await user.keyboard('{ArrowDown}');
  expect(screen.getByRole('menuitem', { name: 'แก้ไขแผน' })).toHaveFocus();
  await user.keyboard('{ArrowDown}');
  expect(screen.getByRole('menuitem', { name: 'ลบแผน' })).toHaveFocus();
  await user.keyboard('{ArrowDown}');
  expect(screen.getByRole('menuitem', { name: 'แก้ไขชื่อรายการ' })).toHaveFocus();
  await user.keyboard('{ArrowUp}');
  expect(screen.getByRole('menuitem', { name: 'ลบแผน' })).toHaveFocus();
  await user.keyboard('{Home}');
  expect(screen.getByRole('menuitem', { name: 'แก้ไขชื่อรายการ' })).toHaveFocus();
  await user.keyboard('{End}');
  expect(screen.getByRole('menuitem', { name: 'ลบแผน' })).toHaveFocus();
});

it('AC-CD23: Escape closes the menu and focuses the trigger', async () => {
  const user = userEvent.setup();
  setup();
  const trigger = screen.getByRole('button', { name: 'ตัวเลือกของแผน iPhone' });
  await user.click(trigger);
  await user.keyboard('{Escape}');
  expect(screen.queryByRole('menu')).toBeNull();
  expect(trigger).toHaveFocus();
});

it('AC-CD23: Tab closes the menu', async () => {
  const user = userEvent.setup();
  setup();
  await user.click(screen.getByRole('button', { name: 'ตัวเลือกของแผน iPhone' }));
  await user.tab();
  expect(screen.queryByRole('menu')).toBeNull();
});

it('an outside mousedown closes the menu', async () => {
  const user = userEvent.setup();
  setup();
  await user.click(screen.getByRole('button', { name: 'ตัวเลือกของแผน iPhone' }));
  fireEvent.mouseDown(document.body);
  expect(screen.queryByRole('menu')).toBeNull();
});

it('AC-CD23: activating an item focuses the trigger, then closes, then runs the action (trigger is the opener)', async () => {
  const user = userEvent.setup();
  const seen: Array<Element | null> = [];
  const onRename = jest.fn(() => { seen.push(document.activeElement); });
  render(<RowActionMenu triggerLabel="ตัวเลือก" items={[{ key: 'rename', label: 'แก้ไขชื่อรายการ', onSelect: onRename }]} />);
  const trigger = screen.getByRole('button', { name: 'ตัวเลือก' });
  await user.click(trigger);
  await user.click(screen.getByRole('menuitem', { name: 'แก้ไขชื่อรายการ' }));
  expect(onRename).toHaveBeenCalledTimes(1);
  expect(seen[0]).toBe(trigger);
  expect(screen.queryByRole('menu')).toBeNull();
});

it('I-24: opens above when there is not enough room below (menu height vs viewport minus nav minus bar)', async () => {
  const user = userEvent.setup();
  const rect = jest.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ bottom: 700, top: 656, left: 0, right: 44, width: 44, height: 44, x: 0, y: 656, toJSON: () => ({}) });
  const offset = jest.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(160);
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 768 });
  setup({ bottomInset: 88 });
  await user.click(screen.getByRole('button', { name: 'ตัวเลือกของแผน iPhone' }));
  // 768 - 56 (nav fallback) - 88 (bar) = 624 available; trigger bottom 700 → no room → flipped above
  expect(screen.getByRole('menu').className).toContain('bottom-[calc(100%+6px)]');
  rect.mockRestore();
  offset.mockRestore();
});
