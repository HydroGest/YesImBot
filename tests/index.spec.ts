import { Context } from "koishi";
import mock, { MessageClient } from "@koishijs/plugin-mock";
import { describe, test, beforeAll, afterAll, jest } from "@jest/globals";

import * as help from "@koishijs/plugin-help";
import * as logger from "@koishijs/plugin-logger";
import * as yesimbot from "../src/index";

import config from "./config";
import { sendRequest } from "../src/utils/tools";

// 拦截 sendRequest 函数请求
jest.mock("../src/utils/tools");

// 通过 url 细分, 返回不同的 response
// TODO: 通过创建特定规则的 url, 测试不同格式的回复
// 比如: /custom/wrong_json 对应错误的 json 输出
//@ts-ignore
sendRequest.mockImplementation((url: string) => {
  const content =
    '{\n  "status": "success",\n  "logic": "<logic>",\n  "reply": "下雨了记得带伞哦~",\n  "select": -1,\n  "check": "<check>",\n  "finReply": "下雨了记得带伞哦~",\n  "execute": [\n    {\n      "action": "send_message",\n      "params": {\n        "msg": "下雨了记得带伞哦~",\n        "to": "group1"\n      }\n    }\n  ]\n}';
  if (url.startsWith("/openai")) {
    return {
      id: "chatcmpl-123",
      object: "chat.completion",
      created: 1677652288,
      model: "gpt-3.5-turbo-0613",
      system_fingerprint: "fp_44709d6fcb",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: content,
          },
          finish_reason: "stop",
        },
      ],
      usage: {
        prompt_tokens: 9,
        completion_tokens: 12,
        total_tokens: 21,
      },
    };
  } else if (url.startsWith("/cloudflare")) {
    return {
      result: {
           response: content
      },
      success: true,
      errors: [],
      messages: []
  };
  } else if (url.startsWith("/ollama")) {
    return {
      model: "llama3.2",
      created_at: "2023-12-12T14:13:43.416799Z",
      message: {
        role: "assistant",
        content: content,
      },
      done: true,
      total_duration: 5191566416,
      load_duration: 2154458,
      prompt_eval_count: 26,
      prompt_eval_duration: 383809000,
      eval_count: 298,
      eval_duration: 4799921000,
    };
  } else if (url.startsWith("/custom")) {
    return {
      id: "chatcmpl-89DA0jsir8Nwf1q8zXPVZ6lcHT6kT",
      object: "chat.completion",
      created: 1732205631,
      model: "glm-4-flash",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: content,
          },
          finish_reason: "stop",
        },
      ],
      usage: {
        prompt_tokens: 4922,
        completion_tokens: 253,
        total_tokens: 5175,
      },
    };
  } else throw new Error(`不支持的 API 类型: ${url}`);
});

function createUser(id: string) {
  return {
    id: id,
    name: `User<${id}>`,
    nick: `Nick<${id}>`
  }
}

class Test {
  app: Context;
  client: MessageClient;
  constructor() {
    // 创建客户端
    this.app = new Context();

    // 加载插件
    this.app.plugin(mock);
    this.app.plugin(help);
    this.app.plugin(logger);
    //@ts-ignore
    this.app.plugin(yesimbot, config);

    // 创建一个群组客户端
    this.client = this.app.mock.client("12345678", "114514");

    this.client.bot.getGuildMemberList = async (guildId: string, next?: string) => {
      return {
        data: [
          {
            user: createUser(this.client.bot.selfId),
            roles: ["member"],
          },
        ],
      };
    };

    this.client.bot.getUser = async (id, guildId) => { 
      return createUser(id)
    }

    // 等待 app 启动完成
    beforeAll(() => this.app.start());
    afterAll(() => this.app.stop());
  }

  test() {
    describe("", () => {
      // 依次测试每个适配器, 保证能正确处理 ai 消息
      test("适配器解析", async () => {
        await this.client.shouldReply(`<at id="${this.client.bot.selfId}" name="" /> 你好`);
        await this.client.shouldReply(`<at id="${this.client.bot.selfId}" name="" /> 你好`);
        await this.client.shouldReply(`<at id="${this.client.bot.selfId}" name="" /> 你好`);
        await this.client.shouldReply(`<at id="${this.client.bot.selfId}" name="" /> 你好`);
      })

      test("AT 立即回复", async () => {
        await this.client.shouldReply(`<at id="${this.client.bot.selfId}" name="YesImBot" /> 你好`);
      });

      test("达到初始触发计数(3)", async () => {
        await this.client.receive("清除记忆");
        await this.client.shouldNotReply("第一条消息");
        await this.client.shouldNotReply("第二条消息");
        await this.client.shouldReply("第三条消息");
      });

      // test("回复间隔消息数(1)", async () => {
      //   await this. client.receive("清除记忆");
      //   await this. client.shouldNotReply("第一条消息");
      //   await this. client.shouldNotReply("第二条消息");
      //   await this. client.shouldReply("第三条消息");
      //   await this. client.shouldNotReply("第四条消息");
      //   await this. client.shouldReply("第五条消息");
      // });

      test("私聊", async () => {
        const privateClient = this.app.mock.client("12345678")
        await privateClient.receive("清除记忆");
        await privateClient.shouldReply(`<at id="${privateClient.bot.selfId}" name="" /> 你好`);
      })

      test("清除记忆", async () => {
        await this.client.receive("清除记忆");
        await this.client.receive("这是一条消息")
        await this.client.shouldReply("清除记忆", `已清除关于 ${this.client.channelId} 的记忆`)
        await this.client.shouldReply("清除记忆", `未找到关于 ${this.client.channelId} 的记忆`)
        await this.client.shouldReply("清除记忆 -t 10000000", `未找到关于 10000000 的记忆`)
        const privateClient = this.app.mock.client("12345678")
        await privateClient.receive("这是一条消息")
        await privateClient.shouldReply("清除记忆", `已清除关于 private:${this.client.userId} 的记忆`)
        await privateClient.shouldReply("清除记忆", `未找到关于 private:${this.client.userId} 的记忆`)
        await privateClient.shouldReply("清除记忆 -t 10000000", `未找到关于 10000000 的记忆`)
        await privateClient.shouldReply("清除记忆 -t private:10000000", `未找到关于 private:10000000 的记忆`)
      })
    });
  }
}

const tester = new Test();

tester.test();


