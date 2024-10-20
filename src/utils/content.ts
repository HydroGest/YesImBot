import { h } from "koishi";

export function replaceTags(str: string): string {
  const imgRegex = /<img.*?\/>/g;
  const videoRegex = /<video.*?\/>/g
  const audioRegex = /<audio.*?\/>/g
  let finalString: string = str;
  finalString = finalString.replace(imgRegex, finalString);
  finalString = finalString.replace(videoRegex, finalString);
  finalString = finalString.replace(audioRegex, finalString);
  return finalString;
}

/*
    @description: 处理 AI 的消息
*/
export function handleResponse(
  APIType: string,
  input: any,
  AllowErrorFormat: boolean,
): {
    res: string;
        LLMResponse: any;
        usage: any;
    } {
    let usage: any;
  let res: string;
  switch (APIType) {
    case "OpenAI": {
          res = input.choices[0].message.content;
          usage = input.usage;
      break;
    }
    case "Custom URL": {
          res = input.choices[0].message.content;
          usage = input.usage;
      break;
    }
    case "Cloudflare": {
      res = input.result.response;
      break;
    }
    default: {
      throw new Error(`不支持的 API 类型: ${APIType}`);
    }
  }
  console.log(typeof res);
  if (typeof res != "string") {
    res = JSON.stringify(res);
  }
  res = res.replaceAll("```", " ");
  res = res.replaceAll("json", " ");
  const LLMResponse = JSON.parse(res);
  if (LLMResponse.status != "success") {
    if (!AllowErrorFormat)
      throw new Error(`LLM provides unexpected response: ${res}`);
  }
  let finalResponse: string = "";
  if (~LLMResponse.select)
    finalResponse += h("quote", {
      id: LLMResponse.select,
    });
  if (!AllowErrorFormat) {
    finalResponse += LLMResponse.finReply
      ? LLMResponse.finReply
      : LLMResponse.reply;
  } else {
    if (LLMResponse.finReply) finalResponse += LLMResponse.finReply;
    else if (LLMResponse.reply) finalResponse += LLMResponse.reply;
    else if (LLMResponse.msg) finalResponse += LLMResponse.msg;
    else throw new Error(`LLM provides unexpected response: ${res}`);
  }
    return {
        res: finalResponse,
        LLMResponse: LLMResponse,
        usage: usage,
  };
}

export async function processUserContent(session: any): Promise<string> {
  const regex = /<at id="([^"]+)"(?:\s+name="([^"]+)")?\s*\/>/g;
  // 转码 <at> 消息
  const matches = Array.from(session.content.matchAll(regex));

  const userContentPromises = matches.map(async (match) => {
    const id = match[1].trim();
    const name = match[2]?.trim(); // 可能获取到 name

    try {
      const user = await session.bot.getUser(id);
      return {
        match: match[0],
        replacement: `@${name || user.name}`, // 如果 name 存在，则使用它，否则使用 user.name
      };
    } catch (error) {
      // QQ 官方机器人接口无法使用 session.bot.getUser()，尝试调用备用 API
      try {
        const response = await fetch(`https://api.usuuu.com/qq/${id}`);
        if (!response.ok) {
          throw new Error(`Failed to fetch user from backup API`);
        }
        const user = await response.json();
        return {
          match: match[0],
          replacement: `@${name || user.data.name || "UserNotFound"}`, // 使用 name 或备用 API 返回的名字
        };
      } catch (backupError) {
        return { match: match[0], replacement: `@UserNotFound` };
      }
    }
  });

  const userContents = await Promise.all(userContentPromises);
  let userContent: string = session.content;
  userContents.forEach(({ match, replacement }) => {
    userContent = userContent.replace(match, replacement);
  });
  userContent = replaceTags(userContent);
  return userContent;
}
