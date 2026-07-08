import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { buildCoreSystemPrompt, createPromptPlugins } from "../src/runtime/prompt.js";

describe("prompt runtime plugins", () => {
  it("appends AGENTS then PERSONA content as structured system prompt blocks", async () => {
    const basePath = await mkdtemp(join(tmpdir(), "athena-core-prompt-"));
    await writeFile(join(basePath, "AGENTS.md"), "agent rules", "utf8");
    await writeFile(join(basePath, "PERSONA.md"), "persona rules", "utf8");

    const [plugin] = createPromptPlugins({ basePath });
    const result = await plugin.appendSystemPrompt?.({} as never);

    expect(result).toEqual([
      { role: "system", content: "<agents>\nagent rules\n</agents>" },
      { role: "system", content: "<persona>\npersona rules\n</persona>" },
    ]);
  });

  it("returns undefined when prompt files are missing", async () => {
    const basePath = await mkdtemp(join(tmpdir(), "athena-core-prompt-"));
    const logger = { debug: vi.fn(), warn: vi.fn() };
    const [plugin] = createPromptPlugins({ basePath, logger });

    await expect(plugin.appendSystemPrompt?.({} as never)).resolves.toBeUndefined();
    expect(logger.debug).toHaveBeenCalled();
  });

  it("builds a core system prompt from channel context only", () => {
    const prompt = buildCoreSystemPrompt({
      channel: {
        platform: "discord",
        selfId: "bot",
        channelId: "room",
        type: "group",
      },
    });

    expect(prompt).toContain("discord");
    expect(prompt).toContain("room");
    expect(prompt).toContain("group");
    expect(prompt).toContain("plain text");
    expect(prompt).not.toContain("AGENTS.md");
    expect(prompt).not.toContain("PERSONA.md");
  });
});
