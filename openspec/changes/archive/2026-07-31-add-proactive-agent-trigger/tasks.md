## 1. Forced Runtime Event Path

- [x] 1.1 Factor ChannelRuntime input commitment so normal routing and a trusted forced EventRecord path share FIFO append and `yesimbot/event` observation while only normal routing evaluates Will.
- [x] 1.2 Add the internal RuntimeManager forced-event operation that selects the existing channel runtime, preserves idle-run and busy-join ownership, and never owns platform sending.
- [x] 1.3 Add `YesImBotService.trigger(event: EventRecord)` with exact current-Bot resolution before forced runtime admission and no public runtime or output-stream exposure.

## 2. Shared Delivery And Host Transport

- [x] 2.1 Extract Gateway's paced output-consumption loop into a private Core helper that retains ordered structured segments, abort checks, first-success acknowledgement, and same-runtime `delivery.failed` feedback.
- [x] 2.2 Adapt Gateway passive delivery to the helper with the originating `Session.send()` capability.
- [x] 2.3 Use the same helper from `YesImBotService.trigger()` with the matched `Bot.sendMessage(event.channel.id, segment)` capability and preserve empty-ID success and first-failure stop behavior.

## 3. Focused Contract Coverage

- [x] 3.1 Add ChannelRuntime tests for forced EventRecord persistence and observation, idle forced runs, busy joins, and the absence of Will evaluation and `yesimbot/will` observation.
- [x] 3.2 Add RuntimeManager and service-facade tests for trusted event dispatch, exact Bot selection, unavailable-Bot rejection before commit, and hidden runtime internals.
- [x] 3.3 Add `core/tests/delivery.test.ts` to prove shared delivery behavior, retain Gateway Session-adapter coverage in `gateway-delivery.test.ts`, and cover Bot-adapter behavior through `service.test.ts`.
- [x] 3.4 Run the focused Core test files, including event model projection coverage, and the Core type check for the new facade, runtime path, and shared delivery behavior.
