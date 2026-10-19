import { render, screen, waitFor } from '@testing-library/react';
import ProfileGalleryPage from '../../pages/profiles';

jest.mock('next/router', () => ({
  useRouter: () => ({ replace: jest.fn(), push: jest.fn() })
}));

jest.mock('../../src/frontend/contexts/SessionContext', () => ({
  useSession: () => ({
    currentUser: null,
    isReady: true,
    selectUser: jest.fn(),
    logout: jest.fn()
  })
}));

jest.mock('../../lib/userStore', () => ({ loadUsers: jest.fn() }));

afterEach(() => {
  jest.restoreAllMocks();
});

test('fetchUsers() dedupes the server-returned demo row so only the special DEMO_PROFILE card renders', async () => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      users: [
        { id: 'u001', displayName: 'ผู้ใช้หนึ่ง', avatar: '' },
        { id: 'demo', displayName: 'demo', avatar: '' },
        { id: 'u002', displayName: 'ผู้ใช้สอง', avatar: '' }
      ]
    })
  }) as unknown as typeof fetch;

  render(<ProfileGalleryPage initialProfiles={[]} />);

  await waitFor(() => expect(global.fetch).toHaveBeenCalled());
  await waitFor(() => expect(screen.queryByText('กำลังโหลดรายชื่อผู้ใช้...')).not.toBeInTheDocument());

  expect(screen.getAllByText('บัญชีสาธิต (Demo)')).toHaveLength(1);
  expect(screen.getByText('ไม่ต้องใช้รหัสผ่าน')).toBeInTheDocument();
  expect(screen.queryByText('demo')).not.toBeInTheDocument();
  expect(screen.getByText('ผู้ใช้หนึ่ง')).toBeInTheDocument();
  expect(screen.getByText('ผู้ใช้สอง')).toBeInTheDocument();
});