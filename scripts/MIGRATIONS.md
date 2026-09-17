# scripts/ — purpose and run-state log

Written 2026-09-17 as part of TD-L01 (`.pipeline/TECH_DEBT.md`). None of the scripts below have a
documented "confirmed run against production" record — nobody deleted or archived anything in this
pass. This file exists so a future pass has something to check before deleting a script, instead of
guessing from the filename alone.

## One-off migrations — run-state unknown, do not delete without checking with the user first

- **`migrateToMultiUser.js`** — converts flat-array JSON data files to per-user keyed objects. No run
  record found in `.pipeline/STATUS.md`/`STATUS-archive.md`/`TECH_DEBT.md`.
- **`migrateMongoUserIds.js`** — backfills `userId` on legacy Mongo docs missing it. No run record
  found.
- **`migrateRemoveEstimateMongo.js`** — strips legacy `estimate`/`totalEstimate` fields from
  `monthly_expense` Mongo docs. No run record found.
- **`migrateBankAccounts.mjs`** — adds `bankAccounts: []` to users lacking it. Operates only on the
  local `src/backend/data/users.json` file (no Mongo branch) — that file no longer exists in this
  repo (production auth moved to Mongo, per `seedUsers.js`'s own comment and TD-H09). Structurally
  inert against current production data, but would still work against a from-scratch local
  JSON-mode dev checkout — keep for that reason, don't delete as "dead code" without checking first.
- **`importJsonToMongo.js`** / **`exportMongoToJson.js`** — reverse-pair bridge scripts between the
  old JSON stores and Mongo collections. No run record found. `exportMongoToJson.js` still uses the
  old inverted `--dry-run` flag convention (everything else in this directory defaults to dry-run,
  requires `--apply` to write) — a separately-tracked, still-open TECH_DEBT follow-up, not fixed
  here.
- **`appendDailyExpenseItems.js`** — parameterized single-user/single-month-pair data-copy tool
  (`--userId --from --to`). By nature a reusable manual-repair tool, not a run-once migration — no
  specific invocation record, and none expected.

## Repeatable setup/seed scripts — keep, not migrations

- **`setupLoginAttemptsCollection.js`** — idempotent (checks `listCollections` first) collection/TTL
  setup for TD-H10's rate limiter. Needed on any fresh environment.
- **`setupSavingsGoalsCollection.js`** — idempotent-ish collection+validator+indexes setup for
  `savingsGoals`. Note: also inserts hardcoded sample data for `u001` on every run — worth knowing
  before ever re-running this against production.
- **`seedUsers.js`** — one-time upsert of a hardcoded user snapshot into Mongo. Per TD-H09
  (`.pipeline/TECH_DEBT.md`), it has an **explicitly open** question: whether a pre-existing
  production `demo` doc has actually picked up `isDemo: true` yet. Do not touch without resolving
  that first.
- **`createUser.mjs`** — general-purpose "add a user" CLI, reusable, has its own usage instructions.
  Same as `migrateBankAccounts.mjs`: JSON-file-only, inert against current Mongo-based production
  data, but a working local-dev tool.
- **`printMongoCollections.js`** — read-only diagnostic (counts + samples per collection). No writes.
  Clear keep.

## Deciding whether to delete a script later

None of the above currently qualifies as "confirmed run, safe to delete" — that requires either a
human who remembers running it against production, or a positive check against production data
showing the migration's target state already holds. Treat deletion of any one script as its own
small, separately-approved follow-up, not something to batch.
