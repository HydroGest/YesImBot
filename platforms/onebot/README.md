# koishi-plugin-yesimbot-platform-onebot

This optional Koishi plugin registers the generic OneBot platform adapter with
`ctx.yesimbot.platform.register()` and unregisters it when the context is
disposed.

It adapts OneBot `message-reactions-updated` native Sessions into the typed
`onebot.message-reactions-updated` event through `refine()`. Its `prepare()`
recursively freezes bounded remote images through `ImagePrepareSink`. Forward
message details are provided by the separate `onebot-utils` tool; this adapter
does not access core asset storage.

Explicit core platform profiles take precedence over generic OneBot matching;
this plugin does not fingerprint OneBot implementation-specific raw fields.
