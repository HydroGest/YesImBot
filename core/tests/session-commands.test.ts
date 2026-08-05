import { describe, expect, it, vi } from "vitest";

import { registerSessionCommands } from "../src/commands/session.js";

type Action = (argv: { session?: unknown; options?: Record<string, unknown> }) => Promise<string | undefined>;
type RegisteredCommand = {
  readonly name: string;
  readonly action: ReturnType<typeof vi.fn>;
  readonly dispose: ReturnType<typeof vi.fn>;
};

function setup() {
  const commands = new Map<string, RegisteredCommand>();
  const createCommand = (
    name: string,
  ): {
    subcommand(name: string): ReturnType<typeof createCommand>;
    option(): ReturnType<typeof createCommand>;
    action: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
  } => {
    const command = {
      subcommand: (subcommand: string) => createCommand(`${name}${subcommand}`),
      option: () => command,
      action: vi.fn(),
      dispose: vi.fn(),
    };
    commands.set(name, command);
    return command;
  };
  const ctx = { command: vi.fn((name: string) => createCommand(name)) };
  const manager = {
    compact: vi.fn(async () => "已压缩当前会话。"),
    archive: vi.fn(async () => "已归档当前会话。"),
    clear: vi.fn(async () => undefined),
    status: vi.fn(async () => "状态"),
    list: vi.fn(async () => "列表"),
  };
  registerSessionCommands(ctx as never, manager as never, { authority: 4 });
  return { commands, ctx, manager };
}

const session = { platform: "test", selfId: "bot", channelId: "room", isDirect: false };
const scope = { platform: "test", selfId: "bot", channelId: "room", type: "shared" };

function action(commands: Map<string, RegisteredCommand>, name: string): Action {
  return commands.get(`yesimbot.session.${name}`)!.action.mock.calls[0]![0];
}

describe("yesimbot session commands", () => {
  it("registers compact, archive, clear, status, and list for the invoking channel", async () => {
    const { commands, ctx, manager } = setup();

    await expect(action(commands, "compact")({ session })).resolves.toBe("已压缩当前会话。");
    await expect(action(commands, "archive")({ session, options: { noSummary: true } })).resolves.toBe(
      "已归档当前会话。",
    );
    await expect(action(commands, "status")({ session })).resolves.toBe("状态");
    await expect(action(commands, "list")({ session })).resolves.toBe("列表");

    expect(ctx.command).toHaveBeenCalledWith("yesimbot.session", "会话管理", { authority: 4 });
    expect(manager.compact).toHaveBeenCalledWith(scope);
    expect(manager.archive).toHaveBeenCalledWith(scope, { noSummary: true });
    expect(manager.status).toHaveBeenCalledWith(scope);
    expect(manager.list).toHaveBeenCalledWith(scope);
  });

  it("clears only after a confirmation prompt", async () => {
    const { commands, manager } = setup();
    const declined = { ...session, send: vi.fn(), prompt: vi.fn(async () => "取消") };
    const confirmed = { ...session, send: vi.fn(), prompt: vi.fn(async () => "确认") };

    await expect(action(commands, "clear")({ session: declined })).resolves.toBe("操作已取消。");
    await expect(action(commands, "clear")({ session: confirmed })).resolves.toBe("已清空所有会话记录和资源文件。");

    expect(declined.prompt).toHaveBeenCalledWith(60_000);
    expect(manager.clear).toHaveBeenCalledTimes(1);
    expect(manager.clear).toHaveBeenCalledWith(scope);
  });
});
