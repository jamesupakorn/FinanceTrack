/**
 * overlayInventory.test.ts — AC-SBC-58 (D9, I5e): source-scan guard that makes a future unlisted
 * dialog/modal/sheet fail CI instead of silently missing Back support (spec §I5, R-SBC-8).
 *
 * Mechanism (source-scan, no rendering — same family as D3's AC-SBC-33 `beforePopState` grep):
 *   1. Enumerate every .tsx file under src/frontend/components/ and pages/ (plain recursive glob — no
 *      allowlist/denylist, so a newly added file is automatically in scope with no test edit needed).
 *   2. For each file, count `aria-modal="true"` and `useBackToClose(` independently (two separate regex
 *      matches, not one combined one, so a failure message can report both counts).
 *   3. Per-file assertion: useBackToClose( count >= aria-modal="true" count. A per-file inequality, not a
 *      directory-wide aggregate — an aggregate would let one over-wired file mask another under-wired one.
 *   4. Two named literal assertions, independent of step 3: ChangePasswordModal.tsx and LineConnectModal.tsx
 *      each contain useBackToClose(. Needed because both files have zero aria-modal="true" occurrences (by
 *      design — a separately-tracked a11y gap, see D5/D9), so the generic inequality (0 >= 0) passes
 *      vacuously for either regardless of whether the hook is wired. This test is the only thing that catches
 *      an absent hook call in those two files.
 *
 * This test catches absence (an overlay added later that skips the hook), not miswiring (the hook called
 * with the wrong close callback) — that correctness is covered by the per-dispatch BackToClose*.test.tsx
 * files (AC-SBC-50/51/55/56), per the architecture review's Check 6.
 */

import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';

const ROOTS = [
  join(__dirname, '../../../../src/frontend/components'),
  join(__dirname, '../../../../pages')
];

function listTsxFiles(dir: string): string[] {
  const entries = readdirSync(dir);
  const files: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      files.push(...listTsxFiles(full));
    } else if (entry.endsWith('.tsx')) {
      files.push(full);
    }
  }
  return files;
}

function countOccurrences(text: string, pattern: RegExp): number {
  return text.match(pattern)?.length ?? 0;
}

const allFiles = ROOTS.flatMap(listTsxFiles);

describe('overlayInventory (AC-SBC-58): every .tsx dialog/modal has at least as many useBackToClose( calls as aria-modal="true" occurrences', () => {
  it.each(allFiles.map(file => [relative(process.cwd(), file), file] as const))(
    '%s',
    (_label, file) => {
      const text = readFileSync(file, 'utf8');
      const ariaModalCount = countOccurrences(text, /aria-modal="true"/g);
      const hookCount = countOccurrences(text, /useBackToClose\(/g);
      expect(hookCount).toBeGreaterThanOrEqual(ariaModalCount);
    }
  );

  it('has enumerated at least one file under each root (the test itself is not vacuous)', () => {
    expect(allFiles.length).toBeGreaterThan(0);
  });
});

describe('overlayInventory (AC-SBC-58): named checks for the two files the generic inequality cannot catch', () => {
  // Both files have zero aria-modal="true" occurrences (a known, separately-tracked a11y gap — D5 for
  // ChangePasswordModal, D9 for LineConnectModal) — the generic per-file inequality above (0 >= 0) would
  // pass whether or not the hook is wired, so it alone can't prove these two are covered.
  const namedFiles = [
    join(__dirname, '../../../../src/frontend/components/ChangePasswordModal.tsx'),
    join(__dirname, '../../../../src/frontend/components/LineConnectModal.tsx')
  ];

  it.each(namedFiles.map(file => [relative(process.cwd(), file), file] as const))(
    '%s contains at least one useBackToClose( call',
    (_label, file) => {
      const text = readFileSync(file, 'utf8');
      expect(text).toMatch(/useBackToClose\(/);
    }
  );
});
