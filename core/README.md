# koishi-plugin-yesimbot

The core package provides YesImBot's Koishi services, canonical message
routing, model registry, channel runtime ownership, platform input, and
Koishi-first output delivery.

## Platform API

Import contracts from `koishi-plugin-yesimbot/platform`. Core exports the
`Platform.Message`, `Platform.MessageRecord`, `Platform.Event`,
`Platform.Scope`, `Platform.Adapter`, `Platform.RefineResult`, and
`Platform.ImagePrepareSink` contracts. Adapters register through
`ctx.yesimbot.platform.register()` and publish semantic events through
`ctx.yesimbot.platform.publish()`.

Core owns fixed message formatting, literal channel history, private
channel-local image assets, and Agent lifecycle routing. Platform adapters do
not render model messages, access stored assets, persist history, or deliver
outbound replies.

## Runtime and delivery

`ChannelRuntime` is an internal deep module with three operations: handle a
canonical message, reset one channel, and stop all owned runtimes. It hides
classification, per-channel FIFO submission, Agent cache and storage, stream
ownership, delivery calls, and lifecycle cleanup. `YesImBotService` is the
public Koishi facade and does not expose Agent handles or turn streams.

Core exports `DeliveryService` and the `Delivery` contracts from the package
root. The same service is available as `ctx.yesimbot.delivery`.

- `reply(session, fragments)` uses the original `Session.send()`.
- `send(source, scope, fragments)` resolves one matching Bot and uses
  `Bot.sendMessage()`.
- `subscribe(listener)` observes process-local started and terminal events.

Delivery preserves ordered fragments and every returned `string[]` message ID.
Receipts report `sent`, `partial`, or `failed`; listener and diagnostic failures
cannot interrupt the send operation. Core does not define a platform delivery
adapter or replace Koishi/Satori encoders.

## History upgrade

This release stores platform history in an incompatible record format. Before
deploying it, remove or replace existing platform-message channel history. Core
does not read, render, or migrate legacy records.
