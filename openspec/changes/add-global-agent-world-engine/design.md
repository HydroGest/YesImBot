## Context

Core currently binds every hosted Agent to one admitted channel. RuntimeManager resolves a real Bot, creates one ChannelRuntime per persistent channel tuple, commits platform records, evaluates Will, and owns passive output delivery. That design gives each channel a clear identity and lifecycle, but it cannot represent one subject that uses several channels through a phone while retaining one memory and world timeline.

YesImBotWorld validated a different product model. Its character lives in a persistent textual world, receives external messages as phone notifications, spends time on actions, and experiences world changes after a delay. Its implementation also carries a second Gateway, a continuous generation loop, custom model backends, a mirrored message database, media systems, and broad platform operations. The migration should preserve the narrative model and leave those replacement subsystems behind.

This design keeps Core channel-first and adds one parallel host capability for Agents that do not belong to Gateway. WorldEngine remains an optional plugin and owns every world-specific concept. `@yesimbot/agent-runtime` remains the common Agent implementation.

## Goals / Non-Goals

**Goals:**

- Host a persistent Agent with stable identity, session history, fixed resources, compaction, interruption, and stop behavior without requiring a platform channel.
- Preserve ChannelScope, ChannelRuntime, Gateway, Will, and channel delivery contracts.
- Implement WorldEngine as an optional domain module with one WorldAgent, phone-mediated chat, continuous world time, delayed activities, and bounded narrative world state.
- Keep world effects tool-driven and auditable. Treat model-produced world changes as proposals until WorldEngine validates and persists them.
- Preserve Core and domain data across stop while keeping their reset responsibilities separate.

**Non-Goals:**

- Registered ecosystem plugins for GlobalAgents or per-Agent plugin-name selection.
- Advisor implementation or a general multi-Agent orchestration framework.
- A virtual channel, synthetic Bot, Session, Will decision, or implicit delivery target for GlobalAgents.
- Infinite model generation, GBNF, Ban EOS, dynamic tool installation, or prompt-cache control.
- A second platform Gateway, message database, AssetService, media pipeline, App framework, shell, browser, or platform administration suite.
- A generic world entity graph, rules DSL, custom calendar engine, manual world pause, or legacy YesImBotWorld migration.

## Decisions

### D1: Add a sibling GlobalAgent host

- **Choice:** Add `GlobalScope`, GlobalRuntime, and GlobalRuntimeManager beside the existing channel types. `GlobalScope` contains `type: "global"` and a stable `agentId`.
- **Rationale:** A WorldAgent owns one cross-channel identity and cannot inherit a real channel's Bot, history, reset, or delivery semantics. Advisor also demonstrates that a non-Gateway Agent may have a domain association with a channel without becoming that channel's main Agent.
- **Alternative considered:** Use a designated home ChannelRuntime. This would bind the subject to one channel, risk delivering background output there, and make reset or Bot replacement alter global identity.
- **Alternative considered:** Let WorldEngine call `createAgent()` directly. This would duplicate Core model resolution, session files, compaction, runtime replacement, and shutdown behavior.

GlobalRuntime has no Bot, Session, Will, channel send tool, passive delivery, delivery feedback, or automatic access to channel assets. Several GlobalScopes may run at once, but one `agentId` selects at most one running runtime and one active session.

### D2: Expose a shared global facade

- **Choice:** Expose `ctx.yesimbot.global` with scope-addressed start, submit, replace, stop, clear, and storage-root operations. Do not return an owner handle and do not expose GlobalRuntimeManager.
- **Rationale:** The selected trust model treats GlobalAgents as shared Core resources available to trusted in-process plugins. A dedicated facade keeps lifecycle invariants in Core and avoids widening the main YesImBotService with several flat methods.
- **Alternative considered:** Return an exclusive owner handle. This would prevent other trusted plugins from fully managing a GlobalScope, contrary to the selected shared-resource model.
- **Alternative considered:** Publish GlobalRuntimeManager. Callers would gain creation maps, session internals, and shutdown controls that belong to Core.

`start` fails for an active scope. `submit` fails for an inactive scope. `replace` stops the old runtime and preserves its session before starting the supplied definition. `stop` aborts active work and preserves all files. `clear` stops the runtime, removes Core session and global assets, and leaves the scope inactive.

### D3: Submit existing Agent custom messages

- **Choice:** GlobalRuntime accepts existing `AgentMessage` values. Domain modules declare custom types through `AgentCustomMessages` and provide their model projection through caller-owned AgentPlugin instances.
- **Rationale:** `@yesimbot/agent-runtime` already supplies typed custom messages, persistence, projection hooks, finite turns, join behavior, and terminal events. A second GlobalEvent type hierarchy would duplicate that contract.
- **Alternative considered:** Add GlobalEventMap and GlobalEventRecord to Core. Those records would force Core to own a global domain event protocol and create another message algebra.

Submitting while idle starts one finite turn. Submitting while busy joins the active turn. The returned promise resolves when that turn completes and rejects when it fails or aborts. GlobalRuntime consumes Agent internal events and does not return an event stream. It stores assistant messages in the Agent session but never interprets or delivers them. Tools produce every external or world effect.

### D4: Use a Core-controlled resource definition

- **Choice:** A caller starts a GlobalAgent with a narrow definition containing a registered model name, structured system prompt, fixed tools, fixed caller-owned AgentPlugin instances, compact-persona data, and terminal-tool configuration.
- **Rationale:** Core must retain control of Agent identity, JSONL storage, Global AssetStore, compaction, turn scheduling, interruption, and stop. The caller still owns the subject's prompt and capabilities.
- **Alternative considered:** Accept a complete AgentConfig. That would let callers replace storage and identity or bypass GlobalRuntime lifecycle.

Core resolves and snapshots the model and resources during start. It stores no factory or closure in the Manifest. Stop releases the definition. Restarting the same scope requires another complete definition, so an unloaded plugin cannot leave callable resources behind.

### D5: Keep channel and global implementations separate

- **Choice:** ChannelRuntime and GlobalRuntime both use `@yesimbot/agent-runtime` Agent but do not inherit a Core base class. Their managers remain separate and compose private runtime-pool and session-lifecycle modules where algorithms match.
- **Rationale:** Agent already owns the useful common lifecycle. ChannelRuntime's remaining work is platform commit, Will, observation, output parsing, and delivery. GlobalRuntime only submits custom messages and waits for terminal completion. A base class would expose protected hooks for unrelated behavior.
- **Alternative considered:** Extract Runtime and Manager inheritance trees. The common surface would either pass Agent calls through or absorb channel-specific branches.

The private runtime pool may centralize one-key singleton creation, concurrent creation coalescing, replacement, removal, stopped admission, and stop-all. The session module may centralize active JSONL selection and Core session operations. Neither module becomes a package export.

### D6: Store GlobalAgents outside channel roots

- **Choice:** Store each GlobalScope under `agents/<encoded-agentId>/`. Write an authoritative `agent.json` containing `type: "global"`, `agentId`, and `createdAt` before returning the root.
- **Rationale:** A GlobalAgent has no platform tuple and should not rely on a fake shared or direct channel path.
- **Alternative considered:** Encode GlobalScopes below `channels/`. This would mix Manifest validation, tuple semantics, and reset rules with a non-channel identity.

Core owns `sessions/` and `assets/`. `ctx.yesimbot.global.getStoragePath(scope)` returns the complete Agent root so WorldEngine can create `worldengine/`. Global clear removes only the two Core children and preserves the Manifest and domain children. The existing AssetService accepts ChannelScope and GlobalScope through overloads while channel and global storage remain separate internally.

### D7: Defer ecosystem plugin adaptation

- **Choice:** Keep `registerChannelPlugin()` and every existing channel plugin unchanged. A GlobalAgent definition may contain private AgentPlugin instances constructed by its caller, but GlobalRuntime does not inspect the channel plugin registry.
- **Rationale:** WorldEngine is the first known tool-using GlobalAgent consumer. MCP, Schedule, Search, Workspace, and future Advisor have different dependencies and selection policies. Defining named registrations and compatibility before another consumer exists would widen this change and hard-code assumptions.
- **Alternative considered:** Install every compatible registered plugin into each GlobalAgent. Advisor shows why different Agents need different tool sets.
- **Alternative considered:** Let WorldEngine retrieve and wrap channel factories. That would duplicate registry ownership, context creation, initialization rollback, and resource snapshots.

### D8: Make the phone the only chat perception path

- **Choice:** WorldEngine listens for committed `yesimbot/message` observations from configured chat access points, stores a private phone record, and submits only a minimal notification to the WorldAgent.
- **Rationale:** The subject should know that its phone has an unread conversation without gaining message content before opening it. Core channel history remains the canonical platform journal; the phone view records the subset available to the subject.
- **Alternative considered:** Replay complete channel messages into GlobalRuntime. That would give the subject omniscient cross-channel context and make phone tools cosmetic.
- **Alternative considered:** Query Core session JSONL on demand. Core does not expose a cross-channel history contract, and session archive, compaction, reset, media, and authorization would leak into WorldEngine.

A notification contains chat access point identity, unread count, and time. It omits sender, content, and media. WorldEngine submits one notification when unread changes from zero to nonzero. Later messages update the count without another wake. Phone tools list conversations and read chronologically from the oldest unread message. Each bounded page advances the read cursor only through returned records. Opening the phone or selecting a conversation changes no read state.

Outgoing chat also uses the phone. WorldEngine stores the access point coordinates rather than retaining Session. It resolves the current Bot only when a delayed send becomes due, records returned message IDs or failure, updates the phone conversation, and submits a completion message.

### D9: Model actions as persisted activities on one TU clock

- **Choice:** WorldAgent tools accept an Agent-estimated duration. WorldEngine validates the value, persists an activity, computes `expectedAt`, and returns an immediate acknowledgement. Completion arrives as a later custom message.
- **Rationale:** This preserves the proven distinction between deciding, executing, and perceiving an outcome. It also permits cancellation before a delayed platform send.
- **Alternative considered:** Use fixed engine durations. Determinism would improve, but the subject would lose the ability to express the perceived cost of typing, moving, waiting, or resting.

Uncertain world actions may run the Arbiter immediately and hold the result until `expectedAt`. External sends execute only at `expectedAt`. The activity store owns cancellation and completion state.

Each world uses one affine TU clock with creation-time real-seconds-per-TU, world-seconds-per-TU, and optional standard epoch. The mapping remains fixed for the world. Time continues through plugin and process downtime. Restart computes one offline interval and never replays historical ticks. Real-time operation is the 1:1 mapping. The MVP omits custom calendars, manual pause, and configuration changes that reinterpret pending times.

### D10: Separate the subject from world adjudication

- **Choice:** WorldEngine uses a stateless WorldArbiter for uncertain state changes. It keeps bounded narrative `worldStatus` and `subjectStatus` snapshots with structured revision, time, activity, and audit metadata.
- **Rationale:** The WorldAgent should propose actions without becoming the authority that decides their success and rewrites the world. Free-form narrative status preserves the useful openness of YesImBotWorld without introducing a generic entity model.
- **Alternative considered:** Let WorldAgent tools write world state directly. A hallucinated or adversarial tool call could become an unchecked fact.
- **Alternative considered:** Build a typed world object graph and rules engine. The current requirements do not establish reusable entity, relation, or rule semantics.

WorldArbiter has no persistent Agent session, platform access, clock ownership, scheduler, or direct storage access. WorldEngine supplies the necessary definitions, current snapshots, action, and time interval for one call. The Arbiter returns a proposal. WorldEngine validates its shape, expected revision, text length, and event count, then atomically writes the accepted snapshot and audit record. Invalid output leaves the old state intact and completes the activity as a failure. Deterministic phone, clock, persistence, and platform operations bypass the Arbiter.

Offline recovery may adjudicate the complete interval once and submit one compressed `world.resumed` perception. WorldEngine does not replay one Arbiter call per missed heartbeat.

### D11: Submit world events through one ordered queue

- **Choice:** WorldEngine routes every wake source through one private submission queue sorted by world time. Notifications, ticks, activity completions, and recovery events enter the queue; WorldEngine submits them in TU order. Every submitted custom message carries the world time at which the event occurred.
- **Rationale:** Real-time timer arrival order can invert world-time order under accelerated clocks or timer jitter. Busy-join merges concurrent events into one turn; explicit TU ordering and a world-time field keep the narrative timeline coherent even inside a joined batch. One queue also replaces four scattered timer subsystems with one scheduler loop.
- **Alternative considered:** Let each subsystem submit on its own timer. Simpler initially, but produces unordered joined batches and lets real-time arrival order masquerade as world chronology.

### D12: Treat the GlobalAgent session as working memory

- **Choice:** WorldEngine keeps authoritative recall in its own domain state: identity, narrative snapshots, and a compact memory digest that summarizes what the subject remembers. The GlobalAgent session is disposable working memory. A wake context includes the compact digest; the full narrative snapshot remains tool-accessed.
- **Rationale:** Shared management allows any trusted plugin to clear a GlobalAgent session. If the session were authoritative history, clearing it would leave a zombie subject with an empty memory and a populated phone. Treating the session as working memory makes shared `clear` safe ("recent forgetting" only) and lets Core compact aggressively, since the session's value to the subject degrades with length.
- **Alternative considered:** Keep the session as the subject's authoritative history. It matches channel semantics, but makes shared clear destructive and forces WorldEngine to reconcile two sources of "what the subject knows".

The memory digest format, update cadence, and injection policy remain open; the invariant is that domain state survives session clear and Core compaction.

### D13: Build the WorldAgent prompt from a fixed constitution and operator definitions

- **Choice:** WorldEngine ships one fixed, identity-neutral running constitution ("your way of existing") and takes the subject definition and world definition from the operator. Wake-time dynamic blocks append the current time line, the compact memory digest, and interval narration. The constitution is rewritten for the finite-turn model: each wake restores consciousness, the turn ends, the world keeps running, and the next wake restores consciousness again. It no longer describes a never-ending tool-call stream.
- **Constitution content:** keep the old diegetic framing ("you are living, not answering questions"), time-costed actions, send-as-activity, phone app layering, social rhythm, and identity-probe defense. Add explicit world-time ordering perception per D11 and memory-refresh narration per D12.
- **Sub-decisions:** the identity boundary stays fully diegetic (D17), wake injection stays minimal (D18), and `rest` is the explicit memory-digest refresh point (D19).
- **Alternative considered:** Make the constitution operator-configurable. Each world would drift its run rules, and WorldEngine could not rely on invariant behavior across worlds. The operator's persona and world definition already carry the per-world voice.

### D14: Drive the world with operator-templated scenarios advanced by the Arbiter

- **Choice:** A scenario is an operator-defined template in the world definition: natural-language trigger condition, beat description, and completion condition. The Arbiter advances it at runtime. The minimal state machine is `pending -> active -> completed / failed`; a failed scenario settles as failed, and no active scenario falls back to ambient daily advancement.
- **Tick semantics:** each tick runs one Arbiter call that advances the active scenario, evaluates pending triggers, and checks completion together. WorldEngine validates the candidate snapshot and events per D10. The snapshot stays a single narrative block per D20.
- **Wake separation:** the Arbiter output distinguishes world-only changes from subject-perceivable events. Only subject-perceivable events enter the D11 ordered queue. World-only changes remain in state and are perceived on demand through tools.
- **Rationale:** operator templates keep plot control with the operator while open progression keeps the Arbiter useful; natural-language conditions avoid a second hardcoded rule semantics; wake separation keeps finite turns and context cost aligned with the living-rhythm narrative.
- **Alternative considered:** Generate all scenarios at genesis. The operator loses plot control. Wake every tick. Turn frequency and context cost contradict the living-rhythm narrative.

## Risks / Trade-offs

- **[Risk] Shared management lets any trusted plugin stop, replace, or clear a GlobalAgent.** Mitigation: keep GlobalRuntimeManager private, require an explicit GlobalScope for every operation, reject implicit start, and document that the facade is an in-process trusted interface rather than a security sandbox.
- **[Risk] The phone view duplicates part of Core's channel journal.** Mitigation: treat Core as the platform-fact authority and store only configured access points plus phone-specific unread and perception state. Do not expose Core JSONL as a query backend.
- **[Risk] Coalesced notifications do not wake the subject for every message.** Mitigation: retain exact unread counts and chronological records. A later world tick still exposes pending notification state without adding one turn per high-volume message.
- **[Risk] Arbiter output can omit or distort narrative state.** Mitigation: bound snapshots, require matching revisions, validate output before atomic replacement, preserve the previous snapshot on failure, and append an audit record for accepted changes.
- **[Risk] Long-running sessions and narrative snapshots can expand model context.** Mitigation: reuse Core compaction, keep phone bodies out of the session until read, bound page results, and cap Arbiter state and event output.
- **[Risk] Stop or replacement can interrupt tools after an external side effect began.** Mitigation: abort active work, persist activity transitions before and after side effects, and leave overdue external-send recovery unresolved until its duplicate-send policy is approved.
- **[Risk] Concurrent event sources deliver an out-of-order world timeline.** Mitigation: D11 routes all wakes through one TU-sorted queue, and every submitted message carries its world time.
- **[Risk] Shared clear or aggressive compaction erases what the subject knows.** Mitigation: D12 keeps authoritative recall in WorldEngine domain state and treats the Core session as disposable working memory.

## Migration Plan

This change uses an additive layout and reads no YesImBotWorld or legacy GlobalAgent data. Existing channel roots, sessions, assets, plugins, and runtime creation continue unchanged.

A deployment can introduce Core GlobalAgent hosting without enabling WorldEngine. Enabling WorldEngine creates a new Agent Manifest and private domain state for its configured `agentId`. Disabling it stops the GlobalRuntime and leaves all data in place. Removing the new plugin and GlobalAgent configuration returns the deployment to channel-only behavior without converting existing channel data.

Rollback requires stopping active GlobalRuntimes before running the older Core. The older Core ignores the separate `agents/` tree. No rollback process should copy GlobalAgent files into `channels/`.

## Open Questions

- What exact tool names, request schemas, page limits, and media-viewing flow should the phone expose?
- What duration ranges should each activity kind accept?
- How should WorldEngine persist its snapshot, phone, activity, and audit files below `worldengine/`?
- What heartbeat cadence and perceptibility rules should trigger Arbiter calls or WorldAgent turns?
- How should recovery handle an external send whose `expectedAt` passed while the process was offline?
- What exact request and response schema should WorldArbiter use within the agreed narrative snapshot and revision boundary?
- What exact memory-digest format and generation call should D12 and D19 use, given that `rest` and offline recovery are the refresh triggers?
- What batch policy should the D11 event queue use: single-event submissions or contiguous TU batches?
- Which package path and configuration surface should the optional WorldEngine plugin use?
