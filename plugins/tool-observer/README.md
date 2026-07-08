# koishi-plugin-yesimbot-tool-observer

Optional YesImBot plugin that reports each visible tool call to the chat immediately after it completes.

Notifications include the tool name, status, elapsed time, argument overview, and result overview. JSON-like arguments and results are rendered as compact TOON previews, with configured sensitive keys redacted before rendering.

By default the plugin only observes and displays tool calls. `compressJsonToolResults` is disabled by default because it rewrites JSON-like tool results into TOON strings before the model sees them, which can reduce token usage but may change model behavior.
