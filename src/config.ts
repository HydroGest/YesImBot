import { Schema } from "koishi";

export interface Config {
  Group: {
    AllowedGroups: string[];
    SendQueueSize: number;
    TriggerCount: number;
    MaxPopNum: number;
    MinPopNum: number;
    AtReactPossibility?: number;
    Filter: string[];
  };
  API: {
    APIList: {
      APIType: "OpenAI" | "Cloudflare" | "Ollama" | "Custom URL";
      BaseURL: string;
      UID: string;
      APIKey: string;
      AIModel: string;
    }[];
  };
  Parameters: {
    Temperature: number;
    MaxTokens: number;
    TopP: number;
    FrequencyPenalty: number;
    PresencePenalty: number;
    Stop: string[];
    OtherParameters: {
      key: string;
      value: string;
    }[];
  };
  Verifier: {
    Enabled?: boolean;
    API?: {
      APIType: string;
      BaseURL: string;
      UID: string;
      APIKey: string;
      AIModel: string;
    };
    SimilarityThreshold?: number;
  };
  Embedding: {
    Enabled?: boolean;
    APIType?: string;
    BaseURL?: string;
    APIKey?: string;
    EmbeddingModel?: string;
    RequestBody?: string;
    GetVecRegex?: string;
  };
  ImageViewer: {
    How:
      | "LLM API 自带的多模态能力"
      | "图片描述服务"
      | "替换成[图片:summary]"
      | "替换成[图片]"
      | "不做处理，以<img>标签形式呈现";
    Detail: "low" | "high" | "auto";
    Memory: number;
    Server: "百度AI开放平台" | "自己搭建的服务" | "另一个LLM";
    BaseURL: string;
    Model: string;
    RequestBody: string;
    GetDescRegex: string;
    APIKey: string;
    Question: string;
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
    BotSentencePostProcess: {
      replacethis: string;
      tothis: string;
    }[];
  };
  Debug: {
    LogicRedirect: {
      Enabled?: boolean;
      Target?: string;
    };
    DebugAsInfo: boolean;
    FirsttoAll: boolean;
    AddAllMsgtoQueue: boolean;
    WholetoSplit: boolean;
    UpdatePromptOnLoad: boolean;
    AllowErrorFormat: boolean;
  };
}

export const Config: Schema<Config> = Schema.object({
  Group: Schema.object({
    AllowedGroups: Schema.array(Schema.string())
      .required()
      .role("table")
      .description("记忆槽位。填入一个或多个群号，用半角逗号分隔。用\"private:\"指定私聊，用\"all\"指定所有群聊，用\"private:all\"指定所有私聊。同一个槽位的聊天将共用同一份记忆。如果多个槽位都包含同一群号，第一个包含该群号的槽位将被应用"),
    SendQueueSize: Schema.number()
      .default(20)
      .min(1)
      .description("Bot 接收的上下文数量（消息队列最大长度）"),
    TriggerCount: Schema.number()
      .default(3)
      .min(1)
      .description("Bot 开始回复消息的初始触发计数"),
    MaxPopNum: Schema.number()
      .default(10)
      .min(1)
      .description("Bot 两次回复之间的最大消息数"),
    MinPopNum: Schema.number()
      .default(1)
      .min(1)
      .description("Bot 两次回复之间的最小消息数"),
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
  }).description("群聊设置"),

  API: Schema.object({
    APIList: Schema.array(
      Schema.object({
        APIType: Schema.union(["OpenAI", "Cloudflare", "Ollama", "Custom URL"])
          .default("OpenAI")
          .description("API 类型"),
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
      })
    ).description("单个 LLM API 配置，可配置多个 API 进行负载均衡。"),
  }).description("LLM API 相关配置"),

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
      .description("自定义停止词。对于 OpenAI 官方的api，最多可以设置4个自定义停止词。生成会在遇到这些停止词时停止"),
    OtherParameters: Schema.array(
      Schema.object({
        key: Schema.string().description("键名"),
        value: Schema.string().description("键值"),
      })
    )
      .default([
        { key: "do_sample", value: "true" },
        {
          key: "grammar_string",
          value:
            'root   ::= object\nobject ::= "{\\n\\"status\\": " status-value ",\\n\\"logic\\": " logic-value ",\\n\\"select\\": " select-value ",\\n\\"reply\\": " reply-value ",\\n\\"check\\": " check-value ",\\n\\"finReply\\": " finReply-value ",\\n\\"execute\\": " execute-value "\\n}"\nstring ::= "\\"" ([^"\\\\] | "\\\\" ["\\\\/bfnrt])* "\\""\nnumber ::= [0-9]+\nban-time ::= [1-9][0-9]{1,3} | [1-4][0-3][0-1][0-9][0-9]\nstatus-value  ::= "\\"success\\"" | "\\"skip\\""\nlogic-value   ::= string | "\\"\\""\nselect-value  ::= number | "-1"\nreply-value   ::= string\ncheck-value   ::= "\\"\\""\nfinReply-value::= string\nexecute-value ::= "["( execute-cmds (", " execute-cmds )* )? "]"\nexecute-cmds  ::= delmsg | ban | reaction\ndelmsg        ::= "\\"delmsg " number "\\""\nban           ::= "\\"ban " number " " ban-time "\\""\nreaction      ::= "\\"reaction-create " number " " number "\\""',
        },
      ])
      .role("table")
      .description("自定义请求体中的其他参数。有些api可能包含一些特别有用的功能，例如 dry_base 和 response_format。\n如果在调用api时出现400或422错误，请尝试删除此处的自定义参数。\n提示：直接将gbnf内容作为grammar_string的值粘贴至此时，换行符会被转换成空格，需要手动替换为\\n后方可生效"),
  }).description("API 参数"),

  Verifier: Schema.intersect([
    Schema.object({
      Enabled: Schema.boolean().default(false),
    }).description("是否启用相似度验证"),
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
          .role("slider")
          .description("相似度阈值，超过此值的回复将被过滤"),
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

  Embedding: Schema.intersect([
    Schema.object({
      Enabled: Schema.boolean().default(false),
    }).description("是否启用 Embedding"),
    Schema.union([
      Schema.object({
        Enabled: Schema.const(true).required(),
        APIType: Schema.union(["OpenAI", "Custom"])
          .default("OpenAI")
          .description("Embedding API 类型"),
        BaseURL: Schema.string()
          .default("https://api.openai.com")
          .description("Embedding API 基础 URL"),
        APIKey: Schema.string().required().description("API 令牌"),
        EmbeddingModel: Schema.string()
          .default("text-embedding-3-large")
          .description("Embedding 模型 ID"),
        RequestBody: Schema.string().description("自定义请求体。其中：`<text>`（包含尖括号）会被替换成用于计算嵌入向量的文本；`<apikey>`（包含尖括号）会被替换成此页面设置的 API 密钥；<model>（包含尖括号）会被替换成此页面设置的模型名称"),
        GetVecRegex: Schema.string().description("从自定义Embedding服务提取嵌入向量的正则表达式。注意转义"),
      }),
      Schema.object({}),
    ]),
  ]),

  ImageViewer: Schema.object({
    How: Schema.union([
      "LLM API 自带的多模态能力",
      "图片描述服务",
      "替换成[图片:summary]",
      "替换成[图片]",
      "不做处理，以<img>标签形式呈现",
    ])
      .default("替换成[图片]")
      .description("处理图片的方式。失败时会自动尝试后一种方式"),
    Detail: Schema.union(["low", "high", "auto"])
      .default("low")
      .description("使用 LLM 时的图片处理细节，这关系到 Token 消耗"),
    Memory: Schema.number()
      .default(1)
      .min(-1)
      .description("使用 LLM API 自带的多模态能力时，LLM 真正能看到的最近的图片数量。设为-1取消此限制"),
    Server: Schema.union(["百度AI开放平台", "自己搭建的服务", "另一个LLM"])
      .default("百度AI开放平台")
      .description("图片查看器使用的服务提供商"),
    BaseURL: Schema.string()
      .default("http://127.0.0.1")
      .description("自己搭建的图片描述服务或另一个LLM的完整 URL"),
    Model: Schema.string()
      .default("gpt-4o-mini")
      .description("使用另一个LLM时的模型名称"),
    RequestBody: Schema.string().description("自己搭建的图片描述服务需要的请求体。其中：`<url>`（包含尖括号）会被替换成消息中出现的图片的url；`<base64>`(包含尖括号)会被替换成图片的base64（自带`data:image/jpeg;base64,`头，无需另行添加）；`<question>`（包含尖括号）会被替换成此页面设置的针对输入图片的问题；`<apikey>`（包含尖括号）会被替换成此页面设置的图片描述服务可能需要的 API 密钥"),
    GetDescRegex: Schema.string().description("从自己搭建的图片描述服务提取所需信息的正则表达式。注意转义"),
    APIKey: Schema.string().description("图片描述服务可能需要的 API 密钥，对于不同服务，它们的名称可能不同。例如`access_token`"),
    Question: Schema.string()
      .default("这张图里有什么？")
      .description("图片描述服务针对输入图片的问题"),
  }).description("图片查看器"),

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
      .min(0.1)
      .max(360)
      .step(0.1)
      .role("slider")
      .description("Bot 的打字速度（每秒字数）"),
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

  Debug: Schema.object({
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
    DebugAsInfo: Schema.boolean()
      .default(false)
      .description("在控制台显示 Debug 消息"),
    FirsttoAll: Schema.boolean()
      .default(false)
      .description("记忆槽位的行为改为：如果多个槽位都包含同一群号，所有包含该群号的槽位都将被应用"),
    AddAllMsgtoQueue: Schema.boolean()
      .default(false)
      .description("将所有消息添加到消息队列，即使它们不是由 LLM 生成的"),
    WholetoSplit: Schema.boolean()
      .default(false)
      .description("BOT的消息是否按照实际的分条存入消息队列，关闭表示一次调用API的消息在消息队列中会呈现为一条，开启表示按照实际发送的分条存入消息队列"),
    UpdatePromptOnLoad: Schema.boolean()
      .default(true)
      .description("每次启动时尝试更新 Prompt 文件"),
    AllowErrorFormat: Schema.boolean()
      .default(false)
      .description("兼容几种较为常见的大模型错误输出格式"),
  }).description("调试工具"),
});
