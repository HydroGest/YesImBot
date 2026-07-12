<!--
Raw capture of superpowers:brainstorming output.

本档原样捕捉 brainstorming skill 的产出，不强制结构。
Skill 的自然产出通常是 decision log 格式（背景 -> 决议链 Q1-Qn -> 设计取舍），
但依对话内容可能有不同组织方式。

design.md 从本档萃取并重新整理为结构化设计文件。

不要将本档的内容复制到 design.md - design.md 是独立的重组产物，
两者互补但不重叠。
-->

# Brainstorm: Expose Channel Platform Context

## Background

The current `koishi-plugin-yesimbot` core creates one `@yesimbot/agent-runtime`
agent per `platform + selfId + channelId` key. External Koishi integrations
register runtime plugins through:

```ts
type AgentPluginFactory = (context: ChannelAgentContext) => AgentPlugin;
```

The current `ChannelAgentContext` only exposes stable channel metadata:

```ts
interface ChannelAgentContext {
  channel: {
    platform: string;
    selfId: string;
    channelId: string;
    type: "private" | "group";
  };
}
```

The design question was how core should expose runtime platform capabilities to
tools without making `agent-runtime` aware of Koishi or turning runtime tool
context into a host-specific dependency container.

Legacy context from `references/#legacy/core-legacy/src/internal/extension/context.ts`
provided `channel`, `tool`, `session`, and `platform.bot`. It was useful as a
reference, but it mixed stable channel state, mutable session operations,
platform internals, extension registration, and hook binding into one object.

The motivating concrete example is
`references/#legacy/plugins/onebot-utils/src/index.ts`. Its tools need access to
OneBot adapter internals such as:

- `bot.internal.getForwardMsg(messageId)`
- `bot.internal._request("set_msg_emoji_like", ...)`
- `bot.internal.setEssenceMsg(messageId)`

Those are platform-specific, high-authority, channel-scoped capabilities. They
do not require `agent-runtime` to understand Koishi sessions.

## Explored Options

### Option A: Generic host/turn context in agent-runtime

Add generic parameters across `AgentConfig`, `AgentPlugin`,
`AgentToolExecuteContext`, and hook contexts so hosts can inject typed host and
turn context.

Pros:

- Strong type propagation for host-specific context.
- Clean way for tools to read injected context from `execute` options.

Cons:

- Expands `agent-runtime` public API for a core-specific need.
- Pushes host/runtime coupling back into the runtime surface.
- Makes every plugin and hook type carry generic complexity even when most tools
  only need stable plugin-owned closures.

Decision: rejected for this change. It is too much machinery for the current
need and risks making `agent-runtime` a host framework again.

### Option B: Plugin-owned closure context

Keep `agent-runtime` unchanged. Let core pass stable channel/platform context to
`AgentPluginFactory`. Each plugin builds its own private context in factory
scope, then exposes tools that close over that context.

Pros:

- Minimal runtime API change: none in `agent-runtime`.
- Keeps Koishi and adapter-specific APIs inside core/plugin boundary.
- Works naturally with current pre-channel plugin lifecycle.
- Keeps tool dynamic context (`turnId`, `toolCallId`, `signal`) in the existing
  runtime execute context.

Cons:

- Raw platform capabilities are not filtered by `agent-runtime`.
- Plugins must document their own authority and platform checks.

Decision: accepted as the base design.

### Option C: Capability registry

Expose a structured capability registry such as
`platform.getCapability("onebot.internal")`.

Pros:

- More explicit and permission-friendly.
- Avoids exposing raw Koishi `Bot` directly.

Cons:

- Adds registry design and naming before there are enough concrete capability
  families.
- More abstraction than the first OneBot use case needs.

Decision: defer. This may become useful after multiple platform-specific
capabilities appear.

## Accepted Direction

Use `ChannelAgentContext` as the core-owned channel-scoped API and add a
`platform` section with `unsafeBot?: Bot`.

```ts
import type { Bot } from "koishi";

export interface ChannelAgentContext {
  readonly channel: {
    readonly platform: string;
    readonly selfId: string;
    readonly channelId: string;
    readonly type: "private" | "group";
  };

  readonly platform: {
    readonly name: string;
    readonly unsafeBot?: Bot;
  };
}
```

`unsafeBot` is intentionally named as an unsafe escape hatch. It exposes the raw
Koishi bot associated with the first session that created the channel runtime.
It is not channel-scoped by `agent-runtime`, not permission-filtered, and not a
general recommendation for ordinary tools.

## Intended OneBot Shape

```ts
ctx.yesimbot.registerAgentPlugin((context) => {
  if (context.channel.platform !== "onebot") {
    return { name: "onebot-utils", tools: [] };
  }

  const getInternal = () => {
    const internal = context.platform.unsafeBot?.internal as Internal | undefined;
    if (!internal) {
      throw new Error("当前频道的机器人适配器不支持 OneBot 协议");
    }
    return internal;
  };

  return {
    name: "onebot-utils",
    tools: [
      {
        name: "onebot_get_forward_message",
        description: "获取合并转发消息的原始消息列表",
        inputSchema,
        async execute(input) {
          return await getInternal().getForwardMsg(input.messageId);
        },
      },
      {
        name: "onebot_create_reaction",
        description: "对消息进行表态",
        inputSchema,
        async execute(input) {
          const internal = getInternal();
          if (!internal._request) {
            throw new Error("当前频道的机器人适配器不支持发送 OneBot 请求");
          }

          return await internal._request("set_msg_emoji_like", {
            message_id: input.messageId,
            emoji_id: input.emojiId,
          });
        },
      },
    ],
  };
});
```

## State Boundary

`platform`, `selfId`, `channelId`, and `unsafeBot` should not be stored in
`agent.state`.

Reasons:

- `agent.state` is persisted mutable semantic runtime state.
- Bot handles are not serializable.
- Channel identity already exists in runtime key, storage path, platform
  messages, and `ChannelAgentContext`.
- Letting plugins mutate identity through state creates consistency and
  security risks.

## Lifecycle Decision

The `unsafeBot` value is captured when core first creates the channel runtime
from an eligible Koishi session. Existing runtimes are not hot-swapped if the
underlying bot changes. This matches the existing first-version design where
registered plugin factories and resolved models affect future runtimes, not
already-created runtimes.

Reset/recreate is the explicit way to refresh the channel runtime context.

## Design Principles Applied

- KISS: change only the core factory context shape.
- YAGNI: no generic runtime context and no capability registry in the first
  version.
- DRY: keep channel/platform identity in one core context rather than duplicating
  it into `agent.state`.
- SOLID: core owns Koishi/platform adaptation; `agent-runtime` owns turn/tool
  execution and remains host-agnostic.
