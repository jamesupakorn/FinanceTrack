import React from 'react';

// React error boundaries must be class components (componentDidCatch/getDerivedStateFromError
// have no hook equivalent) — the one narrow, deliberate exception to CODING_STANDARD.md's
// "no class components" rule. See .pipeline/architecture-review-error-boundary.md for the
// recorded rationale/carve-out.
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    // Only sink available — no Sentry/APM configured in this app (task-context confirmed).
    // error.message/info.componentStack are React-internal identifiers (component names, file
    // stack), not application/financial data — safe to log in full, unlike the LINE
    // token/payload logging TD-C03/TD-C02 had to scrub.
    console.error('[ErrorBoundary] Uncaught render error:', error, info?.componentStack);
  }

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-canvas px-space-4 text-center">
          <div className="max-w-sm rounded-lg border border-border-default bg-surface-1 p-space-6">
            <p className="text-xl font-semibold text-primary">เกิดข้อผิดพลาดบางอย่าง</p>
            <p className="mt-space-2 text-sm text-secondary">
              ขออภัยในความไม่สะดวก ระบบพบปัญหาที่ไม่คาดคิด ลองโหลดหน้านี้ใหม่อีกครั้ง
            </p>
            <button
              type="button"
              onClick={this.handleReload}
              className="mt-space-5 rounded-md bg-accent px-space-5 py-space-3 text-sm font-medium text-on-accent"
            >
              โหลดหน้านี้ใหม่
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
