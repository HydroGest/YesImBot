import { describe, it } from "@jest/globals";

import assert from "assert";

describe("RegExp", () => {
  it("Get User ID", () => {
    let template = "[{{messageId}}][{{date}} {{channelInfo}}] {{senderName}}<{{senderId}}> {{hasQuote,回复[{{quoteMessageId}}]: ,说: }}{{userContent}}"

    let history = [
      "[1245222681][12月8日 17:43:17 from_guild:979455084] 古明地恋<3878265553> 说: <at id='489995798' name='BOT-阿发'/>不许重复复读！",
      "[1663051631][12月8日 17:43:20 from_guild:979455084] 你的牛牛不如我的牛牛<869835619> 说: 哟，酷霸大人，您的龙虾大餐真是威风凛凛，听说您还征服了新岛屿，真是令人敬佩啊！",
      "[1468444462][12月8日 17:43:22 from_guild:979455084] 酷霸<2490139613> 说: 你们这些小蚂蚁，敬酒不吃吃罚酒！",
      "[2119258365][12月8日 17:43:24 from_guild:979455084] 天方夜谭q177<489995798> 说: 每个 人都会有自己的观点和立场，我们应该相互理解，不必过于纠结",
    ]

    let users = collectUserID(template, history);

    assert.equal(users.size, 4);
    assert.equal(users.get("3878265553"), "古明地恋");
    assert.equal(users.get("869835619"), "你的牛牛不如我的牛牛");
    assert.equal(users.get("2490139613"), "酷霸");
    assert.equal(users.get("489995798"), "天方夜谭q177");
  });
});


function collectUserID(template: string, history: string[]) {
  let users: Map<string, string> = new Map();
  template = template
    .replace("{{messageId}}", "(?<messageId>.+?)")
    .replace("{{date}}", "(?<date>.+?)")
    .replace("{{channelInfo}}", "(?<channelInfo>.+?)")
    .replace("{{senderName}}", "(?<senderName>.+?)")
    .replace("{{senderId}}", "(?<senderId>.+?)")
    .replace("{{userContent}}", "(?<userContent>.+?)")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]")
    .replace(/\{\{[^{}]*\}\}/g, "")
    .replace(/\{\{[^{}]*\}\}/g, ".*");
  let re = new RegExp(template);

  for (let msg of history) {
    let match = re.exec(msg);
    if (match && match.groups) {
      users.set(match.groups.senderId, match.groups.senderName);
    }
  }

  return users;
}
