import axios from "axios";

async function sendRequest(url: string, requestBody: any, APIKey: string, debug: boolean): Promise<any> {
  if (debug) {
    console.log(`Request body: \n${JSON.stringify(requestBody, null, 2)}`);
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

export async function runChatCompeletion(
  APIType: string,
  BaseURL: string,
  UID: string,
  APIKey: string,
  model: string,
  SysInput: string,
  InfoInput: string,
  parameters: any,
  detail: string,
  eyeType: string,
  debug: boolean,
): Promise<any> {
  let url: string, requestBody: any;

  // 解析其他参数
  const otherParams = {};
  if (parameters.OtherParameters) {
    parameters.OtherParameters.forEach((param: { key: string, value: string }) => {
      const key = param.key.trim();
      let value = param.value.trim();

      // 尝试解析 JSON 字符串
      try {
        value = JSON.parse(value);
      } catch (e) {
        // 如果解析失败，保持原值
      }

      // 转换 value 为适当的类型
      otherParams[key] = value === 'true' ? true :
        value === 'false' ? false :
          !isNaN(value as any) ? Number(value) :
            value;
    });
  }

  const extractContent = async (input: string) => {
    const regex = /<img\s+(base64|src)\s*=\s*\\?"([^\\"]+)\\?"(?:\s+(base64|src)\s*=\s*\\?"([^\\"]+)\\?")?\s*\/>/g;
    let match;
    const parts = [];
    let lastIndex = 0;

    while ((match = regex.exec(input)) !== null) {
      if (match.index > lastIndex) {
        parts.push({ type: 'text', text: input.substring(lastIndex, match.index) });
      }

      const imageUrl = match[1] === 'base64' ? match[2] : match[4];
      parts.push({ type: 'image_url', image_url: { url: imageUrl, detail: detail }});

      lastIndex = regex.lastIndex;
    }

    if (lastIndex < input.length) {
      parts.push({ type: 'text', text: input.substring(lastIndex) });
    }

    return parts;
  };

  const createMessages = async (sysInput: string, infoInput: string, eyeType: any) => {
    if (eyeType === 'LLM API 自带的多模态能力') {
      return [
        {
          role: "system",
          content: await extractContent(sysInput),
        },
        {
          role: "assistant",
          content: [
            {
              type: "text",
              text: "Resolve OK",
            },
          ],
        },
        {
          role: "user",
          content: await extractContent(infoInput),
        },
      ];
    } else {
      return [
        {
          role: "system",
          content: sysInput,
        },
        {
          role: "assistant",
          content: "Resolve OK"
        },
        {
          role: "user",
          content: infoInput,
        },
      ];
    }
  };

  switch (APIType) {
    case "OpenAI": {
      url = `${BaseURL}/v1/chat/completions`;
      requestBody = {
        model: model,
        messages: await createMessages(SysInput, InfoInput, eyeType),
        temperature: parameters.Temperature,
        max_tokens: parameters.MaxTokens,
        top_p: parameters.TopP,
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
        messages: await createMessages(SysInput, InfoInput, eyeType),
      };
      break;
    }

    case "Custom URL": {
      url = `${BaseURL}`;
      requestBody = {
        model: model,
        messages: await createMessages(SysInput, InfoInput, eyeType),
        temperature: parameters.Temperature,
        max_tokens: parameters.MaxTokens,
        top_p: parameters.TopP,
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

  return sendRequest(url, requestBody, APIKey, debug);
}
