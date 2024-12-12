import { Config } from "../config";
import { sendRequest } from "../utils/http";
import { BaseAdapter, Response } from "./base";
import { LLM } from "./config";
import { Message } from "./creators/component";

export class OpenAIAdapter extends BaseAdapter {
  constructor(config: LLM, parameters?: Config["Parameters"]) {
    super(config, parameters);
    this.url = `${config.BaseURL}/v1/chat/completions`;
  }

  async chat(messages: Message[], debug = false): Promise<Response> {
    const requestBody = {
      model: this.model,
      messages,
      temperature: this.parameters?.Temperature,
      max_tokens: this.parameters?.MaxTokens,
      frequency_penalty: this.parameters?.FrequencyPenalty,
      presence_penalty: this.parameters?.PresencePenalty,
      response_format: this.ability.includes("结构化输出")
        ? { type: "json_object" }
        : undefined,
      ...this.otherParams,
    };
    let response = await sendRequest(this.url, this.apiKey, requestBody, debug);
    try {
      return {
        model: response.model,
        created: response.created,
        message: {
          role: response.choices[0].message.role,
          content: response.choices[0].message.content,
        },
        usage: response.usage,
      };
    } catch (error) {
      console.error("Error parsing response:", error);
      console.error("Response:", response);
    }
  }
}
