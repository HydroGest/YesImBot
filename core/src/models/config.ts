import { readFile, writeFile } from "node:fs/promises";

export const CHAT_MODEL_MODALITIES = ["text", "audio", "image", "video", "pdf"] as const;

let mutationTail: Promise<void> = Promise.resolve();

export type ChatModelModality = (typeof CHAT_MODEL_MODALITIES)[number];

type JsonObject = Record<string, unknown>;

export interface ChatModelConfig {
  id: string;
  name?: string;
  hidden?: boolean;
  toolCall?: boolean;
  reasoning?: boolean;
  limit?: { context: number; output: number };
  modalities?: { input?: ChatModelModality[]; output?: ChatModelModality[] };
  variants?: Record<string, unknown>;
}

export interface EmbeddingModelConfig {
  id: string;
  name?: string;
  hidden?: boolean;
  dimension?: number;
}

export interface BaseProviderConfig {
  id: string;
  apiKey: string;
  baseURL?: string;
  chatModels: ChatModelConfig[];
  embeddingModels?: EmbeddingModelConfig[];
}

export interface ModelServiceConfig {
  basePath: string;
  logLevel?: number;
}

export interface ModelsConfigData {
  defaults: { chat?: string; embedding?: string };
  aliases: Record<string, string>;
  chat: Record<string, ChatModelOverride>;
  embedding: Record<string, EmbeddingModelOverride>;
}

interface ChatModelOverride extends Partial<Omit<ChatModelConfig, "id">> {
  name?: string;
  toolCall?: boolean;
  reasoning?: boolean;
  hidden?: boolean;
}

interface EmbeddingModelOverride extends Partial<Omit<EmbeddingModelConfig, "id">> {
  name?: string;
  hidden?: boolean;
}

interface ModelsConfigLoadResult {
  config: ModelsConfigData;
  warnings: string[];
}

export function isChatModelModality(value: string): value is ChatModelModality {
  return CHAT_MODEL_MODALITIES.some((modality) => modality === value);
}

export async function readModelsConfig(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8"));
}

export function mutateModelsConfig(path: string, mutate: (value: unknown) => unknown | Promise<unknown>): Promise<void> {
  const task = mutationTail.then(async () => {
    const next = await mutate(await readModelsConfig(path));
    await writeFile(path, `${JSON.stringify(next, null, 2)}\n`);
  });
  mutationTail = task.then(
    () => undefined,
    () => undefined,
  );
  return task;
}

export async function loadModelsConfig(filePath?: string): Promise<ModelsConfigLoadResult> {
  const empty = createEmptyModelsConfig();
  if (!filePath) return { config: empty, warnings: [] };

  let parsed: unknown;
  try {
    parsed = await readModelsConfig(filePath);
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { config: empty, warnings: [] };
    return { config: empty, warnings: [`Failed to parse models.json at ${filePath}: ${error instanceof Error ? error.message : String(error)}`] };
  }

  if (!isPlainObject(parsed)) {
    return { config: empty, warnings: [`models.json root must be an object: ${filePath}`] };
  }

  const warnings: string[] = [];
  const defaultsSection = readObjectSection(parsed, "defaults", warnings);
  const aliasesSection = readObjectSection(parsed, "aliases", warnings);
  const chatSection = readObjectSection(parsed, "chat", warnings);
  const embeddingSection = readObjectSection(parsed, "embedding", warnings);
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
      defaults: { chat: readString(defaultsSection.chat), embedding: readString(defaultsSection.embedding) },
      aliases,
      chat: readChatOverrides(chatSection, warnings),
      embedding: readEmbeddingOverrides(embeddingSection, warnings),
    },
    warnings,
  };
}

export function createEmptyModelsConfig(): ModelsConfigData {
  return { defaults: {}, aliases: {}, chat: {}, embedding: {} };
}

function isPlainObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readObjectSection(root: JsonObject, key: keyof ModelsConfigData, warnings: string[]): JsonObject {
  const value = root[key];
  if (value === undefined) return {};
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

function readLimit(value: unknown, fullId: string, warnings: string[]): ChatModelConfig["limit"] {
  if (!isPlainObject(value)) {
    warnings.push(`models.json chat override for "${fullId}" limit must be an object.`);
    return undefined;
  }
  const context = value.context;
  const output = value.output;
  if (typeof context !== "number" || typeof output !== "number") {
    warnings.push(`models.json chat override for "${fullId}" limit must contain numeric context and output.`);
    return undefined;
  }
  return { context, output };
}

function readVariants(value: unknown): Record<string, unknown> | undefined {
  return isPlainObject(value) ? { ...value } : undefined;
}

function readModalityArray(
  value: unknown,
  fullId: string,
  direction: "input" | "output",
  warnings: string[],
): NonNullable<ChatModelConfig["modalities"]>["input"] | undefined {
  if (value === undefined) return undefined;
  if (Array.isArray(value) && value.every(isModelModality)) return [...value];
  warnings.push(`models.json chat override for "${fullId}" modalities.${direction} must be valid.`);
  return undefined;
}

function isModelModality(value: unknown): value is NonNullable<NonNullable<ChatModelConfig["modalities"]>["input"]>[number] {
  return typeof value === "string" && isChatModelModality(value);
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

function readChatOverrides(section: JsonObject, warnings: string[]): Record<string, ChatModelOverride> {
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
      limit: value.limit === undefined ? undefined : readLimit(value.limit, fullId, warnings),
      modalities: value.modalities === undefined ? undefined : readModalities(value.modalities, fullId, warnings),
      variants: readVariants(value.variants),
    };
  }
  return result;
}

function readEmbeddingOverrides(section: JsonObject, warnings: string[]): Record<string, EmbeddingModelOverride> {
  const result: Record<string, EmbeddingModelOverride> = {};
  for (const [fullId, value] of Object.entries(section)) {
    if (!isPlainObject(value)) {
      warnings.push(`models.json embedding override for "${fullId}" must be an object.`);
      continue;
    }
    result[fullId] = { name: readString(value.name), hidden: readBoolean(value.hidden) };
  }
  return result;
}
