import { Config } from "../config";
import { sendRequest } from "../utils/http";
import { BaseAdapter } from "./base";
import { Message } from "./creators/component";

export class CustomAdapter extends BaseAdapter {
  private url: string;
  private apiKey: string;
  private model: string;

  constructor(
    baseUrl: string,
    apiKey: string,
    model: string,
    parameters: Config["Parameters"]
  ) {
    super("Custom URL", parameters);
    this.url = baseUrl;
    this.apiKey = apiKey;
    this.model = model;
  }

  async chat(messages: Message[], debug = false) {
    const requestBody = {
      model: this.model,
      messages,
      temperature: this.parameters.Temperature,
      max_tokens: this.parameters.MaxTokens,
      frequency_penalty: this.parameters.FrequencyPenalty,
      presence_penalty: this.parameters.PresencePenalty,
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
          images: response.choices[0].message?.images,
        },
        usage: response.usage,
      };
    } catch (error) {
      console.error("Error parsing response:", error);
      console.error("Response:", response);
    }
  }
}
