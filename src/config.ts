import { Schema } from "koishi";

export configSchema: any = Schema.object({
    Group: Schema.object({
        AllowedGroups: Schema.array(Schema.string())
            .required()
            .description("允许的群聊"),
        SendQueueSize: Schema.number()
            .default(20)
            .description("Bot 接收的上下文数量（消息队列长度）"),
        MaxPopNum: Schema.number()
            .default(10)
            .description("消息队列每次出队的最大数量"),
        MinPopNum: Schema.number()
            .default(1)
            .description("消息队列每次出队的最小数量"),
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
                .description("API 基础URL, 设置为“Custom URL”需要填写完整的 URL"),
            UID: Schema.string()
                .default("若非 Cloudflare 可不填")
                .description("Cloudflare UID"),
            APIKey: Schema.string().required().description("你的 API 令牌"),
            AIModel: Schema.string()
                .default("@cf/meta/llama-3-8b-instruct")
                .description("模型 ID"),
        })).description("单个 LLM API 配置，可配置多个 API 进行负载均衡。"),
    }).description("LLM API 相关配置"),
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
        BotName: Schema.string().default("Athena").description("Bot 的名字，最好是 Bot 的用户名"),
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
        CuteMode: Schema.boolean().default(false).description("原神模式（迫真"),
    }).description("机器人设定"),
    Debug: Schema.object({
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