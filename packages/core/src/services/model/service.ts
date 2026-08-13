import type { ChatModelInfo, CommonRequestOptions, EmbedModelInfo, ModelInfo, SharedProvider, UnionProvider } from "@yesimbot/shared-model";
import type { Context } from "koishi";
import type { ModelGroup, ModelServiceConfig } from "./config";
import { ChatModelAbility, ModelType } from "@yesimbot/shared-model";
import { Schema, Service } from "koishi";
import { Services } from "@/shared/constants";

declare module "koishi" {
    interface Context {
        [Services.Model]: ModelService;
    }
}

export class ModelService extends Service<ModelServiceConfig> {
    public static readonly separator = ">";
    private readonly providers: Map<string, SharedProvider<UnionProvider>> = new Map();
    private readonly chatModelInfos: Map<string, ChatModelInfo> = new Map();
    private readonly embedModelInfos: Map<string, EmbedModelInfo> = new Map();
    private readonly unknownModelInfos: Map<string, ModelInfo> = new Map();

    constructor(ctx: Context, config: ModelServiceConfig) {
        super(ctx, Services.Model, true);
        this.config = config;
        this.refreshSchemas();
    }

    private parseFullName(fullName: string): { providerName: string; modelName: string } | null {
        const separator = ModelService.separator;
        const index = fullName.indexOf(separator);
        if (index <= 0)
            return null;

        const providerName = fullName.slice(0, index).trim();
        const modelName = fullName.slice(index + separator.length).trim();

        if (!providerName || !modelName)
            return null;

        return { providerName, modelName };
    }

    private formatFullName(providerName: string, modelName: string): string {
        const separator = ModelService.separator;
        return `${providerName}${separator}${modelName}`;
    }

    public getChatModelInfo(fullName: string): ChatModelInfo | undefined {
        return this.chatModelInfos.get(fullName);
    }

    public isVisionChatModel(fullName: string): boolean {
        const info = this.getChatModelInfo(fullName);
        return Boolean((info?.abilities ?? []).includes(ChatModelAbility.ImageInput));
    }

    public resolveChatModels(nameOrGroup: string): string[] {
        const group = (this.config.groups ?? []).find((g) => g.name === nameOrGroup);
        if (group)
            return group.models;
        return [nameOrGroup];
    }

    private createUnion(options: Schema[], fallback: Schema): Schema {
        if (!options.length)
            return fallback;
        return Schema.union(options);
    }

    private refreshSchemas(): void {
        // Chat models
        const chatOptions = Array.from(this.chatModelInfos.values()).map((m) =>
            Schema.const(this.formatFullName(m.providerName, m.modelId)).description(`${m.providerName} - ${m.modelId}`),
        );

        const chatVisionOptions = Array.from(this.chatModelInfos.values())
            .filter((m) => (m.abilities ?? []).includes(ChatModelAbility.ImageInput))
            .map((m) =>
                Schema.const(this.formatFullName(m.providerName, m.modelId)).description(`${m.providerName} - ${m.modelId}`),
            );

        const embedOptions = Array.from(this.embedModelInfos.values()).map((m) =>
            Schema.const(this.formatFullName(m.providerName, m.modelId)).description(`${m.providerName} - ${m.modelId}`),
        );

        const customModel = Schema.string().description("自定义模型 (例如 google>gemini-3-pro)");

        this.ctx.schema.set("registry.chatModels", Schema.union([...chatOptions, customModel]).default(""));

        this.ctx.schema.set(
            "registry.chatVisionModels",
            this.createUnion(chatVisionOptions, customModel).default(""),
        );

        this.ctx.schema.set("registry.embedModels", this.createUnion(embedOptions, customModel).default(""));

        // Groups
        const groupNames = (this.config.groups ?? []).map((g) => g.name);
        const groupOptions = groupNames.map((name) => Schema.const(name).description(name));
        const customGroup = Schema.string().description("自定义模型组");

        this.ctx.schema.set(
            "registry.availableGroups",
            Schema.union([...groupOptions, customGroup]).default(""),
        );

        // Mixed: group or chat model
        const groupOrModelOptions = [
            ...groupNames.map((name) => Schema.const(name).description(`模型组 - ${name}`)),
            ...chatOptions,
        ];

        this.ctx.schema.set(
            "registry.chatModelOrGroup",
            this.createUnion(groupOrModelOptions, Schema.string().description("模型/模型组")).default(""),
        );
    }

    /** Register a provider implementation for request options generation. */
    public setProvider(name: string, provider: SharedProvider): void {
        if (this.providers.has(name)) {
            throw new Error(`Provider with name "${name}" is already registered.`);
        }
        this.providers.set(name, provider);
    }

    public removeProvider(name: string): void {
        if (!this.providers.has(name)) {
            throw new Error(`Provider with name "${name}" is not registered.`);
        }
        this.providers.delete(name);
    }

    /** Register chat model metadata used for schema filtering (e.g. vision-capable). */
    public addChatModels(providerName: string, models: Array<Omit<ChatModelInfo, "providerName">>): void {
        for (const model of models) {
            const info: ChatModelInfo = { ...model, providerName, modelType: model.modelType } as ChatModelInfo;
            this.chatModelInfos.set(this.formatFullName(providerName, model.modelId), info);
        }
        this.refreshSchemas();
    }

    /** Register embedding model metadata used for schema listing. */
    public addEmbedModels(providerName: string, models: Array<Omit<EmbedModelInfo, "providerName">>): void {
        for (const model of models) {
            const info: EmbedModelInfo = { ...model, providerName, modelType: model.modelType } as EmbedModelInfo;
            this.embedModelInfos.set(this.formatFullName(providerName, model.modelId), info);
        }
        this.refreshSchemas();
    }

    /** Register unknown/unclassified models for manual categorization. */
    public addUnknownModels(providerName: string, modelIds: string[]): void {
        for (const modelId of modelIds) {
            const info: ModelInfo = {
                providerName,
                modelId,
                modelType: ModelType.Unknown,
            };
            this.unknownModelInfos.set(this.formatFullName(providerName, modelId), info);
        }
        // Unknown models don't affect schemas automatically
    }

    /** Get all unknown models for a provider or all providers. */
    public getUnknownModels(providerName?: string): ModelInfo[] {
        const models = Array.from(this.unknownModelInfos.values());
        if (providerName) {
            return models.filter((m) => m.providerName === providerName);
        }
        return models;
    }

    /** Promote an unknown model to a specific type with metadata. */
    public promoteModel(
        fullName: string,
        targetType: ModelType.Chat,
        metadata: Omit<ChatModelInfo, "providerName" | "modelId" | "modelType">,
    ): void;
    public promoteModel(
        fullName: string,
        targetType: ModelType.Embed,
        metadata: Omit<EmbedModelInfo, "providerName" | "modelId" | "modelType">,
    ): void;
    public promoteModel(fullName: string, targetType: ModelType, metadata: any): void {
        const unknownModel = this.unknownModelInfos.get(fullName);
        if (!unknownModel) {
            throw new Error(`Model "${fullName}" not found in unknown models`);
        }

        this.unknownModelInfos.delete(fullName);

        switch (targetType) {
            case ModelType.Chat: {
                const chatInfo: ChatModelInfo = {
                    ...metadata,
                    providerName: unknownModel.providerName,
                    modelId: unknownModel.modelId,
                    modelType: ModelType.Chat,
                };
                this.chatModelInfos.set(fullName, chatInfo);
                break;
            }
            case ModelType.Embed: {
                const embedInfo: EmbedModelInfo = {
                    ...metadata,
                    providerName: unknownModel.providerName,
                    modelId: unknownModel.modelId,
                    modelType: ModelType.Embed,
                };
                this.embedModelInfos.set(fullName, embedInfo);
                break;
            }
            default:
                throw new Error(`Unsupported target type: ${targetType}`);
        }

        this.refreshSchemas();
    }

    /** Replace model group config and refresh schemas. */
    public setGroups(groups: ModelGroup[]): void {
        this.config.groups = groups;
        this.refreshSchemas();
    }

    public getChatModel(fullName: string): CommonRequestOptions | undefined {
        const parsed = this.parseFullName(fullName);
        if (!parsed)
            return undefined;

        const provider = this.providers.get(parsed.providerName);
        if (provider && provider.chat) {
            return provider.chat(parsed.modelName);
        }
    }

    public getEmbedModel(fullName: string): CommonRequestOptions | undefined {
        const parsed = this.parseFullName(fullName);
        if (!parsed)
            return undefined;

        const provider = this.providers.get(parsed.providerName);
        if (provider && provider.embed) {
            return provider.embed(parsed.modelName);
        }
    }
}
