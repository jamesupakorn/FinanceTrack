import { render, screen, waitFor } from '@testing-library/react';
import ProfileGalleryPage from '../../pages/profiles';

// TD-H09 M-1 regression: `/api/users` now legitimately returns a real 'demo' row (seedUsers.js), but
// that row is the stripped public projection ({ id, displayName, avatar } — no isDemo/tagline). This
// test exercises the client-side `fetchUsers()` retry path (SSR-empty / "ลองใหม่"), which is the only
// place the raw server row could ever leak through and replace the special DEMO_PROFILE card.
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

// pages/profiles.js only uses `loadUsers` inside `getServerSideProps` (server-only, not exercised by
// this client-render test), but the top-level import still drags in `lib/mongodb.js` → the real
// `mongodb` driver, which ships an ESM-only `bson` submodule Jest's CJS transform can't load. Mock
// the module boundary so the import resolves without pulling in that dependency chain.
jest.mock('../../lib/userStore', () => ({ loadUsers: jest.fn() }));

afterEach(() => {
  jest.restoreAllMocks();
});

test('fetchUsers() dedupes the server-returned demo row so only the special DEMO_PROFILE card renders', async () => {
  // Simulates the exact server projection from pages/api/users.js: a real 'demo' user, stripped of
  // isDemo/tagline/description, sitting alongside u001/u002 — the scenario that broke `hasDemo`.
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      users: [
        { id: 'u001', displayName: 'ผู้ใช้หนึ่ง', avatar: '' },
        { id: 'demo', displayName: 'demo', avatar: '' },
        { id: 'u002', displayName: 'ผู้ใช้สอง', avatar: '' }
      ]
    })
  });

  // initialProfiles=[] forces the SSR-empty branch, which triggers fetchUsers() on mount.
  render(<ProfileGalleryPage initialProfiles={[]} />);

  await waitFor(() => expect(global.fetch).toHaveBeenCalled());
  await waitFor(() => expect(screen.queryByText('กำลังโหลดรายชื่อผู้ใช้...')).not.toBeInTheDocument());

  // Only one 'demo' card should render, and it must be the special DEMO_PROFILE card (its own copy),
  // not the stripped generic server row (which would render as `displayName: 'demo'` with no tagline).
  expect(screen.getAllByText('บัญชีสาธิต (Demo)')).toHaveLength(1);
  expect(screen.getByText('ไม่ต้องใช้รหัสผ่าน')).toBeInTheDocument();
  expect(screen.queryByText('demo')).not.toBeInTheDocument();

  // Real users are still present and untouched.
  expect(screen.getByText('ผู้ใช้หนึ่ง')).toBeInTheDocument();
  expect(screen.getByText('ผู้ใช้สอง')).toBeInTheDocument();
});
