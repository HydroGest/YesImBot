# Task 5 Report: Manifest-Backed Readable Channel Storage

## Scope

- Added `core/src/storage/manifest.ts` for directory-name derivation, manifest versions, record construction, and JSON-boundary parsing.
- Replaced hash directory and Catalog use in `ChannelStorage` with identity-indexed records and readable `directoryName` paths.
- Updated only the Task 5 storage, JSONL path, and RuntimeManager layout assertions.

## Test-First Process

1. Replaced storage path and manifest expectations with readable-directory and manifest-authority assertions.
2. Added coverage for component encoding, basename bounds, startup scanning, old hash directory preservation, name persistence, and integrity rejection without data changes.
3. Ran `rtk yarn workspace koishi-plugin-yesimbot exec vitest run tests/storage.test.ts tests/jsonl-storage.test.ts` before production changes.
4. Observed 14 expected failures caused by hash paths, `key`/`keyVersion`, Catalog creation, and missing integrity rejection.
5. Added the manifest module and simplified storage around manifest scanning.

## Implementation

- `channelDirectoryName()` produces `v1-shared-<platform>-<channelId>` or `v1-direct-<platform>-<channelId>-<selfId>`, retaining only ASCII letters, digits, and underscores within components. It iterates Unicode code points and rejects complete basenames over 200 characters.
- `channel.json` now stores `formatVersion`, `identityVersion`, `directoryVersion`, `identity`, `directoryName`, scope fields, and optional name. Parsing validates the file boundary with Zod, reconstructs the scope, and recomputes both identity and directory name.
- Startup scans only readable-directory candidates, verifies their Manifest against the physical directory, indexes valid records by identity, and reports invalid or old hash directories without reading, migrating, renaming, deleting, or merging them.
- Channel creation writes the Manifest inside a same-parent temporary directory and atomically renames it. Name updates atomically replace only that Manifest.
- `channels.json`, Catalog helpers, and `key` filesystem usage were removed from storage source.

## Verification

- Passed: `rtk yarn workspace koishi-plugin-yesimbot exec vitest run tests/storage.test.ts tests/jsonl-storage.test.ts tests/runtime-manager.test.ts`
  - 3 test files, 83 tests.
- Attempted: `rtk yarn turbo run check-types --filter=koishi-plugin-yesimbot`
  - Fails on pre-existing Task 3 input-pipeline errors in `src/gateway/index.ts`, `src/runtime/channel.ts`, `src/will/index.ts`, and `src/will/willingness.ts`.
  - No diagnostics reference Task 5 storage files.
- TypeScript LSP diagnostics are unavailable because the server is not installed and installation was previously declined.
- `git diff --check` passed.
- Storage source search found no `channels.json`, `keyVersion`, `catalog`, or `record.key` references.

## Design Review

- Single responsibility: `manifest.ts` owns immutable manifest protocol derivation and parsing; `index.ts` owns storage lifecycle and namespace safety.
- Boundary purity: disk JSON is parsed once into a typed Manifest before storage logic uses it.
- Variants and escape hatches: no tagged-union branching, `any`, type assertions, suppressions, or compatibility aliases were added.
- Tests lock the new protocol before the implementation; reverting readable paths, manifest scanning, or integrity validation makes the focused suite fail.
- Pure LOC: `manifest.ts` is 82 and `index.ts` is 233. The pre-existing test files exceed the source-module guideline but gained only focused Task 5 assertions.

## Commit

- Pending the required Task 5-scoped commit.
