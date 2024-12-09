import { App } from "koishi";
import { h } from "koishi";
import mock, { MessageClient } from "@koishijs/plugin-mock";
import { MockBot } from "@koishijs/plugin-mock";
import { beforeAll, afterAll, jest, it, describe } from "@jest/globals";
import assert from "assert";

import database from "@koishijs/plugin-database-memory";
import * as help from "@koishijs/plugin-help";
import * as logger from "@koishijs/plugin-logger";
import * as yesimbot from "../src/index";

import testConfig from "./config";

import { emojiManager } from "../src/managers/emojiManager";
import { CustomAdapter } from "../src/adapters";
import { processText } from "../src/utils/content";

// 拦截 sendRequest 函数请求
jest.mock("../src/utils/http", () => {
  const originalModule = jest.requireActual("../src/utils/http");
  return {
    //@ts-ignore
    ...originalModule,
    //@ts-ignore
    sendRequest: jest.fn().mockImplementation(async (url: string, APIKey: string, requestBody: any) => {
          // 通过 url 细分, 返回不同的 response
          // TODO: 通过创建特定规则的 url, 测试不同格式的回复
          // 比如: /custom/wrong_json 对应错误的 json 输出
          const content = JSON.stringify({
            status: "success",
            logic: "<logic>",
            reply: "下雨了记得带伞哦~",
            nextReplyIn: 3,
            //session_id: "",
            check: "<check>",
            finalReply: "下雨了记得带伞哦~",
            execute: [],
          });
          
          if (url.startsWith("/openai")) {
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
          } else {
            //@ts-ignore
            return await originalModule.sendRequest(url, APIKey, requestBody);
          }
        }
      ),
  };
});

function createUser(id: string) {
  return {
    id: id,
    nick: `Nick<${id}>`,
    user: {
      id: id,
      name: `User<${id}>`,
    }
  };
}

class Test {
  app: App;
  client: MessageClient;
  privateClient: MessageClient;
  constructor() {
    this.app = new App();

    // 加载插件
    this.app.plugin(database);
    this.app.plugin(help);
    this.app.plugin(logger);
    this.app.plugin(mock);
    //@ts-ignore
    this.app.plugin(yesimbot, testConfig);

    // 创建客户端
    this.client = this.app.mock.client("12345678", "114514");
    this.privateClient = this.app.mock.client("12345678", "private:12345678");

    MockBot.prototype.getGuildMemberList = async (guildId: string, next?: string) => {
      return {
        data: [this.client.userId, this.client.bot.userId].map((userId) => createUser(userId)),
      };
    }

    MockBot.prototype.getUser = async (id, guildId) => {
      return createUser(id);
    };

    // 等待 app 启动完成
    beforeAll(async () => {
      await this.app.start();
      await this.app.mock.initUser("12345678", 3);
      await this.app.mock.initChannel("114514");
    });
    afterAll(() => this.app.stop());
  }

  test() {
    describe("utils", () => {
      it("content", async () => {
        const rules = [
          {
            replacethis: "。$",
            tothis: "",
          },
          {
            replacethis: "{date}",
            tothis: "01点57分",
          },
          {
            
            replacethis: "\\{\\w+\\}",
            tothis: "PLACEHOLDER",
          }
        ];
        let sentences = processText(rules, `${h.quote("114514")}走别人的路，让别人无路可走。那走自己的路是不是让自己无路可走？`);
        assert.deepEqual(sentences, [
          `<quote id="114514"/>走别人的路，让别人无路可走。`,
          `那走自己的路是不是让自己无路可走？`
        ]);

        sentences = processText(rules, `走别人的路，让别人无路可走。那走自己的路是不是让自己无路可走？${h.quote("114514")}`);
        assert.deepEqual(sentences, [
          `<quote id="114514"/>走别人的路，让别人无路可走。`,
          `那走自己的路是不是让自己无路可走？`
        ]);

        // sentences = processText(rules, `走别人的路，让别人无路可走。${h.quote("114514")}那走自己的路是不是让自己无路可走？`);
        // assert.deepEqual(sentences, [
        //   `<quote id="114514"/>走别人的路，让别人无路可走。`,
        //   `那走自己的路是不是让自己无路可走？`
        // ]);

        sentences = processText(rules, `[messageId][{date} from_guild:{channelId}] {senderName}[{senderId}] 说: {userContent}`);
        assert.deepEqual(sentences, [
          "[messageId][01点57分 from_guild:PLACEHOLDER] PLACEHOLDER[PLACEHOLDER] 说: PLACEHOLDER"
        ]);

        sentences = processText(rules, `${h.at("12345678")}你好！有什么可以帮助的吗？${h("face", {id:2})}`);
        assert.deepEqual(sentences, [
          `<at id="12345678"/>你好！`,
          `有什么可以帮助的吗？<face id="2"/>`
        ]);
      })
    });

    // 依次测试每个适配器, 保证能正确处理 ai 消息
    it("适配器解析", async () => {
      await this.client.shouldReply(`<at id="${this.client.bot.selfId}" name="" /> 你好`);
      await this.client.shouldReply(`<at id="${this.client.bot.selfId}" name="" /> 你好`);
      await this.client.shouldReply(`<at id="${this.client.bot.selfId}" name="" /> 你好`);
      await this.client.shouldReply(`<at id="${this.client.bot.selfId}" name="" /> 你好`);
    });

    it("AT 立即回复", async () => {
      await this.client.shouldReply(`<at id="${this.client.bot.selfId}" name="YesImBot" /> 你好`);
    });

    it("达到初始触发计数(3)", async () => {
      await this.client.receive("清除记忆");
      await this.client.shouldNotReply("第一条消息");
      await this.client.shouldNotReply("第二条消息");
      await this.client.shouldReply("第三条消息");
    });

    it("私聊", async () => {
      await this.privateClient.receive("清除记忆");
      await this.privateClient.shouldReply(`<at id="${this.privateClient.bot.selfId}" name="" /> 你好`);
    });

    it("清除记忆", async () => {
      await this.client.receive("清除记忆");
      await this.client.receive("这是一条消息");
      await this.client.shouldReply("清除记忆", `✅ ${this.client.channelId}`);
      await this.client.shouldReply("清除记忆", `❌ ${this.client.channelId}`);
      await this.client.shouldReply("清除记忆 -t 10000000", `❌ 10000000`);
      await this.privateClient.receive("这是一条消息");
      await this.privateClient.shouldReply("清除记忆", `✅ private:${this.client.userId}`);
      await this.privateClient.shouldReply("清除记忆", `❌ private:${this.client.userId}`);
      await this.privateClient.shouldReply("清除记忆 -t 10000000", `❌ 10000000`);
      await this.privateClient.shouldReply("清除记忆 -t private:10000000", `❌ private:10000000`);
    });

    it("表情解析", async () => {
      // <face id="277" name="汪汪" platform="onebot"><img src="https://koishi.js.org/QFace/static/s277.png"/></face>
      // h("face", { id: "277", name: "汪汪", platform: "onebot" });
      const at = `<at id="${this.client.bot.selfId}" name="" />`;
      const face = `<face id="277" name="汪汪" platform="onebot"><img src="https://koishi.js.org/QFace/static/s277.png"/></face>`;
      assert.equal(await emojiManager.getIdByName("惊讶"), 0);
      assert.equal(await emojiManager.getNameById("277"), "汪汪");
    });

    // it("表情解析Embedding", async () => {
    //   assert.equal(await emojiManager.getNameByTextSimilarity("征服世界", testConfig["Embedding"]), "奋斗");
    //   assert.equal(await emojiManager.getNameByTextSimilarity("火力全开", testConfig["Embedding"]), "怄火");
    // });
  }
}

const tester = new Test();

tester.test();
