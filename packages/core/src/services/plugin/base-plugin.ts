import type { Context, Logger, Schema } from "koishi";
import type { BaseDefinition, Definition } from "./types";
import type { ActionDefinition, FunctionInput, PluginMetadata, ToolDefinition } from "./types";
import { Services } from "@/shared/constants";
import { FunctionType } from "./types";

export abstract class Plugin<TConfig extends Record<string, any> = {}> {
    static inject: string[] | { required: string[]; optional?: string[] } = [Services.Plugin];
    static Config: Schema<any>;
    static metadata: PluginMetadata;
    static staticTools: ToolDefinition[];
    static staticActions: ActionDefinition[];

    get metadata(): PluginMetadata {
        return (this.constructor as typeof Plugin).metadata;
    }

    protected tools = new Map<string, ToolDefinition<TConfig, any>>();
    protected actions = new Map<string, ActionDefinition<TConfig, any>>();

    public logger: Logger;

    constructor(
        public ctx: Context,
        public config: TConfig,
    ) {
        this.logger = ctx.logger(`plugin:${this.metadata.name}`);
        const childClass = this.constructor as typeof Plugin;
        const parentClass = Object.getPrototypeOf(childClass);

        if (parentClass && parentClass.inject && childClass.inject) {
            if (Array.isArray(childClass.inject)) {
                childClass.inject = [...new Set([...parentClass.inject, ...childClass.inject, Services.Plugin])];
            } else if (typeof childClass.inject === "object") {
                const parentRequired = Array.isArray(parentClass.inject)
                    ? parentClass.inject
                    : parentClass.inject.required || [];
                const childRequired = childClass.inject.required || [];
                const childOptional = childClass.inject.optional || [];

                childClass.inject = {
                    required: [...new Set([...parentRequired, ...childRequired, Services.Plugin])],
                    optional: childOptional,
                };
            }
        }

        for (const tool of (childClass.prototype as any).staticTools || []) {
            this.addTool(tool);
        }

        for (const action of (childClass.prototype as any).staticActions || []) {
            this.addAction(action);
        }

        const toolService = ctx[Services.Plugin];
        if (toolService) {
            ctx.on("ready", () => {
                const enabled = !Object.hasOwn(config, "enabled") || config.enabled;
                toolService.register(this, enabled, config);
            });

            ctx.on("dispose", () => {
                toolService.unregister(this.metadata.name);
            });
        }
    }

    private addFunction<TParams = any, TResult = any>(
        functionType: FunctionType,
        inputOrDefinition: FunctionInput<TConfig, TParams> | BaseDefinition<TConfig, TParams, TResult>,
        execute?: BaseDefinition<TConfig, TParams, TResult>["execute"],
    ): this {
        let executeFn: BaseDefinition<TConfig, TParams, TResult>["execute"];
        let input: FunctionInput<TConfig, TParams>;
        if ("execute" in inputOrDefinition && typeof inputOrDefinition.execute === "function") {
            executeFn = inputOrDefinition.execute?.bind(this) as any;
            input = inputOrDefinition;
        } else {
            input = inputOrDefinition as FunctionInput<TConfig, TParams>;
            executeFn = execute!.bind(this) as any;
        }

        const name = input.name;

        if (functionType === FunctionType.Tool) {
            const definition: ToolDefinition<TConfig, TParams, TResult> = {
                ...input,
                name,
                type: FunctionType.Tool,
                execute: executeFn,
            };
            this.logger.debug(`  -> 注册工具: "${name}"`);
            this.tools.set(name, definition);
        } else if (functionType === FunctionType.Action) {
            const definition: ActionDefinition<TConfig, TParams, TResult> = {
                ...input,
                name,
                type: FunctionType.Action,
                execute: executeFn,
            };
            this.logger.debug(`  -> 注册动作: "${name}"`);
            this.actions.set(name, definition);
        }
        return this;
    }

    public addTool<TParams = any, TResult = any>(
        inputOrDefinition: FunctionInput<TConfig, TParams> | ToolDefinition<TConfig, TParams, TResult>,
        execute?: BaseDefinition<TConfig, TParams, TResult>["execute"],
    ): this {
        return this.addFunction(FunctionType.Tool, inputOrDefinition, execute);
    }

    public addAction<TParams = any, TResult = any>(
        inputOrDefinition: FunctionInput<TConfig, TParams> | ActionDefinition<TConfig, TParams, TResult>,
        execute?: BaseDefinition<TConfig, TParams, TResult>["execute"],
    ): this {
        return this.addFunction(FunctionType.Action, inputOrDefinition, execute);
    }

    getTools(): Map<string, ToolDefinition<TConfig, any>> {
        return this.tools;
    }

    getActions(): Map<string, ActionDefinition<TConfig, any>> {
        return this.actions;
    }

    getFunctions(): Map<string, Definition<TConfig, any, any>> {
        const functions = new Map<string, Definition<TConfig, any, any>>();
        for (const [name, tool] of this.tools) {
            functions.set(name, tool);
        }
        for (const [name, action] of this.actions) {
            functions.set(name, action);
        }
        return functions;
    }
}
