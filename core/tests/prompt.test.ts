import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildCoreSystemPrompt,
  DEFAULT_PERSONA,
  ensureDefaultPersona,
} from "../src/runtime/prompt.js";
import type { ChannelScope } from "../src/runtime/storage.js";

const roots: string[] = [];
const scope = {
  platform: "test",
  selfId: "bot-1",
  channelId: "room-1",
  type: "shared",
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

    const result = await buildCoreSystemPrompt({
      basePath,
      channel: {
        platform: "one&bot",
        selfId: "<bot>",
        channelId: 'room"1',
        type: "shared",
      },
      customInnerThought: true,
      logger: { debug: vi.fn(), warn: vi.fn() } as never,
    });

    expect(result).toEqual([
      {
        role: "system",
        content: expect.stringContaining("<base_instructions>") as unknown as string,
      },
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

  it("composes an inline Chinese prompt without the custom inner-thought protocol when disabled", async () => {
    const basePath = await createBasePath();

    const result = await buildCoreSystemPrompt({ basePath, channel: scope, customInnerThought: false });
    const text = result.map((block) => String(block.content)).join("\n");

    expect(text).toMatch(/[\u4e00-\u9fff]/);
    expect(text).not.toContain("<inner_thought>");
    expect(text).not.toContain("</inner_thought>");
    expect(text).not.toContain("inner_thought");
  });

  it("adds the custom inner-thought protocol when enabled while preserving the block order", async () => {
    const basePath = await createBasePath();

    const disabled = await buildCoreSystemPrompt({ basePath, channel: scope, customInnerThought: false });
    const enabled = await buildCoreSystemPrompt({ basePath, channel: scope, customInnerThought: true });
    const enabledText = enabled.map((block) => String(block.content)).join("\n");
    const disabledText = disabled.map((block) => String(block.content)).join("\n");

    expect(enabledText).toContain("<inner_thought>");
    expect(enabledText).toContain("</inner_thought>");
    expect(enabledText).toMatch(/[\u4e00-\u9fff]/);
    expect(disabledText).not.toContain("<inner_thought>");
    expect(disabledText).not.toContain("</inner_thought>");
    // The visible block order stays: constitution, persona, runtime context.
    expect(enabled).toHaveLength(3);
    expect(String(enabled[0].content)).toContain("<base_instructions>");
    expect(String(enabled[1].content)).toBe(`<persona>\n${DEFAULT_PERSONA}\n</persona>`);
    expect(String(enabled[2].content)).toContain("<runtime_context>");
  });

  it("states that Markdown blank lines are not a message boundary and only <sep/> requests another message", async () => {
    const basePath = await createBasePath();

    const result = await buildCoreSystemPrompt({ basePath, channel: scope, customInnerThought: false });
    const text = result.map((block) => String(block.content)).join("\n");

    expect(text).toContain("Markdown 空行不是消息边界");
    expect(text).toContain("只有 <sep/> 才会请求再发送一条已交付的消息");
  });

  it.each([
    ["missing", undefined],
    ["empty", " \n"],
  ] as const)("uses the default persona when PERSONA.md is %s", async (_name, content) => {
    const basePath = await createBasePath();
    if (content !== undefined) await writeFile(join(basePath, "PERSONA.md"), content);

    const result = await buildCoreSystemPrompt({ basePath, channel: scope, customInnerThought: false });
    const personas = result.filter((block) => String(block.content).startsWith("<persona>"));

    expect(personas).toEqual([
      {
        role: "system",
        content: `<persona>\n${DEFAULT_PERSONA}\n</persona>`,
      },
    ]);
  });

  it("replaces the default persona with non-empty PERSONA.md content", async () => {
    const basePath = await createBasePath();
    await writeFile(join(basePath, "PERSONA.md"), "Custom Subject\n");

    const result = await buildCoreSystemPrompt({ basePath, channel: scope, customInnerThought: false });
    const text = result.map((block) => String(block.content)).join("\n");

    expect(text).toContain("<persona>\nCustom Subject\n</persona>");
    expect(text).not.toContain(DEFAULT_PERSONA);
  });

  it("treats missing AGENTS.md as unconfigured", async () => {
    const basePath = await createBasePath();

    const result = await buildCoreSystemPrompt({ basePath, channel: scope, customInnerThought: false });

    expect(result.some((block) => String(block.content).startsWith("<agents>"))).toBe(false);
  });

  it("fails closed on non-ENOENT prompt file errors", async () => {
    const basePath = await createBasePath();
    await mkdir(join(basePath, "AGENTS.md"));
    const logger = { debug: vi.fn(), warn: vi.fn() };

    await expect(
      buildCoreSystemPrompt({ basePath, channel: scope, customInnerThought: false, logger: logger as never }),
    ).rejects.toThrow();
    expect(logger.warn).toHaveBeenCalledOnce();
  });
});

describe("ensureDefaultPersona", () => {
  it("creates a missing PERSONA.md with the exact default content", async () => {
    const basePath = await createBasePath();

    await ensureDefaultPersona(basePath);

    await expect(readFile(join(basePath, "PERSONA.md"), "utf8")).resolves.toBe(DEFAULT_PERSONA);
  });

  it("leaves an existing non-empty PERSONA.md unchanged", async () => {
    const basePath = await createBasePath();
    await writeFile(join(basePath, "PERSONA.md"), "user authored\n");

    await ensureDefaultPersona(basePath);

    await expect(readFile(join(basePath, "PERSONA.md"), "utf8")).resolves.toBe("user authored\n");
  });

  it("leaves an existing empty PERSONA.md unchanged", async () => {
    const basePath = await createBasePath();
    await writeFile(join(basePath, "PERSONA.md"), "");

    await ensureDefaultPersona(basePath);

    await expect(readFile(join(basePath, "PERSONA.md"), "utf8")).resolves.toBe("");
  });

  it("treats a concurrent EEXIST race as success", async () => {
    const basePath = await createBasePath();

    await Promise.all([ensureDefaultPersona(basePath), ensureDefaultPersona(basePath)]);

    await expect(readFile(join(basePath, "PERSONA.md"), "utf8")).resolves.toBe(DEFAULT_PERSONA);
  });
});
