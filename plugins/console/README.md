# koishi-plugin-yesimbot-console

YesImBot 自定义 Koishi 控制台首页。插件通过 `ctx.console.addEntry()` 注册客户端入口，并用服务端 `yesimbotPanel` DataService 提供健康、模型、配置、能力和插件状态。

## 社区插件识别

面板不再依赖插件是否位于当前 monorepo。任何独立仓库的 Koishi 插件只要在 `package.json` 的 `koishi.yesimbot` 中声明，就会被面板识别：

```json
{ "name": "koishi-plugin-my-yesimbot-tool", "koishi": { "yesimbot": { "kind": "agent", "label": "我的工具", "configKey": "my-yesimbot-tool" } } }
```

字段说明：

- `kind`: `agent`、`provider`、`will`、`resource` 或 `console`。
- `label`: 面板显示名，不配置时回退到 `$label` 或包名。
- `configKey`: 可选；包名不符合 `koishi-plugin-*` 约定时用于匹配 Koishi 配置键。
- `providerId`: provider 插件可选；用于判断注册状态。

当前仓库插件仍保留 `yesimbot-*` / `@yesimbot/*` 前缀兜底，社区插件建议显式声明。
