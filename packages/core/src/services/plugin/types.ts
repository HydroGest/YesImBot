import type { Schema, Session } from "koishi";
import type { HorizonView, Percept } from "@/services/horizon/types";

export interface PluginMetadata {
    name: string;
    display?: string;
    description: string;
    builtin?: boolean;
}

export interface FunctionContext<TConfig = any> {
    config?: TConfig;
    session?: Session;
    view?: HorizonView;
    percept?: Percept;
    [key: string]: unknown;
}

export enum FunctionType {
    Tool = "tool",
    Action = "action",
}

export interface GuardContext<TConfig = any> {
    context: FunctionContext;
    config: TConfig;
}

export type SupportGuard<TConfig = any> = (ctx: GuardContext<TConfig>) => { ok: boolean; reason?: string };

export interface ActivatorResult {
    allow: boolean;
    reason?: string[];
}

export type Activator<TConfig = any> = (ctx: GuardContext<TConfig>) => Promise<ActivatorResult>;

export interface BaseDefinition<TConfig = any, TParams = any, TResult = any> {
    name: string;
    description: string;
    parameters: Schema<TParams>;
    support?: SupportGuard<TConfig>;
    activators?: Activator<TConfig>[];
    execute: (params: TParams, context: FunctionContext) => Promise<TResult>;
}

export interface ToolDefinition<TConfig = any, TParams = any, TResult = any>
    extends BaseDefinition<TConfig, TParams, TResult> {
    type: FunctionType.Tool;
}

export interface ActionDefinition<TConfig = any, TParams = any, TResult = any>
    extends BaseDefinition<TConfig, TParams, TResult> {
    type: FunctionType.Action;
}

// eslint-disable-next-line style/operator-linebreak
export type Definition<TConfig = any, TParams = any, TResult = any> =
    | ToolDefinition<TConfig, TParams, TResult>
    | ActionDefinition<TConfig, TParams, TResult>;

export type FunctionInput<TConfig = any, TParams = any> = Omit<
    BaseDefinition<TConfig, TParams, any>,
    "execute" | "type"
> & { name?: string };

export interface Param {
    type: string;
    description?: string;
    default?: any;
    required?: boolean;
    properties?: Properties;
    enum?: any[];
    items?: Param;
}

export type Properties = Record<string, Param>;

export interface FunctionSchema {
    type?: FunctionType;
    name: string;
    description: string;
    parameters: Properties;
}

export interface ToolResult<TResult = any> {
    status: "success" | "failed" | string;
    result?: TResult;
    error?: string;
}

export type InferSchemaType<T> = T extends Schema<infer U> ? U : never;
