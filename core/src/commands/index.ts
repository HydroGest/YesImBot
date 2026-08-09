import type { Context, Session } from "koishi";

import type { ChannelScope } from "../channels/index.js";
import type { Runtimes } from "../runtimes/index.js";

export function registerSessionCommands(ctx: Context, manager: Runtimes, config: { authority: number }): () => void {
  const command = ctx.command("yesimbot.session", "会话管理", { authority: config.authority });

  command.subcommand(".compact", "压缩会话").action(async ({ session }) => {
    const scope = scopeFromSession(session);
    return scope ? manager.compact(scope) : undefined;
  });

  command
    .subcommand(".archive", "归档会话")
    .option("noSummary", "--no-summary")
    .action(async ({ session }) => {
      const scope = scopeFromSession(session);
      return scope ? manager.archive(scope) : undefined;
    });

  command.subcommand(".clear", "清空会话").action(async ({ session }) => {
    const scope = scopeFromSession(session);
    if (!scope || !session) return;
    await session.send("此操作将清空所有会话记录和资源文件，是否继续？（回复`确认`即可）");
    const confirmed = await session.prompt(60_000);
    if (!confirmed?.includes("确认")) return "操作已取消。";
    await manager.clear(scope);
    return "已清空所有会话记录和资源文件。";
  });

  command.subcommand(".status", "会话状态").action(({ session }) => {
    const scope = scopeFromSession(session);
    return scope ? manager.status(scope) : undefined;
  });

  command.subcommand(".list", "会话列表").action(({ session }) => {
    const scope = scopeFromSession(session);
    return scope ? manager.list(scope) : undefined;
  });

  return () => command.dispose();
}

function scopeFromSession(session: Session | undefined): ChannelScope | undefined {
  if (!session?.platform || !session.selfId || !session.channelId) return;
  return session.isDirect
    ? { platform: session.platform, selfId: session.selfId, channelId: session.channelId, type: "direct" }
    : { platform: session.platform, channelId: session.channelId, type: "shared" };
}
