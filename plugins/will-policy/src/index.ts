import { Context, Logger, Schema } from "koishi";
import type { WillEngineFactory } from "koishi-plugin-yesimbot";

import { resolvePolicy } from "./policy.js";
import { PolicyRoutingEngine } from "./routing.js";
import type { WillPolicyConfig } from "./types.js";
import { PolicyWillingnessEngine } from "./willingness.js";

export const WillPolicyConfigSchema: Schema<WillPolicyConfig> = Schema.object({
  engine: Schema.union([
    Schema.const("routing").description("固定规则（routing）"),
    Schema.const("willingness").description("意愿值引擎(willingness)"),
  ])
    .default("routing")
    .description("该克隆实例使用的引擎；routing 适合稳定规则，willingness 适合动态活跃度"),
  routing: Schema.object({
    direct: Schema.union(["wait", "trigger"]).default("trigger").description("私聊消息"),
    mention: Schema.union(["wait", "trigger"]).default("trigger").description("@ 机器人"),
    mentionAll: Schema.union(["wait", "trigger"]).default("wait").description("@全体成员"),
    mentionHere: Schema.union(["wait", "trigger"]).default("wait").description("@在线成员"),
    quote: Schema.union(["wait", "trigger"]).default("wait").description("引用/回复消息"),
    image: Schema.union(["wait", "trigger"]).default("wait").description("含图片的消息"),
    poke: Schema.union(["wait", "trigger"]).default("wait").description("拍一拍事件"),
    group: Schema.union(["wait", "trigger"]).default("wait").description("普通群消息"),
  }).description("固定规则引擎配置；仅在 engine 为 routing 时生效"),
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
  }).description("意愿值引擎配置；仅在 engine 为 willingness 时生效"),
  factoryPriority: Schema.number().default(1000).description("WillEngineFactory 优先级，数值小者先执行"),
}).description("Will 与 routing 精细化策略插件");

export default class WillPolicyPlugin {
  public static readonly name = "yesimbot-will-policy";
  public static readonly reusable = true;
  public static readonly inject = ["yesimbot"];
  public static readonly usage = "提供可克隆、可筛选、可组合的 Will 与 routing 策略";
  public static readonly Config: Schema<WillPolicyConfig> = WillPolicyConfigSchema;

  public readonly ctx: Context;
  public readonly config: WillPolicyConfig;
  public readonly logger: Logger;

  private disposeFactory?: () => void;

  public constructor(ctx: Context, config: WillPolicyConfig) {
    this.ctx = ctx;
    this.config = config;
    this.logger = ctx.logger("yesimbot.will-policy");
    ctx.on("ready", this.start.bind(this));
    ctx.on("dispose", this.stop.bind(this));
  }

  public async start(): Promise<void> {
    const factory: WillEngineFactory = {
      priority: this.config.factoryPriority,
      create: () => {
        const resolved = resolvePolicy(this.config);
        this.logger.debug("resolve_will_policy", {
          engine: resolved.engine,
          routing: resolved.routing,
          willingness: resolved.willingness,
        });
        return resolved.engine === "routing"
          ? new PolicyRoutingEngine(resolved.routing)
          : new PolicyWillingnessEngine(resolved.willingness);
      },
    };
    this.disposeFactory = this.ctx.yesimbot.registerWillEngineFactory(factory);
    this.logger.success("Will policy plugin started");
  }

  public async stop(): Promise<void> {
    this.disposeFactory?.();
    this.disposeFactory = undefined;
  }
}

export { PolicyRoutingEngine } from "./routing.js";
export { PolicyWillingnessEngine } from "./willingness.js";
export { resolvePolicy } from "./policy.js";
