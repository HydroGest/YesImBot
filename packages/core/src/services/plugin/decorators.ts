import type { ActionDefinition, FunctionContext, FunctionInput, PluginMetadata, ToolDefinition } from "./types";
import { Schema } from "koishi";
import { FunctionType } from "./types";

type Constructor<T = {}> = new (...args: any[]) => T;

export function Metadata(metadata: PluginMetadata): ClassDecorator {
    // @ts-expect-error type checking
    return <T extends Constructor>(TargetClass: T) => {
        (TargetClass as any).metadata = metadata;
        return TargetClass as unknown as T;
    };
}

export function Tool<TParams>(descriptor: FunctionInput<any, TParams>) {
    return function (
        target: any,
        propertyKey: string,
        methodDescriptor: TypedPropertyDescriptor<(params: TParams, context: FunctionContext) => Promise<any>>,
    ) {
        if (!methodDescriptor.value)
            return;

        target.staticTools ??= [];

        const toolDefinition: ToolDefinition<any, TParams> = {
            ...descriptor,
            name: descriptor.name || propertyKey,
            type: FunctionType.Tool,
            execute: methodDescriptor.value,
        };

        (target.staticTools as ToolDefinition[]).push(toolDefinition);
    };
}

export function Action<TParams>(descriptor: FunctionInput<any, TParams>) {
    return function (
        target: any,
        propertyKey: string,
        methodDescriptor: TypedPropertyDescriptor<(params: TParams, context: FunctionContext) => Promise<any>>,
    ) {
        if (!methodDescriptor.value)
            return;

        target.staticActions ??= [];

        const actionDefinition: ActionDefinition<any, TParams> = {
            ...descriptor,
            name: descriptor.name || propertyKey,
            type: FunctionType.Action,
            execute: methodDescriptor.value,
        };

        (target.staticActions as ActionDefinition[]).push(actionDefinition);
    };
}

export function defineTool<TParams>(
    descriptor: FunctionInput<any, TParams>,
    execute: (params: TParams, context: FunctionContext) => Promise<any>,
): ToolDefinition<any, TParams> {
    return {
        ...descriptor,
        name: descriptor.name,
        type: FunctionType.Tool,
        execute,
    };
}

export function defineAction<TParams>(
    descriptor: FunctionInput<any, TParams>,
    execute: (params: TParams, context: FunctionContext) => Promise<any>,
): ActionDefinition<any, TParams> {
    return {
        ...descriptor,
        name: descriptor.name,
        type: FunctionType.Action,
        execute,
    };
}

export function withInnerThoughts(params: { [T: string]: Schema<any> }): Schema<any> {
    return Schema.object({
        inner_thoughts: Schema.string().description("Deep inner monologue private to you only."),
        ...params,
    });
}
