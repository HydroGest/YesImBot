import { join } from "node:path";

import { Context, Schema, Service } from "koishi";

import { resolveBasePath } from "../path.js";
import { loadModelsConfig, type ModelsConfigData, writeModelsConfig } from "./config.js";
import {
  type ChatModelConfig,
  type ChatModelRef,
  type EmbeddingModelConfig,
  formatModelId,
  type ModelId,
  type ModelProvider,
  isChatModelModality,
  parseModelId,
} from "./types.js";

export interface ModelServiceConfig {
  basePath: string;
  logLevel?: number;
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

function cloneModelsConfig(config: ModelsConfigData): ModelsConfigData {
  return {
    defaults: { ...config.defaults },
    aliases: { ...config.aliases },
    chat: Object.fromEntries(
      Object.entries(config.chat).map(([fullId, override]) => [
        fullId,
        {
          ...override,
          modalities: override.modalities
            ? {
                ...(override.modalities.input ? { input: [...override.modalities.input] } : {}),
                ...(override.modalities.output ? { output: [...override.modalities.output] } : {}),
              }
            : undefined,
        },
      ]),
    ),
    embedding: Object.fromEntries(
      Object.entries(config.embedding).map(([fullId, override]) => [fullId, { ...override }]),
    ),
  };
}

declare module "koishi" {
  interface Context {
    "yesimbot.model": ModelService;
  }
}

export class ModelService extends Service<ModelServiceConfig> {
  private providers = new Map<string, ModelProvider>();
  private chatModels = new Map<string, ChatModelRecord>();
  private embeddingModels = new Map<string, EmbeddingModelRecord>();
  private aliases = new Map<string, ModelId>();
  private modelsConfig = createEmptyModelsConfig();
  private modalityMutation = Promise.resolve();
  private defaults: {
    chat?: ModelId;
    embedding?: ModelId;
  } = {};

  constructor(ctx: Context, config: ModelServiceConfig) {
    super(ctx, "yesimbot.model", true);
    this.config = config;
    this.logger.level = config.logLevel ?? 2;
  }

  private getModelsConfigPath(): string {
    return join(resolveBasePath(this.config.basePath, this.ctx.baseDir), "models.json");
  }

  override async start(): Promise<void> {
    const { config: modelsConfig, warnings } = await loadModelsConfig(this.getModelsConfigPath());
    this.modelsConfig = modelsConfig;
    for (const warning of warnings) {
      this.logger.warn(warning);
    }
    this.refreshModels();
  }

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
        this.logger.warn(
          `Ignoring models.json alias "${alias}" because it conflicts with a full model id.`,
        );
        continue;
      }
      const parsedTarget = parseModelId(target);
      if (!parsedTarget) {
        this.logger.warn(
          `Ignoring models.json alias "${alias}" because target "${target}" is not a valid model id.`,
        );
        continue;
      }
      const targetId = formatModelId(parsedTarget.provider, parsedTarget.model);
      if (!this.chatModels.has(targetId) && !this.embeddingModels.has(targetId)) {
        this.logger.warn(
          `Ignoring models.json alias "${alias}" because target "${target}" is not registered.`,
        );
        continue;
      }
      this.aliases.set(alias, targetId);
    }

    if (modelsConfig.defaults.chat) {
      if (this.chatModels.has(modelsConfig.defaults.chat)) {
        this.defaults.chat = modelsConfig.defaults.chat as ModelId;
      } else {
        this.logger.warn(
          `Ignoring models.json chat default "${modelsConfig.defaults.chat}" because it is not a registered chat model.`,
        );
      }
    }

    if (modelsConfig.defaults.embedding) {
      if (this.embeddingModels.has(modelsConfig.defaults.embedding)) {
        this.defaults.embedding = modelsConfig.defaults.embedding as ModelId;
      } else {
        this.logger.warn(
          `Ignoring models.json embedding default "${modelsConfig.defaults.embedding}" because it is not a registered embedding model.`,
        );
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
      throw new Error(
        `Provider "${parsed.provider}" not found. Available: [${this.listProviders().join(", ")}]`,
      );
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
    throw new Error(
      `Model "${parsed.model}" not found in provider "${parsed.provider}". Available: [${available}]`,
    );
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
    throw new Error(
      `Model "${parsed.model}" not found in provider "${parsed.provider}". Available: [${available}]`,
    );
  }

  register(provider: ModelProvider): () => void {
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

  addChatModelInputModality(model: string, modality: string): Promise<"added" | "unchanged"> {
    const task = this.modalityMutation.then(() =>
      this.addChatModelInputModalityInternal(model, modality),
    );
    this.modalityMutation = task.then(
      () => undefined,
      () => undefined,
    );
    return task;
  }

  private async addChatModelInputModalityInternal(
    model: string,
    modality: string,
  ): Promise<"added" | "unchanged"> {
    if (!isChatModelModality(modality)) {
      throw new Error(`Unsupported chat model input modality: ${modality}`);
    }

    const record = this.getChatRecord(model);
    const override = this.modelsConfig.chat[record.fullId];
    const input = override?.modalities?.input ?? [];
    if (input.includes(modality)) return "unchanged";

    const next = cloneModelsConfig(this.modelsConfig);
    const nextOverride = next.chat[record.fullId] ?? {};
    next.chat[record.fullId] = {
      ...nextOverride,
      modalities: {
        ...(nextOverride.modalities?.input ? { input: [...nextOverride.modalities.input] } : {}),
        ...(nextOverride.modalities?.output ? { output: [...nextOverride.modalities.output] } : {}),
        input: [...(nextOverride.modalities?.input ?? []), modality],
      },
    };

    await writeModelsConfig(this.getModelsConfigPath(), next);
    this.modelsConfig = next;
    this.refreshModels();
    return "added";
  }

  resolveChatModel(fullId: string): ChatModelRef {
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

  resolveEmbedding(fullId: string) {
    const record = this.getEmbeddingRecord(fullId);
    const provider = this.providers.get(record.providerId);
    if (!provider) throw new Error(`Provider "${record.providerId}" not found`);
    return provider.embedding!(record.modelId);
  }

  getProvider(id: string) {
    return this.providers.get(id);
  }

  listProviders() {
    return [...this.providers.keys()];
  }

  getDefaultChatModelId(): ModelId | undefined {
    return this.defaults.chat;
  }

  getDefaultEmbeddingModelId(): ModelId | undefined {
    return this.defaults.embedding;
  }

  listChatModels(): Array<{ fullId: string; config: ChatModelConfig }> {
    return [...this.chatModels.values()].map((record) => ({
      fullId: record.fullId,
      config: cloneChatModelConfig(record.config),
    }));
  }

  listEmbeddingModels(): Array<{ fullId: string; config: EmbeddingModelConfig }> {
    return [...this.embeddingModels.values()].map((record) => ({
      fullId: record.fullId,
      config: cloneEmbeddingModelConfig(record.config),
    }));
  }
}
