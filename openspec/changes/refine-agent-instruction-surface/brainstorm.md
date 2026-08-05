# Refine Agent Instruction Surface — Brainstorm Capture

## Context

Everything the model reads before it acts is one surface, currently authored in four
disconnected places:

1. The inline Core Constitution (`core/src/runtime/prompt.ts:27-68`).
2. `DEFAULT_PERSONA` (`prompt.ts:9-25`), written to `PERSONA.md` only when absent.
3. Native tool descriptions: `sendMessage` and `read` (`core/src/runtime/channel.ts:119-180`,
   description builder at `channel.ts:515-529`), plus the terminal `finalize` tool
   (`packages/agent-runtime/src/agent.ts:243-254`).
4. Plugin `appendSystemPrompt` blocks and plugin tool descriptions.

The surface has drifted from the runtime. Behaviour that Core actually enforces is
undocumented to the model, while some documented capability does not exist unless an
optional plugin is loaded. This capture records the verified runtime behaviour, the
resulting gaps, and the decisions needed before any prompt or description is rewritten.

Scope: model-facing instruction text and tool descriptions only, plus whatever minimal
code guard the open questions resolve to. Not a rewrite of the output pipeline.

## Verified Runtime Facts

### Output path

- Assistant text is unconditionally parsed by `parseReply` and delivered as a platform
  message (`channel.ts:331-341`). There is no "do not send" default.
- `parseReply` (`core/src/runtime/reply.ts:12-19`) masks `<text>…</text>` regions before
  `h.parse()`, restores them byte-for-byte, strips every `<inner_thought>` subtree
  regardless of configuration, and returns **at most one** segment.
- Because a whole assistant text is one segment, `deliverOutput`'s per-segment pacing
  (`core/src/delivery.ts:18-28`) applies once. Multiple `<message>` boundaries inside one
  assistant text are handed to the platform encoder in a single `session.send()`, with no
  inter-message typing delay. Only separate assistant texts across steps get separate
  delays. The perceived rhythm of splitting currently comes from the adapter, not pacing.
- Whitespace-only output is filtered to zero segments (`reply.ts:67-69`), so
  `onDelivered()` never fires and Will's `replyCost` (`will.ts:94`) is not charged.
- `reply.customInnerThought` defaults to **false** (`core/src/config.ts:115-117`). The
  Constitution's `<inner_thought>` section is therefore absent by default, even though
  `parseReply` always strips the element.

### Resource path

- Platform images: the OneBot Translator downloads bytes and rewrites the element to
  `h("img", { id })` (`core/src/gateway/onebot.ts:88-108`), budget 4 images / 5 MiB per
  image / 10 MiB total, 10 s per download. Failures degrade silently to the original
  element.
- `AssetStore.put` (`core/src/asset.ts:30-44`) content-addresses bytes as the first 32 hex
  characters of their SHA-256.
- Model-visible rendering happens later: `hydrateElement` (`channel.ts:504-513`) replaces a
  valid-id `img` with the text `[图片：asset://<id>]` and an invalid one with `[图片]`. The
  original URL never reaches the model.
- **Only `img` is persisted.** User-sent `file`, `audio`, and `video` elements pass through
  unchanged with a platform URL in `src`, and `read` supports no `http`/`https` scheme — the
  model can see them but cannot read them.
- Tool output: `artifacts.forTool(name).put()` yields an immutable
  `artifact://<tool>/<uuid-v7>` (`core/src/artifact.ts:104-119`).

### `read` tool

- `parseUri` (`core/src/runtime/read.ts:274-291`) is strict: `scheme://authority[/path]`,
  no `?`, no `#`, no `@` or `:` inside the authority, no `%` in the path, no `.` or `..`
  segment. `asset` requires a 32-hex authority and an empty path; `artifact` requires
  `<tool>/<uuid-v7>`; `workspace` requires an empty authority, i.e. three slashes.
- Result shape is `{ uri, filename?, mediaType?, text?, error? }`. Text resources return
  their content, truncated at 30 000 characters with a trailing `[内容已截断]`
  (`read.ts:208-220`). Images return a placeholder such as
  `[图片资源，image/png，1.2 MiB]`; other binaries return `[资源，<mime>，<size>]`.
- Error codes: `invalid_resource_uri`, `resource_not_found`, `resource_unavailable`,
  `timeout`, `resource_read_aborted`, `resource_too_large`, `resource_read_failed`.
- Limits: 5 MiB hard cap (`READ_MAX_BYTES`), timeout from `resourceReadTimeoutMs`
  (default 30 000 ms).
- Image bytes reach the model only through `createReadProjectionPlugin`
  (`read.ts:293-325`), and only when the last message is a `read` tool-result, the model is
  image-capable, and the byte length satisfies both `maxBytesPerImage` (default 5 MiB) and
  `maxTotalBytes` (default 10 MiB). There is no cumulative accounting across several reads
  in one step; `maxCount` (default 3) is only tested for `< 1`.

### `sendMessage` tool

- The description is a single sentence and unconditionally advertises `workspace://`
  (`channel.ts:121-122`), a scheme that exists only while the Workspace plugin is loaded.
- `execute` calls `opts.bot.sendMessage(channelId, …)` with **no check** that `channelId`
  differs from the current channel (`channel.ts:135-142`). Used against the current channel
  it bypasses `deliverOutput`'s pacing, abort handling, and `delivery.failed` feedback, and
  duplicates the passive reply.
- `content` goes through the same `parseReply` → `prepareOutputSegments` path as a passive
  reply, so `<inner_thought>` stripping, `<text>` verbatim capture, and `<message>`
  boundaries all apply. None of this is stated.
- Returns `{ ok: true, messageIds }` or `{ ok: false, error: { name, message } }`. The
  description does not mention the return value.
- Resource URIs are resolved only for `img` and `file`
  (`core/src/runtime/output.ts:6`); `audio` and `video` pass through untouched
  (asserted by `core/tests/resource.test.ts:568`). `prepareElement` returns early when an
  element has children (`output.ts:44-46`), so an `img` with children never has its `src`
  resolved. A resource that cannot be opened causes the whole element to be dropped
  silently (`omitOutputResource`, `output.ts:69-72`).

### Workspace sandbox

- The sandbox is not a container: `just-bash` interprets shell syntax inside the Node
  process over a `MountableFs` (`plugins/workspace/src/workspace.ts:37-95`). Base is
  `InMemoryFs`; only `/home/workspace` is a real read-write mount pointing at the channel
  root's `workspace/` subdirectory. `persistPaths` are additional real read-write mounts,
  `readOnlyPaths` reject writes, and `overlayPaths` accept writes **into memory only** —
  they look successful and never reach disk.
- `workspace:///path` maps to `/home/workspace` alone (`plugins/workspace/src/index.ts:249-262`).
  No other mount point is reachable through the scheme.
- `assets/` and `artifacts/` live under the channel root **beside** `workspace/`, so they are
  invisible inside the sandbox. `bash` cannot see a platform image or an MCP artifact, and
  there is no path for handing an artifact to `bash`.
- `/home/workspace/x.png` and `workspace:///x.png` are the same file; the current prompt
  never states the equivalence.
- `bash`/`readFile`/`writeFile` descriptions are generated by the third-party `bash-tool`
  package and receive no `extraInstructions`, so mounts, network policy, and the 30 KB
  stdout/stderr truncation exist only in the plugin prompt, not in the tool schema.
- The plugin prompt (`plugins/workspace/src/prompt.ts`) is English, mixed into a Chinese
  Constitution. Most other plugin prompts are English too; `mcp-client`'s artifact guidance
  and `onebot-utils`' tool descriptions are Chinese. The surface has no consistent language.

### Reference-documentation facts

From `references/koishi-docs` and `references/satori-docs`:

- Resource elements (`img`/`audio`/`video`/`file`) share `src` (required), `title`, `cache`,
  `timeout`. `img` additionally carries `width`/`height`, which Satori marks receive-only.
- `at` accepts `id`, `name`, `role`, `type`, and the docs state the semantics are mutually
  exclusive — send exactly one of `id`, `role`, `type`. `@all` is `<at type="all"/>`.
- `quote`'s `id` attribute appears only in guide examples, never in the formal attribute
  table. The docs explicitly warn that borrowing `<message>` features into `<quote>` has no
  platform support today.
- `<message>` semantics, verbatim: "当出现 `<message>` 元素时，之前的元素会被立即视为一条消息被
  发送", and "如果其没有子元素，则消息不会被发送". Nested `<message>` is only defined inside a
  `forward` context (merge-forward); the non-forward case is undocumented.
- Escaping is required for `"`, `&`, `<`, `>`. Unpaired elements degrade to text, and
  leading/trailing whitespace containing newlines at the text boundary is dropped.
- Decorative elements degrade by dropping the wrapper and keeping the children.
- `<image>` vs `<img>`: the docs contradict themselves; `<img>` is the form used everywhere
  in examples and is the one to teach.
- The docs never state that `<text>` is delivered verbatim. That guarantee is Core's own,
  implemented in `parseReply` and required by the `reply-output-control-language` spec, so it
  is safe to teach for **output** while remaining unsupported as a claim about Koishi input.

Measured escaping behaviour (`h.parse` directly), showing that the current wording
"显示可能异常" understates the consequence — characters are absorbed into element attributes
and permanently lost:

```
'用 a<b 且 c>d 判断' → text("用 a") + b{且:true, c:true}[text("d 判断")]
'比较 x < y > z'     → text("比较 x ") + template{y:true}[text(" z")]
'List<String> x'     → text("List") + String[text(" x")]
'a < b'              → text("a < b")            // "< " followed by a space is safe
```

## Gaps

### Constitution

- The `# 消息形态` section covers only `at`, `img`, `quote`, `message`, `text`. Missing:
  `file`/`audio`/`video` and their shared attributes, `at type="all"|"here"` with the
  mutual-exclusion rule, `quote` by message id, and the fact that only `img`/`file` resolve
  resource URIs on output.
- It says `<message>` "支持嵌套" without qualification, while the docs define nesting only
  under `forward`. It also omits that a childless `<message>` is not sent.
- The escaping paragraph says display "可能异常" instead of stating that characters are
  silently absorbed and lost.
- No output protocol section exists at all. The model is never told that its text is sent
  verbatim to a platform, nor how to decline to speak.
- Situational awareness merges `shared` and `direct` into one sentence even though
  `runtime_context` distinguishes them. The message header's `id` field
  (`channel.ts:471-489`) is the `messageId` that `quote`, reactions, and OCR consume, and the
  prompt never connects the two.
- `finalize`'s description is English and reads as a formality ("Mark the current assistant
  response as final"). Since AI SDK's loop already stops when no tool is called, a plain text
  reply never needs it — its real value is deciding **not** to speak, which is unstated.

### Tools

- `sendMessage`: no outward-only constraint, no element-syntax note, no documented return
  value, unconditional `workspace://` claim, no note that only `img`/`file` resolve and that
  an unresolvable resource is dropped.
- `read`: no URI grammar, no result shape, no error-code guidance, no limits, no statement of
  when image bytes actually arrive, and no worked example of following
  `[图片：asset://…]` from an observed message to a `read` call. The per-scheme "best moment"
  guidance that motivated this change is entirely absent.
- Across the whole repository, **no tool description or plugin prompt contains a single
  usage example.** `memos-client` is the only prompt covering scenario, caveats, and timing;
  `onebot-utils` supplies 5-to-10-character verb phrases with no context beyond two
  incidental notes (`duration` unit, forward pagination).

### Workspace prompt

- States "Bash does not consume workspace:// URIs" without the reason, inviting `cat` on a
  URI.
- Never explains `persistent` / `read-only` / `overlay` semantics at runtime, so the
  overlay "write succeeds but nothing persists" trap is undiscoverable.
- Never says that `assets/` and `artifacts/` are outside the sandbox, so the model will look
  for a just-received image with `ls /home/workspace`.
- Omits the 30 KB output truncation and, when the network is enabled, the URL/method
  allowlists.
- Says shell state does not persist without giving the `cd dir && cmd` remedy.

### Default AGENTS

`readPromptFile` silently skips a missing `AGENTS.md` (`prompt.ts:77-93`); only
`PERSONA.md` has an `ensureDefault`. The `<agents>` block sits after `<persona>` and is
specified to carry explicit task requirements, so it is the legitimate place for default
operating guidance — currently empty.

## Proposed direction

These are the parts that follow from the facts without needing a product call.

### 1. Each fact lives in exactly one place

A capability's grammar, limits, and failure modes belong in the tool description; the
Constitution keeps only cross-tool rules (message shape, output protocol, situational
awareness). Per-scheme detail belongs in the scheme's registered prompt so that the text
appears only when the scheme is actually registered — the same rule that motivated deleting
the hardcoded `workspace://`/`skill://` lines from `buildReadDescription`.

### 2. No instruction may describe a capability that is not currently loaded

`sendMessage`'s description must stop naming `workspace://` unconditionally. Either it
enumerates registered schemes the way `read` does, or it refers to `read`'s scheme list
instead of repeating it.

### 3. Silent failures become stated failures

Three behaviours currently drop work with no feedback to the model: an unresolvable
`img`/`file` resource is removed from the outgoing message, whitespace-only output delivers
nothing, and an `img` carrying children never resolves its `src`. Each must either be
documented as a rule the model can follow or fixed. Documenting the third is not adequate —
"do not put children on an `img`" is a rule with no reason a model can internalise.

### 4. Message-shape guidance keeps its existing guardrails

`system-prompt-composition` forbids stating a target message count, segment length,
punctuation ratio, or rhythm, and forbids exposing runtime guardrail values. The expanded
element documentation must stay descriptive (what an element means, what it costs when
malformed) and must not smuggle in quotas. The pacing fact — that several `<message>`
boundaries in one assistant text arrive together — is a guardrail value and stays internal.

### 5. Examples become mandatory for URI-shaped capabilities

The one dimension missing everywhere is a worked example. At minimum: observing
`[图片：asset://…]` and reading it, reading an `artifact://` returned by a tool, and sending a
workspace file as an `img`. These are cheap and directly target the failure mode where the
model invents a URI shape.

### 6. Language is unified

Model-facing text follows the Constitution's language (Chinese) unless a specific prompt has
a reason to differ. `finalize`'s description and the Workspace prompt are the two concrete
items; third-party MCP tool descriptions stay outside our control and are out of scope.

## Open questions

**Resolved 2026-08-05.** Q1: enforce in code. Q2: document `finalize`'s silence semantics
and strengthen the `<inner_thought>` protocol, which stays gated behind
`customInnerThought`. Q3: keep the isolation and describe it in the prompts. The change draft
is in `draft.md`. The original framing is kept below for the reasoning.

### Q1. Is `sendMessage`'s outward-only rule documentation or code?

Wording alone leaves the failure reachable, and the consequence is real: a duplicate message
that skips pacing, abort, and `delivery.failed` feedback. Rejecting the current `channelId`
inside `execute` is roughly three lines and makes the description honest.

Recommendation: enforce it in code and describe the rejection, so the instruction states a
guarantee rather than a request. Counter-argument worth weighing: a legitimate use may exist
for deliberately sending a second, out-of-band message to the current channel.

### Q2. How does the model learn it may stay silent?

Today, with `customInnerThought` false by default, the model is told neither that
`<inner_thought>` exists nor that `finalize` can end a turn without speaking — while
`parseReply` strips inner thought unconditionally and whitespace-only output silently
delivers nothing.

Options: (a) document `finalize`'s silence semantics in the Constitution, which works under
both configurations and costs nothing; (b) flip `customInnerThought` to true so the private
channel is always available; (c) both. Recommendation: (a) as the baseline, since the silence
protocol should not depend on an optional feature flag, and treat (b) as a separate product
decision about whether private deliberation is default behaviour.

### Q3. Do `assets`/`artifacts` and the sandbox stay isolated?

They are fully isolated today. Either accept it and state plainly in each prompt which
capability lives on which side, or introduce a read-only mount so `bash` can reach artifacts.
This is an architecture decision; prompt wording must not paper over it.

Recommendation: accept the isolation for this change and document it precisely. A mount
changes the sandbox's trust boundary and belongs in its own proposal.

## Non-goals

- Rewriting `parseReply`, `deliverOutput`, or the pacing model.
- **Recorded defect, not fixed here.** Delegating `<message/>` to the native Koishi encoder
  left per-segment delay unreachable — a leftover from the earlier refactor, not intended
  behaviour. The correct behaviour is for Core to parse `<message/>` itself and deliver each
  message through its own `session.send()`, computing the delay between them rather than
  relying on the platform adapter. Out of scope for this change.
- Persisting user-sent `file`/`audio`/`video`, or adding an `http`/`https` read scheme. Both
  are real gaps, recorded here, but each is a pipeline change rather than an instruction one.
- Controlling third-party MCP tool descriptions.
- Any change to `openspec/specs/reply-output-control-language`, whose element-stream and
  verbatim-text guarantees this change relies on rather than modifies.

