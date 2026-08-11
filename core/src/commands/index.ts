import type { Context } from "koishi";

import { contextFromSession } from "../channels/context.js";
import type { Runtimes } from "../runtimes/index.js";

export function registerSessionCommands(ctx: Context, manager: Runtimes, config: { authority: number }): () => void {
  const command = ctx.command("yesimbot.session", "会话管理", { authority: config.authority });

  command.subcommand(".compact", "压缩会话").action(async ({ session }) => {
    if (!session) return;
    const channelCtx = contextFromSession(session);
    return channelCtx ? manager.compact(channelCtx) : undefined;
  });

  command
    .subcommand(".archive", "归档会话")
    .option("noSummary", "--no-summary")
    .action(async ({ session, options }) => {
      if (!session) return;
      const channelCtx = contextFromSession(session);
      return channelCtx ? manager.archive(channelCtx, options?.noSummary) : undefined;
    });

  command.subcommand(".clear", "清空会话").action(async ({ session }) => {
    if (!session) return;
    const channelCtx = contextFromSession(session);
    if (!channelCtx) return;
    await session.send("此操作将清空所有会话记录和资源文件，是否继续？（回复`确认`即可）");
    const confirmed = await session.prompt(60_000);
    if (!confirmed?.includes("确认")) return "操作已取消。";
    await manager.clear(channelCtx);
    return "已清空所有会话记录和资源文件。";
  });

  command.subcommand(".status", "会话状态").action(({ session }) => {
    if (!session) return;
    const channelCtx = contextFromSession(session);
    return channelCtx ? manager.status(channelCtx) : undefined;
  });

  command.subcommand(".list", "会话列表").action(({ session }) => {
    if (!session) return;
    const channelCtx = contextFromSession(session);
    return channelCtx ? manager.list(channelCtx) : undefined;
  });

  return () => command.dispose();
}
