import { Schema } from "koishi";
import { Config as EmbeddingsConfig } from "./embeddings/config";
import { Config as AdapterConfig } from "./adapters/config";

export interface Config {
  MemorySlot: {
    SlotContains: string[];
    SlotSize: number;
    FirstTriggerCount: number;
    MaxTriggerCount: number;
    MinTriggerCount: number;
    MaxTriggerTime: number;
    MinTriggerTime: number;
    AtReactPossibility?: number;
    Filter: string[];
  };
  API: AdapterConfig;
  Parameters: {
    Temperature?: number;
    MaxTokens?: number;
    TopP?: number;
    FrequencyPenalty?: number;
    PresencePenalty?: number;
    Stop?: string[];
    OtherParameters: {
      key: string;
      value: string;
    }[];
  };
  Verifier: {
    Enabled?: boolean;
    Action?: "丢弃" | "重新生成";
    SimilarityThreshold?: number;
    Method?: {
      Type: "Embedding" | "LLM";
      APIType: "OpenAI" | "Cloudflare" | "Ollama" | "Custom URL";
      BaseURL: string;
      UID: string;
      APIKey: string;
      AIModel: string;
    };
  };
  Embedding: EmbeddingsConfig;
  ImageViewer: {
    How?:
      | "LLM API 自带的多模态能力"
      | "图片描述服务"
      | "替换成[图片:summary]"
      | "替换成[图片]"
      | "不做处理，以<img>标签形式呈现";
    Memory?: number;
    DescribeImmidately?: boolean;
    Question?: string;
    BaseURL?: string;
    APIKey?: string;
    Server?: {
      Type: "百度AI开放平台" | "自己搭建的服务" | "另一个LLM";
      Adapter?: "OpenAI" | "Cloudflare" | "Ollama" | "Custom URL";
      Model?: string;
      Detail?: "low" | "high" | "auto";
      RequestBody?: string;
      GetDescRegex?: string;
    };
  };
  Bot: {
    PromptFileUrl: string[];
    PromptFileSelected: number;
    NickorName: "群昵称" | "用户昵称";
    SelfAwareness: "此页面设置的名字" | "群昵称" | "用户昵称";
    BotName: string;
    WhoAmI: string;
    BotHometown: string;
    SendDirectly: boolean;
    BotYearold: string;
    BotPersonality: string;
    BotGender: string;
    BotHabbits: string;
    BotBackground: string;
    WordsPerSecond: number;
    CuteMode: boolean;
    BotReplySpiltRegex: string;
    BotSentencePostProcess: Array<{
      replacethis: string;
      tothis: string;
    }>;
  };
  Settings: {
    SingleMessageStrctureTemplate: string;
    LogicRedirect: {
      Enabled?: boolean;
      Target?: string;
    };
    FirsttoAll: boolean;
    SelfReport: Array<"指令消息" | "逻辑重定向" | "和LLM交互的消息">;
    UpdatePromptOnLoad: boolean;
    AllowErrorFormat: boolean;
    MultiTurn: boolean;
  };
  Debug: {
    DebugAsInfo: boolean;
    TestMode: boolean;
    FileUniqueField: string;
    IgnoreImgCache: boolean;
  };
}

export const Config: Schema<Config> = Schema.object({
  MemorySlot: Schema.object({
    SlotContains: Schema.array(Schema.string())
      .required()
      .role("table")
      .description("记忆槽位。填入一个或多个会话ID，用半角逗号分隔。群聊的会话ID是群号，私聊的会话ID是带有\"private:\" + 用户账号。用\"all\"指定所有群聊，用\"private:all\"指定所有私聊。同一个槽位的聊天将共用同一份记忆。如果多个槽位都包含同一会话ID，第一个包含该会话ID的槽位将被应用"),
    SlotSize: Schema.number()
      .default(20)
      .min(1)
      .description("Bot 接收的上下文数量（消息队列最大长度）"),
    FirstTriggerCount: Schema.number()
      .default(3)
      .min(1)
      .description("Bot 开始回复消息的初始触发计数"),
    MaxTriggerCount: Schema.number()
      .default(10)
      .min(1)
      .description("Bot 两次回复之间的最大消息数"),
    MinTriggerCount: Schema.number()
      .default(1)
      .min(1)
      .description("Bot 两次回复之间的最小消息数"),
    MaxTriggerTime: Schema.number()
      .default(0)
      .min(0)
      .max(2147483)
      .description("Bot 能容忍冷场的最长时间（秒），距离会话最后一条消息达到此时间时，将主动触发一次Bot回复，设为 0 表示关闭此功能"),
    MinTriggerTime: Schema.number()
      .default(1000)
      .min(0)
      .description("Bot 单次触发冷却（毫秒），冷却期间如又触发回复，将处理新触发回复，跳过本次触发"),
    AtReactPossibility: Schema.number()
      .default(0.5)
      .min(0)
      .max(1)
      .step(0.05)
      .role("slider")
      .description("立即回复 @ 消息的概率"),
    Filter: Schema.array(Schema.string())
      .default(["你是", "You are", "吧", "呢"])
      .description("过滤的词汇（防止被调皮群友/机器人自己搞傻）"),
  }).description("记忆槽位设置"),

  API: AdapterConfig,

  Parameters: Schema.object({
    Temperature: Schema.number()
      .default(1.36)
      .min(0)
      .max(2)
      .step(0.01)
      .role("slider")
      .description("采样器的温度。数值越大，回复越随机；数值越小，回复越确定"),
    MaxTokens: Schema.number()
      .default(4096)
      .min(1)
      .max(20480)
      .step(1)
      .description("一次生成的最大 Token 数量。请注意，此参数对于 o1 系列等自带思考的模型已经过时。对于 o1-preview 和 o1-mini 模型，请留空此参数，并在自定义参数中使用 max_completion_tokens 来指定一次生成消耗的最大 Token 数"),
    TopP: Schema.number()
      .default(0.64)
      .min(0)
      .max(1)
      .step(0.01)
      .role("slider")
      .description("核心采样。模型生成的所有候选 Tokens 按照其概率从高到低排序后，依次累加这些概率，直到达到或超过此预设的阈值，剩余的 Tokens 会被丢弃。值为1时表示关闭"),
    FrequencyPenalty: Schema.number()
      .default(0)
      .min(-2)
      .max(2)
      .step(0.01)
      .role("slider")
      .description("数值为正时，会根据 Token 在前文出现的频率进行惩罚，降低模型反复重复同一个词的概率。这是一个乘数"),
    PresencePenalty: Schema.number()
      .default(0)
      .min(-2)
      .max(2)
      .step(0.01)
      .role("slider")
      .description("数值为正时，如果 Token 在前文出现过，就对其进行惩罚，降低它再次出现的概率，提高模型谈论新话题的可能性。这是一个加数"),
    Stop: Schema.array(Schema.string())
      .default(["<|endoftext|>"])
      .role("table")
      .description("自定义停止词。对于 OpenAI 官方的 API，最多可以设置4个自定义停止词。生成会在遇到这些停止词时停止"),
    OtherParameters: Schema.array(
      Schema.object({
        key: Schema.string().description("键名"),
        value: Schema.string().description("键值"),
      })
    )
      .default([{ key: "do_sample", value: "true" }])
      .role("table")
      .description(
        `自定义请求体中的其他参数。有些api可能包含一些特别有用的功能，例如 dry_base 和 response_format。<br/>
        如果在调用api时出现400或422错误，请尝试删除此处的自定义参数。<br/>
        提示：直接将gbnf内容作为grammar_string的值粘贴至此时，换行符会被转换成空格，需要手动替换为\\n后方可生效`.trim()
      ),
  }).description("API 参数"),

  Verifier: Schema.intersect([
    Schema.object({
      Enabled: Schema.boolean()
        .default(false)
        .description("是否开启相似度验证"),
    }).description("相似度验证"),
    Schema.union([
      Schema.object({
        Enabled: Schema.const(true).required(),
        SimilarityThreshold: Schema.number()
          .default(0.75)
          .min(0)
          .max(1)
          .step(0.05)
          .role("slider")
          .description("相似度阈值。超过此值的回复将被过滤"),
        Action: Schema.union(["丢弃", "重新生成"])
          .default("丢弃")
          .description("相似度高于阈值时的行为"),
        Method: Schema.intersect([
          Schema.object({
            Type: Schema.union(["Embedding", "LLM"])
              .default("Embedding")
              .description("验证器类型。如果选择 Embedding，请填写下方Embedding配置"),
          }),
          Schema.union([
            Schema.object({
              Type: Schema.const("Embedding").required(),
            }),
            Schema.object({
              Type: Schema.const("LLM").required(),
              APIType: Schema.union(["OpenAI", "Cloudflare", "Ollama", "Custom URL"])
                .default("OpenAI")
                .description("API 类型"),
              BaseURL: Schema.string()
                .default("https://api.openai.com/")
                .description("API 基础 URL, 设置为“Custom URL”需要填写完整的 URL"),
              UID: Schema.string()
                .default("若非 Cloudflare 可不填")
                .description("Cloudflare UID"),
              APIKey: Schema.string().description("你的 API 令牌"),
              AIModel: Schema.string()
                .default("@cf/meta/llama-3-8b-instruct")
                .description("模型 ID"),
            }),
            Schema.object({}),
          ]),
        ]),
      }),
      Schema.object({}),
    ]),
  ]),

  // 保留备用。记忆方案：["embedding模型与RAG，结合koishi的database做向量库", "定期发送消息给LLM，总结聊天记录，并塞到后续的请求prompt中", "两者结合，定期发送消息给LLM，总结聊天记录，把总结文本向量化后存入向量库，有请求时把输入向量化和向量库内的总结做比对，提取出相关的总结塞到prompt中"]
  // 向量库的设想：为每个向量添加时间戳，定期检查并删除超过一定时间的向量；记录每个向量的使用频率，删除使用频率低的向量；查询时，提升更近时间存入的向量的权重 // 遗忘机制 & 减少向量库的大小
  // 多模态向量库：图像和文本嵌入模型，需要CLIP等多模态模型支持/文本和图像对齐??
  // 欸以上这些好像mem0都想到了?
  //
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

  Embedding: EmbeddingsConfig,

  ImageViewer: Schema.intersect([
    Schema.object({
      How: Schema.union([
        "LLM API 自带的多模态能力",
        "图片描述服务",
        "替换成[图片:summary]",
        "替换成[图片]",
        "不做处理，以<img>标签形式呈现",
      ])
        .default("替换成[图片]")
        .description("处理图片的方式。失败时会自动尝试后一种方式"),
    }).description("图片查看器"),
    Schema.union([
      Schema.object({
        How: Schema.const("LLM API 自带的多模态能力").required(),
        Memory: Schema.number()
          .default(1)
          .min(-1)
          .description("使用 LLM API 自带的多模态能力时，LLM 真正能看到的最近的图片数量。设为-1取消此限制"),
      }),
      Schema.object({
        How: Schema.const("图片描述服务").required(),
        DescribeImmidately: Schema.boolean()
          .default(false)
          .description("是否在收到图片时立即描述图片"),
        Question: Schema.string()
          .default("这张图里有什么？")
          .description("图片描述服务针对输入图片的问题"),
        BaseURL: Schema.string()
          .default("http://127.0.0.1")
          .description("自己搭建的图片描述服务或另一个LLM的完整 URL"),
        APIKey: Schema.string().description("图片描述服务可能需要的 API 密钥，对于不同服务，它们的名称可能不同。例如`access_token`"),
        Server: Schema.intersect([
          Schema.object({
            Type: Schema.union(["百度AI开放平台", "自己搭建的服务", "另一个LLM"])
              .required()
              .default("百度AI开放平台")
              .description("图片查看器使用的服务提供商"),
          }),
          Schema.union([
            Schema.object({
              Type: Schema.const("百度AI开放平台"),
            }),
            Schema.object({
              Type: Schema.const("自己搭建的服务").required(),
              RequestBody: Schema.string()
                .role('textarea', { rows: [1, 4] })
                .description("自己搭建的图片描述服务需要的请求体。<br/>其中：<br/>\
                  `<url>`(包含尖括号)会被替换成消息中出现的图片的url;<br/>\
                  `<base64>`(包含尖括号)会被替换成图片的base64(自带`data:image/jpeg;base64,`头，无需另行添加);<br/>\
                  `<question>`(包含尖括号)会被替换成此页面设置的针对输入图片的问题;<br/>\
                  `<apikey>`(包含尖括号)会被替换成此页面设置的图片描述服务可能需要的 API 密钥".trim()),
              GetDescRegex: Schema.string().description("从自己搭建的图片描述服务提取所需信息的正则表达式。注意转义"),
            }),
            Schema.object({
              Type: Schema.const("另一个LLM").required(),
              Adapter: Schema.union([
                "OpenAI",
                "Custom URL",
                "Ollama",
                "Cloudflare"
              ])
                .default("OpenAI")
                .description("使用另一个LLM时的适配器类型"),
              Model: Schema.string()
                .default("gpt-4o-mini")
                .description("使用另一个LLM时的模型名称"),
              Detail: Schema.union(["low", "high", "auto"])
                .default("low")
                .description("使用 LLM 时的图片处理细节，这关系到 Token 消耗"),
            }),
            Schema.object({}),
          ]),
        ]),
      }),
      Schema.object({}),
    ]),
  ]),

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
    NickorName: Schema.union(["群昵称", "用户昵称"])
      .default("群昵称")
      .description("Bot 将看到其他人的..."),
    SelfAwareness: Schema.union(["此页面设置的名字", "群昵称", "用户昵称"])
      .default("群昵称")
      .description("Bot 将认为自己叫..."),
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
    WordsPerSecond: Schema.number()
      .default(2)
      .min(0)
      .max(360)
      .step(0.1)
      .role("slider")
      .description("Bot 的打字速度（每秒字数）。设为 0 取消打字间隔。"),
    BotReplySpiltRegex: Schema.string()
      .default("(?<=[。?!？！])\s*")
      .description("分割 Bot 生成的句子时所用的正则表达式。如果要关闭分割，请设为`(?!)`而不是空字符串"),
    BotSentencePostProcess: Schema.array(
      Schema.object({
        replacethis: Schema.string().description("需要替换的文本"),
        tothis: Schema.string().description("替换为的文本"),
      })
    )
      .default([{ replacethis: "。$", tothis: "" }])
      .role("table")
      .description("Bot 生成的句子后处理，用于替换文本。每行一个替换规则，从上往下依次替换，支持正则表达式"),
    CuteMode: Schema.boolean().default(false).description("原神模式（迫真"),
  }).description("机器人设定"),

  Settings: Schema.object({
    SingleMessageStrctureTemplate: Schema.string()
      .default("[{{messageId}}][{{date}} {{channelInfo}}] {{senderName}}<{{senderId}}> {{hasQuote,回复[{{quoteMessageId}}]: ,说: }}{{userContent}}")
      .description("单条消息的结构模板"),
    LogicRedirect: Schema.intersect([
      Schema.object({
        Enabled: Schema.boolean()
          .default(false)
          .description("是否开启逻辑重定向"),
      }),
      Schema.union([
        Schema.object({
          Enabled: Schema.const(true).required(),
          Target: Schema.string()
            .default("")
            .description("将 Bot 的发言逻辑重定向到群组"),
        }),
        Schema.object({}),
      ]),
    ]),
    FirsttoAll: Schema.boolean()
      .default(false)
      .description("记忆槽位的行为改为：如果多个槽位都包含同一群号，所有包含该群号的槽位都将被应用"),
    SelfReport: Schema.array(
      Schema.union(["指令消息", "逻辑重定向", "和LLM交互的消息"])
    )
      .default(["和LLM交互的消息"])
      .role("checkbox")
      .description("选择将 Bot 的哪些消息添加到数据库"),
    UpdatePromptOnLoad: Schema.boolean()
      .default(true)
      .description("每次启动时尝试更新 Prompt 文件"),
    AllowErrorFormat: Schema.boolean()
      .default(false)
      .description("兼容几种较为常见的大模型错误输出格式"),
    MultiTurn: Schema.boolean()
      .default(false)
      .description("将历史消息以多轮对话格式传递给LLM，这会使得LLM更好地理解哪些消息是自己曾发出的，但会将期望的LLM输出格式从json改为单条消息的结构模板的格式，因此将无法使用某些功能"),
  }).description("插件设置"),

  Debug: Schema.object({
    DebugAsInfo: Schema.boolean()
      .default(false)
      .description("在控制台显示 Debug 消息"),
    TestMode: Schema.boolean()
      .default(false)
      .description("测试模式。如果你不知道这是什么，不要开启"),
    FileUniqueField: Schema.string()
      .default("file")
      .description("图片的唯一标识字段"),
    IgnoreImgCache: Schema.boolean()
      .default(false)
      .description("忽略图片缓存"),
  }).description("调试设置"),
});
