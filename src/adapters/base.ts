import { Config } from "../config";
import { Message } from "./creators/component";

interface Usage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface Response {
  model: string;
  created: string;
  message: {
    role: "system" | "assistant" | "user";
    content: string;
  };
  usage: Usage;
}

export abstract class BaseAdapter {
  protected otherParams: Record<string, any>;

  constructor(
    protected adapterName: string,
    protected parameters: Config["Parameters"]
  ) {
    console.log(`Adapter: ${this.adapterName} registered`);

    // 解析其他参数
    this.otherParams = {};
    if (parameters.OtherParameters) {
      parameters.OtherParameters.forEach(
        (param: { key: string; value: string }) => {
          const key = param.key.trim();
          let value = param.value.trim();
          // 尝试解析 JSON 字符串
          try {
            value = JSON.parse(value);
          } catch (e) {
            // 如果解析失败，保持原值
          }
          // 转换 value 为适当的类型
          if (value === "true") {
            this.otherParams[key] = true;
          } else if (value === "false") {
            this.otherParams[key] = false;
            //@ts-ignore
          } else if (!isNaN(value)) {
            this.otherParams[key] = Number(value);
          } else {
            this.otherParams[key] = value;
          }
        }
      );
    }
  }

  abstract chat(messages: Message[]): Promise<Response>;

  //abstract chatWithHistory(messages: Message[]): Promise<Response>;
}
