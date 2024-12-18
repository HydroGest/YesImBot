import { h } from "koishi";

import { Extension } from "./base";

class Command extends Extension {
  name = "command";
  description = `你可以运行一些只有在IM平台才能运行的命令，下面是你可以运行的命令列表。
  - ban <用户ID> <时长>: 将用户禁言
  - delmsg <消息ID>: 当你认为别人刷屏或发表不当内容时，运行这条指令
  - reaction-create <消息ID> <表态编号>: 对一个或多个消息进行表态。表态编号是数字，这里是一个简略的参考：惊讶(0)，不适(1)，无语(27)，震惊(110)，滑稽(178), 点赞(76)。
  这个函数不能在 "status" 为 function 的时候使用`;
  params = {
    command: "要运行的命令"
  };

  async apply(command: string) {
    return h("execute", {}, command);
  }
}

export default new Command();
