import { randomUUID } from "node:crypto";

import { jsonSchema, type AgentPlugin, type AgentTool } from "@yesimbot/agent-runtime";
import { Context, Logger, Schema, type Bot, type Element } from "koishi";
import type { ChannelContext, ChannelResources } from "koishi-plugin-yesimbot";

import { collectCommandCatalog, filterCommandCatalog, formatCommandCatalog, formatCommandHelp } from "./catalog.js";
import { CommandExecution } from "./execution.js";
import { validateCommandCall } from "./policy.js";
import type {
  AbortCommandInput,
  AnswerPromptInput,
  CommandActor,
  CommandBridgeConfig,
  CommandExecutionEvent,
  CommandHelpInput,
  ExecuteCommandInput,
  ListCommandsInput,
} from "./types.js";

const COMMAND_TOOL_GUIDANCE =
  "koishi_execute 可以静默调用 Koishi 生态中的命令。命令输出只会返回给主模型，不会自动发送到群里；" +
  "是否转述、如何转述由主模型决定。先使用 koishi_execute_list 查看可用命令，" +
  "使用 koishi_execute_help 了解命令的参数和选项；" +
  "命令输出中的图片会渲染成 [图片：asset://<id>]，需要查看图片内容时调用 read 工具读取该 URI；" +
  "若命令返回 awaiting_prompt，请调用 koishi_prompt_answer 继续执行。";

export default class CommandBridgePlugin {
  public static name = "yesimbot-command-bridge";
  public static usage = "让主 LLM 调用 Koishi 生态命令并接管输入输出";
  public static inject = ["yesimbot"];

  public static Config: Schema<CommandBridgeConfig> = Schema.object({
    trustMode: Schema.union(["locked", "full"]).default("locked").description("locked 仅允许 allowCommands，full 允许全部命令"),
    allowCommands: Schema.array(Schema.string()).default([]).role("table").description("locked 模式下允许执行的命令"),
    hardDeny: Schema.array(Schema.string())
      .default(["yesimbot", "koishi_execute", "koishi_execute_abort", "koishi_prompt_answer"])
      .role("table")
      .description("始终禁止的命令前缀"),
    agentAuthority: Schema.number().default(0).description("agent 身份 authority，full 模式下为 0 时默认使用 4"),
    agentPermissions: Schema.array(Schema.string()).default([]).role("table").description("locked 模式下 agent 身份额外拥有的权限"),
    userActor: Schema.union(["disabled", "any"]).default("disabled").description("是否允许以用户身份代执行命令"),
    crossChannel: Schema.boolean().default(false).description("是否允许指定非当前频道执行"),
    timeoutMs: Schema.number().default(30_000).description("单次命令执行超时"),
    maxTranscriptChars: Schema.number().default(20_000).description("返回给模型的最大输出字符数"),
  });

  private readonly executions = new Map<string, CommandExecution>();
  public readonly logger: Logger;
  private disposeAgentPlugin?: () => void;
  private commandEventDisposers: Array<() => unknown> = [];

  public constructor(
    private readonly ctx: Context,
    private readonly config: CommandBridgeConfig,
  ) {
    this.logger = this.ctx.logger("command-bridge");
    this.ctx.on("ready", this.start.bind(this));
    this.ctx.on("dispose", this.stop.bind(this));
  }

  public async start(): Promise<void> {
    this.disposeAgentPlugin?.();
    this.disposeAgentPlugin = this.ctx.yesimbot.agent.use(this);
    for (const dispose of this.commandEventDisposers.splice(0)) dispose?.();
    this.commandEventDisposers = [
      this.ctx.on("command-added", (command) => {
        this.logger.debug("command_bridge.command_added", { name: command.displayName });
      }),
      this.ctx.on("command-updated", (command) => {
        this.logger.debug("command_bridge.command_updated", { name: command.displayName });
      }),
      this.ctx.on("command-removed", (command) => {
        this.logger.debug("command_bridge.command_removed", { name: command.displayName });
      }),
    ];
    this.logger.info("command bridge plugin started");
  }

  public async setup(context: ChannelContext, bot: Bot): Promise<AgentPlugin> {
    const resources = await this.ctx.yesimbot.resource.get(context);
    const tools = this.createTools(context, bot, resources);
    this.logger.debug("command_bridge.tools_ready", { channelId: context.channelId, toolCount: tools.length, toolNames: tools.map((tool) => tool.name) });
    return { name: "command-bridge", tools: (): AgentTool[] => tools, appendSystemPrompt: () => COMMAND_TOOL_GUIDANCE } satisfies AgentPlugin;
  }

  public async stop(): Promise<void> {
    this.disposeAgentPlugin?.();
    this.disposeAgentPlugin = undefined;
    for (const dispose of this.commandEventDisposers.splice(0)) dispose?.();
    for (const execution of this.executions.values()) {
      execution.abort(new Error("command bridge plugin stopped"));
    }
    this.executions.clear();
    this.logger.info("command bridge plugin stopped");
  }

  public createTools(context: ChannelContext, bot: Bot, resources: ChannelResources): AgentTool[] {
    return [
      {
        name: "koishi_execute_list",
        description: "列出当前策略下可用的 Koishi 命令",
        inputSchema: jsonSchema({
          type: "object",
          properties: { filter: { type: "string", description: "按名称或描述过滤的关键字" } },
          additionalProperties: false,
        }),
        execute: async (input: ListCommandsInput) => this.listCommands(input),
        toModelOutput: async (options) => ({ type: "text", value: String((options as { output: string }).output) }),
      },
      {
        name: "koishi_execute_help",
        description: "查看某个 Koishi 命令的详细帮助信息，包括参数、选项、示例和子命令。使用 koishi_execute 前先调用此工具了解参数格式。",
        inputSchema: jsonSchema({
          type: "object",
          properties: { command: { type: "string", description: "要查询的命令名称" } },
          required: ["command"],
          additionalProperties: false,
        }),
        execute: async (input: CommandHelpInput) => this.commandHelp(input),
        toModelOutput: async (options) => ({ type: "text", value: String((options as { output: string }).output) }),
      },
      {
        name: "koishi_execute",
        description: "静默执行一条 Koishi 命令，把输出返回给主模型；支持 ask 交互模式",
        inputSchema: jsonSchema({
          type: "object",
          properties: {
            command: { type: "string" },
            actor: {
              type: "object",
              properties: { kind: { type: "string", enum: ["agent", "user"] }, userId: { type: "string" } },
              required: ["kind"],
              additionalProperties: false,
            },
            interactive: { type: "string", enum: ["reject", "ask"] },
            channelId: { type: "string" },
            guildId: { type: "string" },
          },
          required: ["command"],
          additionalProperties: false,
        }),
        execute: async (input: ExecuteCommandInput) => this.executeCommand(context, bot, resources, input),
        toModelOutput: async (options) => formatToolOutput(options as { output: CommandExecutionEvent }),
      },
      {
        name: "koishi_prompt_answer",
        description: "回答 koishi_execute 返回的 awaiting_prompt，并返回命令后续事件",
        inputSchema: jsonSchema({
          type: "object",
          properties: { executionId: { type: "string" }, answer: { type: "string" } },
          required: ["executionId", "answer"],
          additionalProperties: false,
        }),
        execute: async (input: AnswerPromptInput) => this.answerPrompt(input),
        toModelOutput: async (options) => formatToolOutput(options as { output: CommandExecutionEvent }),
      },
      {
        name: "koishi_execute_abort",
        description: "中止一个正在等待输入或超时的 Koishi 命令执行",
        inputSchema: jsonSchema({ type: "object", properties: { executionId: { type: "string" } }, required: ["executionId"], additionalProperties: false }),
        execute: async (input: AbortCommandInput) => this.abortCommand(input),
        toModelOutput: async (options) => formatToolOutput(options as { output: CommandExecutionEvent }),
      },
    ];
  }

  private async executeCommand(context: ChannelContext, bot: Bot, resources: ChannelResources, input: ExecuteCommandInput): Promise<CommandExecutionEvent> {
    const policyError = validateCommandCall(input.command, this.config);
    if (policyError) {
      this.logger.warn("command_bridge.execute.denied", { channelId: context.channelId, command: input.command, reason: policyError });
      throw new Error(policyError);
    }

    const actor = input.actor ?? { kind: "agent" as const };
    if (actor.kind === "user") {
      if (this.config.userActor === "disabled") throw new Error("user actor is disabled");
      if (!actor.userId) throw new Error("user actor requires userId");
    }

    if ((input.channelId || input.guildId) && !this.config.crossChannel) {
      throw new Error("cross-channel execution is disabled");
    }

    const authority = this.resolveAuthority(actor);
    const permissions = await this.resolvePermissions(actor);
    const executionId = randomUUID();
    const execution = new CommandExecution({
      id: executionId,
      command: input.command,
      bot,
      scope: context,
      actor,
      interactive: input.interactive ?? "reject",
      channelId: input.channelId,
      guildId: input.guildId,
      authority,
      permissions,
      timeoutMs: this.config.timeoutMs,
      maxTranscriptChars: this.config.maxTranscriptChars,
      logger: this.logger,
      persistElements: async (elements) => {
        const prepared = await resources.persistElements(this.ctx, elements);
        const assetIds = collectAssetIds(prepared);
        if (assetIds.length) {
          this.logger.debug("command_bridge.output.assets", { executionId, assetIds });
        }
        return prepared;
      },
    });

    this.logger.debug("command_bridge.execute.start", {
      executionId,
      channelId: context.channelId,
      command: input.command,
      actor: actor.kind,
      interactive: input.interactive ?? "reject",
    });
    this.executions.set(execution.id, execution);
    execution.start();
    const event = await execution.next();
    this.logger.debug("command_bridge.execute.event", { executionId, status: event.status, prompt: event.prompt !== undefined, error: event.error });
    this.scheduleCleanup(execution, event);
    return event;
  }

  private listCommands(_input: ListCommandsInput): string {
    const commander = (this.ctx as unknown as { $commander: { _commandList: readonly import("koishi").Command[] } }).$commander;
    const catalog = collectCommandCatalog(commander);
    const allowed = filterCommandCatalog(catalog, this.config);
    return formatCommandCatalog(allowed) || "(no commands available)";
  }

  private commandHelp(input: CommandHelpInput): string {
    const commander = (this.ctx as unknown as { $commander: { get(name: string): import("koishi").Command | undefined } }).$commander;
    const command = commander.get(input.command);
    if (!command) return `未找到命令: ${input.command}`;
    return formatCommandHelp(command);
  }

  private async answerPrompt(input: AnswerPromptInput): Promise<CommandExecutionEvent> {
    const execution = this.executions.get(input.executionId);
    if (!execution) throw new Error(`execution '${input.executionId}' not found or expired`);

    this.logger.debug("command_bridge.prompt_answer", { executionId: input.executionId });
    const event = await execution.answer(input.answer);
    this.scheduleCleanup(execution, event);
    return event;
  }

  private async abortCommand(input: AbortCommandInput): Promise<CommandExecutionEvent> {
    const execution = this.executions.get(input.executionId);
    if (!execution) throw new Error(`execution '${input.executionId}' not found or expired`);

    this.logger.debug("command_bridge.abort", { executionId: input.executionId });
    execution.abort();
    const event = await execution.next();
    this.scheduleCleanup(execution, event);
    return event;
  }

  private resolveAuthority(actor: CommandActor): number | undefined {
    if (this.config.trustMode === "full") {
      return this.config.agentAuthority > 0 ? this.config.agentAuthority : 4;
    }
    if (actor?.kind === "agent") return this.config.agentAuthority;
    return undefined;
  }

  private async resolvePermissions(actor: CommandActor): Promise<string[] | undefined> {
    if (this.config.trustMode === "full") {
      return this.collectAllPermissions();
    }
    if (actor?.kind === "agent") return [...this.config.agentPermissions];
    return undefined;
  }

  private async collectAllPermissions(): Promise<string[]> {
    try {
      return [...this.ctx.permissions.list()];
    } catch {
      this.logger.warn("failed to collect Koishi permissions, agent permissions fall back to empty");
      return [];
    }
  }

  private scheduleCleanup(execution: CommandExecution, event: CommandExecutionEvent): void {
    if (event.status !== "done") return;
    const timer = setTimeout(() => {
      if (this.executions.get(execution.id) === execution) this.executions.delete(execution.id);
    }, 60_000);
    timer.unref?.();
  }
}

async function formatToolOutput(options: { output: CommandExecutionEvent }): Promise<{ type: "text"; value: string }> {
  const event = options.output;
  const lines = [`状态: ${event.status}`, `执行ID: ${event.executionId}`];
  if (event.prompt) lines.push(`命令请求输入: ${event.prompt}`);
  if (event.transcript) lines.push(`命令输出:\n${event.transcript}`);
  if (event.returnValue) lines.push(`命令返回值:\n${event.returnValue}`);
  if (event.error) lines.push(`错误: ${event.error}`);
  return { type: "text", value: lines.join("\n") };
}

function collectAssetIds(elements: readonly Element[]): string[] {
  const ids: string[] = [];
  const visit = (element: Element): void => {
    if (element.type === "img" && typeof element.attrs.id === "string") ids.push(element.attrs.id);
    for (const child of element.children) visit(child);
  };
  for (const element of elements) visit(element);
  return ids;
}
