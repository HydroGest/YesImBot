# Slice 01 Apply Handoff

## Task

Apply Slice 01 of the YesImBot platform adapter system from Task 1 through Task
7. Use sequential implementation subagents, test-driven development, focused
review after every task, and fresh verification before checking any task box.

Do not redesign the system. The architecture, first-version scope, public
namespace, tasks, and plan are approved.

## Required Workflow

The root agent MUST load these skills before implementation:

1. using-superpowers
2. subagent-driven-development
3. test-driven-development
4. systematic-debugging when a test or behavior fails
5. verification-before-completion
6. requesting-code-review before Slice 01 verification
7. paseo before creating or managing agents

Read the Paseo orchestration preferences before selecting a provider. Use the
current workspace because the approved OpenSpec artifacts and user code changes
are uncommitted here. Do not create a clean worktree that omits them.

Use one implementation subagent at a time. Tasks 1-7 have dependencies and MUST
NOT be implemented in parallel. The root agent owns integration, status updates,
and verification. For each task:

1. Send the exact task section from the slice plan to an implementation
   subagent.
2. Require the failing test before implementation.
3. Inspect the returned patch in the shared workspace.
4. Run the task focused verification commands.
5. Run a specification review and a code-quality review.
6. Resolve findings before starting the next numbered task.
7. Check only task boxes supported by fresh evidence.
8. Update ROADMAP.md if the next action, blocker, or milestone status changes.

Do not create commits or branches unless the user explicitly requests them.

## Context

YesImBot currently receives user messages through Koishi middleware and passes
Session through routing before creating a persisted platform custom message.
The approved design moves platform facts to a core-owned boundary:

- every Satori-dispatched Session is captured once through internal/session;
- middleware correlates the same Session object and keeps reply/routing control;
- core produces stable Platform.Message and Platform.Event facts;
- platform adapters synchronously refine facts or translate native Sessions;
- adapters do not listen to Koishi events, perform I/O, render model messages,
  persist data, choose intent, or send outbound messages;
- ctx.yesimbot.platform.publish() accepts only structured validated input;
- model-visible content uses Satori content plus frozen resource snapshots;
- resource reads happen after synchronous conversion and before first agent
  persistence;
- toModelMessages performs no platform/network resolution or history mutation;
- immutable channel-local assets may be read by content hash for stable media
  parts;
- the first complete version is proven by OneBot reaction, forward, and image
  cases.

Slice 01 is one complete version with four milestones, not four independent
slices. It uses one tasks/plan/apply/verify lifecycle.

## Relevant Files

- AGENTS.md: repository rules, RTK command requirement, tests, and reporting.
- openspec/changes/design-platform-adapter-system/HANDOFF.md: this briefing.
- openspec/changes/design-platform-adapter-system/ROADMAP.md: authoritative
  progress, maintenance rules, decisions, and resume context.
- openspec/changes/design-platform-adapter-system/design.md: architecture.
- openspec/changes/design-platform-adapter-system/specs/: acceptance contracts.
- openspec/changes/design-platform-adapter-system/slices/01-first-implementation/tasks.md:
  authoritative Slice 01 checklist.
- openspec/changes/design-platform-adapter-system/slices/01-first-implementation/plan.md:
  exact files, APIs, TDD steps, commands, and review gates.
- core/src/service.ts: middleware, channel runtime cache, and agent creation.
- core/src/runtime/message.ts: current Session conversion, routing, and model
  projection.
- core/src/platform/types.ts: uncommitted platform type work already present;
  work with it rather than replacing user changes blindly.
- packages/agent-runtime/src/message.ts: model-history projection behavior; do
  not modify agent-runtime unless a focused test proves it necessary.
- node_modules/koishi-plugin-adapter-onebot/lib/: synchronized OneBot source and
  types used by the validation plugin.

## Current State

- Architecture brainstorming, proposal, design, and delta specs are complete.
- OpenSpec strict validation passes.
- Slice 01 tasks.md and plan.md are complete.
- Production implementation has not started.
- Slice 01 Task 1 is the next action.
- verify.md does not exist and MUST be created only during Task 7 from fresh
  evidence.
- Root openspec status reports 4/8 because numbered slice artifacts are custom;
  ROADMAP.md is authoritative for slice status.
- oxfmt currently reports no supported target for these Markdown files. Use
  OpenSpec validation plus git diff --check for documentation verification.

The shared worktree contains user changes outside this design change, including
core, agent-runtime, memos-client, onebot-utils, workspace plugin, and README
changes. Treat every pre-existing modification as user-owned. Do not reset,
checkout, delete, or reformat unrelated files.

## What Was Tried

- Adapter-owned ctx.on() or middleware listeners were rejected because they
  duplicate collection and make middleware order part of adapter behavior.
- Per-adapter final LLM rendering was rejected because the first successful
  toModelMessages plugin wins and platform formatting would diverge.
- A Capability system was permanently rejected as duplicated, drifting state.
- Persisting Session, Bot, raw events, temporary URLs, or tokens was rejected.
- Turn-local-only resource expansion was rejected because historical model
  content would change and invalidate prompt-cache prefixes.
- Resource acquisition inside toModelMessages was rejected. Frozen snapshots
  are produced before first persistence.
- A global event archive, global asset index, cross-session replay dedupe, and
  outbound adapter were rejected for Slice 01.
- Dividing the first version into four slices was corrected. Core input, stable
  views, resource snapshots, and OneBot validation are four milestones inside
  one Slice 01.

## Decisions

- Public names use Platform.Message, Platform.Event, Platform.Scope,
  Platform.Adapter, Platform.MessageView, Platform.EventView, and
  Platform.Reader.
- Public service calls are ctx.yesimbot.platform.register() and publish().
- One adapter uniquely refines each input after the core Satori baseline.
- Explicit bot profile configuration outranks adapter and platform matching;
  core performs no NapCat/Lagrange fingerprinting.
- Platform conversion is synchronous, deterministic, and free of I/O.
- All Satori standard inbound events are recognized structurally.
- Invalid claimed events produce diagnostics; unknown native events expose only
  safe metadata and are ignored by default.
- There is no global event archive. Consumers own persistence.
- Satori content is the persisted message-content source of truth.
- Custom event history stores stable core event views, not plugin payloads.
- Structured resource snapshots are stored with the original message.
- Binary media uses channel-local content-addressed assets.
- Global resource/template/profile configuration applies only to new messages.
- Platform readers may fetch data but cannot render, persist, cache, or relax
  core policy.
- Existing self-ignore, ordinary observation, private/mention turn, and busy
  join behavior must remain unchanged.

## Acceptance Criteria

- [ ] Tasks 1-7 in the Slice 01 checklist are completed from fresh evidence.
- [ ] Platform contracts and strict Zod schemas are exported by core.
- [ ] internal/session collection and middleware correlation publish each
  inbound Session once.
- [ ] Existing message routing and reply behavior remain covered by tests.
- [ ] Standard Satori events, custom events, unknown events, and invalid events
  follow the approved outcomes.
- [ ] MessageView and EventView remain separate typed structures.
- [ ] Core templates and model projection are deterministic and platform
  plugins cannot bypass them.
- [ ] Forward, quote, and media results are frozen before first persistence.
- [ ] Channel-local assets are content-addressed and removed by channel reset.
- [ ] The independent OneBot plugin proves reaction event conversion,
  getForwardMsg resolution, and image acquisition.
- [ ] Focused tests, package checks, repository checks, OpenSpec validation, and
  git diff checks are recorded in verify.md.
- [ ] ROADMAP.md shows Slice 01 Verified only after those checks pass.

## Constraints

- Use Chinese for user communication; keep code, identifiers, logs, and errors
  in their native language.
- Prefix every shell command with rtk. Use Yarn 4, never npm or pnpm.
- Use apply_patch for manual edits.
- Follow TDD: failing test, minimal implementation, passing focused test.
- Keep changes within Slice 01. Do not implement world state, willingness,
  additional adapters, per-channel resource config, Capability, global resource
  storage, or outbound delivery.
- Do not overwrite or revert user changes.
- Do not start Task N+1 before Task N passes focused checks and reviews.
- Do not claim success without fresh verification output.
- Do not commit unless the user explicitly asks.

## First Command Sequence

    rtk git status --short
    rtk openspec validate design-platform-adapter-system --strict
    rtk read openspec/changes/design-platform-adapter-system/ROADMAP.md
    rtk read openspec/changes/design-platform-adapter-system/slices/01-first-implementation/tasks.md
    rtk read openspec/changes/design-platform-adapter-system/slices/01-first-implementation/plan.md

Then start only Task 1 using subagent-driven-development.
