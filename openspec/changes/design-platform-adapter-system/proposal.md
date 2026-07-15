## Why

YesImBot currently lets Koishi Session objects cross routing, persistence, and
LLM presentation boundaries. This makes platform-specific corrections hard to
add without coupling core to OneBot or other adapter internals. Non-message
events have no complete route, and plugins could otherwise duplicate listeners
and prompt formatting. A stable input contract will isolate platform differences
while preserving one policy for routing, persistence, willingness, and LLM
presentation.

## What Changes

**Inbound Platform Adaptation**
- From: Middleware directly converts eligible messages and platform extension
  types expose an open event surface without runtime validation.
- To: Core collects Satori-dispatched Sessions, derives validated messages and
  events, and selects one deterministic platform-specific refiner per input.
- Reason: Platform, adapter, and implementation differences need an extension
  point without letting plugins own listeners or core policy.
- Impact: Core service API gains live platform registrations and structured
  publication. Existing direct Session-to-message conversion changes boundary.

**Unified Platform Presentation**
- From: Core's platform message plugin renders preserved Satori content directly
  into model text, and future platform events would require plugin-owned text.
- To: Core renders stable semantic nodes from messages and events. Extensions
  contribute validated semantics but do not create prompt text or model messages.
- Reason: LLM input must remain consistent, safe, templateable, and replayable
  after a platform plugin changes.
- Impact: Channel history for admitted non-message events stores core semantic
  nodes rather than platform-specific payloads.

**Stable Message Resources**
- From: Model projection could fetch temporary forward or media data each time a
  model request rebuilds history.
- To: Core resolves configured references before first message persistence,
  stores bounded structured snapshots inline, and stores persistent binary media
  by content hash under the channel directory.
- Reason: Historical model input must remain deterministic for prompt-prefix
  stability and prompt-cache reuse.
- Impact: New core-wide resource policy, `Platform.Reader` registrations, and
  channel asset cleanup are required.

**Core Runtime Integration**
- From: `handleSession()` owns collection, message conversion, route selection,
  and model projection as one message-only path.
- To: Session collection and platform conversion become a core boundary that
  supplies the existing message routing and new event consumers.
- Reason: A single input path prevents duplicate middleware/listener handling
  and creates a clean boundary for future world state and willingness systems.
- Impact: Existing routing behavior remains deterministic, but consumes a
  normalized message instead of converting Session independently.

## Capabilities

### New Capabilities
- `platform-input-adaptation`: Collect, validate, refine, publish, and
  distribute inbound Koishi/Satori platform facts through a stable extension
  boundary.
- `platform-llm-presentation`: Convert standardized messages and events into
  core semantic nodes and safe, templateable LLM input.

### Modified Capabilities
- `core-runtime-integration`: Core message routing and platform custom-message
  integration consume the new input and presentation boundaries.

## Impact

- Affected code: `core/src/service.ts`, `core/src/platform/`,
  `core/src/runtime/message.ts`, channel storage helpers, core configuration,
  core public service types, and related tests.
- Affected plugins: future platform refiners replace listener-owned adaptation;
  existing platform tool plugins retain their outbound API ownership.
- Data: channel messages keep Satori content; channel-admitted non-message
  events store semantic nodes. No global raw event archive or replay store is
  introduced.
- Dependencies: No new runtime dependency, capability framework, model
  capability registry, or output delivery abstraction is planned.
