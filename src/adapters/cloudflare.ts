import { BaseAdapter } from "./base";

export class CloudflareAdapter extends BaseAdapter {
  private apiKey: string;
  private uid: string;
  private url: string;

  constructor(baseUrl: string, apiKey: string, uid: string, model :string) {
    super();
    this.adapterName = "Cloudflare";
    this.url = `${baseUrl}/accounts/${uid}/ai/run/${model}`;
    this.apiKey = apiKey;
    this.uid = uid;
  }

  protected async generateResponse(
    sysPrompt: string,
    userPrompt: string,
    parameters: any,
    detail: string,
    eyeType: string,
    debug: boolean
  ) {

    throw new Error("Not implemented");
    const requestBody = {
      messages: await this.createMessages(sysPrompt, userPrompt, eyeType, detail),
    };
  }
}
