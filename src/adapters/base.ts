import { Config } from "../config";
import { AssistantMessage, Message } from "./creators/component";
import { LLM } from "./config";
import { ToolSchema } from "./creators/schema";

export interface Usage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface Response {
  model: string;
  created: string;
  message: AssistantMessage;
  usage: Usage;
}

export abstract class BaseAdapter {
  protected url: string;
  protected readonly apiKey: string;
  protected readonly model: string;
  protected readonly otherParams: Record<string, any>;
  readonly ability: ("原生工具调用" | "识图功能" | "结构化输出")[];

  protected history: Message[] = [];

  constructor(
    protected adapterConfig: LLM,
    protected parameters?: Config["Parameters"]
  ) {
    const { APIKey, APIType, AIModel, Ability } = adapterConfig;
    this.apiKey = APIKey;
    this.model = AIModel;
    this.ability = Ability || [];

    // 解析其他参数
    this.otherParams = {};
    if (this.parameters?.OtherParameters) {
      this.parameters.OtherParameters.forEach(
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
            // @ts-ignore
          } else if (!isNaN(value)) {
            this.otherParams[key] = Number(value);
          } else {
            this.otherParams[key] = value;
          }
        }
      );
    }

    logger.info(`Adapter: ${APIType} registered`);
  }

  abstract chat(messages: Message[], tools?: ToolSchema[], debug?: Boolean): Promise<Response>;
}


export class AdapterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AdapterError";
  }
}
