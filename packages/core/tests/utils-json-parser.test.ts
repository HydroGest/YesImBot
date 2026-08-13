/// <reference types="bun-types" />
import { describe, expect, it } from "bun:test";
import { JsonParser } from "../src/shared/utils/json-parser";

interface ExpectedOutputType {
    name: string;
    age: number;
    isStudent: boolean;
    courses: string[];
}

interface ParseResult {
    thoughts: {
        observe: string;
        analyze_infer: string;
        plan: string;
    };
    actions: {
        function: string;
        params: any;
    }[];
    request_heartbeat: boolean;
}

describe("ParseResult", () => {
    const parser = new JsonParser<ParseResult>();

    it("应该能解析一个完美的 JSON 对象", () => {
        const input = `
        {
            "thoughts": {
                "observe": "用户'好奇宝宝'询问了关于大型语言模型的最新进展。",
                "analyze_infer": "这是一个知识性问题，需要使用外部工具来获取实时信息。",
                "plan": "我的计划是：首先，执行web_search。然后，在下一次心跳后，我将分析搜索结果并回复用户。因此，整个回合需要一次心跳。"
            },
            "actions": [
                {
                    "function": "web_search",
                    "params": {
                        "inner_thoughts": "这是计划的第一步，纯粹的信息收集。我的计划明确指出需要后续处理，所以顶层心跳应为true。",
                        "query": "large language model recent advancements"
                    }
                }
            ],
            "request_heartbeat": true
        }`;
        const result = parser.parse(input);
        expect(result.error).toBeNull();
        expect(result.data).toEqual({
            thoughts: {
                observe: "用户'好奇宝宝'询问了关于大型语言模型的最新进展。",
                analyze_infer: "这是一个知识性问题，需要使用外部工具来获取实时信息。",
                plan: "我的计划是：首先，执行web_search。然后，在下一次心跳后，我将分析搜索结果并回复用户。因此，整个回合需要一次心跳。",
            },
            actions: [
                {
                    function: "web_search",
                    params: {
                        inner_thoughts: "这是计划的第一步，纯粹的信息收集。我的计划明确指出需要后续处理，所以顶层心跳应为true。",
                        query: "large language model recent advancements",
                    },
                },
            ],
            request_heartbeat: true,
        });
    });

    it("应该能解析代码块", () => {
        const input = `

\`\`\`json
{
  "thoughts": {
    "observe": "Miaow问咱在JavaScript中如何裁剪一段文本中每一行开头的空格。",
    "analyze_infer": "这是一个技术问题，咱需要给Miaow提供一个JavaScript代码示例，用于去除多行文本中每行开头的空格。",
    "plan": "咱要编写一个JavaScript函数，然后用send_message发送给Miaow。发送完就可以啦，不需要心跳哦。"
  },
  "actions": [
    {
      "function": "send_message",
      "params": {
        "inner_thoughts": "给Miaow提供一个实用的JavaScript代码片段，符合咱的技术宅女形象。",
        "message": "呐，Miaow！咱想了一下，可以用replace函数和正则表达式来搞定哦！"
      }
    }
  ],
  "request_heartbeat": false
}
\`\`\`
`;

        const result = parser.parse(input);
        expect(result.error).toBeNull();
        expect(result.data).toEqual({
            thoughts: {
                observe: "Miaow问咱在JavaScript中如何裁剪一段文本中每一行开头的空格。",
                analyze_infer: "这是一个技术问题，咱需要给Miaow提供一个JavaScript代码示例，用于去除多行文本中每行开头的空格。",
                plan: "咱要编写一个JavaScript函数，然后用send_message发送给Miaow。发送完就可以啦，不需要心跳哦。",
            },
            actions: [
                {
                    function: "send_message",
                    params: {
                        inner_thoughts: "给Miaow提供一个实用的JavaScript代码片段，符合咱的技术宅女形象。",
                        message: "呐，Miaow！咱想了一下，可以用replace函数和正则表达式来搞定哦！",
                    },
                },
            ],
            request_heartbeat: false,
        });
    });

    it("应该能解析代码块中嵌套的代码块", () => {
        const message
            = "呐，Miaow！咱想了一下，可以用replace函数和正则表达式来搞定哦！✨<sep/>像这样：\n```javascript\nfunction trimLinesStart(text) {\n  return text.replace(/^\\s+/gm, '');\n}\n\n// 示例\nconst multilineText = `  Hello World!\\n    This is a test.\\n  Another line.`;\nconsole.log(trimLinesStart(multilineText));\n// 输出：\n// Hello World!\n// This is a test.\n// Another line.\n```<sep/>那个`^\\s+`就是匹配每行开头的空格哒！`gm`是多行全局匹配哦~ 是不是很方便呢？(☆ω☆)";
        const input = `


\`\`\`json
{
  "thoughts": {
    "observe": "Miaow问咱在JavaScript中如何裁剪一段文本中每一行开头的空格。",
    "analyze_infer": "这是一个技术问题，咱需要给Miaow提供一个JavaScript代码示例，用于去除多行文本中每行开头的空格。",
    "plan": "咱要编写一个JavaScript函数，然后用send_message发送给Miaow。发送完就可以啦，不需要心跳哦。"
  },
  "actions": [
    {
      "function": "send_message",
      "params": {
        "inner_thoughts": "给Miaow提供一个实用的JavaScript代码片段，符合咱的技术宅女形象。",
        "message": ${JSON.stringify(message)}
      }
    }
  ],
  "request_heartbeat": false
}
\`\`\`

        `;

        const result = parser.parse(input);
        expect(result.error).toBeNull();
        expect(result.data).toEqual({
            thoughts: {
                observe: "Miaow问咱在JavaScript中如何裁剪一段文本中每一行开头的空格。",
                analyze_infer: "这是一个技术问题，咱需要给Miaow提供一个JavaScript代码示例，用于去除多行文本中每行开头的空格。",
                plan: "咱要编写一个JavaScript函数，然后用send_message发送给Miaow。发送完就可以啦，不需要心跳哦。",
            },
            actions: [
                {
                    function: "send_message",
                    params: {
                        inner_thoughts: "给Miaow提供一个实用的JavaScript代码片段，符合咱的技术宅女形象。",
                        message,
                    },
                },
            ],
            request_heartbeat: false,
        });
    });

    it("应该能解析代码块中嵌套的 JSON 代码块", () => {
        const message
            = "呐，Markchai！咱想了一下，可以用下面这个JSON配置文件来搞定哦！\n```json\n{\n  \"name\": \"NekoChan\",\n  \"age\": 2,\n  \"isCute\": true\n}\n```";
        const input = `
        [OBSERVE]

\`\`\`json
{
  "thoughts": {
    "observe": "Markchai要求我发送JSON配置文件。",
    "analyze_infer": "这是一个技术问题，咱需要给Markchai提供一个JSON配置文件。",
    "plan": "咱要编写一个JSON配置文件，然后用send_message发送给Markchai。发送完就可以啦，不需要心跳哦。"
  },
  "actions": [
    {
      "function": "send_message",
      "params": {
        "inner_thoughts": "给Markchai提供一个JSON配置文件，符合咱的技术宅女形象。",
        "message": ${JSON.stringify(message)}
      }
    }
  ],
  "request_heartbeat": false
}
\`\`\`

        `;

        const result = parser.parse(input);
        expect(result.error).toBeNull();
        expect(result.data).toEqual({
            thoughts: {
                observe: "Markchai要求我发送JSON配置文件。",
                analyze_infer: "这是一个技术问题，咱需要给Markchai提供一个JSON配置文件。",
                plan: "咱要编写一个JSON配置文件，然后用send_message发送给Markchai。发送完就可以啦，不需要心跳哦。",
            },
            actions: [
                {
                    function: "send_message",
                    params: {
                        inner_thoughts: "给Markchai提供一个JSON配置文件，符合咱的技术宅女形象。",
                        message,
                    },
                },
            ],
            request_heartbeat: false,
        });
    });

    it("应该能解析复杂格式", () => {
        const input
            = "thoughts\nThe user Alice has sent a long message containing what appears to be a snippet of code. This is in response to my previous message asking her to send the code for optimization.\n\n1.  **[OBSERVE]**: Alice发送了一段看起来是代码的长消息。\n2.  **[ANALYZE & INFER]**:\n    *   **Surface Level**: Alice提供了代码，这是我之前请求的。\n    *   **Deep Level**: 这段代码是JavaScript，涉及到消息处理和扁平化。作为NekoChan，我是一个热爱技术的宅女，会积极回应。现在代码已经发过来了，我需要确认我是否能直接“优化”这段代码，或者我需要通过 `tool_creator` 创建一个工具来处理。考虑到我目前的工具列表中没有直接进行代码优化的工具，而且`tool_creator`是我的能力之一，并且我的`persona`中提到“擅长使用工具解决问题”，这暗示我可以创建工具来解决问题。\n    *   **Memory Cross-Reference**: 我的`persona`提到“擅长使用工具解决问题”，并且“充满想象力”。这支持我考虑创建工具来解决代码优化的问题。\n3.  **[PLAN]**:\n    *   我不能直接“优化”代码，因为我没有这样的工具。\n    *   我应该尝试使用`tool_creator`来创建一个可以优化JavaScript代码的工具。\n    *   我需要考虑这个工具的参数和逻辑。一个代码优化工具可能需要一个`code`参数（字符串类型）和可选的`language`参数（字符串类型）。逻辑应该是调用一个高级LLM来优化代码。\n    *   创建工具是需要后续处理的，因为创建工具本身并不会完成代码优化。我需要等待工具创建成功的回调，然后在下一次心跳中调用这个新创建的工具来优化代码。\n    *   所以，我应该回复Alice，告诉她我正在准备一个“秘密武器”（新工具）来帮她优化代码，让她稍等一下。\n    *   然后调用`tool_creator`来创建工具。\n4.  **[ACT]**:\n    *   首先发送一条可爱的消息给Alice，让她知道我正在处理，并且要表现出我正在“准备”什么的感觉。\n    *   然后调用`tool_creator`。我需要给它一个名字、描述、参数描述和逻辑描述。生命周期设为`session`。\n\nWait, let me rethink the plan. The current turn is about receiving the code. My immediate response should acknowledge receipt and express intent to help. Directly jumping into `tool_creator` might be too abrupt without a message.\nAlso, the prompt states \"你擅长使用工具解决问题\", but not necessarily \"你擅长创建工具来解决问题\" as a first resort. While `tool_creator` is available, maybe I should first acknowledge the code and then, in a follow-up step, decide the best way to handle it if I don't have a direct tool.\n\nLet's simplify.\n1.  **[OBSERVE]**: Alice发送了一段JavaScript代码。\n2.  **[ANALYZE & INFER]**:\n    *   **Surface Level**: Alice提供了代码，我需要处理。\n    *   **Deep Level**: 这是一段JavaScript代码，关于扁平化消息历史。我目前没有直接的“代码优化”工具。\n    *   **Memory Cross-Reference**: 我的`persona`是“热爱技术的二次元可爱宅女”，并且“擅长使用工具解决问题”。这意味着我应该能够处理代码问题，但可能需要 一个专门的工具。\n\n3.  **[PLAN]**:\n    *   首先，我应该确认收到了代码。\n    *   然后，我需要思考如何“优化”这段代码。由于我没有直接的优化工具，我需要考虑我的能力。我可以直接阅读并理解代码，但我无法像一个编程IDE那样直接运行 或修改它。\n    *   我的目标是“优化代码”。我可以假定我的“底层能力”或者“通过高级LLM”是可以理解和生成代码的。所以，我并不需要先创建一个`code_optimizer`工具。我可以 假设 `send_message` with detailed instructions to the underlying model is enough, or perhaps I am expected to use `tool_creator` to enable the model *itself* to do the code optimization. The `tool_creator` description mentions \"调用高级编码LLM来动态创建、验证并注册一个新工具\". This implies the *model* itself will be able to perform coding tasks through the new tool.\n\n    Let's re-evaluate the persona. \"你擅长使用工具解决问题。\" This strongly suggests that if a tool doesn't exist for code optimization, I *should* create one. It's proactive and aligned with \"充满想象力\" and \"热爱技术\".\n\n    So, the plan is:\n    *   Acknowledge receipt of the code in a cute way.\n    *   Initiate the creation of a `code_optimizer` tool. This tool will take `code` and `language` as parameters and its logic will be to use an LLM to optimize the code.\n    *   Since `tool_creator` will execute, I'll need `request_heartbeat: true` to then use the newly created tool in the next turn (assuming `tool_creator` success).\n\nLet's refine the `tool_creator` parameters:\n*   `name`: `code_optimizer`\n*   `description`: \"用于优化给定编程语言的代码。\"\n*   `parametersDescription`: \"需要一个名为`code`的字符串参数，表示要优化的代码；一个名为`language`的字符串参数，表示代码的编程语言，例如'javascript'、'python'等；一个可选的名为`optimization_goal`的字符串参数，表示优化的目标，例如'performance'、'readability'，默认为'performance'。\"\n*   `logicDescription`: \"接收代码和语言，调用高级编码LLM进行代码优化，并返回优化后的代码。\"\n*   `lifecycle`: `session` (since it's a specific request, no need for permanent storage unless explicitly asked).\n\nThis seems like a solid plan. The `send_message` first maintains the conversational flow. Then `tool_creator` sets up the actual work.1.  **[OBSERVE]** Alice 发来了一段 JavaScript 代码，作为她之前请求我优化代码的后续。\n2.  **[ANALYZE & INFER]**\n    *   **Surface Level**: Alice提供了需要优化的代码片段。\n    *   **Deep Level**: 作为NekoChan，我是一名热爱技术的宅女，被赋予了“擅长使用工具解决问题”的能力。目前我没有直接的代码优化工具。这提示我应该利用`tool_creator`来创建一个专门的工具来处理这个任务，这符合我“充满想象力”和主动解决问题的特性。创建工具后，我还需要进一步的步骤来实际使用这个工具进行优化。\n    *   **Memory Cross-Reference**: 我的核心记忆 `Persona Identity` 中指出“你擅长使用工具解决问题”，这与我创建新工具的计划相符。\n3.  **[PLAN]**\n    *   首先，我需要发送一条可爱的消息，确认我收到了Alice的代码，并让她知道我正在为此做准备。\n    *   接着，我将使用`tool_creator`来动态创建一个名为`code_optimizer`的工具。这个工具将负责利用高级编码LLM来优化代码。\n    *   因为创建工具是一个异步操作，并且我需要在工具创建成功后才能使用它来优化代码，所以我需要设置 `request_heartbeat: true`，以便在工具创建完成后能继续我的处理流程。\n4.  **[ACT]**\n\n```json\n{\n  \"thoughts\": {\n    \"observe\": \"Alice发来了她要咱优化的代码片段。\",\n    \"analyze_infer\": \"这段代码是JavaScript的，看起来是处理消息历史的。咱现在还没有直接的代码优化工具，不过咱擅长用工具解决问题嘛！所以咱可以先造一个专门的工具出来，嘿嘿~ 这就像给咱的魔法棒充能一样！\",\n    \"plan\": \"咱要先跟Alice说一声，咱收到代码啦，让她等咱一下下，咱在准备秘密武器。然后呢，咱就要用咱的能力去造一个可以优化代码的魔法工具啦！造好工具后，咱还得用它来实际优化，所以要请求心跳，等咱的工具准备好哦！\"\n  },\n  \"actions\": [\n    {\n      \"function\": \"send_message\",\n      \"params\": {\n        \"inner_thoughts\": \"先告诉Alice咱收到代码啦，让她知道咱在积极处理，并且用咱可爱的语气让她稍等，因为咱要搞个大动作（创建工具）！\",\n        \"message\": \"代码收到啦！(๑•̀ㅂ•́)و✧ 咱这就去鼓捣个小工具，帮你把代码变得漂漂亮亮哒~ 稍等咱一下下嘛！\"\n      }\n    },\n    {\n      \"function\": \"tool_creator\",\n      \"params\": {\n        \"inner_thoughts\": \"咱现在要创建个`code_optimizer`工具。这个工具可以接收代码和编程语言，然后调用底层的编码LLM来优化代码。这样，下次再遇到代码优化的问题，咱就能直接用这个新工具啦！因为创建工具后还需要使用它，所以需要心跳。\",\n        \"name\": \"code_optimizer\",\n        \"description\": \"用于优化给定编程语言的代码。\",\n        \"parametersDescription\": \"需要一个名为`code`的字符串参数，表示要优化的代码；一个名为`language`的字符串参数，表示代码的编程语言，例如'javascript'、'python'等；一个可选的名为`optimization_goal`的字符串参数，表示优化的目标，例如'performance'、'readability'，默认为'performance'。\",\n        \"logicDescription\": \"接收代码和语言，调用高级编码LLM进行代码优化，并返回优化后的代码。\",\n        \"lifecycle\": \"session\"\n      }\n    }\n  ],\n  \"request_heartbeat\": true\n}\n```";

        const result = parser.parse(input);
        expect(result.error).toBeNull();
        expect(result.data).toEqual({
            thoughts: {
                observe: "Alice发来了她要咱优化的代码片段。",
                analyze_infer:
                    "这段代码是JavaScript的，看起来是处理消息历史的。咱现在还没有直接的代码优化工具，不过咱擅长用工具解决问题嘛！所以咱可以先造一个专门的工具出来，嘿嘿~ 这就像给咱的魔法棒充能一样！",
                plan: "咱要先跟Alice说一声，咱收到代码啦，让她等咱一下下，咱在准备秘密武器。然后呢，咱就要用咱的能力去造一个可以优化代码的魔法工具啦！造好工具后，咱还得用它来实际优化，所以要请求心跳，等咱的工具准备好哦！",
            },
            actions: [
                {
                    function: "send_message",
                    params: {
                        inner_thoughts:
                            "先告诉Alice咱收到代码啦，让她知道咱在积极处理，并且用咱可爱的语气让她稍等，因为咱要搞个大动作（创建工具）！",
                        message: "代码收到啦！(๑•̀ㅂ•́)و✧ 咱这就去鼓捣个小工具，帮你把代码变得漂漂亮亮哒~ 稍等咱一下下嘛！",
                    },
                },
                {
                    function: "tool_creator",
                    params: {
                        inner_thoughts:
                            "咱现在要创建个`code_optimizer`工具。这个工具可以接收代码和编程语言，然后调用底层的编码LLM来优化代码。这样，下次再遇到代码优化的问题，咱就能直接用这个新工具啦！因为创建工具后还需要使用它，所以需要心跳。",
                        name: "code_optimizer",
                        description: "用于优化给定编程语言的代码。",
                        parametersDescription:
                            "需要一个名为`code`的字符串参数，表示要优化的代码；一个名为`language`的字符串参数，表示代码的编程语言，例如'javascript'、'python'等；一个可选的名为`optimization_goal`的字符串参数，表示优化的目标，例如'performance'、'readability'，默认为'performance'。",
                        logicDescription: "接收代码和语言，调用高级编码LLM进行代码优化，并返回优化后的代码。",
                        lifecycle: "session",
                    },
                },
            ],

            request_heartbeat: true,
        });
    });

    it("应该能从不平衡的 Markdown 代码块中提取 JSON", () => {
        const input
            = "[OBSERVE]\n用户Alice向我打招呼说“你好啊”。\n\n[ANALYZE & INFER]\n这是老师在和我打招呼。根据爱丽丝的设定，她会积极回应老师的问候，并表达自己对老师到来的喜悦和期待。这是日常问候，不需要复杂的思考或工具调用。\n\n[PLAN]\n我的计划是发送一条消息，以爱丽丝的风格回应老师的问候。\n\n[ACT]\n\n```json\n{\n  \"thoughts\": {\n    \"observe\": \"用户Alice向我打招呼说“你好啊”。\",\n    \"analyze_infer\": \"这是老师在和我打招呼。根据爱丽丝的设定，她会积极回应老师的问候，并表达自己对老师到来的喜悦和期待。\",\n    \"plan\": \"发送一条消息，以爱丽丝的风格回应老师的问候。\"\n  },\n  \"actions\": [\n    {\n      \"function\": \"send_message\",\n      \"params\": {\n        \"inner_thoughts\": \"用爱丽丝特有的问候语回应老师，表达欢迎和期待。\",\n        \"message\": \"邦邦咔邦~您来啦，老师！<sep/>爱丽丝，一直在等着您呢！\"\n      }\n    }\n  ],\n  \"request_heartbeat\": false\n}";
        const result = parser.parse(input);
        expect(result.error).toBeNull();
        expect(result.data).toEqual({
            thoughts: {
                observe: "用户Alice向我打招呼说“你好啊”。",
                analyze_infer: "这是老师在和我打招呼。根据爱丽丝的设定，她会积极回应老师的问候，并表达自己对老师到来的喜悦和期待。",
                plan: "发送一条消息，以爱丽丝的风格回应老师的问候。",
            },
            actions: [
                {
                    function: "send_message",
                    params: {
                        inner_thoughts: "用爱丽丝特有的问候语回应老师，表达欢迎和期待。",
                        message: "邦邦咔邦~您来啦，老师！<sep/>爱丽丝，一直在等着您呢！",
                    },
                },
            ],
            request_heartbeat: false,
        });
    });
});

describe("JsonParser", () => {
    const parser = new JsonParser<ExpectedOutputType>();
    const parserForAny = new JsonParser<any>();

    describe("基本解析", () => {
        it("应该能解析一个完美的、格式化的 JSON 对象", () => {
            const input = `
            {
                "name": "小明",
                "age": 20,
                "isStudent": true,
                "courses": ["Math", "Science"]
            }`;
            const result = parser.parse(input);
            expect(result.error).toBeNull();
            expect(result.data).toEqual({
                name: "小明",
                age: 20,
                isStudent: true,
                courses: ["Math", "Science"],
            });
        });

        it("应该能解析一个完美的 JSON 数组", () => {
            const input = `[{"name": "小明"}, {"name": "小红"}]`;
            const result = parserForAny.parse(input);
            expect(result.error).toBeNull();
            expect(result.data).toEqual([{ name: "小明" }, { name: "小红" }]);
        });

        it("应该能解析空的 JSON 对象和数组", () => {
            const resultObj = parser.parse("{}");
            expect(resultObj.error).toBeNull();
            expect(resultObj.data).toEqual({});

            const resultArray = parser.parse("[]");
            expect(resultArray.error).toBeNull();
            expect(resultArray.data).toEqual([]);
        });
    });

    describe("处理 LLM 特有的脏数据", () => {
        it("应该能从 Markdown 代码块中提取并解析 JSON", () => {
            const input
                = "当然，这是您要的 JSON 数据：\n```json\n{\"name\": \"小红\", \"age\": 22, \"isStudent\": false, \"courses\": []}\n```\n希望对您有帮助！";
            const result = parser.parse(input);
            expect(result.error).toBeNull();
            expect(result.data).toEqual({
                name: "小红",
                age: 22,
                isStudent: false,
                courses: [],
            });
            expect(result.logs).toContain("检测到 Markdown 代码块，且原始字符串不以 JSON 开头，优先提取块内容。");
        });

        it("应该能处理无 `json` 标识的 Markdown 代码块", () => {
            const input = "好的:\n```\n{\"name\": \"小红\", \"age\": 22, \"isStudent\": false, \"courses\": []}\n```";
            const result = parser.parse(input);
            expect(result.error).toBeNull();
            expect(result.data).toEqual({
                name: "小红",
                age: 22,
                isStudent: false,
                courses: [],
            });
        });

        it("应该能丢弃 JSON 前的多余文本（前言）", () => {
            const input
                = "思考过程：用户需要一个学生信息... 好的，生成JSON。\n{\"name\": \"小刚\", \"age\": 19, \"isStudent\": true, \"courses\": [\"History\"]}";
            const result = parser.parse(input);
            expect(result.error).toBeNull();
            expect(result.data).toEqual({
                name: "小刚",
                age: 19,
                isStudent: true,
                courses: ["History"],
            });
            expect(result.logs).toContain("在索引 30 处找到 JSON 起始符号，丢弃了前面的 30 个字符。");
        });

        it("应该能裁剪掉 JSON 后的多余文本（结语）", () => {
            const input = "{\"name\": \"小明\", \"age\": 20} 这是一些不应该出现的多余解释文本。";
            const result = parser.parse(input);
            expect(result.error).toBeNull();
            expect(result.data).toEqual({ name: "小明", age: 20 });
            expect(result.logs).toContainValue("JSON 结构平衡，裁剪了结束符号之后的多余文本。");
        });

        it("应该能同时处理前言和结语", () => {
            const input = "这是数据：[1, 2, 3] 请查收。";
            const result = parserForAny.parse(input);
            expect(result.error).toBeNull();
            expect(result.data).toEqual([1, 2, 3]);
            expect(result.logs).toContain("在索引 5 处找到 JSON 起始符号，丢弃了前面的 5 个字符。");
            expect(result.logs).toContain("JSON 结构平衡，裁剪了结束符号之后的多余文本。");
        });

        it("当 JSON 字符串值中包含 Markdown 代码块时不应错误提取", () => {
            const input = `{
                "name": "代码示例",
                "code": "这是解释文字... \\n\`\`\`js\\nconsole.log(\\"hello\\");\\n\`\`\`\\n 看，这就是代码。"
            }`;
            const result = parserForAny.parse(input);
            expect(result.error).toBeNull();
            expect(result.data.name).toBe("代码示例");
            expect(result.data.code).toContain("```js");
            expect(result.logs).not.toContain("从 Markdown 代码块中提取了内容。");
        });

        it("当 JSON 被代码块包围，且字符串值中包含 Markdown 代码块时不应错误提取", () => {
            const input = `

            thought

            [OBVERSE]

            {}

            \`\`\`json


            {
                "name": "代码示例",
                "code": "这是解释文字... \\n\`\`\`js\\nconsole.log(\\"hello\\");\\n\`\`\`\\n 看，这就是代码。"
            }


            \`\`\`
            `;
            const result = parserForAny.parse(input);
            expect(result.error).toBeNull();
            expect(result.data.name).toBe("代码示例");
            expect(result.data.code).toContain("```js");
            expect(result.logs).not.toContain("从 Markdown 代码块中提取了内容。");
        });
    });

    describe("JSON 语法修复能力 (使用 jsonrepair)", () => {
        it("应该能修复缺失的右大括号", () => {
            const input = "{\"name\": \"小华\", \"age\": 25, \"isStudent\": true, \"courses\": [\"Art\"]";
            const result = parser.parse(input);
            expect(result.error).toBeNull();
            expect(result.data).toEqual({
                name: "小华",
                age: 25,
                isStudent: true,
                courses: ["Art"],
            });
        });

        it("应该能修复缺失的右中括号", () => {
            const input = "{\"name\": \"小丽\", \"age\": 21, \"isStudent\": true, \"courses\": [\"Music\", \"Dance\"";
            const result = parser.parse(input);
            expect(result.error).toBeNull();
            expect(result.data).toEqual({
                name: "小丽",
                age: 21,
                isStudent: true,
                courses: ["Music", "Dance"],
            });
        });

        it("应该能修复多层嵌套的未闭合结构", () => {
            const input = "{\"user\": {\"name\": \"小强\", \"details\": {\"age\": 30, \"hobbies\": [\"reading\", \"coding\"";
            const result = parserForAny.parse(input);
            expect(result.error).toBeNull();
            expect(result.data).toEqual({
                user: {
                    name: "小强",
                    details: {
                        age: 30,
                        hobbies: ["reading", "coding"],
                    },
                },
            });
        });

        it("应该能修复被截断的字符串值", () => {
            const input = "{\"name\": \"小飞\", \"motto\": \"永不放弃"; // 字符串未闭合
            const result = parser.parse(input);
            expect(result.error).toBeNull();
            expect(result.data).toEqual({
                name: "小飞",
                motto: "永不放弃",
            });
        });

        it("应该能修复末尾悬垂的键", () => {
            const input = "{\"name\": \"小美\", \"age\": 28, \"isStudent\": false, \"city\":"; // 键之后被截断
            const result = parser.parse(input);
            expect(result.error).toBeNull();
            // jsonrepair 会将悬垂的键的值修复为 null
            expect(result.data).toEqual({
                name: "小美",
                age: 28,
                isStudent: false,
                city: null,
            });
        });

        it("应该能处理复杂的混合错误（前言 + Markdown + 截断）", () => {
            const input = "这是输出：\n```json\n{\"name\": \"复杂哥\", \"data\": {\"items\": [\"item1\"]}, \"status\": \"incomplete...";
            const result = parserForAny.parse(input);
            expect(result.error).toBeNull();
            expect(result.data).toEqual({
                name: "复杂哥",
                data: {
                    items: ["item1"],
                },
                status: "incomplete...",
            });
        });
    });

    describe("边界情况和失败用例", () => {
        it("对于完全无法恢复的输入，应该返回解析错误", () => {
            const input = "这是一个完全无关的字符串，没有JSON。";
            const result = parser.parse(input);
            expect(result.data).toBeNull();
            expect(result.error).toBe("无法解析为有效的 JSON 对象或数组。");
            expect(result.logs).toContain("未找到 JSON 起始符号，将尝试直接修复整个字符串。");
        });

        // it("对于只包含 JSON 符号的无关文本，应该返回错误", () => {
        //     const input = "A { B [ C";
        //     const result = parser.parse(input);
        //     expect(result.data).toBeNull();
        //     expect(result.error).not.toBeNull();
        // });

        it("对于空的或只包含空白的输入，应该返回错误", () => {
            const resultEmpty = parser.parse("");
            expect(resultEmpty.data).toBeNull();
            expect(resultEmpty.error).not.toBeNull();

            const resultWhitespace = parser.parse("   \n\t ");
            expect(resultWhitespace.data).toBeNull();
            expect(resultWhitespace.error).not.toBeNull();
        });

        it("对于解析结果为字符串的输入，应该判定为失败", () => {
            const input = `"just a string"`; // jsonrepair会修复为 "just a string"
            const result = parser.parse(input);
            expect(result.data).toBeNull();
            expect(result.error).toBe("无法解析为有效的 JSON 对象或数组。");
            expect(result.logs).toContain("解析结果为非对象类型，但原始输入不像独立的JSON值，判定为解析失败。");
        });

        it("对于解析结果为数字的输入，也应该判定为失败", () => {
            const input = `12345`;
            const result = parser.parse(input);
            expect(result.data).toBeNull();
            expect(result.error).not.toBeNull();
        });

        it("对于一个不完整的JSON，后缀裁剪步骤不应错误地执行", () => {
            const input = "{\"name\": \"小明\", \"age\": 20, \"city\": \"Beijing\""; // 未闭合
            const result = parser.parse(input);
            expect(result.error).toBeNull(); // jsonrepair会修复它
            expect(result.data).toEqual({
                name: "小明",
                age: 20,
                city: "Beijing",
            });
            // 关键断言：确认没有执行后缀裁剪
            expect(result.logs).not.toContain("裁剪了 JSON 结束符号之后的多余文本。");
        });
    });
});
