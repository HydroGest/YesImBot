import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { AgentPlugin } from "@yesimbot/agent-runtime";
import type { Logger } from "koishi";

import type { ChannelScope } from "../channel/index.js";

async function readPromptFile(
  basePath: string,
  fileName: "AGENTS.md" | "PERSONA.md",
  logger?: Logger,
): Promise<string | undefined> {
  try {
    const content = await readFile(join(basePath, fileName), "utf8");
    const trimmed = content.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      logger?.debug?.(`Prompt file ${fileName} not found under ${basePath}.`);
      return undefined;
    }
    logger?.warn?.(
      `Unable to read prompt file ${fileName}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return undefined;
  }
}

export function createPromptFilePlugin(options: {
  basePath: string;
  logger?: Logger;
}): AgentPlugin {
  return {
    name: "core.prompt-files",
    async appendSystemPrompt() {
      const agents = await readPromptFile(options.basePath, "AGENTS.md", options.logger);
      const persona = await readPromptFile(options.basePath, "PERSONA.md", options.logger);
      const blocks = [
        agents ? { role: "system" as const, content: `<agents>\n${agents}\n</agents>` } : undefined,
        persona
          ? { role: "system" as const, content: `<persona>\n${persona}\n</persona>` }
          : undefined,
      ].filter((block): block is { role: "system"; content: string } => block !== undefined);
      return blocks.length > 0 ? blocks : undefined;
    },
  };
}

export function buildCoreSystemPrompt(context: { readonly channel: ChannelScope }): string {
  const { channel } = context;
  return [
    "You are Athena, a Koishi-based chat agent running in a channel.",
    `Channel context: platform=${channel.platform}, selfId=${channel.selfId}, channelId=${channel.channelId}.`,
    "Channel messages are presented as [sender]: content and may include Koishi message element strings.",
    "Reply in plain text unless the user explicitly asks for another format.",
  ].join("\n");
}
