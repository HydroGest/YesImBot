import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

import type { SystemModelMessage } from "ai";
import type { Logger } from "koishi";

import type { ChannelScope } from "../channel.js";

export const CORE_CONSTITUTION_VERSION = 3 as const;

// Resolve the package root by name instead of a relative path from this module's own
// location: pkgroll bundles this module into a single dist/index.js at the package root,
// while vitest runs it unbundled from src/runtime/, so no fixed `..` depth is correct
// in both places. Package-name resolution is depth-independent in both cases.
const require = createRequire(import.meta.url);
const resourceRoot = join(
  dirname(require.resolve("koishi-plugin-yesimbot/package.json")),
  "resources",
);

export type PromptResource = "constitution" | "athena-persona";

export interface CoreSystemPromptOptions {
  readonly basePath: string;
  readonly channel: ChannelScope;
  readonly logger?: Logger;
}

export async function readPromptResource(name: PromptResource): Promise<string> {
  const content = (await readFile(join(resourceRoot, `${name}.md`), "utf8")).trim();
  if (content.length === 0) throw new Error(`Prompt resource ${name} is empty`);
  return content;
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
      logger?.debug(`Prompt file ${fileName} not found under ${basePath}`);
      return undefined;
    }
    logger?.warn(
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
      `  <isDirect>${channel.type === "direct"}</isDirect>`,
      "</runtime_context>",
    ].join("\n"),
  };
}

export async function buildCoreSystemPrompt(
  options: CoreSystemPromptOptions,
): Promise<SystemModelMessage[]> {
  const [agents, customPersona, constitution, defaultPersona] = await Promise.all([
    readPromptFile(options.basePath, "AGENTS.md", options.logger),
    readPromptFile(options.basePath, "PERSONA.md", options.logger),
    readPromptResource("constitution"),
    readPromptResource("athena-persona"),
  ]);
  const persona = customPersona ?? defaultPersona;

  return [
    { role: "system", content: constitution },
    ...(agents ? [wrap("agents", agents)] : []),
    wrap("persona", persona),
    formatRuntimeContext(options.channel),
  ];
}
