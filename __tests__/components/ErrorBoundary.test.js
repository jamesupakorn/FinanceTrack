import { render, screen } from '@testing-library/react';
import ErrorBoundary from '../../src/frontend/components/ErrorBoundary';

// Standard React Testing Library error-boundary pattern: a component that throws on demand,
// so we can assert both the "no error" and "caught error" render paths.
function Thrower() {
  throw new Error('boom');
}

function Safe() {
  return <p>เนื้อหาปกติ</p>;
}

describe('ErrorBoundary', () => {
  it('renders children normally when nothing throws', () => {
    render(
      <ErrorBoundary>
        <Safe />
      </ErrorBoundary>
    );

    expect(screen.getByText('เนื้อหาปกติ')).toBeInTheDocument();
  });

  it('renders the fallback UI instead of the crashed subtree when a child throws', () => {
    // React (and jsdom) log the thrown error to console.error during the render pass that
    // triggers componentDidCatch — expected noise for this one test, suppressed so it doesn't
    // pollute test output. ErrorBoundary's own componentDidCatch also calls console.error by
    // design (AC-7), so this suppression is scoped to this test only, not globally.
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <ErrorBoundary>
        <Thrower />
      </ErrorBoundary>
    );

    expect(screen.getByText('เกิดข้อผิดพลาดบางอย่าง')).toBeInTheDocument();
    expect(screen.queryByText('เนื้อหาปกติ')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'โหลดหน้านี้ใหม่' })).toBeInTheDocument();

    consoleErrorSpy.mockRestore();
  });

  // Note: a "clicking reload calls window.location.reload()" test was attempted but dropped —
  // jsdom's `window.location` in this project's jsdom version rejects both `delete` and
  // `Object.defineProperty` redefinition of the `location` property (non-configurable), so it
  // cannot be safely stubbed from a test without a jsdom-version-specific workaround. The
  // `handleReload` method is a one-line `window.location.reload()` call, verified by code review
  // (spec AC-3) and by live-browser manual verification (spec AC-1/AC-3), which this app's other
  // error surfaces (`pages/_error.js`) also rely on rather than unit tests.
});
