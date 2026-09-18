import { render, screen } from '@testing-library/react';
import LoadingSkeleton, { SkeletonBlock } from '../../src/frontend/components/LoadingSkeleton';

// Presentational only — no jest.mock() needed (same precedent as ErrorBoundary/LoadingNotice).
// Deliberately no snapshot test of any of the five real skeleton shapes (spec §5): those live at
// each call site and would pin arbitrary pixel values, turning every future layout tweak into a
// test edit. This file only covers the two things LoadingSkeleton/SkeletonBlock actually share.

describe('LoadingSkeleton', () => {
  it('renders role="status" with aria-busy="true" and the given label as sr-only text', () => {
    render(<LoadingSkeleton label="กำลังโหลดตัวอย่าง..." />);

    const region = screen.getByRole('status');
    expect(region).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByText('กำลังโหลดตัวอย่าง...')).toBeInTheDocument();
  });
});

describe('SkeletonBlock', () => {
  it('defaults to bg-surface-2 fill (on="surface-1") and never also carries bg-surface-3', () => {
    const { container } = render(<SkeletonBlock />);
    const block = container.firstChild;

    expect(block.className).toEqual(expect.stringContaining('bg-surface-2'));
    expect(block.className).not.toEqual(expect.stringContaining('bg-surface-3'));
  });

  it('on="surface-2" yields bg-surface-3 fill and never also carries bg-surface-2', () => {
    const { container } = render(<SkeletonBlock on="surface-2" />);
    const block = container.firstChild;

    expect(block.className).toEqual(expect.stringContaining('bg-surface-3'));
    expect(block.className).not.toEqual(expect.stringContaining('bg-surface-2'));
  });

  it('is aria-hidden', () => {
    const { container } = render(<SkeletonBlock />);
    expect(container.firstChild).toHaveAttribute('aria-hidden', 'true');
  });
});
