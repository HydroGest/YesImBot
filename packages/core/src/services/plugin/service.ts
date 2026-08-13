import type { Tool } from "@yesimbot/shared-model";
import type { Context, ForkScope } from "koishi";
import type { Plugin } from "./base-plugin";
import type { ToolResult } from "./types";
import type { Definition, FunctionContext, GuardContext } from "./types";
import type { Config } from "@/config";
import type { CommandService } from "@/services/command";
import type { PromptService } from "@/services/prompt";
import { h, Schema, Service } from "koishi";
import { Services } from "@/shared/constants";
import { isEmpty, schemaToJSONSchema, stringify, truncate } from "@/shared/utils";
import CoreUtilExtension from "./builtin/core-util";
import InteractionsExtension from "./builtin/interactions";
import QManagerExtension from "./builtin/qmanager";
import { FunctionType } from "./types";
import { Failed } from "./utils";

declare module "koishi" {
    interface Context {
        [Services.Plugin]: PluginService;
    }
}

export class PluginService extends Service<Config> {
    static readonly inject = [Services.Prompt];

    private plugins: Map<string, Plugin> = new Map();

    private promptService: PromptService;

    constructor(ctx: Context, config: Config) {
        super(ctx, Services.Plugin, true);
        this.config = config;
        this.promptService = ctx[Services.Prompt];
    }

    protected async start() {
        const builtinPlugins = [CoreUtilExtension, QManagerExtension, InteractionsExtension];
        const loadedPlugins = new Map<string, ForkScope>();

        for (const Ext of builtinPlugins) {
            // 不能在这里判断是否启用，否则无法生成配置
            const name = Ext.prototype.metadata.name;
            const config = this.config.extra[name];
            // @ts-expect-error type checking
            loadedPlugins.set(name, this.ctx.plugin(Ext, config));
        }
        this.registerCommands();
    }

    private registerCommands() {
        const commandService = this.ctx.get(Services.Command) as CommandService;
        const cmd = commandService.subcommand(".tool", "工具管理指令集", { authority: 3 });

        cmd.subcommand(".list", "列出所有可用工具")
            .option("filter", "-f <keyword:string> 按名称或描述过滤工具")
            .option("page", "--page <page:natural> 指定显示的页码 (默认为 1)", { fallback: 1 })
            .option("size", "--size <size:natural> 指定每页显示的数量 (默认为 10)", { fallback: 5 })
            .usage(`查询并展示当前所有已加载且可用的工具。\n支持通过关键词过滤和分页显示，方便在工具数量多时进行查找。`)
            .example(
                [
                    "tool.list                      # 显示第一页的10个工具",
                    `tool.list -f search            # 查找所有名称或描述中包含 "search" 的工具`,
                    "tool.list --page 2 --size 5    # 显示第 2 页，每页 5 个工具",
                    `tool.list -f memory --size 3   # 查找 "memory" 相关工具并每页显示 3 个`,
                ].join("\n"),
            )
            .action(async ({ session, options }) => {
                let allFuncs = await this.filterAvailableFuncs({ session });

                const filterKeyword = options.filter?.toLowerCase();
                if (filterKeyword) {
                    allFuncs = allFuncs.filter(
                        (t) =>
                            // eslint-disable-next-line style/operator-linebreak
                            t.name.toLowerCase().includes(filterKeyword) ||
                            t.description.toLowerCase().includes(filterKeyword),
                    );
                }

                const totalCount = allFuncs.length;

                if (totalCount === 0) {
                    return options.filter ? `没有找到与 "${options.filter}" 匹配的工具。` : "当前没有可用的工具";
                }

                const { page, size } = options;
                const totalPages = Math.ceil(totalCount / size);

                if (page > totalPages) {
                    return `请求的页码 (${page}) 超出范围。总共有 ${totalPages} 页。`;
                }

                const startIndex = (page - 1) * size;
                const pagedFuncs = allFuncs.slice(startIndex, startIndex + size);

                const funcList = pagedFuncs.map((t) => `- ${t.name}: ${t.description}`).join("\n");

                const header = `发现 ${totalCount} 个${options.filter ? "匹配的" : ""}工具。正在显示第 ${page}/${totalPages} 页：\n`;

                return header + funcList;
            });

        cmd.subcommand(".info <name:string>", "显示工具的详细信息")
            .usage("查询并展示指定工具的详细信息，包括名称、描述、参数等")
            .example("tool.info search_web")
            .action(async ({ session }, name) => {
                if (!name) {
                    return "未指定要查询的工具名称";
                }
                const renderResult = await this.promptService.render("tool.info", { toolName: name });

                if (!renderResult) {
                    return `未找到名为 "${name}" 的工具或渲染失败。`;
                }

                return h.escape(renderResult);
            });

        cmd.subcommand(".invoke <name:string> [...params:string]", "调用工具")
            .usage(
                [
                    "调用指定的工具并传递参数",
                    "参数格式为 \"key=value\"，多个参数用空格分隔。",
                    "如果 value 包含空格，请使用引号将其包裹，例如：key=\"some value\"。",
                ].join("\n"),
            )
            .example(["tool.invoke search_web keyword=koishi"].join("\n"))
            .action(async ({ session }, name, ...params) => {
                if (!name) {
                    return "错误：未指定要调用的工具名称";
                }
                const parsedParams: Record<string, any> = {};
                try {
                    // 更健壮的参数解析，支持 "key=value" 和 key="value with spaces"
                    const paramString = params?.join(" ") || "";
                    // eslint-disable-next-line regexp/no-unused-capturing-group
                    const regex = /(\w+)=("([^"]*)"|'([^']*)'|(\S+))/g;
                    let match;
                    // eslint-disable-next-line no-cond-assign
                    while ((match = regex.exec(paramString)) !== null) {
                        const key = match[1];
                        const value = match[3] ?? match[4] ?? match[5]; // 优先取引号内的内容
                        parsedParams[key] = value;
                    }

                    // 对于无法用正则匹配的简单场景做兼容
                    if (Object.keys(parsedParams).length === 0 && params?.length > 0) {
                        for (const param of params) {
                            const parts = param.split("=", 2);
                            if (parts.length === 2) {
                                parsedParams[parts[0]] = parts[1];
                            }
                        }
                    }
                } catch (error: any) {
                    return `参数解析失败：${error.message}\n请检查您的参数格式是否正确（key=value）。`;
                }

                // TODO: Refactor to work without session. A mock context is needed.
                if (!session)
                    return "此指令需要在一个会话上下文中使用。";

                const result = await this.invoke(name, parsedParams, { session });

                if (result.status === "success") {
                    return `✅ 工具 ${name} 调用成功！\n执行结果：${isEmpty(result.result) ? "无返回值" : stringify(result.result, 2)}`;
                } else {
                    return `❌ 工具 ${name} 调用失败。\n原因：${stringify(result.error)}`;
                }
            });
    }

    public register<TConfig = any>(ext: Plugin<TConfig>, enabled: boolean, extConfig: TConfig = {} as TConfig) {
        const validate: Schema<TConfig> = (ext.constructor as any).Config;
        const validatedConfig = validate ? validate(extConfig) : extConfig;

        let availablePlugins = this.ctx.schema.get("availablePlugins");

        if (availablePlugins.type !== "object") {
            availablePlugins = Schema.object({});
        }

        try {
            if (!ext.metadata || !ext.metadata.name) {
                this.logger.warn("一个扩展在注册时缺少元数据或名称，已跳过");
                return;
            }

            const metadata = ext.metadata;

            if (metadata.builtin) {
                this.ctx.schema.set(
                    "availablePlugins",
                    availablePlugins.set(
                        ext.metadata.name,
                        Schema.intersect([
                            Schema.object({
                                enabled: Schema.boolean().default(true).description("是否启用此扩展"),
                            }).description(`${metadata.display || metadata.name} - ${metadata.description}`),
                            Schema.union([
                                Schema.object({
                                    enabled: Schema.const(true),
                                    ...(validate && enabled ? validate.default(validatedConfig) : Schema.object({}))
                                        .dict,
                                }),
                                Schema.object({}),
                            ]),
                        ]),
                    ),
                );
            }

            if (!enabled) {
                return;
            }

            const display = metadata.display || metadata.name;

            this.logger.info(`正在注册扩展: "${display}"`);
            this.plugins.set(metadata.name, ext);

            // Log registered tools and actions
            const tools = ext.getTools();
            if (tools.size > 0) {
                for (const [name, tool] of tools) {
                    this.logger.debug(`  -> 注册工具: "${tool.name}"`);
                }
            }

            const actions = ext.getActions();
            if (actions.size > 0) {
                for (const [name, action] of actions) {
                    this.logger.debug(`  -> 注册动作: "${action.name}"`);
                }
            }
        } catch (error: any) {
            this.logger.error(`扩展配置验证失败: ${error.message}`);
        }
    }

    public unregister(name: string): boolean {
        const ext = this.plugins.get(name);
        if (!ext) {
            this.logger.warn(`尝试卸载不存在的扩展: "${name}"`);
            return false;
        }
        this.plugins.delete(name);
        this.logger.info(`已卸载扩展: "${name}"`);
        return true;
    }

    public async invoke(
        funcName: string,
        params: Record<string, unknown>,
        context: FunctionContext,
    ): Promise<ToolResult> {
        const func = await this.getFunction(funcName, context);
        if (!func) {
            this.logger.warn(`工具/动作未找到或在当前上下文中不可用 | 名称: ${funcName}`);
            return Failed(`Tool ${funcName} not found or not supported in this context.`);
        }

        const isActionType = func.type === FunctionType.Action;
        const typeLabel = isActionType ? "动作" : "工具";

        let validatedParams = params;
        if (func.parameters) {
            try {
                validatedParams = func.parameters(params);
            } catch (error: any) {
                this.logger.warn(`✖ 参数验证失败 | ${typeLabel}: ${funcName} | 错误: ${error.message}`);
                return Failed(`Parameter validation failed: ${error.message}`);
            }
        }

        const stringifyParams = stringify(params);
        this.logger.info(`→ 调用${typeLabel}: ${funcName} | 参数: ${stringifyParams}`);
        let lastResult: ToolResult = Failed("Tool call did not execute.");

        for (let attempt = 1; attempt <= this.config.advanced.maxRetry + 1; attempt++) {
            try {
                if (attempt > 1) {
                    this.logger.info(`  - 重试 (${attempt - 1}/${this.config.advanced.maxRetry})`);
                    await new Promise((resolve) => setTimeout(resolve, this.config.advanced.retryDelay));
                }

                const executionResult = await func.execute(validatedParams, context);

                if (executionResult && "build" in executionResult && typeof executionResult.build === "function") {
                    lastResult = executionResult.build();
                } else if (executionResult && "status" in executionResult) {
                    lastResult = executionResult as ToolResult;
                } else {
                    lastResult = Failed("Tool call did not return a valid result.");
                }

                const resultString = truncate(stringify(lastResult), 120);

                if (lastResult.status === "success") {
                    this.logger.success(`✔ 成功 ← 返回: ${resultString}`);
                    return lastResult;
                }
                if (lastResult.error) {
                    this.logger.warn(`✖ 失败 (不可重试) ← 原因: ${stringify(lastResult.error)}`);
                    return lastResult;
                }
            } catch (error: any) {
                this.logger.error(`💥 异常 | 调用 ${funcName} 时出错`, error.message);
                this.logger.debug(error.stack);
                lastResult = Failed(`Exception: ${error.message}`);
                return lastResult;
            }
        }
        this.logger.error(`✖ 失败 (耗尽重试) | 工具: ${funcName}`);
        return lastResult;
    }

    public async getFunction(name: string, context?: FunctionContext): Promise<Definition | undefined> {
        const func = this.findFuncByName(name);
        if (!func)
            return undefined;
        if (!context) {
            return func;
        }

        const result = await this.isFuncAvailable(func, context);
        if (!result.available) {
            if (result.reason) {
                this.logger.debug(`工具不可用 | 名称: ${func.name} | 原因: ${result.reason.join("; ")}`);
            }
            return undefined;
        }

        return func;
    }

    private findFuncByName(name: string): Definition | undefined {
        for (const plugin of this.plugins.values()) {
            const tool = plugin.getTools().get(name);
            if (tool) {
                return tool;
            }
            const action = plugin.getActions().get(name);
            if (action) {
                return action;
            }
        }
        return undefined;
    }

    private getConfigByFunc(def: Definition): any {
        let plugin: Plugin | undefined;
        for (const p of this.plugins.values()) {
            const tool = p.getTools().get(def.name);
            if (tool) {
                plugin = p;
                break;
            }
            const action = p.getActions().get(def.name);
            if (action) {
                plugin = p;
                break;
            }
        }
        if (!plugin) {
            return null;
        }
        return this.getConfig(plugin.metadata.name);
    }

    private getAllFuncs(): Definition[] {
        const result: Definition[] = [];
        for (const plugin of this.plugins.values()) {
            result.push(...plugin.getTools().values());
            result.push(...plugin.getActions().values());
        }
        return result;
    }

    public getConfig(name: string): any {
        const ext = this.plugins.get(name);
        if (!ext)
            return null;
        return ext.config;
    }

    public async filterAvailableFuncs(context: FunctionContext): Promise<Definition[]> {
        const allFunc = this.getAllFuncs();
        const availableFuncs: Definition[] = [];

        for (const func of allFunc) {
            const result = await this.isFuncAvailable(func, context);
            if (result.available) {
                availableFuncs.push(func);
            }
        }

        return availableFuncs;
    }

    /* prettier-ignore */
    private async isFuncAvailable(def: Definition, context: FunctionContext): Promise<{ available: boolean; reason?: string[] }> {
        const config = this.getConfigByFunc(def);
        const reason: string[] = [];

        if (def.support) {
            try {
                const guardContext = { context, config };
                const result = def.support(guardContext);
                if (!result.ok) {
                    return { available: false, reason: [result.reason || "不支持此工具"] };
                }
            }
            catch (error: any) {
                this.logger.warn(`工具支持检查失败 | 工具: ${def.name} | 错误: ${error.message ?? error}`);
                return { available: false, reason: ["支持检查失败"] };
            }
        }

        if (def.activators) {
            for (const activator of def.activators) {
                try {
                    const activatorContext: GuardContext = { context, config };
                    const result = await activator(activatorContext);
                    if (!result.allow) {
                        if (result.reason?.length) {
                            reason.push(...result.reason);
                        }
                        return { available: false, reason };
                    }
                }
                catch (error: any) {
                    this.logger.warn(`工具激活器执行失败 | 工具: ${def.name} | 错误: ${error.message ?? error}`);
                    return { available: false, reason };
                }
            }
        }

        return { available: true, reason };
    }

    public async getTools(context?: FunctionContext): Promise<Tool[]> {
        const tools: Tool[] = [];
        for (const plugin of this.plugins.values()) {
            for (const toolDef of plugin.getFunctions().values()) {
                if (context) {
                    const result = await this.isFuncAvailable(toolDef, context);
                    if (!result.available) {
                        continue;
                    }
                }
                tools.push({
                    type: "function",
                    function: {
                        name: toolDef.name,
                        description: toolDef.description,
                        parameters: schemaToJSONSchema(toolDef.parameters) || {},
                    },
                    execute: async (input: Record<string, unknown>, options) => {
                        const result = await this.invoke(toolDef.name, input, context);
                        return result;
                    },
                });
            }
        }
        return tools;
    }
}
