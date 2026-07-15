## 1. Public Contracts and Configuration

- [ ] 1.1 Define the approved `Platform.*` public namespace, declaration-merging maps, stable source/scope/entity/time types, message/event variants, views, resource references, and diagnostic result types with Zod schemas.
- [ ] 1.2 Extend core configuration with one global resource policy covering forward/quote switches, detail, nesting, item/character limits, timeouts, concurrency, request budgets, allowed media types, and byte limits.
- [ ] 1.3 Export the platform API from `koishi-plugin-yesimbot/platform` and expose `ctx.yesimbot.platform.register()` and `publish()` without expanding the agent-runtime public surface.

## 2. Live Registry and Satori Conversion

- [ ] 2.1 Implement the live disposable registry for adapters, event schemas, extension schemas, element rules, readers, and view contributors with duplicate-id rejection.
- [ ] 2.2 Implement deterministic per-input adapter matching by explicit profile, Koishi adapter, and platform, including decline, tie, failure, and Satori fallback behavior.
- [ ] 2.3 Implement synchronous Satori message conversion and all standard inbound event conversions with event-specific minimum schemas, safe unknown results, and invalid-result diagnostics.
- [ ] 2.4 Implement typed external publication and synchronous consumer notification without cross-Session replay deduplication or a global event archive.

## 3. Koishi Collection and Existing Message Routing

- [ ] 3.1 Collect Satori-dispatched Sessions through one `internal/session` listener and correlate each message Session with its converted `Platform.Message`.
- [ ] 3.2 Route the correlated message from prepended Koishi middleware while preserving self-ignore, ordinary group observation, direct-message turn, group-mention turn, and busy-join behavior.
- [ ] 3.3 Prove that one dispatched message is converted, appended, sent, or persisted at most once across `internal/session` and middleware.
- [ ] 3.4 Deliver valid non-message events to registered synchronous consumers without inventing channel routes for guild/account scopes.

## 4. Stable Message and Event Views

- [ ] 4.1 Parse persisted Satori content into `Platform.MessageView` nodes for text, mentions, emoji, media references, quotes, forwards, files, and safe unknown elements.
- [ ] 4.2 Convert standard and namespaced events into `Platform.EventView` action/entity/fact nodes without accepting plugin-owned final text or AI SDK messages.
- [ ] 4.3 Implement core-owned deterministic text rendering, safe media placeholders, bounded quote/forward nesting, and user body templates that cannot replace model roles, framing, escaping, or limits.
- [ ] 4.4 Replace direct platform-message projection with one built-in core `toModelMessages` path that performs no I/O and leaves unrelated custom messages to other agent plugins.
- [ ] 4.5 Persist channel-admitted non-message events as source metadata plus stable event-view nodes so historical rendering does not require the original platform plugin.

## 5. Resource Snapshots and Channel Assets

- [ ] 5.1 Discover stable quote, forward, message, and media references during synchronous conversion without performing I/O.
- [ ] 5.2 Resolve configured references after conversion and before first agent persistence through registered `Platform.Reader` implementations under core timeout, concurrency, and request budgets.
- [ ] 5.3 Freeze bounded structured resource snapshots, policy version, truncation state, and stable unavailable outcomes into the original `Platform.Message`.
- [ ] 5.4 Implement channel-local content-addressed binary asset storage with MIME/size validation and stable message asset references.
- [ ] 5.5 Extend channel reset to remove that channel's persisted message history and binary assets together.
- [ ] 5.6 Prove repeated model steps and later turns render identical persisted views without platform reads, downloads, or historical rewrites.

## 6. OneBot Vertical Validation

- [ ] 6.1 Create the `plugins/platform-onebot` workspace package with Koishi lifecycle registration and explicit OneBot profile matching.
- [ ] 6.2 Convert OneBot `message-reactions-updated` native Sessions into a validated namespaced event and stable event view without relying on its declared Koishi event name.
- [ ] 6.3 Implement a OneBot forward reader using `get_forward_msg` that returns normalized structured messages and obeys core depth/detail budgets.
- [ ] 6.4 Implement OneBot image acquisition through the common reader and channel asset path without returning plugin-owned model messages.
- [ ] 6.5 Add contract tests for generic OneBot fallback, explicit profile selection, native reaction conversion, forward snapshots, image persistence, plugin disposal, and failure fallback.

## 7. Verification and Handoff

- [ ] 7.1 Run focused core and OneBot tests after each milestone, then run package typechecks and builds for every changed workspace.
- [ ] 7.2 Run root lint, formatting check, typecheck, build, tests, and strict OpenSpec validation without fixing unrelated failures.
- [ ] 7.3 Review Slice 01 against all 25 parsed OpenSpec deltas, record evidence and residual risks in `verify.md`, and update `ROADMAP.md` status and decision log.
