## Why

The current pipeline rewrites frozen message literals while embedding images, presents runtime events like ordinary user input, and can send unbounded or unsupported image parts to a model. Its deterministic Will cannot temporarily exercise the v3 willingness behavior, and every configured channel currently reaches expensive Gateway admission work. This change makes Agent admission explicit, model input deterministic and bounded, runtime notifications semantically isolated, and willingness behavior replaceable without leaking Koishi Session into the runtime.

## What Changes

**Channel admission**
- From: every structurally valid Session proceeds to storage readiness and assignee admission.
- To: a deny-by-default `allowedChannels` list filters `platform`, `channelId`, and optional `isDirect` immediately after ChannelScope derivation; `platform` and `channelId` accept `*`.
- Reason: operators need an explicit boundary for where the Agent is active.
- Impact: breaking for deployments that do not configure at least one allowed channel.

**Event and image model projection**
- From: Core reparses and reconstructs frozen content, inserts deprecated image parts at source positions, drops empty events, and gives non-message events no fixed semantic wrapper.
- To: Core preserves the complete frozen literal or existing content array, appends selected image `FilePart` values only at the tail, and wraps every non-message Event as deterministic untrusted `SYSTEM_NOTIFICATION` JSON data under `user` role.
- Reason: original content must remain immutable and runtime events must not be mistaken for user instructions.
- Impact: model-visible image placement and non-message Event text change intentionally.

**Model media controls**
- From: Gateway freeze limits are the only image limits, and model input ignores per-model modalities.
- To: model calls use a separate configurable count/byte budget and selection strategy. Embedding requires both the global switch and explicit `image` input capability configured in `models.json`; an authority-4 command idempotently adds one input modality to one model.
- Reason: prevent unsupported or oversized multimodal calls without conflating ingress safety with model budgets.
- Impact: models without explicit image capability receive text-only projection.

**Will engine selection**
- From: Core always constructs deterministic routing Will unless a plugin replaces the factory.
- To: Core configuration selects `routing` or an isolated static-config `willingness` engine; routing remains the default. Will gains an optional successful-reply notification used for v3-style reply cost.
- Reason: provide a minimal, reversible temporary willingness substitute.
- Impact: non-breaking until `willingness` is explicitly selected.

## Capabilities

### New Capabilities
- `model-input-media-budgeting`: Defines model image capability gating, call-scoped image budgets, deterministic selection strategies, file-part append semantics, and media failure behavior.

### Modified Capabilities
- `platform-message-ingestion`: Adds deny-by-default channel allowlist admission before all asynchronous Gateway work.
- `platform-message-formatting`: Preserves frozen content exactly, appends file parts, and defines the fixed non-message Event notification wrapper.
- `agent-plugin-system`: Adds read-only transformed-history and current-batch arrays to the existing `toModelMessages` context without adding another hook.
- `agent-runtime-core`: Distinguishes immutable persisted text/order from call-scoped attachment selection and defines model-call-batch current priority.
- `channel-will-evaluation`: Adds Core Will engine selection, temporary static willingness behavior, lazy decay, and successful-reply cost notification.
- `system-prompt-composition`: Defines untrusted notification guidance and the explicit call-scoped media exception to attachment-level prefix equivalence.
- `core-runtime-integration`: Snapshots resolved model image capability and composes the selected Core Will engine without exposing Session or model metadata to agent-runtime.

## Impact

- Core configuration, Gateway admission, Event formatting, model resolution, ChannelRuntime plugin composition, Will contracts, and prompt constants change.
- `@yesimbot/agent-runtime` adds two read-only arrays to the existing model-message context; it gains no new hook or persisted/turn identity.
- Provider plugins remain unchanged. `models.json` parsing, atomic persistence, ModelService refresh, and the Core modality command become the sole built-in capability-management path.
- Formatter, Gateway, model service, runtime manager, ChannelRuntime, Will, prompt, and agent-runtime tests require focused additions.
- No storage migration, EventRecord schema migration, remote media lookup, or new external dependency is required.
