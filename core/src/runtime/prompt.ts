import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { SystemModelMessage } from "ai";
import type { Logger } from "koishi";

import type { ChannelScope } from "../channel/index.js";
import { DEFAULT_ATHENA_PERSONA } from "./prompts/athena.js";
import { CORE_CONSTITUTION } from "./prompts/constitution.js";

export interface CoreSystemPromptOptions {
  readonly basePath: string;
  readonly channel: ChannelScope;
  readonly logger?: Logger;
}

async function readPromptFile(
  basePath: string,
  fileName: "AGENTS.md" | "PERSONA.md",
  logger?: Logger,
): Promise<string | undefined> {
  try {
    const content = (await readFile(join(basePath, fileName), "utf8")).trim();
    return content.length > 0 ? content : undefined;
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
    throw error;
  }
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function wrap(tag: "agents" | "persona", content: string): SystemModelMessage {
  return {
    role: "system",
    content: `<${tag}>\n${content}\n</${tag}>`,
  };
}

function formatRuntimeContext(channel: ChannelScope): SystemModelMessage {
  return {
    role: "system",
    content: [
      "<runtime_context>",
      `  <platform>${escapeXml(channel.platform)}</platform>`,
      `  <selfId>${escapeXml(channel.selfId)}</selfId>`,
      `  <channelId>${escapeXml(channel.channelId)}</channelId>`,
      `  <isDirect>${channel.isDirect}</isDirect>`,
      "</runtime_context>",
    ].join("\n"),
  };
}

export async function buildCoreSystemPrompt(
  options: CoreSystemPromptOptions,
): Promise<SystemModelMessage[]> {
  const [agents, customPersona] = await Promise.all([
    readPromptFile(options.basePath, "AGENTS.md", options.logger),
    readPromptFile(options.basePath, "PERSONA.md", options.logger),
  ]);
  const persona = customPersona ?? DEFAULT_ATHENA_PERSONA;

  return [
    { role: "system", content: CORE_CONSTITUTION },
    ...(agents ? [wrap("agents", agents)] : []),
    wrap("persona", persona),
    formatRuntimeContext(options.channel),
  ];
}
