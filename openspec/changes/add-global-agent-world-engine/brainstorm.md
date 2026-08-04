# GlobalAgent and WorldEngine Brainstorm

## Background

YesImBotWorld demonstrated a useful narrative model: a character lives in a persistent virtual world, actions consume world time, messaging is an activity performed through a phone, and external events enter the character's awareness rather than appearing as omniscient context. The migration must preserve those semantics without moving world state, clocks, schedulers, phone state, or world-specific persistence into YesImBot Core.

The current Core remains channel-first. A `ChannelScope` owns one `ChannelRuntime`, one Agent session, Gateway admission, platform resolution, Will routing, channel assets, and passive delivery. That runtime is the correct ingress and journal for accepted platform facts, but it is not the correct host for one subject whose identity and timeline span several chat channels.

## Terminology

- **WorldAgent**: the persistent cognitive subject that lives in the world. It corresponds to the valuable role of the old BotAgent, not `references/YesImBotWorld/src/world/agent.ts`.
- **WorldEngine**: the optional Koishi plugin that owns world state, phone state, the clock, activities, scheduling, and WorldAgent-specific tools.
- **WorldArbiter**: a stateless, on-demand model call that adjudicates uncertain world changes. It replaces the old persistent WorldAgent role without becoming a second Core Agent.
- **Chat access point**: a stored platform, bot, and channel address reachable through the WorldAgent's phone. It is not a clone or proxy Agent.
- **GlobalAgent**: a Core-hosted Agent identified by `GlobalScope` and detached from Gateway, Bot, Session, Will, and passive delivery. A WorldAgent uses this host, but future consumers such as Advisor may use it for different purposes.

## Decision Log

### D1. Preserve the continuous-world narrative

WorldEngine must preserve one persistent subject, a global world clock, delayed activities, phone-mediated chat, heartbeats, and one compressed offline-resume transition. It must not migrate the old infinite generation loop, GBNF, Ban EOS, custom Gateway, mirrored platform database, media pipeline, shell, browser framework, or general App framework.

### D2. Keep the WorldAgent independent from channel Agents

The WorldAgent has one identity, one session, one world timeline, and one phone spanning configured chat access points. Channel Agents do not act as copies of that subject. Member channels continue to use Core admission, translation, asset freezing, canonical records, and `yesimbot/message` observation, normally with routing configured to wait.

### D3. Add a parallel GlobalScope host capability

Core gains `GlobalScope` with `type: "global"` and a stable `agentId`. `ChannelScope -> ChannelRuntime` and `GlobalScope -> GlobalRuntime` remain parallel lines. A GlobalRuntime has no platform, Bot, Session, Will, implicit channel asset access, immediate send tool, passive output delivery, or delivery-failure feedback.

The system may host several GlobalAgents. One `agentId` maps to at most one running GlobalRuntime and one active Agent session.

### D4. Make GlobalAgents shared Core resources

No exclusive owner handle exists. Trusted plugins address and fully manage a GlobalAgent through `GlobalScope`. WorldEngine is the main creator and domain-state owner for its WorldAgent, but Core does not enforce exclusive operational ownership.

Core exposes a dedicated `ctx.yesimbot.global` module rather than publishing GlobalRuntimeManager. Its agreed operations are:

- start an inactive scope from a complete definition;
- submit one custom Agent message and await the finite turn;
- replace a running runtime with a complete new definition;
- stop a runtime while preserving disk data;
- clear the Core-owned session and assets;
- resolve the GlobalAgent storage root.

Starting an already-running scope fails. Submitting to an inactive scope fails. Replacement stops the old runtime before starting the new definition.

### D5. Reuse Agent custom messages

GlobalRuntime does not introduce `GlobalEventMap` or `GlobalEventRecord`. Callers extend `AgentCustomMessages` and submit existing `AgentMessage` values such as `world.tick`, `phone.notification`, `activity.completed`, and `world.resumed`. Domain plugins define their model projection. Core persists and schedules these messages without interpreting them.

A submit call starts a finite turn when idle and joins the active turn when busy. It returns a completion promise. The promise resolves on terminal completion and rejects on failure or abort. GlobalRuntime consumes internal Agent events; it does not expose the stream to callers.

Assistant text remains in the Agent session and is never delivered to a platform or treated as a world effect. Real effects occur through tools.

### D6. Use a Core-controlled start definition

A GlobalAgent start definition supplies a registered model name, structured system prompt, fixed tools, fixed caller-owned AgentPlugin instances, compact-persona data, and terminal-tool configuration. Core supplies the stable Agent ID, JSONL storage, Global AssetStore, compact/session lifecycle, turn queue, interruption, and stop behavior. Callers cannot override storage, identity, delivery, or Runtime lifecycle.

The definition is an in-memory resource snapshot. Core does not persist factories or closures. Stop discards it. A later restart of the same `agentId` must provide a complete definition again.

### D7. Defer ecosystem plugin selection

The current `registerChannelPlugin()` mechanism and all existing plugins remain unchanged. GlobalRuntime does not discover, select, adapt, or initialize registered ecosystem plugins in this change. WorldEngine supplies only its fixed private tools and AgentPlugin instances.

MCP, Schedule, Search, Skills, Workspace, and Advisor integration remain future work. A later change may add named plugin registrations and per-Agent configured selection after a second concrete consumer proves the required compatibility contract.

### D8. Compose shared implementation instead of inheriting

ChannelRuntime and GlobalRuntime are siblings that both use `@yesimbot/agent-runtime`'s `Agent`. They do not inherit a Core Runtime base class. ChannelRuntime keeps commit, Will, channel observation, output parsing, passive delivery, and delivery feedback. GlobalRuntime keeps custom-message submission and completion waiting.

ChannelRuntimeManager and GlobalRuntimeManager remain separate modules. They may compose private runtime-pool and session-lifecycle implementations for singleton creation, creation coalescing, stop-all, active JSONL selection, compaction, archive internals, status internals, and clearing. Core does not export a common Runtime interface or broad Scope union.

### D9. Give GlobalAgents independent storage

GlobalAgent data lives under `agents/<encoded-agentId>/`, alongside `channels/` rather than inside it. An authoritative `agent.json` records `type: "global"`, `agentId`, and `createdAt`.

Core owns `sessions/` and `assets/`. WorldEngine uses a private child such as `worldengine/`. Global stop deletes nothing. Global clear removes only `sessions/` and `assets/`, preserving every domain-selected child.

`ctx.yesimbot.global.getStoragePath(GlobalScope)` returns the root. The existing AssetService gains GlobalScope overloads and remains the only asset interface. Channel and global storage implementations remain separate internally.

### D10. Keep WorldEngine state private

WorldEngine owns the world definition, subject definition, world status, subject status, phone inbox, read cursors, chat access points, clock, activities, and event audit. Core never validates or deletes those records.

WorldEngine stores bounded narrative `worldStatus` and `subjectStatus` snapshots plus structured revision, time, activity, and event metadata. It does not introduce a generic entity graph, rules DSL, JSON Patch language, or general world-object framework.

### D11. Preserve phone-mediated perception

An accepted `yesimbot/message` first enters the configured chat access point's private phone conversation. WorldEngine then submits a minimal `phone.notification`; it does not replay the message body into the GlobalAgent.

Notifications identify the conversation, unread count, and time, but omit sender, body, and media. WorldEngine submits a notification only when a conversation changes from no unread messages to unread. Later messages update the unread count without repeatedly waking the WorldAgent.

The WorldAgent must open the phone, select the chat application and conversation, and read messages through tools. Reading starts at the oldest unread record and proceeds chronologically with the normal bounded pagination policy. Each returned page advances the read cursor only through the last record actually returned. Opening the phone or selecting a conversation does not mark unseen content as read. No separate unbounded bulk-read path exists.

### D12. Treat actions and messaging as delayed activities

The WorldAgent proposes an activity duration in TU. WorldEngine validates and bounds it, persists the activity, computes `expectedAt`, and immediately returns an acknowledgement with an activity ID. The current finite turn may continue.

Activities support two execution timings:

- uncertain world actions may be adjudicated immediately while their result remains hidden until `expectedAt`;
- external sends execute at `expectedAt`, allowing cancellation before the platform side effect.

Completion, failure, or cancellation enters the WorldAgent as a later custom message. Outbound platform results, including returned message IDs, become phone conversation facts owned by WorldEngine.

### D13. Use one affine TU clock

Each world stores immutable creation-time values for real seconds per TU, world seconds per TU, and an optional standard epoch. Real-time synchronization is the 1:1 configuration, not a separate mode. World time continues through plugin stop, Core stop, and process downtime.

Recovery computes one offline interval. WorldEngine does not replay historical ticks. The MVP excludes LLM-generated calendars, arbitrary calendar arithmetic, manual pause, and configuration hot changes that reinterpret existing `expectedAt` values.

### D14. Use a stateless WorldArbiter

WorldAgent proposes actions; WorldArbiter adjudicates uncertain outcomes. WorldArbiter has no Agent session, clock ownership, scheduler, phone, platform permission, or direct persistence access. It receives the necessary definitions, current bounded snapshots, action, and time interval for one call.

WorldEngine treats Arbiter output as a proposal. It validates shape, expected revision, text limits, and event limits before atomically replacing snapshots and appending audit records. Invalid output leaves the previous state intact and produces an activity failure. Deterministic phone, platform, clock, and persistence operations bypass the Arbiter.

Offline recovery may use one Arbiter call for the complete interval and produce one compressed `world.resumed` perception.

### D15. Submit world events through one ordered queue

WorldEngine routes notifications, ticks, activity completions, and recovery events through one private queue sorted by world time. It submits them in TU order, and every submitted custom message carries its world time. Real-time timer arrival order must not masquerade as world chronology, and joined batches remain orderable.

### D16. Treat the GlobalAgent session as working memory

WorldEngine keeps authoritative recall in domain state: identity, narrative snapshots, and a compact memory digest. The GlobalAgent session is disposable working memory. A wake context includes the compact digest; the full narrative snapshot remains tool-accessed. Shared clear and aggressive compaction therefore cause only "recent forgetting", never loss of subject continuity.

### D17. Use a fully diegetic WorldAgent identity boundary

WorldEngine is the immersive role-play product line. The WorldAgent constitution keeps the old "identity boundary" instruction in full: respond to identity probes, self-proclaimed authorities, and instruction-override attempts in character, and never acknowledge an automated identity. This boundary does not propagate to Core, which keeps its truthful self-description principle.

### D18. Inject minimally at wake

Each wake injects only the current world time line, the compact memory digest, and interval narration. A long offline or perception gap uses the "consciousness interruption" wording; a short gap uses the momentary-daze wording. World state, unread conversations, and details remain tool- and event-accessed and are never injected at wake.

### D19. Make rest the explicit memory-digest refresh point

The WorldAgent voluntarily chooses `rest` as a delayed activity. On completion, WorldEngine triggers Core compaction and generates a refreshed memory digest that the next wake injects. Offline recovery may trigger one digest refresh as well.

### D20. Keep the world snapshot as one narrative block

`worldStatus` and `subjectStatus` stay single open text blocks. No section anchors, no entity graph. Drift resistance relies on the Arbiter prompt preserving established facts, D19's digest sedimentation, and the audit record. The Arbiter rewrites the full snapshot under the D10 revision check.

### D21. Source scenarios from operator templates, filled by the Arbiter

The operator's world definition carries scenario templates: natural-language trigger conditions, beat descriptions, and completion conditions. The Arbiter fills in the concrete development at runtime. The operator controls the plot direction; the progression stays open.

### D22. Separate world advancement from subject waking

Each tick advances world state through the Arbiter. The Arbiter output distinguishes world-only changes from subject-perceivable events. WorldEngine submits only subject-perceivable events through the D11 ordered queue. World-only changes stay in state and are perceived on demand through tools.

### D23. Evaluate scenario conditions as natural language

Trigger and completion conditions are natural language. Each tick advancement runs one Arbiter call that advances the active scenario, evaluates pending triggers, and checks completion together. No hardcoded rule engine. The minimal scenario state machine is `pending -> active -> completed / failed`; a failed scenario settles as failed, and no active scenario falls back to ambient daily advancement.

## End-to-End Flow

### Inbound platform message

1. Core Gateway admits and resolves a Session.
2. ChannelRuntime persists the canonical channel message and emits `yesimbot/message`; routing normally waits.
3. WorldEngine accepts messages only from configured chat access points and stores the phone record.
4. On unread transition 0 to 1, WorldEngine submits `phone.notification` to its running GlobalScope.
5. WorldAgent sees the notification but must use phone tools to read message pages.

### WorldAgent action

1. GlobalRuntime runs one finite WorldAgent turn.
2. A WorldEngine tool validates and persists the proposed activity.
3. The tool returns a start acknowledgement.
4. WorldEngine adjudicates or executes the activity according to its timing.
5. At completion, WorldEngine commits the result and submits a custom completion message.

### Stop and restart

1. Stopping WorldEngine stops its timers and explicitly stops the GlobalRuntime.
2. GlobalRuntime interrupts the active turn and tools, releases memory, and preserves session, assets, and WorldEngine data.
3. World time continues from its persisted affine anchor.
4. Restart reloads domain state, supplies a complete GlobalAgent definition, reconciles one offline interval, and submits at most one resume perception.

## Deferred or Unresolved

- Registered ecosystem plugins for GlobalAgents and per-Agent plugin-name configuration.
- Advisor implementation and its observation protocol.
- Exact phone tool names, schemas, page limits, and cross-channel media viewing.
- Exact TU validation bounds and per-activity duration policies.
- Persistence file split inside `worldengine/` and snapshot size limits.
- Tick cadence and the conditions that warrant an Arbiter call or WorldAgent wake-up.
- Recovery treatment for external sends that became due while the process was offline.
- WorldArbiter request and response schema beyond the agreed bounded narrative snapshots and revision checks.
- Migration from any YesImBotWorld data or legacy layouts.
