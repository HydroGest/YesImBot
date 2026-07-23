## 1. Channel Identity And Key

- [x] 1.1 Add `isDirect` to `ChannelScope`, derive it consistently from Session and EventRecord data, and reject resolver classification mismatches.
- [x] 1.2 Replace legacy channel key and filename helpers with the tagged shared/direct SHA-256/Base32 protocol and all approved conformance vectors.
- [x] 1.3 Update channel identity callers and tests so shared scopes ignore `selfId` while direct scopes retain bot isolation.

## 2. Core Channel Storage

- [x] 2.1 Add the private Core storage manager for Manifest validation, atomic channel creation, Catalog rebuild, and collision detection.
- [x] 2.2 Add namespace registration and safe path resolution with slug, reserved-name, segment, and containment validation.
- [x] 2.3 Expose `channelKey`, `registerStorage`, `ensureStorage`, and `listChannels` directly on `YesImBotService`, and initialize storage before admission.
- [x] 2.4 Add crash-recovery, malformed-data, Catalog ordering, duplicate namespace, and path traversal tests.

## 3. Core Storage Consumers

- [x] 3.1 Move Agent JSONL storage to `channels/<key>/sessions/messages.jsonl` through Core storage resolution.
- [x] 3.2 Move AssetStore paths to `channels/<key>/assets/` while preserving content hashing, integrity checks, and reset cleanup.
- [x] 3.3 Keep reset limited to Session and Asset data while preserving Manifest, Catalog, Workspace, and other namespaces.

## 4. Database Assignee Admission

- [x] 4.1 Declare Koishi Database as a required Core dependency and add one shared-channel assignee resolver keyed by `platform + channelId`.
- [x] 4.2 Reject missing, empty, failed, or mismatched shared-channel assignments before resolver work, asset freezing, persistence, and Runtime creation.
- [x] 4.3 Apply the same assignee check at Runtime submission and to state-changing YesImBot commands while direct channels skip assignment.

## 5. Online Runtime Handover

- [x] 5.1 Track each shared Runtime's bound `selfId` and generation under the shared Channel Key.
- [x] 5.2 Add a delivery lease and internal completion lane so a draining Runtime owns all output delivery and delivery-failure work.
- [x] 5.3 Implement two-phase graceful handover outside the per-Key lifecycle coordinator, with repeated assignee checks and no normal-turn interruption.
- [x] 5.4 Bound each handover at five waiting events and fail closed on stale assignment, drain failure, or stuck Runtime.
- [x] 5.5 Add concurrency tests for normal handover, assignment changes during drain, delivery failure completion, queue overflow, and direct-channel independence.

## 6. Workspace Integration

- [x] 6.1 Remove the plugin-owned channel workspace root and legacy `workspace_v2_*` path derivation.
- [x] 6.2 Register `workspace`, resolve the root through `ensureStorage`, and cache Workspace objects by Core Channel Key.
- [x] 6.3 Add tests for shared-assignee reuse, direct bot isolation, namespace disposal, and preservation of existing Workspace data.

## 7. MemOS Integration

- [ ] 7.1 Replace memos-client's local channel hash with `ctx.yesimbot.channelKey(scope)` while retaining all MemOS-owned identity derivations.
- [ ] 7.2 Update runtime and import identity call sites and tests for stable shared-channel hashes and direct-channel bot isolation.

## 8. Documentation And Verification

- [ ] 8.1 Update public exports, configuration documentation, and operator documentation for the new Key, Catalog, unified root, Database requirement, and no-migration boundary.
- [ ] 8.2 Run targeted Core, Workspace, and memos-client tests after each package change.
- [ ] 8.3 Run `yarn lint`, `yarn fmt:check`, `yarn check-types`, `yarn build`, and `yarn test`, then record any environment-only failures.
- [ ] 8.4 Run strict OpenSpec validation and confirm no implementation retains legacy channel path or plugin-local channel hash derivation.
