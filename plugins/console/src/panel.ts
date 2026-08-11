import { readFile, readdir } from "node:fs/promises";
import { freemem, totalmem } from "node:os";
import { join } from "node:path";

import { DataService } from "@koishijs/console";
import {} from "@koishijs/loader";
import { Context } from "koishi";
import { type Event as YesImBotEvent } from "koishi-plugin-yesimbot";

const REFRESH_INTERVAL = 5_000;

const PLUGIN_LABELS: Record<string, string> = {
  yesimbot: "核心",
  "@yesimbot/provider-openai": "OpenAI",
  "@yesimbot/provider-anthropic": "Anthropic",
  "@yesimbot/provider-deepseek": "DeepSeek",
  "@yesimbot/provider-google": "Google",
  "yesimbot-command-bridge": "命令桥接",
  "yesimbot-console": "控制台",
  "yesimbot-chat-learning": "聊天学习",
  "yesimbot-global-brain": "全局脑",
  "yesimbot-mcp-client": "MCP 客户端",
  "yesimbot-memos-client": "MemOS 记忆",
  "yesimbot-onebot-utils": "OneBot 工具",
  "yesimbot-roleplay": "角色扮演",
  "yesimbot-schedule": "定时任务",
  "yesimbot-search-service": "搜索服务",
  "yesimbot-sticker-manager": "表情包",
  "yesimbot-usage": "用量统计",
  "yesimbot-will-policy": "Will 策略",
  "yesimbot-workspace": "工作区",
};

const PLUGIN_ORDER = [
  "yesimbot",
  "@yesimbot/provider-openai",
  "@yesimbot/provider-anthropic",
  "@yesimbot/provider-deepseek",
  "@yesimbot/provider-google",
  "yesimbot-workspace",
  "yesimbot-mcp-client",
  "yesimbot-search-service",
  "yesimbot-memos-client",
  "yesimbot-global-brain",
  "yesimbot-chat-learning",
  "yesimbot-schedule",
  "yesimbot-sticker-manager",
  "yesimbot-onebot-utils",
  "yesimbot-command-bridge",
  "yesimbot-roleplay",
  "yesimbot-will-policy",
  "yesimbot-usage",
  "yesimbot-console",
];

export interface PanelPayload {
  generatedAt: string;
  health: { online: boolean; botCount: number; botErrorCount: number; memory: { app: number; total: number }; uptimeSeconds: number };
  model: {
    chatModel: string | null;
    visionModel: string | null;
    defaultChat: string | null;
    defaultEmbedding: string | null;
    providers: string[];
    chatModels: number;
    embeddingModels: number;
    imageInput: boolean;
    imageBudget: { maxCount: number; maxBytesPerImage: number; maxTotalBytes: number } | null;
    describeImage: boolean;
  };
  config: { basePath: string; allowedChannels: number; idleTimeoutSeconds: number; configPath: string };
  plugins: PanelPlugin[];
  adapters: PanelAdapter[];
  onboarding: PanelOnboarding;
  recent: PanelRecent[];
  attention: PanelIssue[];
}

export interface PanelPlugin {
  key: string;
  label: string;
  enabled: boolean;
  status: "enabled" | "disabled" | "attention";
  detail: string;
  configPath: string;
}

export interface PanelAdapter {
  key: string;
  name: string;
  platform: string;
  enabled: boolean;
  state: "disabled" | "unconfigured" | "configured" | "error" | "online";
  configPath: string;
  error?: string;
}

export interface PanelIssue {
  level: "error" | "warning";
  message: string;
}

export interface PanelRecent {
  timestamp: string;
  level: "error";
  type: string;
  message: string;
  channel: string;
}

export interface PanelOnboardingStep {
  id: "adapter" | "model" | "channels";
  title: string;
  description: string;
  target: string;
  done: boolean;
}

export interface PanelOnboarding {
  complete: boolean;
  steps: PanelOnboardingStep[];
}

export interface YesImBotPackageMeta {
  packageName: string;
  configKey: string;
  label?: string;
  kind?: string;
  providerId?: string;
}

declare module "@koishijs/console" {
  namespace Console {
    interface Services {
      yesimbotPanel: PanelProvider;
    }
  }
}

export class PanelProvider extends DataService<PanelPayload> {
  public static readonly inject = ["console", "yesimbot", "loader"];

  private timer: (() => void) | undefined;
  private refreshSoon: (() => void) | undefined;
  private packageRegistryPromise: Promise<Map<string, YesImBotPackageMeta>> | undefined;
  private recent: PanelRecent[] = [];

  public constructor(public readonly ctx: Context) {
    super(ctx, "yesimbotPanel");

    this.refreshSoon = ctx.debounce(() => this.refresh(), 500);
    ctx.on("yesimbot/event", (event) => this.recordEvent(event));
    ctx.on("ready", () => {
      this.refresh();
      this.timer = ctx.setInterval(() => this.refresh(), REFRESH_INTERVAL);
    });
    ctx.on("dispose", () => {
      this.timer?.();
      this.timer = undefined;
    });
  }

  public async get(): Promise<PanelPayload> {
    const registry = await this.getPackageRegistry();
    return buildPanelPayload(this.ctx, registry, this.recent);
  }

  private getPackageRegistry(): Promise<Map<string, YesImBotPackageMeta>> {
    this.packageRegistryPromise ??= loadYesImBotPackageRegistry(this.ctx);
    return this.packageRegistryPromise;
  }

  private recordEvent(event: YesImBotEvent): void {
    const data = event.data as {
      eventType?: string;
      platform?: string;
      channel?: { id?: string };
      delivery?: { error?: { message?: string } };
    };
    if (data.eventType !== "delivery.failed") return;
    this.recent.unshift({
      timestamp: new Date().toISOString(),
      level: "error",
      type: data.eventType,
      message: data.delivery?.error?.message ?? "消息投递失败",
      channel: `${data.platform ?? ""}:${data.channel?.id ?? ""}`,
    });
    this.recent = this.recent.slice(0, 30);
    this.refreshSoon?.();
  }
}

function buildPanelPayload(
  ctx: Context,
  registry: Map<string, YesImBotPackageMeta>,
  recent: PanelRecent[],
): PanelPayload {
  const issues: PanelIssue[] = [];
  const plugins = collectPlugins(ctx, registry);
  const coreConfig = readCoreConfig(ctx);
  const model = readModelState(ctx, coreConfig, issues);
  const adapters = collectAdapters(ctx);
  const onboarding = buildOnboarding(ctx, coreConfig, model.providers.length > 0, adapters);
  const bots = Array.from(ctx.bots);
  const botErrorCount = bots.filter((bot) => Boolean(bot.error)).length;
  const total = totalmem();
  const free = freemem();
  const rss = process.memoryUsage().rss;

  if (coreConfig.allowedChannels === 0) {
    issues.push({ level: "warning", message: "allowedChannels 为空，外部消息不会进入 Agent" });
  }
  if (botErrorCount > 0) {
    issues.push({ level: "warning", message: `${botErrorCount} 个 Bot 实例报错` });
  }
  for (const plugin of plugins) {
    if (plugin.status === "attention") issues.push({ level: "warning", message: plugin.detail });
  }

  return {
    generatedAt: new Date().toISOString(),
    health: {
      online: true,
      botCount: bots.length,
      botErrorCount,
      memory: { app: rss / total, total: 1 - free / total },
      uptimeSeconds: Math.floor(process.uptime()),
    },
    model,
    config: coreConfig,
    plugins,
    adapters,
    onboarding,
    recent,
    attention: issues,
  };
}

function buildOnboarding(
  ctx: Context,
  coreConfig: ReturnType<typeof readCoreConfig>,
  hasProvider: boolean,
  adapters: PanelAdapter[],
): PanelOnboarding {
  const adapterDone = adapters.some((adapter) => adapter.state === "online");
  const enabledAdapter = adapters.find((adapter) => adapter.enabled);
  const adapterTarget = enabledAdapter?.configPath ?? "/plugins/group:adapter";
  const adapterDescription = adapterDone
    ? "平台适配器已在线。"
    : !adapters.length
      ? "在下方选择或到插件市场安装一个适配器。"
      : !adapters.some((adapter) => adapter.enabled)
        ? "启用下方已安装的适配器。"
        : "配置连接并等待 Bot 在线。";
  const steps: PanelOnboardingStep[] = [
    {
      id: "adapter",
      title: "安装并启用平台适配器",
      description: adapterDescription,
      target: adapterTarget,
      done: adapterDone,
    },
    {
      id: "model",
      title: "配置模型 Provider 与 Chat 模型",
      description: "启用模型服务并指定默认 chatModel。",
      target: hasProvider ? coreConfig.configPath : "/plugins/group:provider",
      done: hasProvider && Boolean(coreConfig.chatModel),
    },
    {
      id: "channels",
      title: "设置允许的频道",
      description: "至少添加一条 allowedChannels 规则。",
      target: coreConfig.configPath,
      done: coreConfig.allowedChannels > 0,
    },
  ];
  return { complete: steps.every((step) => step.done), steps };
}

function collectAdapters(ctx: Context): PanelAdapter[] {
  const plugins = flattenPluginConfig(ctx.loader.config.plugins ?? {});
  const bots = Array.from(ctx.bots);
  return Object.entries(plugins)
    .filter(([key]) => normalizePluginKey(key).startsWith("adapter-"))
    .map(([rawKey, value]) => {
      const enabled = !rawKey.startsWith("~");
      const raw = rawKey.replace(/^~/, "");
      const base = normalizePluginKey(raw);
      const config = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
      const platform = base.slice("adapter-".length);
      const selfId = typeof config.selfId === "string" ? config.selfId : "";
      const bot = selfId ? bots.find((candidate) => candidate.platform === platform && candidate.selfId === selfId) : undefined;
      let state: PanelAdapter["state"] = "disabled";
      if (enabled) {
        state = hasAdapterConnection(config) ? "configured" : "unconfigured";
        if (bot?.error) state = "error";
        else if (bot) state = "online";
      }
      return {
        key: raw,
        name: ADAPTER_NAMES[platform] ?? platform,
        platform,
        enabled,
        state,
        configPath: instancePath(raw),
        error: bot?.error?.message,
      };
    })
    .sort((left, right) => Number(right.enabled) - Number(left.enabled) || left.name.localeCompare(right.name));
}

const ADAPTER_NAMES: Record<string, string> = {
  onebot: "OneBot",
  discord: "Discord",
  kook: "KOOK",
  lark: "飞书",
  line: "Line",
  mail: "邮件",
  matrix: "Matrix",
  qq: "QQ",
  satori: "Satori",
  slack: "Slack",
  telegram: "Telegram",
  wecom: "企业微信",
  "wechat-official": "微信公众号",
  whatsapp: "WhatsApp",
  zulip: "Zulip",
  dingtalk: "钉钉",
};

function hasAdapterConnection(config: Record<string, unknown>): boolean {
  return ["selfId", "token", "endpoint", "appId", "appSecret", "botToken", "secret"].some((key) => typeof config[key] === "string" && Boolean(config[key]));
}

function readCoreConfig(
  ctx: Context,
): PanelPayload["config"] & { chatModel: string | null; visionModel: string | null; imageInput: boolean; imageBudget: PanelPayload["model"]["imageBudget"] } {
  const plugins = flattenPluginConfig(ctx.loader.config.plugins ?? {});
  const coreEntry = Object.entries(plugins).find(([key]) => normalizePluginKey(key) === "yesimbot");
  const coreConfigKey = coreEntry?.[0] ? coreEntry[0].replace(/^~/, "") : "yesimbot";
  const raw = coreEntry?.[1] as Record<string, unknown> | undefined;
  const chatModel = typeof raw?.chatModel === "string" ? raw.chatModel : null;
  const visionModel = typeof raw?.visionModel === "string" ? raw.visionModel : null;
  const imageInput = raw?.imageInput !== false;
  const imageBudget = readImageBudget(raw?.imageInput, imageInput);
  const allowedChannels = Array.isArray(raw?.allowedChannels) ? raw.allowedChannels.length : 0;
  const basePath = typeof raw?.basePath === "string" ? raw.basePath : "data/yesimbot";
  const idleTimeout = (raw as { session?: { idle?: { timeout?: unknown } } } | undefined)?.session?.idle?.timeout;

  return {
    chatModel,
    visionModel,
    imageInput,
    imageBudget,
    basePath,
    allowedChannels,
    configPath: instancePath(coreConfigKey),
    idleTimeoutSeconds: typeof idleTimeout === "number" ? Math.floor(idleTimeout / 1000) : 7_200,
  };
}

function readModelState(ctx: Context, config: ReturnType<typeof readCoreConfig>, issues: PanelIssue[]): PanelPayload["model"] {
  const model = ctx.yesimbot.model;
  const providers = model.listProviders();
  const chatModels = model.listChatModels().length;
  const embeddingModels = model.listEmbeddingModels().length;
  const defaultChat = model.getDefaultChatModelId() ?? null;
  const defaultEmbedding = model.getDefaultEmbeddingModelId() ?? null;

  if (!config.chatModel) {
    issues.push({ level: "error", message: "未配置 chatModel" });
  } else {
    try {
      model.resolveChatModel(config.chatModel);
    } catch (cause) {
      issues.push({ level: "error", message: `chatModel 解析失败：${messageOf(cause)}` });
    }
  }
  if (config.visionModel) {
    try {
      model.resolveChatModel(config.visionModel);
    } catch (cause) {
      issues.push({ level: "warning", message: `visionModel 解析失败：${messageOf(cause)}` });
    }
  }
  if (!providers.length) {
    issues.push({ level: "warning", message: "没有已注册的模型 provider" });
  }

  return {
    chatModel: config.chatModel,
    visionModel: config.visionModel,
    defaultChat,
    defaultEmbedding,
    providers,
    chatModels,
    embeddingModels,
    imageInput: config.imageInput,
    imageBudget: config.imageBudget,
    describeImage: Boolean(config.visionModel),
  };
}

function collectPlugins(ctx: Context, registry: Map<string, YesImBotPackageMeta>): PanelPlugin[] {
  const plugins = flattenPluginConfig(ctx.loader.config.plugins ?? {});
  const result = Object.entries(plugins)
    .filter(([key]) => {
      const base = normalizePluginKey(key);
      const legacy = base === "yesimbot" || (base.startsWith("yesimbot-") && base !== "yesimbot-world") || base.startsWith("@yesimbot/");
      return registry.has(base) || legacy;
    })
    .map(([rawKey, value]) => toPanelPlugin(rawKey, value, ctx, registry.get(normalizePluginKey(rawKey))));

  const order = new Map(PLUGIN_ORDER.map((key, index) => [key, index]));
  return result.sort((left, right) => {
    const leftOrder = order.get(left.key) ?? Number.MAX_SAFE_INTEGER;
    const rightOrder = order.get(right.key) ?? Number.MAX_SAFE_INTEGER;
    return leftOrder - rightOrder || left.key.localeCompare(right.key);
  });
}

function toPanelPlugin(rawKey: string, _value: unknown, ctx: Context, meta?: YesImBotPackageMeta): PanelPlugin {
  const enabled = !rawKey.startsWith("~");
  const raw = enabled ? rawKey : rawKey.slice(1);
  const key = normalizePluginKey(raw);
  const value = _value && typeof _value === "object" ? (_value as Record<string, unknown>) : {};
  const label = meta?.label ?? (typeof value["$label"] === "string" ? value["$label"] : (PLUGIN_LABELS[key] ?? key));
  let status: PanelPlugin["status"] = enabled ? "enabled" : "disabled";
  let detail = enabled ? "已启用" : "未启用";

  if (key === "yesimbot") {
    detail = "核心服务";
  } else if (key.startsWith("@yesimbot/provider-")) {
    const packageId = key.slice("@yesimbot/provider-".length);
    const providerId = meta?.providerId ?? (typeof value["id"] === "string" ? value["id"] : packageId);
    if (!enabled) {
      status = "disabled";
    } else if (!ctx.yesimbot.model.listProviders().includes(providerId)) {
      status = "attention";
      detail = `已启用但 provider 未注册：${providerId}`;
    } else {
      detail = `已注册：${providerId}`;
    }
  }

  return { key, label, enabled, status, detail, configPath: instancePath(raw) };
}

function instancePath(key: string): string {
  const raw = key.replace(/^~/, "");
  const index = raw.indexOf(":");
  return index < 0 ? raw : raw.slice(index + 1);
}

function normalizePluginKey(key: string): string {
  const bare = key.startsWith("~") ? key.slice(1) : key;
  const instanceIndex = bare.indexOf(":");
  return instanceIndex < 0 ? bare : bare.slice(0, instanceIndex);
}

async function loadYesImBotPackageRegistry(ctx: Context): Promise<Map<string, YesImBotPackageMeta>> {
  const result = new Map<string, YesImBotPackageMeta>();
  const nodeModules = join(ctx.loader.baseDir || ctx.baseDir, "node_modules");
  const entries = await readdir(nodeModules, { withFileTypes: true }).catch(() => []);

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const packagePaths = entry.name.startsWith("@") ? await scopedPackagePaths(nodeModules, entry.name) : [join(nodeModules, entry.name, "package.json")];
    for (const packagePath of packagePaths) {
      const meta = await readYesImBotPackageMeta(packagePath);
      if (meta) result.set(meta.configKey, meta);
    }
  }
  return result;
}

async function scopedPackagePaths(nodeModules: string, scope: string): Promise<string[]> {
  const scopeDir = join(nodeModules, scope);
  const entries = await readdir(scopeDir, { withFileTypes: true }).catch(() => []);
  return entries.filter((entry) => entry.isDirectory()).map((entry) => join(scopeDir, entry.name, "package.json"));
}

async function readYesImBotPackageMeta(packagePath: string): Promise<YesImBotPackageMeta | undefined> {
  let content: string;
  try {
    content = await readFile(packagePath, "utf8");
  } catch {
    return undefined;
  }
  let raw: { name?: unknown; koishi?: { yesimbot?: Partial<YesImBotPackageMeta> | boolean } };
  try {
    raw = JSON.parse(content) as typeof raw;
  } catch {
    return undefined;
  }
  const marker = raw.koishi?.yesimbot;
  if (!marker || typeof raw.name !== "string") return undefined;
  const meta = typeof marker === "object" ? marker : {};
  return {
    packageName: raw.name,
    configKey: meta.configKey ?? configKeyFromPackageName(raw.name),
    label: meta.label,
    kind: meta.kind,
    providerId: meta.providerId,
  };
}

function configKeyFromPackageName(name: string): string {
  if (name.startsWith("@")) {
    const slash = name.indexOf("/");
    if (slash >= 0 && name.slice(slash + 1).startsWith("koishi-plugin-")) {
      return `${name.slice(0, slash + 1)}${name.slice(slash + 1 + "koishi-plugin-".length)}`;
    }
    return name;
  }
  if (name.startsWith("koishi-plugin-")) return name.slice("koishi-plugin-".length);
  return name;
}

function flattenPluginConfig(plugins: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(plugins)) {
    if (key.startsWith("group:")) {
      if (!value || typeof value !== "object") continue;
      for (const [childKey, childValue] of Object.entries(value as Record<string, unknown>)) {
        if (childKey === "$collapsed" || childKey === "$label") continue;
        result[childKey] = childValue;
      }
      continue;
    }
    result[key] = value;
  }
  return result;
}

function readImageBudget(value: unknown, enabled: boolean): PanelPayload["model"]["imageBudget"] {
  if (!enabled) return null;
  if (!value || typeof value !== "object") {
    return { maxCount: 3, maxBytesPerImage: 5 * 1024 * 1024, maxTotalBytes: 10 * 1024 * 1024 };
  }
  const config = value as { maxCount?: unknown; maxBytesPerImage?: unknown; maxTotalBytes?: unknown };
  return {
    maxCount: typeof config.maxCount === "number" ? config.maxCount : 3,
    maxBytesPerImage: typeof config.maxBytesPerImage === "number" ? config.maxBytesPerImage : 5 * 1024 * 1024,
    maxTotalBytes: typeof config.maxTotalBytes === "number" ? config.maxTotalBytes : 10 * 1024 * 1024,
  };
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
