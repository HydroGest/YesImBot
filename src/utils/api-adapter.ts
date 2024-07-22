import axios from "axios";

export async function run(
  APIType: string,
  BaseAPI: string,
  UID: string,
  APIKey: string,
  model: string,
  SysInput: string,
  InfoInput: string
): Promise<any> {
  let url: string, requestBody: any;

  switch (APIType) {
    case "OpenAI": {
      url = `${BaseAPI}/v1/chat/completions/`;
      requestBody = {
        model: model,
        messages: [
          {
            role: "system",
            content: SysInput,
          },
		  {
            role: "assistant",
            content: "Resolved OK",
          },
          {
            role: "user",
            content: InfoInput,
          },
        ],
        temperature: 0.7,
        max_tokens: 4096,
      };
      break;
    }

    case "Cloudflare": {
      url = `${BaseAPI}/accounts/${UID}/ai/run/${model}`;
      requestBody = {
        messages: [
          {
            role: "system",
            content: SysInput,
          },
          {
            role: "system",
            content: InfoInput,
          },
        ],
      };
      break;
    }

    default: {
      throw new Error(`不支持的 API 类型: ${APIType}`);
    }
  }

  try {
    const response = await axios.post(url, requestBody, {
      headers: {
        Authorization: `Bearer ${APIKey}`,
        "Content-Type": "application/json",
      },
    });

    if (response.status !== 200) {
      const errorMessage = response.data;
      throw new Error(`请求失败: ${response.status} - ${errorMessage}`);
    }
	
    const result = await response.data;
    return result;
	
  } catch (error) {
    console.error("Error occurred during API call:", error);
    throw error;
  }
}