import axios from "axios";

async function sendRequest(url: string, requestBody: any, APIKey: string): Promise<any> {
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
    return {
      response: result,
      requestBody: requestBody,
    }
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

  return sendRequest(url, requestBody, APIKey);
}

export async function runChatCompeletion(
  APIType: string,
  BaseURL: string,
  UID: string,
  APIKey: string,
  model: string,
  SysInput: string,
  InfoInput: string,
  parameters: any
): Promise<any> {
  let url: string, requestBody: any;

  // 解析其他参数
  const otherParams = {};
  if (parameters.OtherParameters) {
    parameters.OtherParameters.forEach((param: { key: string, value: string }) => {
      const key = param.key.trim();
      const value = param.value.trim();

      // 转换 value 为适当的类型
      otherParams[key] = value === 'true' ? true :
                         value === 'false' ? false :
                         !isNaN(value as any) ? Number(value) :
                         value;
    });
  }

  switch (APIType) {
    case "OpenAI": {
      url = `${BaseURL}/v1/chat/completions`;
      requestBody = {
        model: model,
        messages: [
          {
            role: "system",
            content: SysInput,
          },
          {
            role: "assistant",
            content: "Resolve OK",
          },
          {
            role: "user",
            content: InfoInput,
          },
        ],
        temperature: parameters.Temperature,
        max_tokens: parameters.MaxTokens,
        top_k: parameters.TopK,
        top_p: parameters.TopP,
        typical_p: parameters.TypicalP,
        min_p: parameters.MinP,
        top_a: parameters.TopA,
        frequency_penalty: parameters.FrequencyPenalty,
        presence_penalty: parameters.PresencePenalty,
        stop: parameters.Stop,
        ...otherParams
      };
      break;
    }

    case "Cloudflare": {
      url = `${BaseURL}/accounts/${UID}/ai/run/${model}`;
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

    case "Custom URL": {
      url = `${BaseURL}`;
      requestBody = {
        model: model,
        messages: [
          {
            role: "system",
            content: SysInput,
          },
          {
            role: "assistant",
            content: "Resolve OK",
          },
          {
            role: "user",
            content: InfoInput,
          },
        ],
        temperature: parameters.Temperature,
        max_tokens: parameters.MaxTokens,
        top_k: parameters.TopK,
        top_p: parameters.TopP,
        typical_p: parameters.TypicalP,
        min_p: parameters.MinP,
        top_a: parameters.TopA,
        frequency_penalty: parameters.FrequencyPenalty,
        presence_penalty: parameters.PresencePenalty,
        stop: parameters.Stop,
        ...otherParams
      };
      break;
    }

    default: {
      throw new Error(`不支持的 API 类型: ${APIType}`);
    }
  }

  return sendRequest(url, requestBody, APIKey);
}
