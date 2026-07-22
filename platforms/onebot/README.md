# koishi-plugin-yesimbot-platform-onebot

This optional Koishi plugin registers `createResolver(ctx)` through
`ctx.yesimbot.registerResolver()` and unregisters that exact resolver when the
context is disposed.

The resolver turns OneBot `message-reactions-updated` Sessions into typed
`EventRecord` values. For messages, it preserves the generic Satori base and
uses `ResolveContext.freezeImage()` to freeze OneBot image sources before the
event is stored. Forward details remain available through the separate
`onebot-utils` forward tool.
