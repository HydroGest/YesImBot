## Why

Core ingress and reply parsing currently carry more structure than the runtime
needs and place that structure at the wrong seams. Message fallback assembly can
leak platform event residue into persisted records, internal message types still
inherit from `Universal.Event`, and reply segmentation keeps control semantics
that the approved product direction no longer wants to support. This change
shrinks those seams now, before more platform integrations and reply features
accumulate on top of the current shapes.

## What Changes

**Message ingress record ownership**
- From: Gateway fallback assembly may spread arbitrary `session.event` residue
  into message records, and `MessageData` inherits from `Universal.Event`.
- To: Message records become a closed host-owned whitelist shape, and Gateway
  becomes the single authority that assembles the final persisted message record.
- Reason: Persisted message records must not inherit platform runtime structure
  or leak `_data`-style payload residue.
- Impact: Breaking for any code that relies on inherited event fields being
  present on `yesimbot.message` payloads.

**Non-message ingress contract**
- From: Event variants are open through `EventMap`, but their host envelope is
  also derived from `Universal.Event`.
- To: `EventMap` and declaration merge stay, but the host envelope becomes a
  closed `EventBase` plus flat declaration-merged event variant fields.
- Reason: The project wants extensible event variants without keeping an open
  platform event shell.
- Impact: Breaking for resolver code and tests that depend on inherited
  `Universal.Event` resources being present automatically on event records.

**Reply control parsing**
- From: Reply parsing recognizes `inner_thought`, `sep`, `sleep`, and `skip`,
  includes merge-based guardrail behavior, and treats OCL as a larger protocol
  layer.
- To: Reply parsing keeps only `inner_thought` and `sep`, removes `skip` and
  `sleep`, and shrinks into a smaller host-owned reply control parser.
- Reason: `skip` and `sleep` duplicate behavior the host already owns or no
  longer wants to expose as model-authored control semantics.
- Impact: Breaking for prompts, tests, and code that still assume `skip` or
  `sleep` are valid reply control elements.

## Capabilities

### New Capabilities
- `ingress-record-boundary`: Define closed host-owned base shapes for persisted
  message and event records while preserving declaration-merged event variants.

### Modified Capabilities
- `platform-message-ingestion`: Change resolver responsibilities and Gateway
  record assembly so final persisted ingress records are host-normalized and
  field-whitelisted.
- `platform-event-contract`: Replace `Universal.Event`-derived host envelopes
  with closed host-owned message and event bases while keeping `EventMap`
  extensibility.
- `reply-output-control-language`: Reduce the reply control grammar to
  `inner_thought` and `sep`, and remove `skip`/`sleep` semantics.

## Impact

- Affected code: `core/src/gateway`, `core/src/event`, `core/src/runtime`,
  `core/src/reply`, `core/src/platforms/onebot`, and related tests.
- Affected persisted contracts: `yesimbot.message` and `yesimbot.event` payload
  shapes.
- Affected prompt/runtime behavior: reply control instructions, parser behavior,
  delivery metadata, and runtime tests around segmentation and event formatting.
