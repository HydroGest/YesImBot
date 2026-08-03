import type { Context, Session } from "koishi";

import type { RuntimeManager } from "../runtime/manager.js";
import type { ChannelScope } from "../runtime/storage.js";

export function registerSessionCommands(
  ctx: Context,
  manager: RuntimeManager,
  config: { authority: number },
): () => void {
  const command = ctx.command("yesimbot session", { authority: config.authority });

  command.subcommand(".compact").action(async ({ session }) => {
    const scope = scopeFromSession(session);
    return scope ? manager.compact(scope) : undefined;
  });

  command
    .subcommand(".archive")
    .option("noSummary", "--no-summary")
    .action(async ({ session, options }) => {
      const scope = scopeFromSession(session);
      return scope ? manager.archive(scope, { noSummary: options?.noSummary }) : undefined;
    });

  command.subcommand(".clear").action(async ({ session }) => {
    const scope = scopeFromSession(session);
    if (!scope || !session) return;
    const confirmed = await session.prompt(60_000);
    if (!confirmed?.includes("确认")) return "操作已取消。";
    await manager.clear(scope);
    return "已清空所有会话记录和资源文件。";
  });

  command.subcommand(".status").action(({ session }) => {
    const scope = scopeFromSession(session);
    return scope ? manager.status(scope) : undefined;
  });

  command.subcommand(".list").action(({ session }) => {
    const scope = scopeFromSession(session);
    return scope ? manager.list(scope) : undefined;
  });

  return () => command.dispose();
}

function scopeFromSession(session: Session | undefined): ChannelScope | undefined {
  if (!session?.platform || !session.selfId || !session.channelId) return;
  return {
    platform: session.platform,
    selfId: session.selfId,
    channelId: session.channelId,
    type: session.isDirect ? "direct" : "shared",
  };
}
