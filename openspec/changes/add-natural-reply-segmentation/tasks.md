## 1. Establish OCL Contract, Configuration, And Protection Zones

- [x] 1.1 Add OCL types: recognized control element set, parsed segment with index/total/delay hint, parse result covering delivered segments, inner thoughts, skip decision, and degradation reason.
- [x] 1.2 Add the segmentation and pacing configuration schema with defaults in Core's existing default-value source, covering maximum segment count, per-segment delay ceiling, total delivery ceiling, typing rates, random factor bounds, and first-segment residual buffer range.
- [x] 1.3 Implement protection-zone detection for fenced code blocks, inline code spans, URLs, and non-control platform elements, returning ranges rather than mutated text.
- [x] 1.4 Implement control-element recognition and entity unescaping so only the four recognized elements outside protection zones are treated as control elements.
- [x] 1.5 Add tests proving unterminated fences, nested backticks, adjacent zones, URLs containing angle brackets, and unrecognized look-alike elements all resolve to the intended zones.

## 2. Implement The Ordered Parse Pipeline

- [x] 2.1 Implement inner-thought extraction outside protection zones, returning removed regions as metadata without altering surrounding whitespace semantics.
- [x] 2.2 Implement skip evaluation so a skip element outside protection zones discards all visible content and yields zero delivered segments.
- [x] 2.3 Implement separator splitting, consecutive-separator collapsing, leading and trailing separator handling, trimming, and empty-segment discarding.
- [x] 2.4 Implement per-segment sleep-hint summation and marker removal, then assign segment index and total.
- [x] 2.5 Implement guardrails and degradation: segment-count truncation, zero-segment fallback to one message, parse-failure fallback, and the residual-control-element assertion that degrades the whole reply.
- [x] 2.6 Add tests proving determinism across repeated parses, no runtime-chosen segment count, and that every degradation path preserves the reply's visible content.

## 3. Implement Bounded Pacing

- [ ] 3.1 Implement visible-character typing delay with separate CJK and Latin rates, bounded random factor, and floor and ceiling clamping, excluding inner-thought text from the character count.
- [ ] 3.2 Implement first-segment elapsed-generation subtraction retaining a bounded random residual buffer.
- [ ] 3.3 Implement additive sleep-hint composition with per-segment ceiling clamping.
- [ ] 3.4 Implement total-delivery-ceiling accounting that switches remaining segments to minimum spacing instead of dropping them.
- [ ] 3.5 Inject clock and randomness so tests assert bounds and ordering deterministically without asserting exact delays.

## 4. Raise The Constitution To Version Two

- [ ] 4.1 Remove the competing runtime identity from the constitution: delete the digital-subject opening assertion and the host-runtime software-nature paragraph, and replace the section with authority-only framing that names no identity.
- [ ] 4.2 Add the voice and inner-thought section, preserving persona immersion, persona-voiced inner monologue, example-dialogue adherence, the prohibition on announcing being an AI, persona ownership of diegetic life, the narrow sincere-inquiry floor, and the prohibition on generic service phrases.
- [ ] 4.3 Add the message-shape section stating that meaning precedes shape, one message is a normal outcome, and shape follows content without any count, length, or punctuation target.
- [ ] 4.4 Add the sequential-reader rule requiring each split point to leave a harmless partial reply, with integrity priority for facts, instructions, code, links, structured content, and quoted text.
- [ ] 4.5 Add the protocol rules covering escaping, protection zones, non-leakage, and the prohibition on restating inner-thought content in visible messages.
- [ ] 4.6 Verify the action-truthfulness rules survive the edit: no fabricated tool call, observation, delivery, memory operation, persistent change, or successful result, and a missing tool remains a missing capability.
- [ ] 4.7 Bump the constitution version constant to 2 and add tests asserting the version, section presence, and absence of any runtime identity assertion, without asserting prose wording.

## 5. Integrate Segmentation Into ChannelRuntime

- [ ] 5.1 Replace the single-fragment text egress with OCL parsing so one assistant message pushes ordered outputs carrying segment index and total.
- [ ] 5.2 Represent a skip decision as zero outputs while keeping the turn successful and emitting no delivery failure.
- [ ] 5.3 Verify raw assistant output including control elements persists unchanged to channel JSONL and replays unchanged in historical projection.
- [ ] 5.4 Suppress the successful-reply will notification for skipped turns and for turns that delivered no platform message, and invoke it exactly once for a multi-segment reply.
- [ ] 5.5 Add tests proving output ordering, delivery-lease behavior, and that no control element or inner-thought text reaches any output.

## 6. Integrate Pacing And Failure Handling Into Gateway

- [ ] 6.1 Apply per-segment pacing in the delivery loop while keeping send authority and Session ownership in Gateway.
- [ ] 6.2 Check cancellation before each delay and before each send, stopping delivery without recalling delivered segments and without emitting a cancellation failure.
- [ ] 6.3 Stop remaining segments on the first send rejection without retrying.
- [ ] 6.4 Extend the delivery-failure record with the failed segment's position and total segment count.
- [ ] 6.5 Add tests proving stop-on-first-failure, abort points, no duplicate sends, correct failure position, and unchanged single-message behavior for replies without control elements.

## 7. Add Observability And Anti-Template Verification

- [ ] 7.1 Emit structured diagnostics per reply recording segment count, degradation reason when present, skip decisions, and total delivery time, without logging inner-thought content.
- [ ] 7.2 Implement the pattern-repetition metrics: sliding-window segment-count entropy, maximum run length of identical counts, and segment-length variance.
- [ ] 7.3 Add integration tests across short, long, emotional, mixed-language, and structured-content replies asserting integrity rather than a preferred shape.
- [ ] 7.4 Add a provider-compliance harness recording control-element adoption and degradation rate per configured provider.
- [ ] 7.5 Record baseline measurements and the run-length alarm threshold so calibration of the deferred numeric guardrails can follow observation.
