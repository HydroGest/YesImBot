# Task 9 Report: Synchronize Verified Decisions Into Main OpenSpec Specs

## Scope

- Repaired the missing active OpenSpec change at `openspec/changes/redesign-message-storage-channel-identity/` using the minimal `spec-driven` artifact set: proposal, design, tasks, and nine capability delta specs.
- Synchronized the nine required main specifications with the verified clean-break implementation.
- Kept the change active. No runtime or source files were changed and no archive operation ran.

## Source Evidence

- Read the Task 9 brief, approved design, implementation plan, controller progress ledger, Task 8 report, and all nine pre-sync main specs.
- The controller ledger records Tasks 2 through 8 as complete. Task 8 records passing `rtk yarn check-types` and `rtk yarn build`; its full-suite baseline retains only three accepted stale OneBot reaction failures in `core/tests/platform/onebot.test.ts`.

## Active Change Repair

- `openspec/changes/` contained only `archive/`; the required active change was absent.
- Created `redesign-message-storage-channel-identity` with the local `spec-driven` schema because it provides the required minimal proposal, design, specs, and tasks artifacts without inventing additional planning scope.
- Delta specs cover all nine affected capabilities and record the split message/event contract, `channelIdentity`, readable Manifest-backed storage, no Catalog, clean-break behavior, and plugin boundaries.

## Main Spec Synchronization

- `platform-event-contract`: defines `yesimbot.message` versus `yesimbot.event`, `schemaVersion: 1`, source elements, frozen text, and Input observation.
- `platform-message-ingestion` and `platform-message-formatting`: use the InputRecord union, strict ordinary-message admission, pre-transform element capture, and frozen-text-only replay/media projection.
- `channel-scope-identity` and `channel-storage-protocol`: define `channelIdentity`, readable `v1-shared-*` / `v1-direct-*` directories, authoritative `channel.json`, Manifest scanning, no `channels.json`, and no fallback.
- `core-runtime-integration` and `message-delivery`: route Message/Event input through identity-keyed runtime ownership and persist delivery failures as `eventType: "delivery.failed"`.
- `memos-cloud-memory` and `workspace-sandbox-tools`: require `channelIdentity` for logical metadata/cache identity and `ensureStorage` as the storage-path boundary.

## Verification

- `rtk openspec validate redesign-message-storage-channel-identity --type change --strict --no-interactive`: passed.
- `rtk openspec validate --specs --strict --no-interactive`: passed, 20 specifications passed and 0 failed.
- Markdown LSP diagnostics were unavailable because no `.md` language server is configured; no TypeScript or runtime files were changed.

## Design Discipline

- KISS: used one active change and one requirement set per capability.
- YAGNI: created only the change artifacts required for Task 9 validation and sync.
- DRY: authoritative contract language lives in the relevant main capability rather than duplicated compatibility clauses.
- SOLID: identity, directory naming, Manifest storage, runtime routing, and plugin consumers remain separate responsibility boundaries.

## Remaining Concern

The implementation baseline still has the three controller-accepted stale OneBot reaction expectation failures documented by Task 8. They are outside this documentation-only task. The active change remains intentionally unarchived.
