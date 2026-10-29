# CLAUDE.md

Agent rules for working in this repo. Read `.pipeline/WORKSPACE.md` first — it has the
full read order. This file only states the rules; it doesn't repeat the content.

## Before doing anything else

1. Read `.pipeline/WORKSPACE.md`, then `.pipeline/PROJECT.md`, `.pipeline/ARCHITECTURE.md`,
   `.pipeline/BUSINESS_RULE.md`, `.pipeline/CODING_STANDARD.md`, `.pipeline/CONTEXT.md`.
2. If `.pipeline/` is missing or looks stale (doesn't match current `git log`/file tree),
   run `/project-init` (full) or `/refresh-context` (incremental) instead of guessing.
3. Identify the impacted module(s) via `.pipeline/CONTEXT.md` before opening files. Don't
   scan the whole repo by default — this codebase has 71 test files and ~150 source
   files; targeted reads beat broad ones every time.
4. Use the minimum set of files required for the task. If uncertain which file owns a
   behavior, check `.pipeline/REUSABLES.md` and `.pipeline/ARCHITECTURE.md` before
   grepping blindly.

## Hard rules specific to this repo

- **No first-party JavaScript.** `scripts/checkNoFirstPartyJavaScript.ts` (run via
  `npm run check:no-js`) fails the build if any `.js/.jsx/.mjs/.cjs` file exists outside
  `node_modules`/build output. Every new file is `.ts`/`.tsx`. `next.config.ts` also sets
  `pageExtensions: ['ts','tsx']`.
- **One breakpoint: 768px.** Don't add a second responsive breakpoint anywhere — multiple
  CSS files call a second breakpoint a defect (AC-27/AC-75). `tailwind.config.ts`'s
  `screens` and `src/shared/utils/frontend/breakpoints.ts` must stay in sync.
- **`src/shared/utils/frontend/workspaceRoutes.ts`'s `WORKSPACE_SECTIONS` table must have
  exactly one copy.** It's the single source of truth for `/workspace/*` routing; a
  second copy anywhere fails review per its own header comment.
- **Credit-card money fields are never trusted from the client and never persisted as
  derived values.** Installment schedules are always rebuilt server-side via
  `buildSchedule`; revolving-balance figures (`interest`, `closingBalance`, etc.) are
  always recomputed from stored inputs via `buildRevolvingCycles`, never stored. See
  `.pipeline/BUSINESS_RULE.md` §Credit cards before changing any of this.
- **Every per-user API route must call `assertUserId(req, res)`** (session + CSRF check)
  before touching data, and mutating routes should be wrapped in `withAudit(handler, {source})`.
  Don't hand-roll auth checks.
- **Don't delete anything in `scripts/`** without checking `scripts/MIGRATIONS.md` first
  and getting explicit user confirmation — several one-off migrations there have no
  run-record and deletion is tracked per-script, not batched.
- **`.pipeline/` is gitignored and untracked; `CLAUDE.md` is committed.** `.gitignore`
  lists `.PIPELINE/` as local pipeline notes, and commit `b1a781b` ("ignore and untrack
  pipeline artifacts") removed it from git on purpose. Treat `.pipeline/*.md` as local
  working notes: they are not in the repo history, so never rely on a teammate or a fresh
  clone having them. Don't `git add -f` them or drop the ignore line without asking.
  Source comments that cite `.pipeline/spec-*.md` point at local files.
- **No ESLint config exists.** The only enforced gates are `tsc --noEmit` (strict mode),
  the no-JS check, and Jest. Match surrounding code style by observation, not by an
  enforced linter.

## When uncertain

- Ask the user rather than guessing on: anything touching money-math business rules not
  covered in `.pipeline/BUSINESS_RULE.md`, deleting any file under `scripts/`, or
  changing the session/CSRF/audit security primitives in `lib/` or
  `src/shared/utils/backend/`.
- Never invent a `BR-*`/`ADR-*`/`TD-*` ID — grep for the real one or state there isn't one.
