# Task 1 Report: Channel Scope And Key Protocol

## Status

Completed and committed as one Task 1 change.

## Changes

- `core/src/channel/index.ts`: added flat `ChannelScope.isDirect`, exact non-empty-field and boolean validation, tagged direct/shared canonical tuples, SHA-256 first-128-bit lowercase unpadded RFC 4648 Base32 Keys, and EventRecord classification through `Universal.Channel.Type.DIRECT`.
- `core/src/gateway/index.ts`: preserves `Session.isDirect` in scopes and rejects Resolver output whose direct classification disagrees with the source Session.
- `core/src/service.ts`: preserves command Session direct classification when resetting a channel.
- `plugins/memos-client/src/index.ts`: supplies the Core scope discriminator from the existing target channel type or runtime channel context without changing memos identity hashing.
- Core Task 1 test fixtures now explicitly classify scopes and Sessions. `channel.test.ts` holds the approved shared, direct, Unicode, and empty-field vectors; `gateway.test.ts` covers Resolver direct/shared mismatch rejection.

Modified files:

- `core/src/channel/index.ts`
- `core/src/gateway/index.ts`
- `core/src/service.ts`
- `plugins/memos-client/src/index.ts`
- `core/tests/asset.test.ts`
- `core/tests/channel-runtime.test.ts`
- `core/tests/channel.test.ts`
- `core/tests/formatter.test.ts`
- `core/tests/gateway-delivery.test.ts`
- `core/tests/gateway.test.ts`
- `core/tests/image-freeze.test.ts`
- `core/tests/jsonl-storage.test.ts`
- `core/tests/runtime-manager.test.ts`
- `core/tests/service.test.ts`

## TDD Evidence

RED command:

```sh
rtk yarn workspace koishi-plugin-yesimbot exec vitest run tests/channel.test.ts
```

Result: 6 failures. The shared vector expected `a5vnf2ijd75c2ibyo2s5czdir4` but received the old `"[\"onebot\",\"10000\",\"123456\"]"` tuple. Empty field cases also did not throw. This confirmed the old implementation had neither the Key protocol nor validation.

Gateway RED command:

```sh
rtk yarn workspace koishi-plugin-yesimbot exec vitest run tests/gateway.test.ts
```

After normalizing the Session fixture to a direct `message-created` Session, the new mismatch case failed because `runtime.route` was called once. This confirmed Gateway did not compare direct classification.

GREEN command:

```sh
rtk yarn workspace koishi-plugin-yesimbot exec vitest run tests/channel.test.ts tests/gateway.test.ts
```

Result: 2 files and 20 tests passed with no test warnings.

Expanded Task 1 core verification:

```sh
rtk yarn workspace koishi-plugin-yesimbot exec vitest run tests/channel.test.ts tests/gateway.test.ts tests/asset.test.ts tests/channel-runtime.test.ts tests/formatter.test.ts tests/gateway-delivery.test.ts tests/image-freeze.test.ts tests/jsonl-storage.test.ts tests/runtime-manager.test.ts
```

Result: 9 files and 74 tests passed with no test warnings.

Type checks:

```sh
rtk yarn turbo run check-types --filter=koishi-plugin-yesimbot
rtk yarn check-types
```

Result: both passed. Turbo replayed its existing package export warning about `package.json` outside `dist`; it is unrelated to this change and no type errors occurred.

## Self-Check

- `git diff --check` passed.
- The code diff is limited to files listed by the Task 1 brief.
- The report is the only additional Task artifact.
- The implementation keeps `ChannelScope` flat and does not introduce a parallel identity type, wrapper, compatibility mapping, or new extension point.
- Existing `channelPath` and `channelFileName` exports remain only for consumers that later Tasks replace.

## Unresolved Items And Risks

- `core/tests/service.test.ts` still has one unrelated baseline failure in `exposes only the confirmed facade`: the inherited Koishi `Service` exposes enumerable `config`, while the test expects it not to. Task 1 does not alter that facade behavior. The Task-specific reset scope test was updated for explicit classification.
- The full 10-file expanded command therefore has this known single failure; the 9-file Task 1 identity/Gateway/core-path verification is clean.
- Storage layout, manifest/catalog, assignee admission, Runtime handover, Workspace relocation, and replacement of memos channel hashing are intentionally deferred to Tasks 2-9.
