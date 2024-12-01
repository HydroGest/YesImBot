import { sendRequest } from "../utils/http";
import { BaseAdapter } from "./base";

export class CloudflareAdapter extends BaseAdapter {
  private url: string;
  private apiKey: string;
  private uid: string;
  private model: string;

  constructor(baseUrl: string, apiKey: string, uid: string, model: string) {
    super("Cloudflare");
    this.url = `${baseUrl}/accounts/${uid}/ai/run/${model}`;
    this.apiKey = apiKey;
    this.uid = uid;
    this.model = model;
  }

  protected async generateResponse(
    sysPrompt: string,
    userPrompt: string,
    parameters: any,
    detail: string,
    eyeType: string,
    debug: boolean
  ) {
    const requestBody = {
      model: this.model,
      messages: await this.createMessages(sysPrompt, userPrompt, eyeType, detail),
      temperature: parameters.Temperature,
      max_tokens: parameters.MaxTokens,
      top_p: parameters.TopP,
      frequency_penalty: parameters.FrequencyPenalty,
      presence_penalty: parameters.PresencePenalty,
      stop: parameters.Stop,
      ...parameters.OtherParameters,
    };
    let response = await sendRequest(this.url, this.apiKey, requestBody, debug);
    try {
      return {
        model: "",
        created_at: "",
        message: {
          role: response.result.role,
          content: response.result.response,
          images: [],
        },
        usage: {
          prompt_tokens: 0,
          completion_tokens: 0,
          total_tokens: 0
        },
      }
    } catch (error) {
      console.error("Error parsing response:", error);
      console.error("Response:", response);
    }
  }
}
