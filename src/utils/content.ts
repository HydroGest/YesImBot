import { h } from "koishi";

export function replaceTags(str: string): string {
  const imgRegex = /<img.*?\/>/g;
  const videoRegex = /<video.*?\/>/g
  const audioRegex = /<audio.*?\/>/g
  let finalString: string = str;
  finalString = finalString.replace(imgRegex, "[图片]");
  finalString = finalString.replace(videoRegex, "[视频]");
  finalString = finalString.replace(audioRegex, "[音频]");
  return finalString;
}

/*
    @description: 处理 AI 的消息
*/
export function handleResponse(
  APIType: string,
  input: any,
  AllowErrorFormat: boolean,
  session: any,
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
    res = JSON.stringify(res, null, 2);
  }

  // 正版回复：
  // {
  //   "status": "success", // "success" 或 "skip" (跳过回复)
  //   "logic": "", // LLM思考过程
  //   "select": -1, // 回复引用的消息id
  //   "reply": "", // 初版回复
  //   "check": "", // 检查初版回复是否符合 "消息生成条例" 过程中的检查逻辑。
  //   "finReply": "" // 最终版回复
  //   "execute":[] // 要运行的指令列表
  // }
  const jsonMatch = res.match(/{.*}/s);
  if (jsonMatch) {
    res = jsonMatch[0];
  } else {
    throw new Error(`LLM provides unexpected response: ${res}`);
  }
  const LLMResponse = JSON.parse(res);
  if (LLMResponse.status != "success") {
    if (!AllowErrorFormat && LLMResponse.status != "skip") {
      throw new Error(`LLM provides unexpected response: ${res}`);
    } else {
      console.log(`LLM choose not to reply.`);
    }
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
    // 盗版回复
    else if (LLMResponse.msg) finalResponse += LLMResponse.msg;
    else if (LLMResponse.text) finalResponse += LLMResponse.text;
    else if (LLMResponse.message) finalResponse += LLMResponse.message;
    else if (LLMResponse.answer) finalResponse += LLMResponse.answer;
    else throw new Error(`LLM provides unexpected response: ${res}`);
  }

  // 使用groupMemberList反转义<at>消息
  const groupMemberList = session.groupMemberList;
  const atRegex = /@([^@\s!?,.，。！？]+)/g; // 怎么这么多符号都可能出现在用户名里，我只能挑出这一点点了
  let match;
  while ((match = atRegex.exec(finalResponse)) !== null) {
    const username = match[1];
    const member = groupMemberList.data.find(
      (member) => member.nick === username || member.user.name === username
    );
    if (member) {
      finalResponse = finalResponse.replace(`@${username}`, `<at id="${member.user.id}" name="${username}"/>` );
    }
  }




  return {
    res: finalResponse,
    LLMResponse: LLMResponse,
    usage: usage,
  };
}


/*
    @description: 处理 人类 的消息
*/
export async function processUserContent(session: any): Promise<{ content: string, name: string }> {
  const groupMemberList = session.groupMemberList;
  const regex = /<at id="([^"]+)"(?:\s+name="([^"]+)")?\s*\/>/g;
  // 转码 <at> 消息，把<at id="0" name="YesImBot" /> 转换为 @Athena 或 @YesImBot
  const matches = Array.from(session.content.matchAll(regex));
  let finalName = "";

  const userContentPromises = matches.map(async (match) => {

    const id = match[1].trim();
    const name = match[2]?.trim(); // 可能获取到 name

    try {
      const member = groupMemberList.data.find((member) => member.user.id === id);
      // 使用 nick(优先) 或 name，如果都不存在则使用 "UserNotFound"
      finalName = member ? member.nick : name || "UserNotFound";
      return {
        match: match[0],
        replacement: `@${finalName}`,
      };
    } catch (error) {
      // QQ 官方机器人接口无法使用 session.bot.getUser()，尝试调用备用 API
      try {
        const response = await fetch(`https://api.usuuu.com/qq/${id}`);
        if (!response.ok) {
          throw new Error(`Failed to fetch user from backup API`);
        }
        const user = await response.json();
        finalName = name ? name : user.data.name || "UserNotFound";
        return {
          match: match[0],
          replacement: `@${finalName}`, // 使用 name 或备用 API 返回的名字
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
  return { content: userContent, name: finalName };
}
