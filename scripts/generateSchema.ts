import { readFileSync } from "fs";
import path from "path";
import ts from "typescript";


interface ToolSchema {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: ParameterSchema;
  };
}

interface ParameterSchema {
    type: "object"
    properties: {
        [key: string]: {
            type: string
            description: string
        }
    }
    required: string[]
}

/**
 * 解析 TypeScript 源代码并生成 JSON Schema
 * @param sourceCode 源代码字符串
 */
function generateJsonSchemaFromSource(sourceCode: string) {
    const sourceFile = ts.createSourceFile('', sourceCode, ts.ScriptTarget.Latest, true)

    const schemas: ToolSchema[] = []

    function visit(node: ts.Node) {
        if (ts.isFunctionDeclaration(node) && node.name) {
            schemas.push({
                type: "function",
                function: {
                    name: node.name.text,
                    description: getJsDocDescription(node),
                    parameters: getFunctionParametersSchema(node),
                }
            })
        }
        ts.forEachChild(node, visit)
    }

    visit(sourceFile)

    return schemas
}

/**
 * 提取函数的参数 JSON Schema
 */
function getFunctionParametersSchema(node: ts.FunctionDeclaration): ParameterSchema {
    const schema: ParameterSchema = {
        type: 'object',
        properties: {},
        required: [],
    }

    for (const param of node.parameters) {
        if (ts.isIdentifier(param.name) && param.type) {
            const paramName = param.name.text
            schema.properties[paramName] = {
                type: mapTypeToJson(param.type),
                description: extractParamDescription(node, paramName),
            }
            if (!param.questionToken) {
                schema.required.push(paramName)
            }
        }
    }

    return schema
}

/**
 * 将 TypeScript 类型映射到 JSON Schema 类型
 */
function mapTypeToJson(typeNode: ts.TypeNode): string {
    const typeMap: Record<number, string> = {
        [ts.SyntaxKind.StringKeyword]: "string",
        [ts.SyntaxKind.NumberKeyword]: "number",
        [ts.SyntaxKind.BooleanKeyword]: "boolean",
        [ts.SyntaxKind.EnumKeyword]: "string",
    };
    return typeMap[typeNode.kind] || "object";
}

/**
 * 提取 JSDoc 描述
 */
function getJsDocDescription(node: ts.Node): string {
    const jsDocs = ts.getJSDocTags(node);
    const descriptionTags = jsDocs.filter(tag => tag.tagName.text === "description");
    if (descriptionTags.length > 0) {
        return descriptionTags[0].comment as string || "";
    }
    const jsDocComment = (node as any).jsDoc?.[0]?.comment; // 提取普通注释
    return jsDocComment || "";
}

/**
 * 提取参数的 JSDoc 描述
 */
function extractParamDescription(node: ts.Node, paramName: string): string {
    const jsDoc = ts.getJSDocTags(node);
    const paramTag = jsDoc.find(
        (tag) => ts.isJSDocParameterTag(tag) && tag.name?.getText() === paramName
    );
    return paramTag?.comment as string || "";
}

const sourceCode = readFileSync(path.join(__dirname, "funcs.ts"), "utf-8");

console.log(JSON.stringify(generateJsonSchemaFromSource(sourceCode), null, 4))

// output:
// [{
//     "type": "function",
//     "function": {
//         "name": "get_current_temperature",
//         "description": "Get current temperature at a location.",
//         "parameters": {
//             "type": "object",
//             "properties": {
//                 "location": {
//                     "type": "string",
//                     "description": "The location to get the temperature for, in the format \"City, State, Country\"."
//                 },
//                 "unit": {
//                     "type": "string",
//                     "description": "The unit to return the temperature in. Defaults to \"celsius\". (choices: [\"celsius\", \"fahrenheit\"])"
//                 }
//             },
//             "required": [
//                 "location"
//             ]
//         }
//     }
// },
// {
//     "type": "function",
//     "function": {
//         "name": "get_temperature_date",
//         "description": "Get temperature at a location and date.",
//         "parameters": {
//             "type": "object",
//             "properties": {
//                 "location": {
//                     "type": "string",
//                     "description": "The location to get the temperature for, in the format \"City, State, Country\"."
//                 },
//                 "date": {
//                     "type": "string",
//                     "description": "The date to get the temperature for, in the format \"Year-Month-Day\"."
//                 },
//                 "unit": {
//                     "type": "string",
//                     "description": "The unit to return the temperature in. Defaults to \"celsius\". (choices: [\"celsius\", \"fahrenheit\"])"
//                 }
//             },
//             "required": [
//                 "location",
//                 "date",
//                 "unit"
//             ]
//         }
//     }
// }]
