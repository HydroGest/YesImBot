import { randomUUID } from "node:crypto";

import { Context, Logger, Schema, type Command, type Session } from "koishi";
import type { ChannelContext, WillEngine, WillPlugin } from "koishi-plugin-yesimbot";

import { resolvePolicy } from "./policy.js";
import { PolicyRoutingEngine } from "./routing.js";
import type { PolicyWillingnessChannelOverride, PolicyWillingnessConfig, WillPolicyConfig } from "./types.js";
import { PolicyWillingnessEngine } from "./willingness.js";

export const WillPolicyConfigSchema: Schema<WillPolicyConfig> = Schema.intersect([
  Schema.object({
    engine: Schema.union([Schema.const("routing").description("固定规则（routing）"), Schema.const("willingness").description("意愿值引擎(willingness)")])
      .default("routing")
      .description("该克隆实例使用的引擎；routing 适合稳定规则，willingness 适合动态活跃度"),
    priority: Schema.number().default(1000).description("WillEngine 优先级，数值小者先执行"),
  }),
  Schema.union([
    Schema.object({
      engine: Schema.const("routing"),
      routing: Schema.object({
        direct: Schema.union(["wait", "trigger"]).default("trigger").description("私聊消息"),
        mention: Schema.union(["wait", "trigger"]).default("trigger").description("@ 机器人"),
        mentionAll: Schema.union(["wait", "trigger"]).default("wait").description("@全体成员"),
        mentionHere: Schema.union(["wait", "trigger"]).default("wait").description("@在线成员"),
        quote: Schema.union(["wait", "trigger"]).default("wait").description("引用/回复消息"),
        image: Schema.union(["wait", "trigger"]).default("wait").description("含图片的消息"),
        poke: Schema.union(["wait", "trigger"]).default("wait").description("拍一拍事件"),
        group: Schema.union(["wait", "trigger"]).default("wait").description("普通群消息"),
      })
        .required()
        .description("固定规则引擎配置；仅在 engine 为 routing 时生效"),
    }),
    Schema.object({
      engine: Schema.const("willingness"),
      willingness: Schema.object({
        maxScore: Schema.number().default(100).description("意愿值上限"),
        initialScore: Schema.number().default(0).description("初始意愿值"),
        decayHalfLifeSeconds: Schema.number().default(600).description("意愿值半衰期(秒)"),
        probabilityThreshold: Schema.number().default(55).description("触发概率阈值"),
        probabilityAmplifier: Schema.number().default(0.04).description("超过阈值后的概率放大系数"),
        replyCost: Schema.number().default(35).description("每次成功回复后扣除的意愿值"),
        textGain: Schema.number().default(12).description("普通消息基础增益"),
        mentionGain: Schema.number().default(100).description("被 @ 时的增益"),
        quoteGain: Schema.number().default(15).description("引用/回复时的增益"),
        directGain: Schema.number().default(40).description("私聊时的增益"),
        imageGain: Schema.number().default(8).description("含图片消息的增益"),
        pokeGain: Schema.number().default(80).description("拍一拍事件的增益"),
        keywords: Schema.array(Schema.string()).default([]).description("高兴趣关键词"),
        keywordMultiplier: Schema.number().default(1.2).description("命中关键词时的乘数"),
        defaultMultiplier: Schema.number().default(1).description("未命中关键词时的默认乘数"),
        hotWindowSeconds: Schema.number().default(15).description("热窗口秒数"),
        warmWindowSeconds: Schema.number().default(60).description("温窗口秒数"),
        hotDecayWeight: Schema.number().default(0.3).description("热窗口衰减权重"),
        warmDecayWeight: Schema.number().default(0.7).description("温窗口衰减权重"),
        mentionForce: Schema.boolean().default(false).description("被 @ 时强制触发"),
        quoteForce: Schema.boolean().default(false).description("引用时强制触发"),
        directForce: Schema.boolean().default(false).description("私聊强制触发"),
        channelOverrides: Schema.array(
          Schema.object({
            platform: Schema.string().default("*").description("平台；* 表示任意平台"),
            channelId: Schema.string().default("*").description("频道、群或私聊账号；* 表示任意"),
            isDirect: Schema.boolean().description("是否私聊；留空同时匹配群聊与私聊"),
            textGain: Schema.number().min(0).description("普通消息基础增益覆盖"),
            keywordMultiplier: Schema.number().min(0).description("命中关键词时的乘数覆盖"),
          }),
        )
          .role("table")
          .default([])
          .description("按顺序匹配的频道意愿值覆盖；第一条匹配规则生效"),
      })
        .required()
        .description("意愿值引擎配置；仅在 engine 为 willingness 时生效"),
    }),
  ]),
]);

const DEBUG_COMMAND_NAME = "yesimbot.will-policy";

const DEBUG_PROBES = new WeakMap<Context, Set<WillPolicyPlugin>>();

const DEBUG_COMMANDS = new WeakMap<Context, Command>();

const DEBUG_ACTION: unique symbol = Symbol("yesimbot.will-policy.debug-action");

type DebugCommand = Command & { [DEBUG_ACTION]?: boolean };

export default class WillPolicyPlugin implements WillPlugin {
  public static readonly name = "yesimbot-will-policy";
  public static readonly reusable = true;
  public static readonly inject = ["yesimbot"];
  public static readonly usage = "提供可克隆、可筛选、可组合的 WillEngine 与 routing 策略";
  public static readonly Config: Schema<WillPolicyConfig> = WillPolicyConfigSchema;

  public readonly ctx: Context;
  public readonly config: WillPolicyConfig;
  public readonly logger: Logger;
  public readonly priority: number;

  private readonly instanceId = randomUUID();
  private disposeWillPlugin?: () => void;

  public constructor(ctx: Context, config: WillPolicyConfig) {
    this.ctx = ctx;
    this.config = config;
    this.priority = config.priority ?? 1000;
    this.logger = ctx.logger("yesimbot.will-policy");
    this.logger.level = ctx.yesimbot.config.logLevel ?? 2;
    ctx.on("ready", this.start.bind(this));
    ctx.on("dispose", this.stop.bind(this));
  }

  public async start(): Promise<void> {
    this.disposeWillPlugin?.();
    this.disposeWillPlugin = this.ctx.yesimbot.agent.will(this);
    this.registerDebugProbe();
    this.logger.success("Will policy plugin started", { instanceId: this.instanceId });
  }

  public match(session: Session): boolean {
    const matched = this.ctx.filter(session);
    this.logger.debug("will_policy.match", {
      instanceId: this.instanceId,
      priority: this.priority,
      engine: this.config.engine,
      platform: session.platform,
      channelId: session.channelId,
      guildId: session.guildId,
      matched,
    });
    return matched;
  }

  public matchContext(context: ChannelContext): boolean {
    const bot =
      this.ctx.bots.find((candidate) => candidate.platform === context.platform && (!context.selfId || candidate.selfId === context.selfId)) ??
      this.ctx.bots[0];
    if (!bot) {
      this.logger.debug("will_policy.match_context", {
        instanceId: this.instanceId,
        priority: this.priority,
        engine: this.config.engine,
        platform: context.platform,
        channelId: context.channelId,
        guildId: context.type === "direct" ? undefined : context.guildId,
        matched: false,
        reason: "no_bot",
      });
      return false;
    }

    const isDirect = context.type === "direct";

    const session = bot.session({
      type: "message-created",
      subtype: isDirect ? "private" : "group",
      platform: context.platform,
      selfId: context.selfId,
      timestamp: Date.now(),
      channel: { id: context.channelId, type: isDirect ? 1 : 0 },
      ...(!isDirect && context.guildId ? { guild: { id: context.guildId } } : {}),
      ...(isDirect ? { user: { id: context.userId, ...(context.userName ? { name: context.userName } : {}) } } : {}),
    } as never) as Session;
    const matched = this.ctx.filter(session);
    this.logger.debug("will_policy.match_context", {
      instanceId: this.instanceId,
      priority: this.priority,
      engine: this.config.engine,
      platform: context.platform,
      channelId: context.channelId,
      guildId: isDirect ? undefined : context.guildId,
      matched,
    });
    return matched;
  }

  public setup(scope: ChannelContext): WillEngine {
    const resolved = resolvePolicy(this.config);
    this.logger.debug("resolve_will_policy", { engine: resolved.engine, routing: resolved.routing, willingness: resolved.willingness });
    if (resolved.engine === "routing") return new PolicyRoutingEngine(resolved.routing, this.logger);
    return new PolicyWillingnessEngine(resolveWillingnessForChannel(resolved.willingness, scope), this.logger);
  }

  public async stop(): Promise<void> {
    const root = this.ctx.root;
    const probes = DEBUG_PROBES.get(root);
    probes?.delete(this);
    if (probes?.size === 0) {
      DEBUG_COMMANDS.get(root)?.dispose();
      DEBUG_COMMANDS.delete(root);
      DEBUG_PROBES.delete(root);
    }
    this.disposeWillPlugin?.();
    this.disposeWillPlugin = undefined;
  }

  private registerDebugProbe(): void {
    const root = this.ctx.root;
    const probes = DEBUG_PROBES.get(root) ?? new Set<WillPolicyPlugin>();
    probes.add(this);
    DEBUG_PROBES.set(root, probes);

    let command = DEBUG_COMMANDS.get(root);
    if (!command) {
      command = root.command(DEBUG_COMMAND_NAME, "检查当前 WillEngine 策略实例", { authority: 4 });
      DEBUG_COMMANDS.set(root, command);
    }
    const debugCommand = command as DebugCommand;
    if (debugCommand[DEBUG_ACTION]) return;
    Object.defineProperty(debugCommand, DEBUG_ACTION, { value: true });
    debugCommand.action(async ({ session }) => {
      if (!session) return;
      const matches = [...probes].filter((probe) => probe.ctx.filter(session));
      if (matches.length === 0) return;
      return matches.map((probe) => probe.instanceDescription()).join("\n");
    });
  }

  private instanceDescription(): string {
    return [`WillPolicy[${this.instanceId.slice(0, 8)}]`, `engine=${this.config.engine}`, `priority=${this.priority}`].join(" ");
  }
}

export function resolveWillingnessForChannel(config: PolicyWillingnessConfig, context: ChannelContext): PolicyWillingnessConfig {
  const override = config.channelOverrides?.find((rule) => matchesChannelOverride(context, rule));
  if (!override) return config;
  return {
    ...config,
    ...(override.textGain === undefined ? {} : { textGain: override.textGain }),
    ...(override.keywordMultiplier === undefined ? {} : { keywordMultiplier: override.keywordMultiplier }),
  };
}

function matchesChannelOverride(context: ChannelContext, rule: PolicyWillingnessChannelOverride): boolean {
  if (rule.platform !== "*" && rule.platform !== context.platform) return false;
  const channelId = context.type === "direct" ? normalizeDirectChannelId(rule) : rule.channelId;
  if (channelId !== "*" && channelId !== context.channelId) return false;
  return rule.isDirect === undefined || rule.isDirect === (context.type === "direct");
}

function normalizeDirectChannelId(rule: PolicyWillingnessChannelOverride): string {
  if (rule.isDirect !== false && rule.channelId !== "*" && !rule.channelId.startsWith("private:")) return `private:${rule.channelId}`;
  return rule.channelId;
}
