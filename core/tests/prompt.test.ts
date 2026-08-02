import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { ChannelScope } from "../src/channel.js";
import { buildCoreSystemPrompt, CORE_CONSTITUTION_VERSION, readPromptResource } from "../src/runtime/prompt.js";

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
  vi.restoreAllMocks();
});

describe("buildCoreSystemPrompt", () => {
  it("builds constitution, agents, custom persona, and runtime context in order", async () => {
    const basePath = await createBasePath();
    await writeFile(join(basePath, "AGENTS.md"), "operator policy\n");
    await writeFile(join(basePath, "PERSONA.md"), "custom persona\n");

    const constitution = await readPromptResource("constitution");
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

    expect(CORE_CONSTITUTION_VERSION).toBe(3);
    expect(result).toEqual([
      { role: "system", content: constitution },
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

  it("uses version-three constitution and teaches the raw control element", async () => {
    const constitution = await readPromptResource("constitution");

    expect(CORE_CONSTITUTION_VERSION).toBe(3);
    expect(constitution).toContain("<base_instructions>");
    expect(constitution).toContain("<style>");
    expect(constitution).toContain("<basic_functions>");
    expect(constitution).toContain("# Memory and context");
    expect(constitution).toContain("# Deliberation and communication");
    expect(constitution).toContain("# Voice and inner thought");
    expect(constitution).toContain("# Message shape");
    expect(constitution).toContain("# Output protocol");
    expect(constitution).toContain("<inner_thought>");
    expect(constitution).toContain("</inner_thought>");
    expect(constitution).toContain("<sep/>");
    expect(constitution).not.toContain("<skip/>");
    expect(constitution).not.toContain("<sleep");

    expect(constitution).toContain("exactly three control elements");
    expect(constitution).toContain("<raw>...</raw>");
    expect(constitution).toContain("<raw>");
    expect(constitution).toContain("</raw>");
    expect(constitution).toContain("List<String>");
  });

  it("keeps inner thought private and explains literal control escaping", async () => {
    const constitution = await readPromptResource("constitution");

    expect(constitution).toContain("Inner thought is yours alone and is never shown to anyone.");
    expect(constitution).toContain("Write &lt;sep/&gt; or &lt;inner_thought&gt;");
    expect(constitution).toContain("These elements control delivery. They never appear");
  });

  it.each([
    ["missing", undefined],
    ["empty", " \n"],
  ] as const)("uses the default Athena persona when PERSONA.md is %s", async (_name, content) => {
    const basePath = await createBasePath();
    if (content !== undefined) await writeFile(join(basePath, "PERSONA.md"), content);

    const defaultPersona = await readPromptResource("athena-persona");
    const result = await buildCoreSystemPrompt({ basePath, channel: scope });
    const personas = result.filter((block) => String(block.content).startsWith("<persona>"));

    expect(personas).toEqual([
      {
        role: "system",
        content: `<persona>\n${defaultPersona}\n</persona>`,
      },
    ]);
  });

  it("replaces the default Athena persona with non-empty PERSONA.md content", async () => {
    const basePath = await createBasePath();
    await writeFile(join(basePath, "PERSONA.md"), "Custom Subject\n");

    const defaultPersona = await readPromptResource("athena-persona");
    const result = await buildCoreSystemPrompt({ basePath, channel: scope });
    const text = result.map((block) => String(block.content)).join("\n");

    expect(text).toContain("<persona>\nCustom Subject\n</persona>");
    expect(text).not.toContain(defaultPersona);
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

    await expect(buildCoreSystemPrompt({ basePath, channel: scope, logger: logger as never })).rejects.toThrow();
    expect(logger.warn).toHaveBeenCalledOnce();
  });

  it("rejects when a packaged prompt resource is missing", async () => {
    await expect(readPromptResource("missing" as never)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
