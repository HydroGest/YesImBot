import {
  Schema
} from "koishi";

export const configSchema: any = Schema.object({
  Group: Schema.object({
    AllowedGroups: Schema.array(Schema.string())
      .required()
      .description("允许的群聊"),
    SendQueueSize: Schema.number()
      .default(20).min(1)
      .description("Bot 接收的上下文数量（消息队列最大长度）"),
    TriggerCount: Schema.number()
      .default(3).min(1)
      .description("Bot 开始回复消息的初始触发计数"),
    MaxPopNum: Schema.number()
      .default(10).min(1)
      .description("Bot 两次回复之间的最大消息数"),
    MinPopNum: Schema.number()
      .default(1).min(1)
      .description("Bot 两次回复之间的最小消息数"),
    AtReactPossiblilty: Schema.number()
      .default(0.5)
      .min(0).max(1).step(0.05)
      .role('slider')
      .description("立即回复 @ 消息的概率"),
    Filter: Schema.array(Schema.string())
      .default(["你是", "You are", "吧", "呢"])
      .description("过滤的词汇（防止被调皮群友/机器人自己搞傻）"),
  }).description("群聊设置"),

  API: Schema.object({
    APIList: Schema.array(Schema.object({
      APIType: Schema.union(["OpenAI", "Cloudflare", "Custom URL"]).default("OpenAI").description(
        "API 类型"
      ),
      BaseURL: Schema.string()
        .default("https://api.openai.com/")
        .description("API 基础 URL, 设置为“Custom URL”需要填写完整的 URL"),
      UID: Schema.string()
        .default("若非 Cloudflare 可不填")
        .description("Cloudflare UID"),
      APIKey: Schema.string().required().description("你的 API 令牌"),
      AIModel: Schema.string()
        .default("@cf/meta/llama-3-8b-instruct")
        .description("模型 ID"),
    })).description("单个 LLM API 配置，可配置多个 API 进行负载均衡。"),
  }).description("LLM API 相关配置"),

  Parameters: Schema.object({
    Temperature: Schema.number()
      .default(1.36)
      .min(0)
      .max(5)
      .step(0.01)
      .role('slider')
      .description("温度，数值越大，回复越具有创造性"),
    MaxTokens: Schema.number()
      .default(4096)
      .min(1)
      .max(20480)
      .step(1)
      .description("一次生成的最大 Token 数量"),
    TopK: Schema.number()
      .default(33)
      .min(-1)
      .max(200)
      .step(1)
      .role('slider')
      .description("Top K，值为0时表示关闭"),
    TopP: Schema.number()
      .default(0.64)
      .min(0)
      .max(1)
      .step(0.01)
      .role('slider')
      .description("Top P，值为1时表示关闭"),
    TypicalP: Schema.number()
      .default(1)
      .min(0)
      .max(1)
      .step(0.01)
      .role('slider')
      .description("Typical P，值为1时表示关闭"),
    MinP: Schema.number()
      .default(0.164)
      .min(0)
      .max(1)
      .step(0.001)
      .role('slider')
      .description("Min P，值为0时表示关闭"),
    TopA: Schema.number()
      .default(0.04)
      .min(0)
      .max(1)
      .step(0.01)
      .role('slider')
      .description("Top A，值为0时表示关闭"),
    FrequencyPenalty: Schema.number()
      .default(0)
      .min(-2)
      .max(2)
      .step(0.01)
      .role('slider')
      .description("Frequency 重复惩罚"),
    PresencePenalty: Schema.number()
      .default(0)
      .min(-2)
      .max(2)
      .step(0.01)
      .role('slider')
      .description("Presence 重复惩罚"),
    Stop: Schema.array(Schema.string())
      .default(["<|endoftext|>"])
      .role('table')
      .description("自定义停止词"),
    OtherParameters: Schema.array(Schema.object({
      key: Schema.string().description("键名"),
      value: Schema.string().description("键值"),
    })).default([{ key: "do_sample", value: "true" }, { key: "grammar_string", value: "root   ::= object\nobject ::= \"{\\n\\\"status\\\": \" status-value \",\\n\\\"logic\\\": \" logic-value \",\\n\\\"select\\\": \" select-value \",\\n\\\"reply\\\": \" reply-value \",\\n\\\"check\\\": \" check-value \",\\n\\\"finReply\\\": \" finReply-value \",\\n\\\"execute\\\": \" execute-value \"\\n}\"\nstring ::= \"\\\"\" ([^\"\\\\] | \"\\\\\" [\"\\\\/bfnrt])* \"\\\"\"\nnumber ::= [0-9]+\nban-time ::= [1-9][0-9]{1,3} | [1-4][0-3][0-1][0-9][0-9]\nstatus-value  ::= \"\\\"success\\\"\" | \"\\\"skip\\\"\"\nlogic-value   ::= string | \"\\\"\\\"\"\nselect-value  ::= number | \"-1\"\nreply-value   ::= string\ncheck-value   ::= \"\\\"\\\"\"\nfinReply-value::= string\nexecute-value ::= \"[\"( execute-cmds (\", \" execute-cmds )* )? \"]\"\nexecute-cmds  ::= delmsg | ban | reaction\ndelmsg        ::= \"\\\"delmsg \" number \"\\\"\"\nban           ::= \"\\\"ban \" number \" \" ban-time \"\\\"\"\nreaction      ::= \"\\\"reaction-create \" number \" \" number \"\\\"\"" }]).role('table').description("自定义请求体中的其他参数，例如dry_base: 1。\n提示：直接将gbnf内容作为grammar_string的值粘贴至此时，换行符会被转换成空格，需要手动替换为\\n后方可生效"),
  }).description("API 参数"),

  // Embedding: Schema.object({
  //   APIList: Schema.array(Schema.object({
  //     APIType: Schema.union(["OpenAI", "Cloudflare", "Custom URL"]).default("OpenAI").description("Embedding API 类型"),
  //     BaseURL: Schema.string().default("https://api.openai.com/").description("Embedding API 基础 URL"),
  //     UID: Schema.string().default("").description("Cloudflare UID（如果适用）"),
  //     APIKey: Schema.string().required().description("API 令牌"),
  //     EmbeddingModel: Schema.string().default("text-embedding-ada-002").description("Embedding 模型 ID"),
  //   })).description("单个 Embedding 模型配置，可配置多个 API 进行负载均衡。"),
  // }).description("Embedding 模型相关配置，可用于存储BOT的记忆"),

  Verifier: Schema.intersect([
    Schema.object({
      Enabled: Schema.boolean().default(false),
    }).description('是否启用相似度验证'),
    Schema.union([
      Schema.object({
        Enabled: Schema.const(true).required(),
        API: Schema.object({
          APIType: Schema.union(["OpenAI", "Cloudflare", "Custom URL"])
            .default("OpenAI")
            .description("验证器 API 类型"),
          BaseURL: Schema.string()
            .default("https://api.openai.com/")
            .description("验证器 API 基础 URL"),
          UID: Schema.string()
            .default("")
            .description("验证器 Cloudflare UID（如果适用）"),
          APIKey: Schema.string()
            .default("sk-xxxxxxx")
            .description("验证器 API 令牌"),
          AIModel: Schema.string()
            .default("gpt-3.5-turbo")
            .description("验证器使用的模型，可以使用embedding模型"),
        }).description("验证器 API 配置"),
        SimilarityThreshold: Schema.number()
          .default(0.75)
          .min(0)
          .max(1)
          .step(0.05)
          .role('slider')
          .description("相似度阈值，超过此值的回复将被过滤"),
      }),
      Schema.object({})
    ])
  ]),

  // 保留备用
  // Memory: Schema.intersect([
  //     Schema.object({
  //         Enabled: Schema.boolean().default(false),
  //     }).description('是否启用记忆中枢'),
  //     Schema.union([
  //         Schema.object({
  //             Enabled: Schema.const(true).required(),
  //             API: Schema.object({
  //                 APIType: Schema.union(["OpenAI", "Cloudflare", "Custom URL"])
  //                     .default("OpenAI")
  //                     .description("记忆中枢 API 类型"),
  //                 BaseURL: Schema.string()
  //                     .default("https://api.openai.com/")
  //                     .description("记忆中枢 API 基础 URL"),
  //                 UID: Schema.string()
  //                     .default("")
  //                     .description("记忆中枢 Cloudflare UID（如果适用）"),
  //                 APIKey: Schema.string()
  //                     .default("sk-xxxxxxx")
  //                     .description("记忆中枢 API 令牌"),
  //                 AIModel: Schema.string()
  //                     .default("gpt-3.5-turbo")
  //                     .description("记忆中枢使用的模型"),
  //             }).description("记忆中枢 API 配置"),
  //         }),
  //     ])
  // ]),

  Bot: Schema.object({
    PromptFileUrl: Schema.array(Schema.string())
      .default([
        "https://fastly.jsdelivr.net/gh/HydroGest/promptHosting@main/src/prompt-legacy.mdt",
        "https://fastly.jsdelivr.net/gh/HydroGest/promptHosting@main/src/prompt-next.mdt",
        "https://fastly.jsdelivr.net/gh/HydroGest/promptHosting@main/src/prompt-next-short.mdt",
      ])
      .description("Prompt 文件下载链接。一般情况下不需要修改。"),
    PromptFileSelected: Schema.number()
      .default(2)
      .description("Prompt 文件编号，从 0 开始。请阅读 readme 再修改!"),
    NickorName: Schema.union(["群昵称", "用户昵称"]).default("群昵称").description("Bot 将看到其他人的..."),
    SelfAwareness: Schema.union(["此页面设置的名字", "群昵称", "用户昵称"]).default("群昵称").description("Bot 将认为自己叫..."),
    BotName: Schema.string().default("Athena").description("Bot 的名字"),
    WhoAmI: Schema.string()
      .default("一个普通的群友")
      .description("Bot 的简要设定"),
    BotHometown: Schema.string().default("广州").description("Bot 的家乡"),
    SendDirectly: Schema.boolean()
      .default(false)
      .description("运行时屏蔽其他指令"),
    BotYearold: Schema.string().default("16").description("Bot 的年龄"),
    BotPersonality: Schema.string()
      .default("外向/有爱")
      .description("Bot 性格"),
    BotGender: Schema.string().default("女").description("Bot 的性别"),
    BotHabbits: Schema.string().default("").description("Bot 的爱好"),
    BotBackground: Schema.string()
      .default("高中女生")
      .description("Bot 的背景"),
    BotSentencePostProcess: Schema.array(Schema.object({
      replacethis: Schema.string().description("需要替换的文本"),
      tothis: Schema.string().description("替换为的文本"),
    })).default([{ replacethis: "。$", tothis: "" }]).role('table').description("Bot 生成的句子后处理，用于替换文本。每行一个替换规则，从上往下依次替换，支持正则表达式"),
    CuteMode: Schema.boolean().default(false).description("原神模式（迫真"),
  }).description("机器人设定"),
  Debug: Schema.object({
    LogicRedirect: Schema.intersect([
      Schema.object({
        Enabled: Schema.boolean().default(false).description('是否开启逻辑重定向'),
      }),
      Schema.union([
        Schema.object({
          Enabled: Schema.const(true).required(),
          Target: Schema.string()
            .default("")
            .description("将 Bot 的发言逻辑重定向到群组"),
        }),
        Schema.object({}),
      ])
    ]),
    DebugAsInfo: Schema.boolean()
      .default(false)
      .description("在控制台显示 Debug 消息"),
    DisableGroupFilter: Schema.boolean()
      .default(false)
      .description("禁用聊群筛选器，接收并回复所有群的消息"),
    UpdatePromptOnLoad: Schema.boolean()
      .default(true)
      .description("每次启动时尝试更新 Prompt 文件"),
    AllowErrorFormat: Schema.boolean()
      .default(false)
      .description("兼容几种较为常见的大模型错误输出格式"),
  }).description("调试工具"),
});
