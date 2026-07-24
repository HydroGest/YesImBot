import { randomUUID } from "node:crypto";
import { readFile, rename, rm, writeFile } from "node:fs/promises";

import {
  ChatModelConfig,
  type ChatModelModality,
  EmbeddingModelConfig,
  isChatModelModality,
  ModelId,
  parseModelId,
} from "./types.js";

type JsonObject = Record<string, unknown>;

export interface ChatModelOverride extends Partial<Omit<ChatModelConfig, "id">> {
  name?: string;
  toolCall?: boolean;
  reasoning?: boolean;
  hidden?: boolean;
}

export interface EmbeddingModelOverride extends Partial<Omit<EmbeddingModelConfig, "id">> {
  name?: string;
  hidden?: boolean;
}

export interface ModelsConfigData {
  defaults: {
    chat?: string;
    embedding?: string;
  };
  aliases: Record<string, string>;
  chat: Record<string, ChatModelOverride>;
  embedding: Record<string, EmbeddingModelOverride>;
}

export interface ModelsConfigLoadResult {
  config: ModelsConfigData;
  warnings: string[];
}

function isPlainObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readObjectSection(
  root: JsonObject,
  key: keyof ModelsConfigData,
  warnings: string[],
): JsonObject {
  const value = root[key];
  if (value === undefined) {
    return {};
  }
  if (!isPlainObject(value)) {
    warnings.push(`models.json field "${key}" must be an object.`);
    return {};
  }
  return value;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function readVariants(value: unknown): Record<string, unknown> | undefined {
  return isPlainObject(value) ? { ...value } : undefined;
}

function readModalities(value: unknown, fullId: string, warnings: string[]): ChatModelConfig["modalities"] {
  if (!isPlainObject(value)) {
    warnings.push(`models.json chat override for "${fullId}" modalities must be an object.`);
    return undefined;
  }

  const input = readModalityArray(value.input, fullId, "input", warnings);
  const output = readModalityArray(value.output, fullId, "output", warnings);
  return input || output ? { ...(input ? { input } : {}), ...(output ? { output } : {}) } : undefined;
}

function readModalityArray(
  value: unknown,
  fullId: string,
  direction: "input" | "output",
  warnings: string[],
): ChatModelModality[] | undefined {
  if (value === undefined) return undefined;
  if (Array.isArray(value) && value.every(isModelModality)) return [...value];
  warnings.push(`models.json chat override for "${fullId}" modalities.${direction} must be valid.`);
  return undefined;
}

function isModelModality(value: unknown): value is ChatModelModality {
  return typeof value === "string" && isChatModelModality(value);
}

function readChatOverrides(
  section: JsonObject,
  warnings: string[],
): Record<string, ChatModelOverride> {
  const result: Record<string, ChatModelOverride> = {};

  for (const [fullId, value] of Object.entries(section)) {
    if (!isPlainObject(value)) {
      warnings.push(`models.json chat override for "${fullId}" must be an object.`);
      continue;
    }

    result[fullId] = {
      name: readString(value.name),
      toolCall: readBoolean(value.toolCall),
      reasoning: readBoolean(value.reasoning),
      hidden: readBoolean(value.hidden),
      modalities: value.modalities === undefined ? undefined : readModalities(value.modalities, fullId, warnings),
      variants: readVariants(value.variants),
    };
  }

  return result;
}

export async function writeModelsConfig(filePath: string, config: ModelsConfigData): Promise<void> {
  const temporary = `${filePath}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(config, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    await rename(temporary, filePath);
  } finally {
    await rm(temporary, { force: true });
  }
}

function readEmbeddingOverrides(
  section: JsonObject,
  warnings: string[],
): Record<string, EmbeddingModelOverride> {
  const result: Record<string, EmbeddingModelOverride> = {};

  for (const [fullId, value] of Object.entries(section)) {
    if (!isPlainObject(value)) {
      warnings.push(`models.json embedding override for "${fullId}" must be an object.`);
      continue;
    }

    result[fullId] = {
      name: readString(value.name),
      hidden: readBoolean(value.hidden),
    };
  }

  return result;
}

export function isModelId(value: string): value is ModelId {
  return parseModelId(value) !== null;
}

export async function loadModelsConfig(filePath?: string): Promise<ModelsConfigLoadResult> {
  const empty: ModelsConfigData = {
    defaults: {},
    aliases: {},
    chat: {},
    embedding: {},
  };

  if (!filePath) {
    return { config: empty, warnings: [] };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(filePath, "utf8"));
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { config: empty, warnings: [] };
    }
    return {
      config: empty,
      warnings: [
        `Failed to parse models.json at ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
      ],
    };
  }

  if (!isPlainObject(parsed)) {
    return {
      config: empty,
      warnings: [`models.json root must be an object: ${filePath}`],
    };
  }

  const warnings: string[] = [];
  const defaultsSection = readObjectSection(parsed, "defaults", warnings);
  const aliasesSection = readObjectSection(parsed, "aliases", warnings);
  const chatSection = readObjectSection(parsed, "chat", warnings);
  const embeddingSection = readObjectSection(parsed, "embedding", warnings);

  const defaults = {
    chat: readString(defaultsSection.chat),
    embedding: readString(defaultsSection.embedding),
  };

  const aliases: Record<string, string> = {};
  for (const [alias, target] of Object.entries(aliasesSection)) {
    const value = readString(target);
    if (!value) {
      warnings.push(`models.json alias "${alias}" must point to a non-empty string.`);
      continue;
    }
    aliases[alias] = value;
  }

  return {
    config: {
      defaults,
      aliases,
      chat: readChatOverrides(chatSection, warnings),
      embedding: readEmbeddingOverrides(embeddingSection, warnings),
    },
    warnings,
  };
}
