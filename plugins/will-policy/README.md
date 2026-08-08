# yesimbot-will-policy

可选的 WillEngine 与 routing 精细化策略插件。插件启动时通过 `ctx.yesimbot.agent.will()` 注册一个具名 WillEngine；不安装时 Core 完全保持默认行为。

## 基础概念

### wait / trigger 是什么意思

- `wait`：这条消息只进入历史，不启动回复，也不加入正在进行的回复。
- `trigger`：这条消息会触发一次 Agent 回复；如果 Agent 正在忙，则加入当前回复流程。

这两个值只出现在 `routing` 配置里，因为 routing 是确定规则：命中哪类消息，就直接返回 `wait` 或 `trigger`。

### routing 和 willingness 的区别

- `routing`：固定规则，不看概率。例如“私聊一定回复”“普通群消息一定不回复”。
- `willingness`：动态活跃度。每条消息都会改变一个意愿分数，分数超过阈值后按概率触发回复；分数越高，回复概率越大。

`engine` 选择当前克隆实例使用哪一套：

```text
engine: routing      # 只看 routing，不看 willingness
engine: willingness  # 使用意愿值动态决定，routing 配置不会被使用
```

## 特性

- 像 provider 一样可以在 Koishi 管理页中克隆/重复添加，每个实例是一套独立 WillEngine 配置。
- 每个实例的筛选交给 Koishi 管理页自带的 filter，插件不重复实现。
- `routing` 支持私聊、@机器人、@全体、@在线、引用/回复、图片消息、拍一拍、普通群消息八类独立决策。
- `willingness` 参考 v3 意愿引擎，提供基础增益、属性增益、关键词乘数、概率曲线、热/温窗口和强制触发开关。
- 多个 WillEngine 插件可以共存，由具名 `priority` 决定顺序；数值小者先执行。

## 示例配置

下面的示例把 `routing` 和 `willingness` 都写出来了，方便你理解每块配置负责什么：

```yaml
plugins:
  yesimbot-will-policy:
    # 当前克隆实例使用意愿值引擎
    engine: willingness

    # routing 配置：只有当 engine 为 routing 时才会使用
    routing:
      direct: trigger
      mention: trigger
      mentionAll: wait
      mentionHere: wait
      quote: wait
      image: wait
      poke: trigger
      group: wait

    # willingness 配置：只有当 engine 为 willingness 时才会使用
    willingness:
      probabilityThreshold: 55
      decayHalfLifeSeconds: 600
      replyCost: 35
      textGain: 12
      mentionGain: 100
      directGain: 40
      imageGain: 8
      pokeGain: 80
      keywords:
        - 猫
        - 代码
      keywordMultiplier: 1.8
      mentionForce: true
```

## 什么时候走哪套配置

- 如果这个克隆实例的 `engine: routing`，Core 只看 `routing` 里的 `wait / trigger`。
- 如果这个克隆实例的 `engine: willingness`，Core 使用 `willingness` 计算分数和概率，`routing` 被忽略。
- 每个克隆实例独立选择 `engine`，所以你可以一个实例用 routing，另一个实例用 willingness。
- Koishi 管理页的 filter 决定每个克隆实例应用于哪些频道/平台。
- 多个实例同时匹配时，按 `priority` 决定哪一个先接管；数值小者优先。

## 克隆语义

- 每个插件实例拥有独立的 `routing` / `willingness` 配置。
- 多个实例按 `priority` 参与 WillEngine 排序，数值小者先执行。
- 需要按频道/平台区分时，在 Koishi 管理页给对应实例配置 filter。
