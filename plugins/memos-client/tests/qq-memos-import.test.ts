import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { buildQqMemosImportPlan, runQqMemosImportCli } from "../scripts/qq-memos-import.js";
import { deriveMemosIdentity } from "../src/identity.js";

const BOT_SELF_ID = "100000001";
const USER_ID = "200000001";
const GROUP_ID = "300000001";
const PRIVATE_ID = "400000001";
const tempDirs: string[] = [];

async function createTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function createExportFixture(params: { name: string; type: "group" | "private"; messages: unknown[] }): unknown {
  return {
    chatInfo: {
      name: params.name,
      type: params.type,
      selfUid: "bot-uid-placeholder",
      selfUin: BOT_SELF_ID,
      selfName: "Example Bot",
    },
    statistics: {},
    messages: params.messages,
    exportOptions: { includedFields: [], filters: {}, options: { encoding: "utf-8" } },
  };
}

function textMessage(overrides: {
  id: string;
  timestamp: number;
  senderId: string;
  senderName: string;
  text: string;
  system?: boolean;
  recalled?: boolean;
  elements?: Array<{ type: string; data?: Record<string, unknown> }>;
  resources?: Array<Record<string, unknown>>;
}): unknown {
  return {
    id: overrides.id,
    seq: overrides.id,
    timestamp: overrides.timestamp,
    sender: {
      uid: `uid-${overrides.senderId}`,
      uin: overrides.senderId,
      name: overrides.senderName,
      nickname: overrides.senderName,
    },
    type: "type_1",
    content: {
      text: overrides.text,
      html: "",
      elements: overrides.elements ?? [{ type: "text", data: { text: overrides.text } }],
      resources: overrides.resources ?? [],
      mentions: [],
    },
    recalled: overrides.recalled ?? false,
    system: overrides.system ?? false,
  };
}

async function createInputDirectory(): Promise<string> {
  const dir = await createTempDir("athena-qq-memos-import-");
  await writeJson(
    join(dir, `Example_Group(${GROUP_ID}).json`),
    createExportFixture({
      name: "Example Group",
      type: "group",
      messages: [
        textMessage({
          id: "g-1",
          timestamp: 1_710_000_000_000,
          senderId: USER_ID,
          senderName: "Example User",
          text: "This project uses deterministic synthetic fixtures.",
        }),
        textMessage({
          id: "g-2",
          timestamp: 1_710_000_060_000,
          senderId: BOT_SELF_ID,
          senderName: "Example Bot",
          text: "Acknowledged with a synthetic assistant reply.",
        }),
        textMessage({
          id: "g-3",
          timestamp: 1_710_000_120_000,
          senderId: USER_ID,
          senderName: "Example User",
          text: "",
          system: true,
        }),
        textMessage({
          id: "g-4",
          timestamp: 1_710_000_180_000,
          senderId: USER_ID,
          senderName: "Example User",
          text: "",
          elements: [{ type: "image", data: { filename: "synthetic.png" } }],
          resources: [{ filename: "synthetic.png" }],
        }),
        textMessage({
          id: "g-5",
          timestamp: 1_710_000_240_000,
          senderId: USER_ID,
          senderName: "Example User",
          text: "",
          elements: [{ type: "json", data: { summary: "synthetic card without text" } }],
        }),
      ],
    }),
  );
  await writeJson(
    join(dir, "Example_Private.json"),
    createExportFixture({
      name: "Example Private",
      type: "private",
      messages: [
        textMessage({
          id: "p-1",
          timestamp: 1_710_010_000_000,
          senderId: PRIVATE_ID,
          senderName: "Example Contact",
          text: "Private synthetic context is imported separately.",
        }),
      ],
    }),
  );
  await mkdir(join(dir, "nested"));
  await writeJson(join(dir, "nested", "Nested_Should_Not_Load.json"), createExportFixture({ name: "Nested", type: "group", messages: [] }));
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("qq-memos-import script", () => {
  it("requires explicit input and bot self id", async () => {
    await expect(runQqMemosImportCli(["--dry-run"])).rejects.toThrow(/--input/u);
    await expect(runQqMemosImportCli(["--input", "./exports", "--dry-run"])).rejects.toThrow(/--bot-self-id/u);
  });

  it("dry-runs directory imports without calling MemOS", async () => {
    const inputDir = await createInputDirectory();
    const fetch = vi.fn(async () => {
      throw new Error("dry-run must not call MemOS");
    });
    const stdout: string[] = [];
    const stderr: string[] = [];

    await runQqMemosImportCli(["--input", inputDir, "--bot-self-id", BOT_SELF_ID, "--dry-run", "--debug"], {
      env: {},
      fetch,
      stdout: (line) => stdout.push(line),
      stderr: (line) => stderr.push(line),
    });

    expect(fetch).not.toHaveBeenCalled();
    const summary = JSON.parse(stdout.join("\n")) as {
      dryRun: boolean;
      files: number;
      chunks: number;
      messages: { parsed: number; imported: number; filtered: number };
      defaults: { maxTokens: number; maxMessages: number };
    };
    expect(summary).toMatchObject({
      dryRun: true,
      files: 2,
      chunks: 2,
      messages: { parsed: 6, imported: 3, filtered: 3 },
      defaults: { maxTokens: 16000, maxMessages: 400 },
    });
    expect(stderr.join("\n")).not.toContain(inputDir);
  });

  it("builds chunk messages with system source context, chat_time, and role mapping", async () => {
    const inputDir = await createInputDirectory();

    const plan = await buildQqMemosImportPlan({
      input: inputDir,
      botSelfId: BOT_SELF_ID,
      dryRun: true,
    });

    expect(plan.chunks).toHaveLength(2);
    expect(plan.chunks.every((chunk) => chunk.estimatedTokens <= 16000)).toBe(true);
    expect(plan.chunks.every((chunk) => chunk.importedMessageCount <= 400)).toBe(true);

    const groupChunk = plan.chunks.find((chunk) => chunk.channelId === GROUP_ID);
    expect(groupChunk?.request.messages[0]).toMatchObject({
      role: "system",
      chat_time: "2024-03-09 16:00:00",
    });
    expect(groupChunk?.request.messages[0]?.content).toContain("平台标识符：onebot");
    expect(groupChunk?.request.messages[0]?.content).toContain(`频道 ID：${GROUP_ID}`);
    expect(groupChunk?.request.messages.slice(1)).toEqual([
      {
        role: "user",
        content: `Example User(${USER_ID}): This project uses deterministic synthetic fixtures.`,
        chat_time: "2024-03-09 16:00:00",
      },
      {
        role: "assistant",
        content: `Example Bot(${BOT_SELF_ID}): Acknowledged with a synthetic assistant reply.`,
        chat_time: "2024-03-09 16:01:00",
      },
    ]);
  });

  it("uses shared subject ids and chunk-scoped conversation ids", async () => {
    const inputDir = await createInputDirectory();

    const plan = await buildQqMemosImportPlan({
      input: inputDir,
      botSelfId: BOT_SELF_ID,
      dryRun: true,
      maxMessages: 1,
    });
    const runtimeIdentity = deriveMemosIdentity({
      channelScope: {
        platform: "onebot",
        selfId: "another-synthetic-bot",
        channelId: GROUP_ID,
        type: "shared",
      },
      channelHash: "y4hqcmhpojcbee72vfgt22mflq",
      channelType: "group",
      authorId: USER_ID,
      turnId: "runtime-turn",
    });
    const groupChunks = plan.chunks.filter((chunk) => chunk.channelId === GROUP_ID);

    expect(groupChunks).toHaveLength(2);
    expect(new Set(groupChunks.map((chunk) => chunk.request.user_id))).toEqual(new Set([runtimeIdentity.userId]));
    expect(new Set(groupChunks.map((chunk) => chunk.request.conversation_id)).size).toBe(2);
    expect(groupChunks.map((chunk) => chunk.request.conversation_id)).not.toContain(runtimeIdentity.conversationId);
    expect(groupChunks.every((chunk) => chunk.request.info.subject_hash)).toBe(true);
  });

  it("imports chunks through MemOS only when dry-run is disabled", async () => {
    const inputDir = await createInputDirectory();
    const requests: Array<{ url: string; body: unknown; authorization?: string }> = [];
    const stderr: string[] = [];
    const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      requests.push({
        url: String(url),
        body: JSON.parse(String(init?.body)) as unknown,
        authorization: init?.headers instanceof Headers ? (init.headers.get("Authorization") ?? undefined) : undefined,
      });
      return new Response(JSON.stringify({ code: 0, data: { task_id: "task-synthetic" } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    await runQqMemosImportCli(["--input", inputDir, "--bot-self-id", BOT_SELF_ID, "--debug"], {
      env: {
        MEMOS_BASE_URL: "https://memos.example/api/openmem/v1",
        MEMOS_API_KEY: "mpg-synthetic-secret",
      },
      fetch,
      stdout: () => undefined,
      stderr: (line) => stderr.push(line),
    });

    expect(requests).toHaveLength(2);
    expect(requests[0]?.url).toBe("https://memos.example/api/openmem/v1/add/message");
    expect(requests[0]?.authorization).toBe("Token mpg-synthetic-secret");
    expect(requests[0]?.body).toMatchObject({
      async_mode: true,
      source: "yesimbot.qq_import",
      tags: ["yesimbot", "qq_import", "trusted_source"],
    });
    expect(JSON.stringify(requests[0]?.body)).not.toContain("mpg-synthetic-secret");
    expect(stderr.join("\n")).not.toContain("mpg-synthetic-secret");
  });
});
