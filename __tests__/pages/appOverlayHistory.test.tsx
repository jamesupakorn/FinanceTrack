/**
 * AC-SBC-37: pages/_app.tsx installs overlayHistory once, with the next/router singleton.
 * The overlay module is mocked: the real next/router singleton throws in beforePopState when no router is mounted.
 */

import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import type { ReactNode } from 'react';
import type { AppProps } from 'next/app';
import { render, screen } from '@testing-library/react';
import MyApp from '../../pages/_app';
import { installOverlayHistory } from '../../src/shared/utils/frontend/overlayHistory';

const mockTeardown = jest.fn();

jest.mock('../../src/shared/utils/frontend/overlayHistory', () => ({
  installOverlayHistory: jest.fn(() => mockTeardown)
}));

jest.mock('next/router', () => ({
  __esModule: true,
  default: { asPath: '/', events: { on: jest.fn(), off: jest.fn() } },
  useRouter: () => ({ pathname: '/', asPath: '/', push: jest.fn(), replace: jest.fn() })
}));

jest.mock('../../src/frontend/contexts/ThemeContext', () => ({
  ThemeProvider: ({ children }: { children: ReactNode }) => <>{children}</>
}));

jest.mock('../../src/frontend/contexts/SessionContext', () => ({
  SessionProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  useSession: () => ({ currentUser: null })
}));

jest.mock('../../src/frontend/components/Toast', () => ({
  __esModule: true,
  default: () => null
}));

const routerSingleton = (jest.requireMock('next/router') as { default: unknown }).default;
const install = installOverlayHistory as jest.MockedFunction<typeof installOverlayHistory>;

const Page = () => <p>page body</p>;
const renderApp = () => render(<MyApp {...({ Component: Page, pageProps: {} } as unknown as AppProps)} />);

beforeEach(() => {
  jest.clearAllMocks();
});

it('installs once with the next/router singleton and tears down on unmount', () => {
  const { rerender, unmount } = renderApp();
  expect(screen.getByText('page body')).toBeInTheDocument();
  expect(install).toHaveBeenCalledTimes(1);
  expect(install.mock.calls[0][0]).toBe(routerSingleton);

  rerender(<MyApp {...({ Component: Page, pageProps: { again: true } } as unknown as AppProps)} />);
  expect(install).toHaveBeenCalledTimes(1);
  expect(mockTeardown).toHaveBeenCalledTimes(0);

  unmount();
  expect(mockTeardown).toHaveBeenCalledTimes(1);
});

it('installOverlayHistory is imported only by pages/_app.tsx within src/ and pages/', () => {
  const root = join(__dirname, '../..');
  const sourceFiles = (dir: string): string[] => readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
  const importers = [...sourceFiles(join(root, 'src')), ...sourceFiles(join(root, 'pages'))]
    .filter(path => /import\s*\{[^}]*\binstallOverlayHistory\b[^}]*\}\s*from/.test(readFileSync(path, 'utf8')))
    .map(path => path.slice(root.length + 1));
  expect(importers).toEqual(['pages/_app.tsx']);
});
