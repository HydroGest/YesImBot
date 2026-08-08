import { join, resolve } from "node:path";

import type { EmbeddingModel, LanguageModel } from "ai";
import { Context, Logger, Schema } from "koishi";

import { readModelsConfig } from "./config.js";

export const CHAT_MODEL_MODALITIES = ["text", "audio", "image", "video", "pdf"] as const;

export type ModelId = `${string}:${string}`;
export type ChatModelModality = (typeof CHAT_MODEL_MODALITIES)[number];
export interface ChatModelConfig {
  id: string;
  name?: string;
  hidden?: boolean;
  toolCall?: boolean;
  reasoning?: boolean;
  limit?: { context: number; output: number };
  modalities?: { input?: ChatModelModality[]; output?: ChatModelModality[] };
  variants?: Record<string, unknown>;
}
export interface EmbeddingModelConfig {
  id: string;
  name?: string;
  hidden?: boolean;
  dimension?: number;
}
export interface ChatModelRef {
  fullId: ModelId;
  providerId: string;
  modelId: string;
  entry: ChatModelConfig;
  model: LanguageModel;
}
export interface BaseProviderConfig {
  id: string;
  apiKey: string;
  baseURL?: string;
  chatModels: ChatModelConfig[];
  embeddingModels?: EmbeddingModelConfig[];
}

function isChatModelModality(value: string): value is ChatModelModality {
  return CHAT_MODEL_MODALITIES.some((modality) => modality === value);
}
function parseModelId(fullId: string): { provider: string; model: string } | null {
  const idx = fullId.indexOf(":");
  return idx <= 0 ? null : { provider: fullId.slice(0, idx), model: fullId.slice(idx + 1) };
}
function formatModelId(providerId: string, modelId: string): ModelId {
  return `${providerId}:${modelId}`;
}

export interface ModelServiceConfig {
  basePath: string;
  logLevel?: number;
}

type JsonObject = Record<string, unknown>;

interface ChatModelOverride extends Partial<Omit<ChatModelConfig, "id">> {
  name?: string;
  toolCall?: boolean;
  reasoning?: boolean;
  hidden?: boolean;
}

interface EmbeddingModelOverride extends Partial<Omit<EmbeddingModelConfig, "id">> {
  name?: string;
  hidden?: boolean;
}

interface ModelsConfigData {
  defaults: {
    chat?: string;
    embedding?: string;
  };
  aliases: Record<string, string>;
  chat: Record<string, ChatModelOverride>;
  embedding: Record<string, EmbeddingModelOverride>;
}

interface ModelsConfigLoadResult {
  config: ModelsConfigData;
  warnings: string[];
}

interface Provider {
  readonly id: string;
  readonly capabilities: { chat: boolean; embedding: boolean };
  chatModels(): ChatModelConfig[];
  embeddingModels(): EmbeddingModelConfig[];
  chat?(modelId: string): LanguageModel;
  embedding?(modelId: string): EmbeddingModel;
}

interface ChatModelRecord {
  fullId: ModelId;
  providerId: string;
  modelId: string;
  config: ChatModelConfig;
}

interface EmbeddingModelRecord {
  fullId: ModelId;
  providerId: string;
  modelId: string;
  config: EmbeddingModelConfig;
}

export class ModelService {
  private readonly ctx: Context;
  private readonly config: ModelServiceConfig;

  private providers = new Map<string, Provider>();
  private chatModels = new Map<string, ChatModelRecord>();
  private embeddingModels = new Map<string, EmbeddingModelRecord>();
  private aliases = new Map<string, ModelId>();
  private modelsConfig = createEmptyModelsConfig();
  private defaults: {
    chat?: ModelId;
    embedding?: ModelId;
  } = {};
  private readonly logger: Logger;

  constructor(ctx: Context, config: ModelServiceConfig) {
    this.ctx = ctx;
    this.config = config;
    this.logger = ctx.logger("yesimbot.model");
    this.logger.level = config.logLevel ?? 2;

    this.ctx.on("ready", this.start.bind(this));
    this.ctx.on("dispose", this.stop.bind(this));
  }

  private getModelsConfigPath(): string {
    return join(resolve(this.ctx.baseDir, this.config.basePath || this.ctx.baseDir), "models.json");
  }

  private async start(): Promise<void> {
    const { config: modelsConfig, warnings } = await loadModelsConfig(this.getModelsConfigPath());
    this.modelsConfig = modelsConfig;
    for (const warning of warnings) {
      this.logger.warn(warning);
    }
    this.refreshModels();
  }

  private async stop(): Promise<void> {}

  private refreshSchemas(): void {
    const options: Schema<string>[] = [];
    for (const model of this.chatModels.values()) {
      if (isHiddenModel(model.config)) {
        continue;
      }
      const fullId = model.fullId;
      options.push(Schema.const(fullId).description(fullId) as Schema<string>);
    }
    options.push(Schema.string().description("Custom model (provider:model)"));
    this.ctx.schema.set("registry.chatModels", Schema.union(options).default(""));
  }

  private refreshModels(): void {
    this.chatModels.clear();
    this.embeddingModels.clear();
    this.aliases.clear();
    this.defaults = {};

    for (const provider of this.providers.values()) {
      if (provider.capabilities.chat) {
        for (const config of provider.chatModels()) {
          const fullId = formatModelId(provider.id, config.id);
          const cloned = cloneChatModelConfig(config);
          // Strip provider modalities: only models.json overrides own this field.
          cloned.modalities = undefined;
          this.chatModels.set(fullId, {
            fullId,
            providerId: provider.id,
            modelId: config.id,
            config: cloned,
          });
        }
      }

      if (provider.capabilities.embedding) {
        for (const config of provider.embeddingModels()) {
          const fullId = formatModelId(provider.id, config.id);
          this.embeddingModels.set(fullId, {
            fullId,
            providerId: provider.id,
            modelId: config.id,
            config: cloneEmbeddingModelConfig(config),
          });
        }
      }
    }

    const modelsConfig = this.modelsConfig;

    for (const [fullId, override] of Object.entries(modelsConfig.chat)) {
      const record = this.chatModels.get(fullId);
      if (!record) {
        this.logger.warn(`Ignoring models.json chat override for unknown model "${fullId}".`);
        continue;
      }
      record.config = {
        ...record.config,
        name: override.name ?? record.config.name,
        toolCall: override.toolCall ?? record.config.toolCall,
        reasoning: override.reasoning ?? record.config.reasoning,
        hidden: override.hidden ?? record.config.hidden,
        modalities: override.modalities
          ? {
              ...(override.modalities.input ? { input: [...override.modalities.input] } : {}),
              ...(override.modalities.output ? { output: [...override.modalities.output] } : {}),
            }
          : record.config.modalities,
        limit: override.limit ?? record.config.limit,
      };
    }

    for (const [fullId, override] of Object.entries(modelsConfig.embedding)) {
      const record = this.embeddingModels.get(fullId);
      if (!record) {
        this.logger.warn(`Ignoring models.json embedding override for unknown model "${fullId}".`);
        continue;
      }
      record.config = {
        ...record.config,
        name: override.name ?? record.config.name,
        hidden: override.hidden ?? record.config.hidden,
      };
    }

    for (const [alias, target] of Object.entries(modelsConfig.aliases)) {
      if (this.chatModels.has(alias) || this.embeddingModels.has(alias)) {
        this.logger.warn(`Ignoring models.json alias "${alias}" because it conflicts with a full model id.`);
        continue;
      }
      const parsedTarget = parseModelId(target);
      if (!parsedTarget) {
        this.logger.warn(`Ignoring models.json alias "${alias}" because target "${target}" is not a valid model id.`);
        continue;
      }
      const targetId = formatModelId(parsedTarget.provider, parsedTarget.model);
      if (!this.chatModels.has(targetId) && !this.embeddingModels.has(targetId)) {
        this.logger.warn(`Ignoring models.json alias "${alias}" because target "${target}" is not registered.`);
        continue;
      }
      this.aliases.set(alias, targetId);
    }

    if (modelsConfig.defaults.chat) {
      if (this.chatModels.has(modelsConfig.defaults.chat)) {
        this.defaults.chat = modelsConfig.defaults.chat as ModelId;
      } else {
        this.logger.warn(`Ignoring models.json chat default "${modelsConfig.defaults.chat}" because it is not a registered chat model.`);
      }
    }

    if (modelsConfig.defaults.embedding) {
      if (this.embeddingModels.has(modelsConfig.defaults.embedding)) {
        this.defaults.embedding = modelsConfig.defaults.embedding as ModelId;
      } else {
        this.logger.warn(`Ignoring models.json embedding default "${modelsConfig.defaults.embedding}" because it is not a registered embedding model.`);
      }
    }

    this.refreshSchemas();
  }

  private resolveInput(input: string): string {
    return this.aliases.get(input) ?? input;
  }

  private getChatRecord(fullId: string): ChatModelRecord {
    fullId = this.resolveInput(fullId);
    const parsed = parseModelId(fullId);
    if (!parsed) throw new Error(`Invalid model ID format: ${fullId}`);

    const provider = this.providers.get(parsed.provider);
    if (!provider) {
      throw new Error(`Provider "${parsed.provider}" not found. Available: [${this.listProviders().join(", ")}]`);
    }

    if (!provider.capabilities.chat) {
      throw new Error(`Provider "${parsed.provider}" does not support chat`);
    }

    const record = this.chatModels.get(fullId);
    if (record) return record;

    const available = [...this.chatModels.values()]
      .filter((item) => item.providerId === parsed.provider)
      .map((item) => item.modelId)
      .join(", ");
    throw new Error(`Model "${parsed.model}" not found in provider "${parsed.provider}". Available: [${available}]`);
  }

  private getEmbeddingRecord(fullId: string): EmbeddingModelRecord {
    fullId = this.resolveInput(fullId);
    const parsed = parseModelId(fullId);
    if (!parsed) throw new Error(`Invalid model ID format: ${fullId}`);

    const provider = this.providers.get(parsed.provider);
    if (!provider) throw new Error(`Provider "${parsed.provider}" not found`);

    if (!provider.capabilities.embedding) {
      throw new Error(`Provider "${parsed.provider}" does not support embedding`);
    }

    const record = this.embeddingModels.get(fullId);
    if (record) return record;

    const available = [...this.embeddingModels.values()]
      .filter((item) => item.providerId === parsed.provider)
      .map((item) => item.modelId)
      .join(", ");
    throw new Error(`Model "${parsed.model}" not found in provider "${parsed.provider}". Available: [${available}]`);
  }

  public register(provider: Provider): () => void {
    const existing = this.providers.get(provider.id);
    if (existing && existing !== provider) {
      throw new Error(`Provider "${provider.id}" is already registered`);
    }
    this.providers.set(provider.id, provider);
    this.refreshModels();
    this.logger.info(`Provider registered: ${provider.id}`);

    return () => {
      if (this.providers.get(provider.id) !== provider) {
        return;
      }
      this.providers.delete(provider.id);
      this.refreshModels();
      this.logger.info(`Provider unregistered: ${provider.id}`);
    };
  }

  public resolveChatModel(fullId: string): ChatModelRef {
    const record = this.getChatRecord(fullId);
    const provider = this.providers.get(record.providerId);
    if (!provider) {
      throw new Error(`Provider "${record.providerId}" not found`);
    }

    return {
      fullId: record.fullId,
      providerId: record.providerId,
      modelId: record.modelId,
      entry: cloneChatModelConfig(record.config),
      model: provider.chat!(record.modelId),
    };
  }

  public resolveEmbedding(fullId: string) {
    const record = this.getEmbeddingRecord(fullId);
    const provider = this.providers.get(record.providerId);
    if (!provider) throw new Error(`Provider "${record.providerId}" not found`);
    return provider.embedding!(record.modelId);
  }

  public getProvider(id: string) {
    return this.providers.get(id);
  }

  public listProviders() {
    return [...this.providers.keys()];
  }

  public getDefaultChatModelId(): ModelId | undefined {
    return this.defaults.chat;
  }

  public getDefaultEmbeddingModelId(): ModelId | undefined {
    return this.defaults.embedding;
  }

  public listChatModels(): Array<{ fullId: string; config: ChatModelConfig }> {
    return [...this.chatModels.values()].map((record) => ({
      fullId: record.fullId,
      config: cloneChatModelConfig(record.config),
    }));
  }

  public listEmbeddingModels(): Array<{ fullId: string; config: EmbeddingModelConfig }> {
    return [...this.embeddingModels.values()].map((record) => ({
      fullId: record.fullId,
      config: cloneEmbeddingModelConfig(record.config),
    }));
  }
}

function isPlainObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readObjectSection(root: JsonObject, key: keyof ModelsConfigData, warnings: string[]): JsonObject {
  const value = root[key];
  if (value === undefined) return {};
  if (!isPlainObject(value)) {
    warnings.push(`models.json field "${key}" must be an object.`);
    return {};
  }
  return value;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function readLimit(value: unknown, fullId: string, warnings: string[]): ChatModelConfig["limit"] {
  if (!isPlainObject(value)) {
    warnings.push(`models.json chat override for "${fullId}" limit must be an object.`);
    return undefined;
  }
  const context = value.context;
  const output = value.output;
  if (typeof context !== "number" || typeof output !== "number") {
    warnings.push(`models.json chat override for "${fullId}" limit must contain numeric context and output.`);
    return undefined;
  }
  return { context, output };
}

function readVariants(value: unknown): Record<string, unknown> | undefined {
  return isPlainObject(value) ? { ...value } : undefined;
}

function readModalityArray(
  value: unknown,
  fullId: string,
  direction: "input" | "output",
  warnings: string[],
): NonNullable<ChatModelConfig["modalities"]>["input"] | undefined {
  if (value === undefined) return undefined;
  if (Array.isArray(value) && value.every(isModelModality)) return [...value];
  warnings.push(`models.json chat override for "${fullId}" modalities.${direction} must be valid.`);
  return undefined;
}

function isModelModality(value: unknown): value is NonNullable<NonNullable<ChatModelConfig["modalities"]>["input"]>[number] {
  return typeof value === "string" && isChatModelModality(value);
}

function readModalities(value: unknown, fullId: string, warnings: string[]): ChatModelConfig["modalities"] {
  if (!isPlainObject(value)) {
    warnings.push(`models.json chat override for "${fullId}" modalities must be an object.`);
    return undefined;
  }
  const input = readModalityArray(value.input, fullId, "input", warnings);
  const output = readModalityArray(value.output, fullId, "output", warnings);
  return input || output ? { ...(input ? { input } : {}), ...(output ? { output } : {}) } : undefined;
}

function readChatOverrides(section: JsonObject, warnings: string[]): Record<string, ChatModelOverride> {
  const result: Record<string, ChatModelOverride> = {};
  for (const [fullId, value] of Object.entries(section)) {
    if (!isPlainObject(value)) {
      warnings.push(`models.json chat override for "${fullId}" must be an object.`);
      continue;
    }
    result[fullId] = {
      name: readString(value.name),
      toolCall: readBoolean(value.toolCall),
      reasoning: readBoolean(value.reasoning),
      hidden: readBoolean(value.hidden),
      limit: value.limit === undefined ? undefined : readLimit(value.limit, fullId, warnings),
      modalities: value.modalities === undefined ? undefined : readModalities(value.modalities, fullId, warnings),
      variants: readVariants(value.variants),
    };
  }
  return result;
}

function readEmbeddingOverrides(section: JsonObject, warnings: string[]): Record<string, EmbeddingModelOverride> {
  const result: Record<string, EmbeddingModelOverride> = {};
  for (const [fullId, value] of Object.entries(section)) {
    if (!isPlainObject(value)) {
      warnings.push(`models.json embedding override for "${fullId}" must be an object.`);
      continue;
    }
    result[fullId] = {
      name: readString(value.name),
      hidden: readBoolean(value.hidden),
    };
  }
  return result;
}

async function loadModelsConfig(filePath?: string): Promise<ModelsConfigLoadResult> {
  const empty = createEmptyModelsConfig();
  if (!filePath) return { config: empty, warnings: [] };

  let parsed: unknown;
  try {
    parsed = await readModelsConfig(filePath);
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { config: empty, warnings: [] };
    return {
      config: empty,
      warnings: [`Failed to parse models.json at ${filePath}: ${error instanceof Error ? error.message : String(error)}`],
    };
  }

  if (!isPlainObject(parsed)) {
    return { config: empty, warnings: [`models.json root must be an object: ${filePath}`] };
  }

  const warnings: string[] = [];
  const defaultsSection = readObjectSection(parsed, "defaults", warnings);
  const aliasesSection = readObjectSection(parsed, "aliases", warnings);
  const chatSection = readObjectSection(parsed, "chat", warnings);
  const embeddingSection = readObjectSection(parsed, "embedding", warnings);
  const aliases: Record<string, string> = {};
  for (const [alias, target] of Object.entries(aliasesSection)) {
    const value = readString(target);
    if (!value) {
      warnings.push(`models.json alias "${alias}" must point to a non-empty string.`);
      continue;
    }
    aliases[alias] = value;
  }

  return {
    config: {
      defaults: {
        chat: readString(defaultsSection.chat),
        embedding: readString(defaultsSection.embedding),
      },
      aliases,
      chat: readChatOverrides(chatSection, warnings),
      embedding: readEmbeddingOverrides(embeddingSection, warnings),
    },
    warnings,
  };
}

function cloneChatModelConfig(config: ChatModelConfig): ChatModelConfig {
  return {
    ...config,
    modalities: config.modalities
      ? {
          ...(config.modalities.input ? { input: [...config.modalities.input] } : {}),
          ...(config.modalities.output ? { output: [...config.modalities.output] } : {}),
        }
      : undefined,
  };
}

function cloneEmbeddingModelConfig(config: EmbeddingModelConfig): EmbeddingModelConfig {
  return { ...config };
}

function isHiddenModel(config: { hidden?: boolean } | undefined): boolean {
  return config?.hidden === true;
}

function createEmptyModelsConfig(): ModelsConfigData {
  return {
    defaults: {},
    aliases: {},
    chat: {},
    embedding: {},
  };
}
