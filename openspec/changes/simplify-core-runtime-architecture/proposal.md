## Why

Core's Session, Runtime, storage, and media pipeline has sound ownership rules, but dead extension points and repeated contracts now obscure them. `registerWill` adds a generation dimension with no production consumer, assignee checks repeat on the ordinary event path, image policy is split across four modules, and public exports expose unused surfaces. This change removes those costs while preserving channel data, FIFO ordering, Session isolation, and explicit operator control over runtime replacement.

## What Changes

**Will evaluation**
- From: Core exports `Will`, accepts a custom `Will.Factory`, tracks Runtime generations, and maintains a 32-event read-only state window.
- To: Core owns an internal `WillEngine` selected by `config.will.engine`; state contains only `activeTurnId`; custom registration, generations, and the recent window are removed.
- Impact: Breaking public API removal for Will registration and exported Will contracts.

**Shared-channel assignee changes**
- From: Gateway and RuntimeManager both query assignee state, and RuntimeManager automatically drains and replaces a cached Runtime when `selfId` changes.
- To: Gateway admission is the ordinary-event assignee snapshot. A cached `selfId` mismatch fails closed and requires explicit `reload(newScope)`; Core never switches assignees from an event route.
- Impact: Operators must reload a channel after changing its Koishi assignee.

**Reload and reset**
- From: reload reuses the handover path, while cached and uncached reset paths implement cleanup separately.
- To: reload explicitly drains and removes a cached Runtime without clearing data; reset uses one RuntimeManager-owned sessions/assets cleanup path after teardown.
- Impact: Runtime lifecycle becomes simpler; persisted data semantics remain unchanged.

**Media pipeline**
- From: Gateway freeze limits and model-call selection limits are independent, duplicate policy types exist, and generic image logic spans Gateway, shared, and event modules.
- To: one configured numeric image budget controls freezing, AssetStore, and per-request selection; generic image handling moves to one media module.
- Impact: Breaking configuration rename from call-scoped fields to `maxCount` and `maxTotalBytes`.

**Module and public-surface cleanup**
- Merge Gateway with Satori fallback resolution in `gateway/index.ts`.
- Merge RuntimeManager and ChannelRuntime into `runtime/index.ts` while retaining separate classes and promise tails.
- Remove `shared/`, centralize `resolveBasePath`, centralize defaults, normalize Core-owned platform imports, and declare the optional OneBot adapter dependency.
- Delete zero-production-call public and internal exports directly, including `listChannels`; preserve the embedding capability chain as an explicit exception.
- Keep `sendMessage` cross-channel behavior while correcting its TypeScript tool contract.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `channel-will-evaluation`: Replace public Will factories and recent-state windows with an internal configured WillEngine.
- `core-runtime-integration`: Replace online assignee handover with explicit reload and unify Runtime reset ownership.
- `platform-message-ingestion`: Make Gateway admission the ordinary-event assignee snapshot and remove Runtime submission revalidation.
- `model-input-media-budgeting`: Use one numeric image budget for ingress persistence and per-request model selection.
- `workspace-sandbox-tools`: Reuse workspace identity after an operator-triggered assignee reload instead of automatic handover.
- `memos-cloud-memory`: Preserve channel and agent identity semantics across explicit assignee reload.

## Impact

- Core source organization, runtime lifecycle, Gateway admission, storage namespace registration, model media projection, configuration, tests, README files, `AGENTS.md`, and CHANGELOG change together.
- Public removals include `registerWill`, exported Will contracts, `listChannels`, `ChannelFilter`, and other confirmed zero-production-call exports.
- Existing JSONL, assets, channel Manifests, workspace data, and embedding configuration require no migration.
- Existing installations must rename multimedia image limit keys and explicitly reload a shared channel after changing its Koishi assignee.
