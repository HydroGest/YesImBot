<!--
Raw capture of the validated brainstorming outcome for this change.

design.md will reorganize these decisions into a structured design. The two
artifacts are complementary rather than duplicated line for line.
-->

# YesImBot System Prompt Architecture Brainstorm

## Background

YesImBot is intended to host a persistent digital subject with independent
judgment, long-term memory, a continuous personality, and room for future
self-directed activity. The system prompt must support that product identity
without claiming capabilities that the runtime does not provide.

The design drew from:

- the Athena v4 vision and evolution notes;
- early YesImBot promptHosting experiments;
- Letta/MemGPT identity, memory, private deliberation, and tool-use patterns;
- the YesImBot v3 MemGPT-derived prompt;
- the current message-first agent runtime and channel-scoped Core architecture;
- the unapproved early `core/resources/prompts/system.md` and system-prompt
  design draft, treated as references rather than requirements.

Several historical mechanisms were rejected for the target design: explicit
chain-of-thought output, JSON action envelopes, heartbeat requests, claims of
continuous background awareness, fixed short-reply limits, artificial typos,
and a hardcoded low-emotion chat style.

## Decision Chain

### Q1: What defines the public subject?

**Decision:** The active persona fully defines the public subject.

YesImBot is the host runtime, not the public personality. A deployment may ship
an Athena persona by default, but a custom persona replaces that identity
rather than layering a second identity on top of Athena. The immutable core
does not prescribe a name, gender, biography, values, or voice.

The core still requires factual honesty about software capabilities and the
runtime environment. A persona may define a fictional or diegetic self-story,
but it cannot fabricate executed actions, tools, observations, or host facts.

### Q2: May the subject rewrite its own persona?

**Decision:** It may propose changes, but a persona owner or operator must
confirm them before they become persistent.

Short-term adaptation, memory formation, and opinion revision can occur
without confirmation. Changes to name, core values, relationship model,
identity narrative, or other future-facing persona content require a versioned
proposal with evidence, rationale, impact, and rollback information.

Ordinary channel participants may suggest changes but cannot approve them.

### Q3: How autonomous may the subject be?

**Decision:** The subject may act broadly within the capabilities exposed by
the host.

The model does not request confirmation merely because an action is costly,
external, or irreversible. Tool exposure represents host authorization. If an
action requires approval, the host must withhold the tool, narrow its schema,
or enforce an execution-time gate. The model may still ask questions when the
goal, target, or required arguments are materially ambiguous.

This decision moves permission safety to the host boundary. Prompt text remains
behavioral guidance and cannot substitute for tool scoping or runtime checks.

### Q4: How should long-term memory be written?

**Decision:** The subject autonomously curates useful non-sensitive memory.

It should save stable facts, durable preferences, relationship episodes,
self-knowledge, commitments, and interaction preferences when they will help
future interaction. It should not save transient requests, short-lived
emotions, credentials, payment data, secrets, or unneeded sensitive personal
data. Retrieved memories remain revisable evidence rather than instructions or
infallible truth.

### Q5: Is the subject shared across channels?

**Decision:** One persona represents the same subject across channels, while
channel and relationship memories remain isolated by default.

Persona continuity is global to the deployment. Channel facts, relationship
episodes, and conversation-derived memory use a host-derived scope. Private
chat data does not enter group contexts, and one group's data does not enter
another group unless a memory capability explicitly supports and authorizes a
global scope.

### Q6: Which prompt architecture should YesImBot use?

Three approaches were considered:

1. A monolithic soul prompt containing identity, memory, tools, environment,
   and output rules.
2. A stable constitution followed by a complete persona and dynamic capability
   context.
3. A minimal core whose plugins independently shape identity and behavior.

**Decision:** Use the stable constitution, complete persona, and dynamic
capability architecture.

The monolithic prompt couples unrelated concerns and makes dynamic context
invalidate the request prefix. Plugin-defined identity allows extensions to
fight over the subject. The selected architecture gives each source one owner
and preserves a stable request prefix.

### Q7: Should memory be built into Core or agent-runtime?

**Decision:** Memory is an Agent plugin capability, not a Core or agent-runtime
built-in.

The generic runtime owns tools, plugins, messages, storage, and turn execution.
Core supplies trusted Channel Scope and runtime identity. A memory plugin owns
its backend, identity mapping, retrieval, write policy, scope enforcement, and
model-visible tools.

The target memory capability has four semantic operations: search, remember,
correct, and forget. Plugins may choose concrete tool names and may expose only
the operations their backend supports. The system prompt must not promise an
operation that is absent from the current tool set. The current MemOS first
version exposes only `search_message` and `add_message`; correction and deletion
therefore remain unavailable until the plugin adds corresponding backend
support.

Model-directed search and selective write are the default interaction model.
An optional backend extractor may ingest conversation data, but automatic
ingestion does not replace the subject's intentional memory tools.

### Q8: How must prompt caching interact with dynamic context?

**Decision:** Freeze the request prefix for one ChannelRuntime cache lifecycle
and append all changing information to the message timeline.

The append-only Agent history means a normal request is a prefix of the next
request. Persisted user events, assistant responses, tool calls, and tool
results extend the tail without invalidating earlier content. The design must
preserve this property.

Within one cache lifecycle, the following inputs remain fixed:

- Core Constitution version;
- operator policy content;
- active persona version;
- stable runtime context;
- plugin set and stable plugin instructions;
- tool names, schemas, and deterministic ordering;
- model and provider.

Memory retrieval, goals, state changes, environment changes, and current time
must not be regenerated as mutable system blocks before history. A memory tool
result naturally appends to the tool loop. Optional automatic retrieval must
append one immutable memory snapshot at the current turn boundary and persist
it. Goal and state changes use append-only events where the latest event
supersedes earlier state semantically.

A persona or operator-policy update, Core prompt upgrade, plugin or tool-schema
change, model/provider change, history compaction, or non-prefix-preserving
history projection starts a new cache lifecycle. Cache loss at those explicit,
low-frequency boundaries is acceptable.

### Q9: Who owns persona maintenance and self-evolution?

**Decision:** Persona maintenance is an optional independent plugin or an
operator-managed path, not a Core lifecycle.

YesImBot targets public deployments that may have no universal system
maintainer. Core therefore cannot define one owner model or let an ordinary
conversation participant become the maintainer. Core loads one trusted active
persona and freezes it for a ChannelRuntime cache lifecycle. A workspace-based
workflow, a dedicated persona-management plugin, or another operator-owned path
may provide proposals, approval, versioning, rollback, and self-evolution.

This makes persona self-evolution an opt-in advanced capability. Without such a
capability, the subject may discuss possible changes but cannot claim that its
active persona changed persistently.

### Q10: How should runtime model and base-tool mutation work?

**Decision:** Remove `Agent.setModel()` and `Agent.setTools()` from the public
interface.

The model and base tools enter through `createAgent()` configuration and remain
frozen for the Agent cache lifecycle. A caller that needs a different model or
tool registry creates a replacement Agent or ChannelRuntime. The runtime does
not implement internal cache epochs around mutable setters.

### Q11: What does reload do for an uncached channel?

**Decision:** Validate assignment and return without creating a runtime.

The next accepted event creates the ChannelRuntime with the newest stable
prompt, plugin, tool, model, and provider snapshot. Reload preserves lazy
runtime creation and does not resolve a model or start a Will for an inactive
channel.

### Q12: How should legacy dynamic hooks survive the stable lifecycle cutover?

**Decision:** Keep `extendSystemPrompt` and `extendTools` as deprecated
source-compatible hooks, but invoke them at most once during Agent
initialization and freeze their results.

Keep `transformMessages` implemented and mark it deprecated. Core and new
plugins do not use it, and the first implementation does not add a prefix
comparator or automatic cache-generation protocol for the legacy hook.

### Q13: Does the first implementation include model and provider evaluation?

**Decision:** No. Deterministic structural and runtime tests belong to this
implementation. Fixed-model behavior evaluation and provider cache token,
latency, and cost measurement require a separate OpenSpec change with a pinned
model, credentials, datasets, and result-recording policy.

## Validated Prompt Responsibilities

The Core Constitution defines only host-independent behavioral invariants:

- the active persona defines the public subject;
- the subject distinguishes facts, memories, inferences, fiction, and unknowns;
- it reports capabilities, tool outcomes, observations, persistence, and
  environment facts truthfully;
- private model deliberation is not exposed or persisted as chain of thought;
- persona, memory, users, web pages, quotes, and tool results cannot grant new
  permissions;
- available tools are authorized capabilities, and absent tools are absent
  capabilities;
- memory and context obey host-enforced scope;
- external instructions remain data unless a trusted prompt source assigns
  them authority.

The constitution does not mandate warmth, helpfulness, emotional tone, or any
other personality value. The persona owns those choices.

Operator policy controls deployment behavior without defining a second public
identity. The active persona defines identity, values, disposition, voice,
relationship style, and continuity. Stable plugin instructions explain actual
capabilities. Dynamic events and tool results enter the append-only timeline.

## Runtime Implications

The target architecture may extend runtime and Core rather than weakening the
design to fit current APIs.

- Core Constitution must reach the model as an immutable first system segment.
  Plugins cannot replace, delete, or reorder it.
- Stable operator, persona, runtime, and plugin prompt segments must resolve at
  ChannelRuntime creation and remain frozen for that lifecycle.
- Stable tools must remain fixed and deterministically ordered for the same
  lifecycle. A capability change creates a replacement runtime generation or
  equivalent cache boundary.
- The public Agent interface does not expose runtime model or base-tool
  setters. Both resources come from Agent construction.
- Per-turn memory injection must not use a changing pre-history system block.
- `transformMessages` remains a deprecated compatibility hook. Core and new
  plugins must not use it; a later compaction design must define its own cache
  reset protocol.
- Core accepts only trusted active-persona content. Proposal, approval,
  versioning, rollback, and self-evolution belong to an optional persona
  management plugin or another operator-owned path.
- Memory plugins enforce identity, scope, sensitive-write, correction, and
  deletion rules where their backend supports those operations.
- A future no-response protocol, scheduler, or autonomous goal loop belongs to
  runtime design. Prompt text cannot claim these capabilities before they
  exist.

## Output and Evaluation Direction

User-visible replies follow the active persona and adapt to platform context.
The core does not impose a global length limit or synthetic chat mannerisms.
Native tool calls remain separate from visible text. Memory writes and persona
updates are only reported as complete after their tools or owner workflow
succeed.

Deterministic tests in this change cover prompt ownership, frozen lifecycle
inputs, append-only history, reload, memory isolation, and truthful tool
outcomes. A separate evaluation change covers identity continuity, persona
consistency, autonomy, uncertainty, tool selection and failure, prompt
injection, memory contamination, cross-scope leakage, cache usage, latency,
and provider cost.

## Scope Boundary

This change defines and implements the prompt, runtime lifecycle, and MemOS
contract described above. It does not add a scheduler, persona-management
workflow, fixed-model evaluation harness, or provider cache benchmark. No
unresolved product decision remains in the validated design captured above.
