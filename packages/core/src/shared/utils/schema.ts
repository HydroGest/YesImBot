import type { JSONSchema4 } from "json-schema";
import type { Schema } from "koishi";

export function isEmptyObject(obj: any): boolean {
    return obj && Object.keys(obj).length === 0 && obj.constructor === Object;
}

export function schemaToJSONSchema(schema: Schema<any>): JSONSchema4 {
    const jsonSchema: JSONSchema4 = {};
    if (schema.type) {
        jsonSchema.type = schema.type as unknown as JSONSchema4["type"];
    }
    if (schema.meta.description) {
        jsonSchema.description = schema.meta.description as string;
    }
    if (schema.meta.default !== undefined && !isEmptyObject(schema.meta.default)) {
        jsonSchema.default = schema.meta.default;
    }

    switch (schema.type) {
        case "object": {
            jsonSchema.properties = {};
            const required: string[] = [];
            for (const [key, childSchema] of Object.entries(schema.dict || {})) {
                jsonSchema.properties![key] = schemaToJSONSchema(childSchema);
                if (childSchema.meta.required) {
                    required.push(key);
                }
            }
            if (required.length > 0) {
                jsonSchema.required = required;
            }
            break;
        }
        case "string":
        case "number":
        case "boolean":
            break;
        case "union": {
            const isEnum = schema.list.every(item => item.type === "const");
            if (isEnum) {
                jsonSchema.type = "string";
                jsonSchema.enum = schema.list.map(item => item.value);
            } else {
                jsonSchema.anyOf = schema.list.map((subSchema) => schemaToJSONSchema(subSchema));
            }
            break;
        }
        case "const": {
            jsonSchema.const = schema.value;
            break;
        }
        case "array": {
            jsonSchema.items = schemaToJSONSchema(schema.inner);
            break;
        }
    }
    return jsonSchema;
}
