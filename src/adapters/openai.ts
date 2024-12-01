import { sendRequest } from "../utils/http";
import { BaseAdapter } from "./base";

export class OpenAIAdapter extends BaseAdapter {
  private url: string;
  private apiKey: string;
  private model: string;

  constructor(baseUrl: string, apiKey: string, model: string) {
    super("OpenAI");
    this.url = `${baseUrl}/v1/chat/completions`;
    this.apiKey = apiKey;
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

    return sendRequest(this.url, this.apiKey, requestBody, debug);
  }
}
