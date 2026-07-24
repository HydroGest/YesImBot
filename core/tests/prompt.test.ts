import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { ChannelScope } from "../src/channel/index.js";
import { CORE_CONSTITUTION, CORE_CONSTITUTION_VERSION } from "../src/runtime/prompts/constitution.js";
import { DEFAULT_ATHENA_PERSONA } from "../src/runtime/prompts/athena.js";
import { buildCoreSystemPrompt } from "../src/runtime/prompt.js";

const roots: string[] = [];
const scope = {
  platform: "test",
  selfId: "bot-1",
  channelId: "room-1",
  isDirect: false,
} satisfies ChannelScope;

async function createBasePath(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "yesimbot-prompt-"));
  roots.push(path);
  return path;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("buildCoreSystemPrompt", () => {
  it("builds constitution, agents, custom persona, and runtime context in order", async () => {
    const basePath = await createBasePath();
    await writeFile(join(basePath, "AGENTS.md"), "operator policy\n");
    await writeFile(join(basePath, "PERSONA.md"), "custom persona\n");

    const result = await buildCoreSystemPrompt({
      basePath,
      channel: {
        platform: "one&bot",
        selfId: "<bot>",
        channelId: 'room"1',
        isDirect: false,
      },
      logger: { debug: vi.fn(), warn: vi.fn() } as never,
    });

    expect(CORE_CONSTITUTION_VERSION).toBe(1);
    expect(result).toEqual([
      { role: "system", content: CORE_CONSTITUTION },
      { role: "system", content: "<agents>\noperator policy\n</agents>" },
      { role: "system", content: "<persona>\ncustom persona\n</persona>" },
      {
        role: "system",
        content: [
          "<runtime_context>",
          "  <platform>one&amp;bot</platform>",
          "  <selfId>&lt;bot&gt;</selfId>",
          "  <channelId>room&quot;1</channelId>",
          "  <isDirect>false</isDirect>",
          "</runtime_context>",
        ].join("\n"),
      },
    ]);
  });

  it.each([
    ["missing", undefined],
    ["empty", " \n"],
  ] as const)("uses the default Athena persona when PERSONA.md is %s", async (_name, content) => {
    const basePath = await createBasePath();
    if (content !== undefined) await writeFile(join(basePath, "PERSONA.md"), content);

    const result = await buildCoreSystemPrompt({ basePath, channel: scope });
    const personas = result.filter((block) => String(block.content).startsWith("<persona>"));

    expect(personas).toEqual([
      {
        role: "system",
        content: `<persona>\n${DEFAULT_ATHENA_PERSONA}\n</persona>`,
      },
    ]);
  });

  it("replaces the default Athena persona with non-empty PERSONA.md content", async () => {
    const basePath = await createBasePath();
    await writeFile(join(basePath, "PERSONA.md"), "Custom Subject\n");

    const result = await buildCoreSystemPrompt({ basePath, channel: scope });
    const text = result.map((block) => String(block.content)).join("\n");

    expect(text).toContain("<persona>\nCustom Subject\n</persona>");
    expect(text).not.toContain(DEFAULT_ATHENA_PERSONA);
  });

  it("treats missing AGENTS.md as unconfigured", async () => {
    const basePath = await createBasePath();

    const result = await buildCoreSystemPrompt({ basePath, channel: scope });

    expect(result.some((block) => String(block.content).startsWith("<agents>"))).toBe(false);
  });

  it("fails closed on non-ENOENT prompt file errors", async () => {
    const basePath = await createBasePath();
    await mkdir(join(basePath, "AGENTS.md"));
    const logger = { debug: vi.fn(), warn: vi.fn() };

    await expect(
      buildCoreSystemPrompt({ basePath, channel: scope, logger: logger as never }),
    ).rejects.toThrow();
    expect(logger.warn).toHaveBeenCalledOnce();
  });
});
