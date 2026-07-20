# koishi-plugin-yesimbot

The core package provides YesImBot's Koishi service, message routing, model
registry, channel runtimes, and the platform input boundary.

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

## History upgrade

This release stores platform history in an incompatible record format. Before
deploying it, remove or replace existing platform-message channel history. Core
does not read, render, or migrate legacy records.
