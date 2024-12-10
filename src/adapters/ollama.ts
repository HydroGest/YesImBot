import { Config } from "../config";
import { sendRequest } from "../utils/http";
import { BaseAdapter, Response } from "./base";
import { Message } from "./creators/component";

export class OllamaAdapter extends BaseAdapter {
  private url: string;
  private apiKey: string;
  private model: string;

  constructor(
    baseUrl: string,
    apiKey: string,
    model: string,
    parameters?: Config["Parameters"]
  ) {
    super("Ollama", parameters);
    this.url = `${baseUrl}/api/chat`;
    this.apiKey = apiKey;
    this.model = model;
  }

  async chat(messages: Message[], debug = false): Promise<Response> {
    for (const message of messages) {
      for (const component of message.content) {
        if (typeof component === "string")
          continue;
        if (component.type === "image_url") {
          if (!message["images"]) message["images"] = [];
          message["images"].push(component["image_url"]["url"]);
        }
      }
    }
    const requestBody = {
      model: this.model,
      stream: false,
      messages,
      options: {
        num_ctx: this.parameters.MaxTokens,
        temperature: this.parameters.Temperature,
        presence_penalty: this.parameters.PresencePenalty,
        frequency_penalty: this.parameters.FrequencyPenalty,
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
