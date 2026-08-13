import type { CommonRequestOptions } from "xsai";

export interface ChatProvider<T = string> {
    chat: (model: (string & {}) | T) => CommonRequestOptions;
}

export interface EmbedProvider<T = string> {
    embed: (model: (string & {}) | T) => CommonRequestOptions;
}

export interface ImageProvider<T = string> {
    image: (model: (string & {}) | T) => CommonRequestOptions;
}

export interface ModelProvider {
    model: () => Omit<CommonRequestOptions, "model">;
}

export interface SpeechProvider<T = string> {
    speech: (model: (string & {}) | T) => CommonRequestOptions;
}

export interface TranscriptionProvider<T = string> {
    transcription: (model: (string & {}) | T) => CommonRequestOptions;
}

export enum ModelType {
    Chat = "chat",
    Embed = "embed",
    Rerank = "rerank",
    Image = "image",
    Speech = "speech",
    Transcription = "transcription",
    Unknown = "unknown",
}

export interface ModelInfo {
    providerName: string;
    modelId: string;
    modelType: ModelType;
}

export enum ChatModelAbility {
    ImageInput = "image-input",
    ObjectGeneration = "object-generation",
    ToolUsage = "tool-usage",
    ToolStreaming = "tool-streaming",
    Reasoning = "reasoning",
    WebSearch = "web-search",
}

export interface ChatModelInfo extends ModelInfo {
    modelType: ModelType.Chat;
    abilities?: ChatModelAbility[];
}

export interface EmbedModelInfo extends ModelInfo {
    modelType: ModelType.Embed;
    dimension: number;
}

export type ExtractChatModels<T> = T extends ChatProvider<infer M> ? M : never;
export type ExtractEmbedModels<T> = T extends EmbedProvider<infer M> ? M : never;
export type ExtractImageModels<T> = T extends ImageProvider<infer M> ? M : never;
export type ExtractSpeechModels<T> = T extends SpeechProvider<infer M> ? M : never;
export type ExtractTranscriptionModels<T> = T extends TranscriptionProvider<infer M> ? M : never;
/* prettier-ignore */
export type UnionProvider
    = | ChatProvider<any>
        | EmbedProvider<any>
        | ImageProvider<any>
        | SpeechProvider<any>
        | TranscriptionProvider<any>;
