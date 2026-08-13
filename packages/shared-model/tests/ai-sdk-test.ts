import type { ModelMessage, StepResult, Tool, ToolSet } from "ai";
import process from "node:process";
import { createDeepSeek } from "@ai-sdk/deepseek";
import { generateObject, generateText, jsonSchema, stepCountIs, streamObject, streamText, tool } from "ai";

const deepseek = createDeepSeek({
    apiKey: process.env.API_KEY_DEEPSEEK!,
});

const getWeatherTool: Tool = {
    type: "function",
    description: "Get the current weather for a given location.",
    inputSchema: jsonSchema<{ location: string }>({
        type: "object",
        properties: {
            location: { type: "string" },
        },
        required: ["location"],
    }),
    execute: async (input, option) => {
        return {
            location: input.location,
            temperature: "25°C",
            condition: "Sunny",
        };
    },
};

const sendMessage: Tool = {
    type: "function",
    description: "Send a message to a user. This is the only way to communicate with the user.",
    inputSchema: jsonSchema<{ content: string }>({
        type: "object",
        properties: {
            content: { type: "string" },
        },
        required: ["content"],
    }),
    execute: async (input) => {
        console.log(`Message sent: ${input.content}`);
        return { success: true };
    },
};

function stepIsAction(options: { steps: Array<StepResult<any>> }): boolean {
    const lastStep = options.steps[options.steps.length - 1];
    const toolName = lastStep.toolCalls[0]?.toolName;
    return toolName === "sendMessage";
}

async function testJSONCall() {
    console.log("----- JSON Call Test -----");
    const response = await generateText({
        model: deepseek("deepseek-chat"),
        system: "你是一个温柔的猫娘伙伴。请以 JSON 格式输出：{actions: [{type: 'action', name: 'send_message', args: {content: '你的回复'}}]}",
        prompt: "用户说：今天心情不太好",
        temperature: 0,
        seed: 114514,
        stopWhen: [stepCountIs(3), stepIsAction],
    });

    console.log("Generate Text Response:", response.text);
    console.log("Usage:", response.totalUsage);
    console.log("----- End of JSON Call Test -----");
}

async function testToolCall() {
    console.log("----- Tool Call Test -----");
    const response = await generateText({
        model: deepseek("deepseek-chat"),
        system: "你是一个温柔的猫娘伙伴。你只能通过 sendMessage 工具与用户交流。",
        prompt: "用户说：今天心情不太好",
        temperature: 0,
        seed: 114514,
        tools: {
            sendMessage: tool(sendMessage),
        },
        stopWhen: [stepCountIs(3), stepIsAction],
    });

    console.log("Generate Text Response:", response.text);
    console.log("Usage:", response.totalUsage);
    console.log("----- End of Tool Call Test -----");
}

async function test() {
    await testJSONCall();
    await testToolCall();
}

test();
