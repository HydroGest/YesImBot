import { Context } from "koishi";
import mock, { MessageClient } from "@koishijs/plugin-mock";
import { beforeAll, afterAll, jest, it } from "@jest/globals";
import assert from "assert";

import * as help from "@koishijs/plugin-help";
import * as logger from "@koishijs/plugin-logger";
import * as yesimbot from "../src/index";

import testConfig from "./config";

import { emojiManager } from "../src/utils/content";
import { CustomAdapter } from "../src/adapters";

// 拦截 sendRequest 函数请求
jest.mock("../src/utils/tools", () => {
  const originalModule = jest.requireActual("../src/utils/tools");
  return {
    //@ts-ignore
    ...originalModule,
    //@ts-ignore
    sendRequest: jest.fn().mockImplementation(async (url: string, APIKey: string, requestBody: any) => {
          // 通过 url 细分, 返回不同的 response
          // TODO: 通过创建特定规则的 url, 测试不同格式的回复
          // 比如: /custom/wrong_json 对应错误的 json 输出
          const content =
            '{\n  "status": "success",\n  "logic": "<logic>",\n  "reply": "下雨了记得带伞哦~",\n  "select": -1,\n  "check": "<check>",\n  "finReply": "下雨了记得带伞哦~",\n  "execute": [\n    {\n      "action": "send_message",\n      "params": {\n        "msg": "下雨了记得带伞哦~",\n        "to": "group1"\n      }\n    }\n  ]\n}';
          if (url.startsWith("/openai/embedding")) {
            return;
          } else if (url.startsWith("http://localhost:11434/api/embeddings")) {
            //@ts-ignore
            return await originalModule.sendRequest(url, APIKey, requestBody);
          } else if (url.startsWith("/openai")) {
            return {
              choices: [
                {
                  message: {
                    content: content,
                  },
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
                response: content,
              },
            };
          } else if (url.startsWith("/ollama")) {
            return {
              message: {
                content: content,
              },
              prompt_eval_count: 26,
              eval_count: 298,
            };
          } else if (url.startsWith("/custom")) {
            return {
              choices: [
                {
                  message: {
                    content: content,
                  },
                },
              ],
              usage: {
                prompt_tokens: 4922,
                completion_tokens: 253,
                total_tokens: 5175,
              },
            };
          } else throw new Error(`不支持的 API 类型: ${url}`);
        }
      ),
  };
});

function createUser(id: string) {
  return {
    id: id,
    name: `User<${id}>`,
    nick: `Nick<${id}>`,
  };
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
    this.app.plugin(yesimbot, testConfig);

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
      return createUser(id);
    };

    // 等待 app 启动完成
    beforeAll(() => this.app.start());
    afterAll(() => this.app.stop());
  }

  test() {
    
    // 依次测试每个适配器, 保证能正确处理 ai 消息
    it("适配器解析", async () => {
      await this.client.shouldReply(`<at id="${this.client.bot.selfId}" name="" /> 你好`);
      await this.client.shouldReply(`<at id="${this.client.bot.selfId}" name="" /> 你好`);
      await this.client.shouldReply(`<at id="${this.client.bot.selfId}" name="" /> 你好`);
      await this.client.shouldReply(`<at id="${this.client.bot.selfId}" name="" /> 你好`);
    });

    it("AT 立即回复", async () => {
      await this.client.shouldReply(
        `<at id="${this.client.bot.selfId}" name="YesImBot" /> 你好`
      );
    });

    it("达到初始触发计数(3)", async () => {
      await this.client.receive("清除记忆");
      await this.client.shouldNotReply("第一条消息");
      await this.client.shouldNotReply("第二条消息");
      await this.client.shouldReply("第三条消息");
    });

    // it("回复间隔消息数(1)", async () => {
    //   await this. client.receive("清除记忆");
    //   await this. client.shouldNotReply("第一条消息");
    //   await this. client.shouldNotReply("第二条消息");
    //   await this. client.shouldReply("第三条消息");
    //   await this. client.shouldNotReply("第四条消息");
    //   await this. client.shouldReply("第五条消息");
    // });

    it("私聊", async () => {
      const privateClient = this.app.mock.client("12345678");
      await privateClient.receive("清除记忆");
      await privateClient.shouldReply(`<at id="${privateClient.bot.selfId}" name="" /> 你好`);
    });

    it("清除记忆", async () => {
      await this.client.receive("清除记忆");
      await this.client.receive("这是一条消息");
      await this.client.shouldReply("清除记忆", `已清除关于 ${this.client.channelId} 的记忆`)
      await this.client.shouldReply("清除记忆", `未找到关于 ${this.client.channelId} 的记忆`)
      await this.client.shouldReply("清除记忆 -t 10000000", `未找到关于 10000000 的记忆`)
      const privateClient = this.app.mock.client("12345678")
      await privateClient.receive("这是一条消息")
      await privateClient.shouldReply("清除记忆", `已清除关于 private:${this.client.userId} 的记忆`)
      await privateClient.shouldReply("清除记忆", `未找到关于 private:${this.client.userId} 的记忆`)
      await privateClient.shouldReply("清除记忆 -t 10000000", `未找到关于 10000000 的记忆`)
      await privateClient.shouldReply("清除记忆 -t private:10000000", `未找到关于 private:10000000 的记忆`)
    });

    it("表情解析", async () => {
      // <face id="277" name="汪汪" platform="onebot"><img src="https://koishi.js.org/QFace/static/s277.png"/></face>
      const at = `<at id="${this.client.bot.selfId}" name="" />`
      const face = `<face id="277" name="汪汪" platform="onebot"><img src="https://koishi.js.org/QFace/static/s277.png"/></face>`
      assert.equal(await emojiManager.getIdByName("惊讶"), 0);
      assert.equal(await emojiManager.getNameById("277"), "汪汪");
    });

    it("表情解析Embedding", async () => {
      assert.equal(
        await emojiManager.getNameByTextSimilarity("征服世界", testConfig),
        "奋斗"
      );
    });

    it("表情解析Embedding", async () => {
      assert.equal(
        await emojiManager.getNameByTextSimilarity("火力全开", testConfig),
        "怄火"
      );
    });

    it("handleResponse", async () => {
      const adapter = new CustomAdapter(
        "/custom/static",
        "",
        "static"
      );

      const content = JSON.stringify({
        "status": "success",
        "logic": "",
        "select": -1,
        "reply": "",
        "check": "", //
        "finReply": "",
        "execute": [
          "echo 123"
        ]
      })

      const input = {
        choices: [
          {
            message: {
              content: content,
            },
          },
        ],
        usage: {
          prompt_tokens: 4922,
          completion_tokens: 253,
          total_tokens: 5175,
        },
      };

      const { res, resNoTag, LLMResponse, usage } = await adapter.handleResponse(
        input,
        true,
        testConfig,
        //@ts-ignore
        (await this.client.bot.getGuildMemberList(this.client.channelId)).data
      )
    });
  }
}

const tester = new Test();

tester.test();
