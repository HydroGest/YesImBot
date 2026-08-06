import type { AgentEntry } from "@yesimbot/agent-runtime";
import { h, type Element } from "koishi";
import type { ArtifactStore } from "koishi-plugin-yesimbot";

import { prepareStaticGif } from "./frames.js";
import type { StickerStore } from "./store.js";
import { pickBestTaggedSticker } from "./tools.js";
import type { StickerConfig, StickerProjection } from "./types.js";

interface StickerElementOptions {
  readonly store: StickerStore;
  readonly artifacts: ArtifactStore;
  readonly scopeKey: string;
  readonly config: StickerConfig;
  readonly artifactIds?: Map<string, string>;
}

const STICKER_ARTIFACT_SOURCE = /^artifact:\/\/sticker\//;
const STICKER_ID = /^[a-f0-9]{64}$/i;

export async function projectStickerElements(
  entries: readonly AgentEntry[],
  options: StickerElementOptions,
): Promise<AgentEntry[]> {
  if (!options.config.stickerElement) return [...entries];

  const result: AgentEntry[] = [];
  for (const entry of entries) {
    if (entry.type !== "message" || entry.data.role !== "assistant") {
      result.push(entry);
      continue;
    }
    const content = assistantText(entry.data.content);
    if (!content || !content.includes("sticker")) {
      result.push(entry);
      continue;
    }
    const next = await replaceStickerElements(content, options);
    result.push(next === content ? entry : { ...entry, data: { ...entry.data, content: next } });
  }
  return result;
}

export async function projectStickerHistoryElements(
  entries: readonly AgentEntry[],
  options: StickerElementOptions,
): Promise<AgentEntry[]> {
  if (!options.config.stickerElement) return [...entries];

  const result: AgentEntry[] = [];
  for (const entry of entries) {
    if (entry.type !== "message" || entry.data.role !== "assistant") {
      result.push(entry);
      continue;
    }
    const content = assistantText(entry.data.content);
    if (!content || !content.includes("artifact://sticker/")) {
      result.push(entry);
      continue;
    }
    const next = await replaceStickerHistoryElements(content, options);
    result.push(next === content ? entry : { ...entry, data: { ...entry.data, content: next } });
  }
  return result;
}

function assistantText(content: unknown): string | undefined {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return undefined;
  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (
        part &&
        typeof part === "object" &&
        "type" in part &&
        part.type === "text" &&
        typeof (part as { text?: unknown }).text === "string"
      ) {
        return (part as { text: string }).text;
      }
      return "";
    })
    .join("");
}

async function replaceStickerElements(raw: string, options: StickerElementOptions): Promise<string> {
  const tree = h.parse(raw);
  let changed = false;
  const prepared: Element[] = [];

  for (const element of tree) {
    const next = await replaceElement(element, options);
    if (next !== element) changed = true;
    if (next) prepared.push(next);
  }

  return changed ? prepared.map((element) => String(element)).join("") : raw;
}

async function replaceStickerHistoryElements(raw: string, options: StickerElementOptions): Promise<string> {
  const tree = h.parse(raw);
  let changed = false;
  const prepared: Element[] = [];

  for (const element of tree) {
    const next = await replaceHistoryElement(element, options);
    if (next !== element) changed = true;
    if (next) prepared.push(next);
  }

  return changed ? prepared.map((element) => String(element)).join("") : raw;
}

async function replaceHistoryElement(element: Element, options: StickerElementOptions): Promise<Element | undefined> {
  if (element.type === "img" && isStickerArtifactSource(element.attrs.src)) {
    const id = await resolveStickerArtifactId(element.attrs.src, options);
    return id ? h("sticker", { id }) : undefined;
  }

  if (element.children.length === 0) return element;
  let changed = false;
  const children: Element[] = [];
  for (const child of element.children) {
    const next = await replaceHistoryElement(child, options);
    if (next !== child) changed = true;
    if (next) children.push(next);
  }
  return changed ? h(element.type, element.attrs, children) : element;
}

async function replaceElement(element: Element, options: StickerElementOptions): Promise<Element | undefined> {
  if (element.type === "sticker") {
    try {
      const sticker = await resolveSticker(element.attrs, options);
      if (!sticker) return undefined;
      const bytes = await options.store.readBytes(sticker);
      const prepared = prepareStaticGif(bytes, sticker.mime, options.config.sendStaticAsGif);
      const uri = await options.artifacts.forTool("sticker").put(prepared.bytes, {
        mediaType: prepared.mediaType,
        filename: `${sticker.id}.${extensionOf(prepared.mediaType)}`,
      });
      options.artifactIds?.set(uri, sticker.id);
      await options.store.markUsed(options.scopeKey, sticker.id);
      return h("img", { src: uri });
    } catch {
      return undefined;
    }
  }

  if (element.type === "img" && isStickerArtifactSource(element.attrs.src)) {
    const id = await resolveStickerArtifactId(element.attrs.src, options);
    return id ? element : undefined;
  }

  if (element.children.length === 0) return element;
  let changed = false;
  const children: Element[] = [];
  for (const child of element.children) {
    const next = await replaceElement(child, options);
    if (next !== child) changed = true;
    if (next) children.push(next);
  }
  return changed ? h(element.type, element.attrs, children) : element;
}

async function resolveStickerArtifactId(uri: string, options: StickerElementOptions): Promise<string | undefined> {
  const known = options.artifactIds?.get(uri);
  if (known) return known;
  try {
    const opened = await options.artifacts.open(uri);
    const id = stickerIdFromFilename(opened.filename);
    if (!id || !STICKER_ID.test(id)) return undefined;
    options.artifactIds?.set(uri, id);
    return id;
  } catch {
    return undefined;
  }
}

function isStickerArtifactSource(value: unknown): value is string {
  return typeof value === "string" && STICKER_ARTIFACT_SOURCE.test(value);
}

function stickerIdFromFilename(filename: string | undefined): string | undefined {
  if (!filename) return undefined;
  const dot = filename.lastIndexOf(".");
  return dot > 0 ? filename.slice(0, dot) : undefined;
}

async function resolveSticker(
  attrs: Readonly<Record<string, unknown>>,
  options: StickerElementOptions,
): Promise<StickerProjection | null> {
  const id = stringAttr(attrs.id);
  if (id) return options.store.get(options.scopeKey, id);

  const category = stringAttr(attrs.category);
  const tags = parseTags(attrs.tags);
  if (tags.length > 0) {
    return pickBestTaggedSticker(
      options.store,
      options.scopeKey,
      tags,
      category,
      options.config.fuzzyTagMatch,
      options.config.tagRandomRange,
    );
  }
  return options.store.random(options.scopeKey, category);
}

function parseTags(value: unknown): string[] {
  if (typeof value !== "string") return [];
  return value.split(/[,，;；\s]+/).filter((tag) => tag.length > 0);
}

function stringAttr(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function extensionOf(mediaType: string): string {
  const match = /^image\/([a-z0-9.+-]+)$/.exec(mediaType);
  return match?.[1] ?? "bin";
}
