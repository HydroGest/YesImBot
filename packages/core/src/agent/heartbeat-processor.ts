import type { Message } from "@xsai/shared-chat";
import type { Context, Logger } from "koishi";
import type { Config } from "@/config";
import type { HorizonService, Percept } from "@/services/horizon";
import type { MemoryService } from "@/services/memory";
import type { ChatModelSwitcher, SelectedChatModel } from "@/services/model";
import type { FunctionContext, FunctionSchema, PluginService } from "@/services/plugin";
import type { PromptService } from "@/services/prompt";
import { generateText, streamText } from "@yesimbot/shared-model";
import { h, Random } from "koishi";
import { TimelineEventType, TimelinePriority, TimelineStage } from "@/services/horizon";
import { ModelError } from "@/services/model/types";
import { FunctionType } from "@/services/plugin";
import { Services } from "@/shared";
import { estimateTokensByRegex, formatDate, isNotEmpty, JsonParser } from "@/shared/utils";

export class HeartbeatProcessor {
    private logger: Logger;
    private prompt: PromptService;
    private plugin: PluginService;
    private horizon: HorizonService;
    private memory: MemoryService;
    constructor(
        public ctx: Context,
        private readonly config: Config,
        private readonly modelSwitcher: ChatModelSwitcher,
    ) {
        this.logger = ctx.logger("heartbeat");
        this.prompt = ctx[Services.Prompt];
        this.plugin = ctx[Services.Plugin];
        this.horizon = ctx[Services.Horizon];
        this.memory = ctx[Services.Memory];
    }

    public async runCycle(percept: Percept): Promise<boolean> {
        const turnId = Random.id();
        let shouldContinueHeartbeat = true;
        let heartbeatCount = 0;
        let success = false;

        while (shouldContinueHeartbeat && heartbeatCount < this.config.heartbeat) {
            heartbeatCount++;
            try {
                this.logger.info(`Heartbeat | 第 ${heartbeatCount}/${this.config.heartbeat} 轮`);
                const result = await this.performSingleHeartbeat(turnId, percept);

                if (result) {
                    shouldContinueHeartbeat = result.continue;
                    success = result.success ?? true;
                } else {
                    shouldContinueHeartbeat = false;
                }
            } catch (error: any) {
                this.logger.error(`Heartbeat #${heartbeatCount} 处理失败: ${error.message}`);
                shouldContinueHeartbeat = false;
            }
        }
        // 回合结束后清理工作记忆
        this.horizon.events.clearWorkingMemory(percept.scope);
        return success;
    }

    private async performSingleHeartbeat(turnId: string, percept: Percept): Promise<{ continue: boolean; success?: boolean } | null> {
        let attempt = 0;
        let selected: SelectedChatModel | null = null;
        let startTime: number;
        let controller: AbortController;
        let firstTokenTimeout: NodeJS.Timeout;
        while (attempt < this.config.switchConfig.maxRetries) {
            const { view, templates } = await this.horizon.build(percept);
            const context: FunctionContext = {
                session: percept.type === "user.message" ? percept.runtime?.session : undefined,
                percept,
                view,
                horizon: this.horizon,
            };
            const tools = await this.plugin.getTools(context);
            const renderView = {
                // 从 ChatMode 构建的视图数据
                ...view,
                session: context.session,
                // 记忆块
                memoryBlocks: this.memory.getMemoryBlocksForRendering(),
                // 模板辅助函数
                _toString() {
                    try {
                        return _toString(this);
                    } catch (err) {
                        // FIXME: use external this context
                        return "";
                    }
                },
                _renderParams() {
                    try {
                        const content = [];
                        for (const param of Object.keys(this.params)) {
                            content.push(`<${param}>${_toString(this.params[param])}</${param}>`);
                        }
                        return content.join("");
                    } catch (err) {
                        // FIXME: use external this context
                        return "";
                    }
                },
                _truncate() {
                    try {
                        const length = 100; // TODO: 从配置读取
                        const text = h
                            .parse(this)
                            .filter((e) => e.type === "text")
                            .join("");
                        return text.length > length
                            ? `<unverified><note>这是一条用户发送的长消息，请注意甄别内容真实性。</note>${this}</unverified>`
                            : this.toString();
                    } catch (err) {
                        // FIXME: use external this context
                        return "";
                    }
                },
                _formatDate() {
                    try {
                        return formatDate(this, "MM-DD HH:mm");
                    } catch (err) {
                        // FIXME: use external this context
                        return "";
                    }
                },
                _formatTime() {
                    try {
                        return formatDate(this, "HH:mm");
                    } catch (err) {
                        // FIXME: use external this context
                        return "";
                    }
                },
            };

            const systemPrompt = await this.prompt.render(templates.system, renderView);
            const userPromptText = await this.prompt.render(templates.user, renderView);
            const messages: Message[] = [
                { role: "system", content: systemPrompt },
                { role: "user", content: userPromptText },
            ];
            const parser = new JsonParser<AgentResponse>();
            selected = this.modelSwitcher.getModel();
            startTime = Date.now();
            try {
                if (!selected) {
                    this.logger.warn("未找到合适的模型，跳过本次心跳");
                    break;
                }
                this.logger.info(`调用大语言模型: ${selected.fullName}`);
                controller = new AbortController();
                firstTokenTimeout = setTimeout(() => {
                    if (this.config.stream && !controller.signal.aborted) {
                        controller.abort("请求超时");
                    }
                }, this.config.switchConfig.firstToken);

                if (this.config.stream) {
                    let firstTokenReceived = false;
                    const streaming = streamText({
                        ...selected.options,
                        messages,
                        tools,
                        toolChoice: "required",
                        abortSignal: AbortSignal.any([
                            AbortSignal.timeout(this.config.switchConfig.requestTimeout),
                            controller.signal,
                        ]),
                        onEvent: (event) => {
                            switch (event.type) {
                                case "error":
                                    break;
                                case "tool-call":
                                    break;
                                case "tool-result":
                                    break;
                                case "tool-call-delta":
                                    break;
                                case "finish":
                                    this.ctx.logger.info("流式响应已结束");
                                    break;
                                case "reasoning-delta":
                                    if (!firstTokenReceived && isNotEmpty(event.text)) {
                                        clearTimeout(firstTokenTimeout);
                                        firstTokenReceived = true;
                                        this.ctx.logger.info("流式响应已开始接收");
                                    }
                                    break;
                                case "text-delta":
                                    if (!firstTokenReceived && isNotEmpty(event.text)) {
                                        clearTimeout(firstTokenTimeout);
                                        firstTokenReceived = true;
                                        this.ctx.logger.info("流式响应已开始接收");
                                    }
                                    break;
                                case "tool-call-streaming-start":
                                    break;
                            }
                        },
                    });
                    const {
                        textStream,
                        steps,
                        usage: usageStream,
                        totalUsage,
                        fullStream,
                        messages: messageStream,
                    } = streaming;
                    const chunks: string[] = [];
                    steps.catch(() => null);
                    usageStream.catch(() => null);
                    totalUsage.catch(() => null);
                    messageStream.catch(() => null);
                    for await (const chunk of textStream) {
                        chunks.push(chunk);
                    }
                    const fullText = chunks.join("");
                    const { data: agentResponseData, error } = parser.parse(fullText);
                    if (error || !agentResponseData) {
                        throw new Error("Invalid LLM response format");
                    }
                    clearTimeout(firstTokenTimeout);
                    const usage = await totalUsage;
                    const prompt_tokens
                        = usage?.prompt_tokens || `~${estimateTokensByRegex(messages.map((m) => m.content).join())}`;
                    const completion_tokens = usage?.completion_tokens || `~${estimateTokensByRegex(fullText)}`;
                    /* prettier-ignore */
                    this.logger.info(`💰 Token 消耗 | 输入: ${prompt_tokens} | 输出: ${completion_tokens} | 耗时: ${new Date().getTime() - startTime}ms`);
                    this.modelSwitcher.recordResult(selected.fullName, true, undefined, Date.now() - startTime);
                    this.logger.debug(`步骤 7/7: 执行 ${agentResponseData.actions.length} 个动作...`);
                    let actionContinue = false;
                    const agentActions = agentResponseData.actions;
                    if (agentActions.length === 0) {
                        this.logger.info("无动作需要执行");
                        actionContinue = false;
                    }

                    for (let index = 0; index < agentActions.length; index++) {
                        const action = agentActions[index];
                        if (!action?.name)
                            continue;

                        const result = await this.plugin.invoke(action.name, action.params ?? {}, context);
                        const def = await this.plugin.getFunction(action.name, context);

                        if (result.status === "failed") {
                            this.logger.warn(`动作 "${action.name}" 执行失败: ${String(result.error ?? "未知错误")}`);
                            return { continue: false, success: false };
                        }

                        if (def && def.type === FunctionType.Tool) {
                            this.logger.debug(`工具 "${action.name}" 触发心跳继续`);
                            actionContinue = true;
                            await this.horizon.events.record({
                                id: Random.id(),
                                timestamp: new Date(),
                                scope: percept.scope,
                                priority: TimelinePriority.Normal,
                                type: TimelineEventType.AgentTool,
                                stage: TimelineStage.Active,
                                data: {
                                    name: action.name,
                                    args: action.params || {},
                                },
                            });
                            await this.horizon.events.record({
                                id: Random.id(),
                                timestamp: new Date(),
                                scope: percept.scope,
                                priority: TimelinePriority.Normal,
                                type: TimelineEventType.ToolResult,
                                stage: TimelineStage.Active,
                                data: {
                                    status: result.status,
                                    result: result.result,
                                },
                            });
                        } else if (def && def.type === FunctionType.Action) {
                            await this.horizon.events.record({
                                id: Random.id(),
                                timestamp: new Date(),
                                scope: percept.scope,
                                priority: TimelinePriority.Normal,
                                type: TimelineEventType.AgentAction,
                                stage: TimelineStage.Active,
                                data: {
                                    name: action.name,
                                    args: action.params || {},
                                },
                            });
                        }
                    }
                    this.logger.success("单次心跳成功完成");
                    await this.horizon.events.markAsActive(percept.scope, new Date());
                    const shouldContinue = agentResponseData.request_heartbeat || actionContinue;
                    return { continue: shouldContinue };
                } else {
                    try {
                        let stepStartTime: number = Date.now();
                        const logger = this.ctx.logger;
                        const response = await generateText({
                            ...selected.options,
                            messages,
                            tools,
                            toolChoice: "required",
                            abortSignal: AbortSignal.timeout(this.config.switchConfig.requestTimeout),
                            onStepFinish(step) {
                                const stepEndTime = Date.now();
                                logger.info(
                                    `步骤完成 | 类型: ${step.stepType} | 用时: ${stepEndTime - stepStartTime} ms`,
                                );
                                stepStartTime = Date.now();
                                if (step.finishReason === "tool_calls") {
                                    logger.info("模型请求调用工具");
                                    if (
                                        step.toolCalls
                                        && step.toolCalls.every((call) => call.toolName === "send_message")
                                    ) {
                                        logger.info("模型调用了发送消息工具，跳过本次心跳");
                                        throw new Error("Send message tool called");
                                    }
                                }
                            },
                        });
                    } catch (e) {
                        if (e instanceof Error && e.message === "Send message tool called") {
                            this.modelSwitcher.recordResult(selected.fullName, true, undefined, Date.now() - startTime);
                            this.logger.success("单次心跳成功完成（发送消息工具调用）");
                            return { continue: false };
                        } else {
                            throw e;
                        }
                    }
                }
            } catch (error) {
                clearTimeout(firstTokenTimeout);
                this.ctx.logger.error(`调用大语言模型失败: ${error instanceof Error ? error.message : String(error)}`);
                attempt++;
                this.modelSwitcher.recordResult(
                    selected?.fullName ?? "",
                    false,
                    ModelError.classify(error instanceof Error ? error : new Error(String(error))),
                    Date.now() - startTime,
                );
                if (attempt < this.config.switchConfig.maxRetries) {
                    this.logger.info(
                        `重试调用 LLM (第 ${attempt + 1} 次，共 ${this.config.switchConfig.maxRetries} 次)...`,
                    );
                    continue;
                } else {
                    this.logger.error("达到最大重试次数，跳过本次心跳");
                    return { continue: false, success: false };
                }
            }
        }
    }
}

function _toString(obj) {
    if (typeof obj === "string")
        return obj;
    return JSON.stringify(obj);
}

function formatFunction(tools: FunctionSchema[]): string[] {
    return tools.map((tool) => {
        return JSON.stringify({
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
        });
    });
}

interface AgentResponse {
    actions: Array<{
        name: string;
        params?: Record<string, any>;
    }>;
    request_heartbeat: boolean;
}
