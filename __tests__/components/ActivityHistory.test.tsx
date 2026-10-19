import { afterEach, describe, expect, it } from '@jest/globals';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import ActivityHistory from '../../src/frontend/components/ActivityHistory';
import { auditLogAPI } from '../../src/shared/utils/frontend/apiUtils';

jest.mock('../../src/shared/utils/frontend/apiUtils', () => ({
  auditLogAPI: { list: jest.fn() },
}));

const list = jest.mocked(auditLogAPI.list);

const item = (id: string, over = {}) => ({
  eventId: id, occurredAt: '2026-03-01T10:00:00.000Z', actorType: 'user', source: 'salary',
  resource: 'salary', action: 'updated', changedFields: ['amount'], ...over,
});

afterEach(() => { jest.clearAllMocks(); jest.restoreAllMocks(); });

describe('ActivityHistory', () => {
  it('shows loading then localized labels', async () => {
    list.mockResolvedValueOnce({ items: [item('1')], nextCursor: null } as never);
    render(<ActivityHistory />);
    expect(screen.getByRole('status').textContent).toContain('กำลังโหลด');
    expect(await screen.findByText(/แก้ไขข้อมูล · เงินเดือน/)).toBeTruthy();
    expect(screen.getByText(/จำนวนเงิน/)).toBeTruthy();
    expect(screen.queryByText('โหลดเพิ่ม')).toBeNull();
  });

  it('shows the empty state', async () => {
    list.mockResolvedValueOnce({ items: [], nextCursor: null } as never);
    render(<ActivityHistory />);
    expect(await screen.findByText('ยังไม่มีประวัติการเปลี่ยนแปลง')).toBeTruthy();
  });

  it('shows an error with retry that recovers', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    list.mockRejectedValueOnce(new Error('x')).mockResolvedValueOnce({ items: [item('1')], nextCursor: null } as never);
    render(<ActivityHistory />);
    fireEvent.click(await screen.findByText('ลองใหม่'));
    expect(await screen.findByText(/แก้ไขข้อมูล/)).toBeTruthy();
    expect(list).toHaveBeenCalledTimes(2);
  });

  it('paginates with load more using the cursor and marks system actors', async () => {
    list.mockResolvedValueOnce({ items: [item('1')], nextCursor: 'c1' } as never)
      .mockResolvedValueOnce({ items: [item('2', { actorType: 'system', action: 'retention_pruned', resourceKey: '2024-01' })], nextCursor: null } as never);
    render(<ActivityHistory />);
    fireEvent.click(await screen.findByText('โหลดเพิ่ม'));
    await waitFor(() => expect(list).toHaveBeenLastCalledWith('c1'));
    expect(await screen.findByText('โดยระบบ')).toBeTruthy();
    expect(screen.getAllByText('โดยคุณ')).toHaveLength(1);
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.queryByText('โหลดเพิ่ม')).toBeNull();
  });

  it('renders unknown resource/action as generic labels, never as raw server text', async () => {
    list.mockResolvedValueOnce({ items: [item('1', { resource: '<img src=x>', action: 'weird' as never })], nextCursor: null } as never);
    const { container } = render(<ActivityHistory />);
    expect(await screen.findByText(/การเปลี่ยนแปลง · ข้อมูลอื่น/)).toBeTruthy();
    expect(container.querySelector('img')).toBeNull();
  });

  it('keeps loaded items and offers retry when load-more fails', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    list.mockResolvedValueOnce({ items: [item('1')], nextCursor: 'c1' } as never).mockRejectedValueOnce(new Error('x'));
    render(<ActivityHistory />);
    fireEvent.click(await screen.findByText('โหลดเพิ่ม'));
    expect(await screen.findByText('โหลดเพิ่มไม่สำเร็จ')).toBeTruthy();
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
  });
});
