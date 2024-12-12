import { Config } from "../config";
import { sendRequest } from "../utils/http";
import { BaseAdapter, Response } from "./base";
import { LLM } from "./config";
import { Message } from "./creators/component";

export class OllamaAdapter extends BaseAdapter {
  constructor(config: LLM, parameters?: Config["Parameters"]) {
    super(config, parameters);
    this.url = `${config.BaseURL}/api/chat`;
  }

  async chat(messages: Message[], debug = false): Promise<Response> {
    for (const message of messages) {
      for (const component of message.content) {
        if (typeof component === "string") continue;
        if (component.type === "image_url") {
          if (!message["images"]) message["images"] = [];
          message["images"].push(component["image_url"]["url"]);
        }
      }
    }
    const requestBody = {
      model: this.model,
      stream: false,
      format: this.ability.includes("结构化输出") ? "json" : undefined,
      messages,
      options: {
        num_ctx: this.parameters?.MaxTokens,
        temperature: this.parameters?.Temperature,
        presence_penalty: this.parameters?.PresencePenalty,
        frequency_penalty: this.parameters?.FrequencyPenalty,
      },
      ...this.otherParams,
    };
    let response = await sendRequest(this.url, this.apiKey, requestBody, debug);
    try {
      return {
        model: response.model,
        created: response.created_at,
        message: {
          role: response.message.role,
          content: response.message.content,
        },
        usage: {
          prompt_tokens: response.prompt_eval_count,
          completion_tokens: response.eval_count,
          total_tokens: response.prompt_eval_count + response.eval_count,
        },
      };
    } catch (error) {
      console.error("Error parsing response:", error);
      console.error("Response:", response);
    }
  }
}
