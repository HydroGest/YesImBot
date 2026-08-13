import process from "node:process";
import { createDeepSeek } from "@ai-sdk/deepseek";
import { jsonSchema, streamObject } from "ai";

const deepseek = createDeepSeek({
    apiKey: process.env.API_KEY_DEEPSEEK!,
});

async function streamTest() {
    const { partialObjectStream, usage } = streamObject({
        model: deepseek("deepseek-chat"),

        schema: jsonSchema({
            type: "object",
            properties: {
                actions: {
                    type: "array",
                    items: {
                        type: "object",
                        properties: {
                            name: { type: "string" },
                            args: {
                                type: "object",
                                additionalProperties: { type: "string" },
                            },
                        },
                        required: ["name", "args"],
                    },
                },
                request_heartbeat: { type: "boolean" },
            },
        }),

        system: "你是一只猫娘。",
        prompt: "讲一个关于黑洞的科幻故事。",
    });

    for await (const partialObject of partialObjectStream) {
        console.clear();
        console.log(JSON.stringify(partialObject, null, 2));
    }

    console.log("Usage:", await usage);
}

streamTest();
