# koishi-plugin-yesimbot-command-bridge

让 YesImBot 主 LLM 通过工具调用 Koishi 生态中的命令，并完全接管命令的输入输出。

## 设计

- `koishi.execute` 静默执行 Koishi 命令。
- `koishi.execute.list` 列出当前策略下可用的 Koishi 命令。
- 命令内部通过 `session.send` / `session.sendQueued` 产生的输出会被捕获，不会自动发送到群里。
- 通过 `session.bot.sendMessage()` 产生的输出也会被捕获。
- `session.prompt` 在 `interactive: "ask"` 时返回 `awaiting_prompt`，主模型调用 `koishi.prompt.answer` 继续命令。
- 是否把命令结果转述到群里由主 LLM 决定。

## 配置

```yaml
trustMode: locked
allowCommands:
  - weather
  - search
hardDeny:
  - yesimbot
  - koishi.execute
  - koishi.execute.abort
  - koishi.prompt.answer
agentAuthority: 0
agentPermissions: []
userActor: disabled
crossChannel: false
timeoutMs: 30000
maxTranscriptChars: 20000
```

`trustMode: "full"` 会收集 Koishi 当前全部权限并给 agent 使用，同时 `agentAuthority` 为 0 时默认使用 4。

`userActor: "any"` 允许模型传入 `actor: { kind: "user", userId }` 代执行，插件看到的 `session.userId` 就是目标用户。

## 安全

- `hardDeny` 始终生效，默认禁止 yesimbot 自身命令和桥接工具，防止递归调用。
- `locked` 模式只允许 `allowCommands`。
- `userActor` 默认关闭，开启后仍建议限制命令范围。
- `crossChannel` 默认关闭。
