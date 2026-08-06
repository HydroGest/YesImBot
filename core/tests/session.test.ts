import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("koishi", async () => import("@koishijs/core"));

import { registerSessionCommands } from "../src/commands/session.js";
import { Config } from "../src/config.js";
import {
  createNewSession,
  formatSessionTimestamp,
  listSessions,
  migrateOldSession,
  resolveActiveSession,
} from "../src/runtime/session-files.js";

type Action = (argv: { session?: unknown; options?: Record<string, unknown> }) => Promise<string | undefined>;
type RegisteredCommand = {
  readonly name: string;
  readonly action: ReturnType<typeof vi.fn>;
  readonly dispose: ReturnType<typeof vi.fn>;
};

const commandSession = { platform: "test", selfId: "bot", channelId: "room", isDirect: false };
const commandScope = { platform: "test", selfId: "bot", channelId: "room", type: "shared" };

function setupCommands() {
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

function commandAction(commands: Map<string, RegisteredCommand>, name: string): Action {
  return commands.get(`yesimbot.session.${name}`)!.action.mock.calls[0]![0];
}

describe("session configuration", () => {
  it("materializes compact and idle defaults", () => {
    expect(Config({ basePath: "data", chatModel: "test:model" }).session).toEqual({
      compact: { threshold: 0.9, charTokenRatio: 1.8, minMessages: 20, maxFailures: 3, model: undefined },
      idle: { timeout: 7_200_000 },
    });
  });
});

describe("yesimbot session commands", () => {
  it("registers compact, archive, clear, status, and list for the invoking channel", async () => {
    const { commands, ctx, manager } = setupCommands();

    await expect(commandAction(commands, "compact")({ session: commandSession })).resolves.toBe("已压缩当前会话。");
    await expect(
      commandAction(commands, "archive")({ session: commandSession, options: { noSummary: true } }),
    ).resolves.toBe("已归档当前会话。");
    await expect(commandAction(commands, "status")({ session: commandSession })).resolves.toBe("状态");
    await expect(commandAction(commands, "list")({ session: commandSession })).resolves.toBe("列表");

    expect(ctx.command).toHaveBeenCalledWith("yesimbot.session", "会话管理", { authority: 4 });
    expect(manager.compact).toHaveBeenCalledWith(commandScope);
    expect(manager.archive).toHaveBeenCalledWith(commandScope, { noSummary: true });
    expect(manager.status).toHaveBeenCalledWith(commandScope);
    expect(manager.list).toHaveBeenCalledWith(commandScope);
  });

  it("clears only after a confirmation prompt", async () => {
    const { commands, manager } = setupCommands();
    const declined = { ...commandSession, send: vi.fn(), prompt: vi.fn(async () => "取消") };
    const confirmed = { ...commandSession, send: vi.fn(), prompt: vi.fn(async () => "确认") };

    await expect(commandAction(commands, "clear")({ session: declined })).resolves.toBe("操作已取消。");
    await expect(commandAction(commands, "clear")({ session: confirmed })).resolves.toBe(
      "已清空所有会话记录和资源文件。",
    );

    expect(declined.prompt).toHaveBeenCalledWith(60_000);
    expect(manager.clear).toHaveBeenCalledTimes(1);
    expect(manager.clear).toHaveBeenCalledWith(commandScope);
  });
});

describe("session files", () => {
  let dir: string;

  beforeEach(async () => {
    dir = join(tmpdir(), `session-test-${Date.now()}`);
    await fs.mkdir(dir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("formats a date as YYYYMMDDTHHmmssZ", () => {
    expect(formatSessionTimestamp(new Date("2026-08-03T14:30:22.000Z"))).toBe("20260803T143022Z");
  });

  it("resolves the latest JSONL session and ignores other files", async () => {
    expect(await resolveActiveSession(dir)).toBeNull();
    await fs.writeFile(join(dir, "20260801T090000Z.jsonl"), "");
    await fs.writeFile(join(dir, "20260803T143022Z.jsonl"), "");
    await fs.writeFile(join(dir, "sessions.json"), "");
    await fs.writeFile(join(dir, "README.md"), "");

    expect(await resolveActiveSession(dir)).toBe(join(dir, "20260803T143022Z.jsonl"));
  });

  it("creates a timestamp-named JSONL session", async () => {
    const path = await createNewSession(dir);

    expect(path).toMatch(/\/\d{8}T\d{6}Z\.jsonl$/);
    expect((await fs.stat(path)).isFile()).toBe(true);
  });

  it("lists sessions in descending order with an active marker", async () => {
    await fs.writeFile(join(dir, "20260801T090000Z.jsonl"), '{"id":"a"}\n');
    await fs.writeFile(join(dir, "20260803T143022Z.jsonl"), '{"id":"b"}\n{"id":"c"}\n');

    expect(await listSessions(dir)).toEqual([
      expect.objectContaining({ filename: "20260803T143022Z.jsonl", isActive: true }),
      expect.objectContaining({ filename: "20260801T090000Z.jsonl", isActive: false }),
    ]);
  });

  it("migrates a legacy messages file and leaves an absent one unchanged", async () => {
    const content = '{"id":"x","timestamp":1722470400000,"type":"message","data":{}}\n';
    await fs.writeFile(join(dir, "messages.jsonl"), content);
    const logger = { error: () => {} };

    await migrateOldSession(dir, logger);

    expect(await fs.readdir(dir)).toSatisfy((files: string[]) =>
      files.some((file) => file.endsWith(".jsonl") && file !== "messages.jsonl"),
    );

    const emptyDir = join(dir, "empty");
    await fs.mkdir(emptyDir);
    await migrateOldSession(emptyDir, logger);
    await expect(fs.readdir(emptyDir)).resolves.toEqual([]);
  });
});
