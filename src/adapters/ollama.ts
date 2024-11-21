import { sendRequest } from "../utils/tools";
import { BaseAdapter } from "./base";

export class OllamaAdapter extends BaseAdapter {
  private url: string;
  private apiKey: string;
  private model: string;

  constructor(baseUrl: string, apiKey: string, model: string) {
    super("Ollama");
    this.url = `${baseUrl}/api/chat`;
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
      stream: false,
      format: "json",
      messages: await this.createMessages(sysPrompt, userPrompt, eyeType, detail),
      options: {
        top_p: parameters.TopP,
        temperature: parameters.Temperature,
        presence_penalty: parameters.PresencePenalty,
        frequency_penalty: parameters.FrequencyPenalty,
        stop: parameters.Stop,
        num_ctx: parameters.MaxTokens,
      },
      ...parameters.OtherParameters,
    };

    return sendRequest(this.url, this.apiKey, requestBody, debug);
  }
}
