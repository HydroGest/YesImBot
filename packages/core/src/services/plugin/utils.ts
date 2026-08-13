import type { Schema } from "koishi";
import type { Properties, ToolResult } from "./types";

export function Failed(message: string): ToolResult {
    return {
        status: "failed",
        error: message,
    };
}

export function Success<TResult>(result?: TResult): ToolResult<TResult> {
    return {
        status: "success",
        result,
    };
}

export function toProperties(schema: Schema<any>): Properties {
    if (!schema) {
        return {};
    }
    const dict = schema.dict;
    if (!dict) {
        return {};
    }

    const properties: Properties = {};
    for (const [key, value] of Object.entries(dict)) {
        switch (value.type) {
            case "string":
            case "number":
            case "boolean":
            case "array":
            case "object":
                properties[key] = { type: value.type, description: value.meta?.description as string || "" };
                break;
            default:
                properties[key] = { type: "string" };
                break;
        }
    }
    return properties;
}
