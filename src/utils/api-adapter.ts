import axios from "axios";
import JSON5 from "json5";

async function sendRequest(url: string, requestBody: any, APIKey: string, debug: boolean): Promise<any> {
  if (debug) {
    console.log(`Request body: \n${JSON5.stringify(requestBody, null, 2)}`);
  }

  try {
    const response = await axios.post(url, requestBody, {
      headers: {
        'Authorization': `Bearer ${APIKey}`,
        'Content-Type': "application/json",
      },
    });

    if (response.status !== 200) {
      const errorMessage = response.data;
      throw new Error(`请求失败: ${response.status} - ${errorMessage}`);
    }

    const result = await response.data;
    return result;
  } catch (error) {
    throw error;
  }
}

export async function runEmbedding(
  APIType: string,
  BaseURL: string,
  UID: string,
  APIKey: string,
  model: string,
  text: string,
  config: any,
): Promise<any> {
  let url: string, requestBody: any;
  switch (APIType) {
    case "OpenAI": {
      url = `${BaseURL}/v1/embeddings`;
      requestBody = {
        input: text,
        model: model,
      };
      break;
    }

    case "Cloudflare": {
      // TODO: I'm not familiar with Cloudflare's AI service, so keep it as a placeholder
      break;
    }

    case "Custom URL": {
      url = `${BaseURL}`;
      requestBody = {
        input: text,
        model: model,
      };
      break;
    }

    default: {
      throw new Error(`不支持的 API 类型: ${APIType}`);
    }
  }

  return sendRequest(url, requestBody, APIKey, config.Debug.DebugAsInfo);
}
