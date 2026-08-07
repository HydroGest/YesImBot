import { describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";

import { registerSessionCommands } from "../src/commands/session.js";

describe("session commands", () => {
  it("delegates conversation mutations to Runtimes with a flat shared scope", async () => {
    const commands = new Map<string, { action: Mock }>();
    const ctx = { command: vi.fn((name: string) => {
      const command = {
        subcommand: (child: string) => ctx.command(`${name}${child}`),
        option: () => command,
        action: vi.fn(),
        dispose: vi.fn(),
      };
      commands.set(name, command);
      return command;
    }) };
    const runtimes = { compact: vi.fn(async () => "ok"), archive: vi.fn(async () => "ok"), clear: vi.fn(), status: vi.fn(async () => "ok"), list: vi.fn(async () => "ok") };
    registerSessionCommands(ctx as never, runtimes as never, { authority: 4 });
    const action = commands.get("yesimbot.session.compact")!.action.mock.calls[0]![0];
    await expect(action({ session: { platform: "test", selfId: "bot", channelId: "room", isDirect: false } })).resolves.toBe("ok");
    expect(runtimes.compact).toHaveBeenCalledWith({ type: "shared", platform: "test", channelId: "room" });
  });
});
