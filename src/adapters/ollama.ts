import { sendRequest } from "../utils/http";
import { BaseAdapter, Message } from "./base";

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
    userPrompt: string | Message,
    parameters: any,
    detail: string,
    eyeType: string,
    debug: boolean
  ) {
    const requestBody = {
      model: this.model,
      stream: false,
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
    let response = await sendRequest(this.url, this.apiKey, requestBody, debug);
    try {
      return {
        model: response.model,
        created_at: response.created_at,
        message: {
          role: response.message.role,
          content: response.message.content,
        },
        usage: {
          prompt_tokens: response.prompt_eval_count,
          completion_tokens: response.eval_count,
          total_tokens: 0
        },
      }
    } catch (error) {
      console.error("Error parsing response:", error);
      console.error("Response:", response);
    }
  }

  async createMessages(sysInput: string, infoInput: string | Message, eyeType: any, detail: string) {
    let userMessage: any = {
      role: "user"
    }
    if (typeof infoInput === "string") {
      userMessage.content = infoInput;
    } else {
      userMessage = infoInput;
    }
    return [
      {
        role: "system",
        content: sysInput,
      },
      {
        role: "assistant",
        content: "Resolve OK",
      },
      userMessage
    ];
  }
}
