import { h } from "koishi";

import { Extension } from "./base";

class Execute extends Extension {
  name = "execute";
  description = `
  你可以运行一些只有在IM平台才能运行的命令，下面是你可以运行的命令列表。
  - ban <用户ID> <时长>: 将用户禁言
  - delmsg <消息ID>: 当你认为别人刷屏或发表不当内容时，运行这条指令
  - reaction-create <消息ID> <表态编号>: 对一个或多个消息进行表态。表态编号是数字，这里是一个简略的参考：惊讶(0)，不适(1)，无语(27)，震惊(110)，滑稽(178), 点赞(76)。
  请将命令字符串添加到 cmd 参数上来执行命令。
  这个函数**不能**在 "status" 为 function 的时候使用。DO NOT USE THIS FUNCTION WHEN "status" IS "function". 你只能在 "status" 为 "success" 或 "skip" 的时候使用这个函数。YOU CAN ONLY USE THIS FUNCTION WHEN "status" IS "success" OR "skip".
  这个函数没有返回值。
  请务必将此处可以运行的命令与你允许调用的函数区分开来。`;
  params = {
    cmd: "要运行的命令"
  };

  async apply(command: string) {
    return h("execute", {}, command);
  }
}

export default new Execute();
