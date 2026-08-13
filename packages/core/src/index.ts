import type { Context, ForkScope } from "koishi";
import { Service, sleep } from "koishi";
import { AgentCore } from "./agent";
import { Config } from "./config";
import {
    AssetService,
    CommandService,
    HorizonService,
    MemoryService,
    ModelService,
    PluginService,
    PromptService,
} from "./services";

declare module "koishi" {
    interface Context {
        yesimbot: YesImBot;
    }
}

export default class YesImBot extends Service<Config> {
    static readonly Config = Config;
    static readonly inject = {
        required: ["database"],
    };

    static readonly name = "yesimbot";
    static readonly usage = `"Yes! I'm Bot!" 是一个能让你的机器人激活灵魂的插件。\n
使用请阅读[文档](https://docs.yesimbot.chat/), 推荐使用 [GPTGOD](https://gptgod.online/#/register?invite_code=envrd6lsla9nydtipzrbvid2r) 提供的 \`deepseek-v3.2\` 模型以获得最高性价比。目前已知效果最佳模型：\`gemini-3-pro\`
\n
官方交流群：[857518324](http://qm.qq.com/cgi-bin/qm/qr?_wv=1027&k=k3O5_1kNFJMERGxBOj1ci43jHvLvfru9&authKey=TkOxmhIa6kEQxULtJ0oMVU9FxoY2XNiA%2B7bQ4K%2FNx5%2F8C8ToakYZeDnQjL%2B31Rx%2B&noverify=0&group_code=857518324)\n`;

    constructor(ctx: Context, config: Config) {
        super(ctx, "yesimbot", true);

        const commandService = ctx.plugin(CommandService, config);

        try {
            const assetService = ctx.plugin(AssetService, config);
            const promptService = ctx.plugin(PromptService, config);
            const toolService = ctx.plugin(PluginService, config);
            const modelService = ctx.plugin(ModelService, config);
            const memoryService = ctx.plugin(MemoryService, config);
            const horizonService = ctx.plugin(HorizonService, config);

            const agentCore = ctx.plugin(AgentCore, config);

            const services = [
                agentCore,
                assetService,
                commandService,
                memoryService,
                modelService,
                promptService,
                toolService,
                horizonService,
            ];

            waitForServices(services)
                .then(() => {
                    this.ctx.logger.info("所有服务已就绪");
                    // eslint-disable-next-line ts/no-require-imports
                    this.ctx.logger.info(`Version: ${require("../package.json").version}`);
                })
                .catch((err) => {
                    this.ctx.logger.error("服务初始化失败:", err.message);
                    this.ctx.logger.error(err.stack);
                    services.forEach((service) => {
                        try {
                            service.dispose();
                        } catch (error: any) {

                        }
                    });
                    this.ctx.stop();
                });
        } catch (err: any) {
            this.ctx.logger.error("初始化时发生错误:", err.message);
            this.ctx.logger.error(err.stack);
            this.ctx.stop();
        }
    }
}

async function waitForServices(services: ForkScope[]) {
    await sleep(1000);

    // 未就绪服务
    const notReadyServices = new Set(services.map((service) => service.ctx.name));

    return new Promise<void>((resolve, reject) => {
        setTimeout(() => {
            if (!services.every((service) => service.ready)) {
                reject(new Error(`服务初始化超时: ${Array.from(notReadyServices).join(", ")}`));
            }
        }, 10000);
        const check = () => {
            for (const service of services) {
                if (service.ready && notReadyServices.has(service.ctx.name)) {
                    notReadyServices.delete(service.ctx.name);
                }
            }
            if (notReadyServices.size === 0) {
                resolve();
            } else {
                setTimeout(check, 1000);
            }
        };
        check();
    });
}

export * from "./services";
export * from "./shared";
