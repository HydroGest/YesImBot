import { h, type Element } from "koishi";

import { detectMediaType, type ResourceReader } from "./read.js";

const RESOURCE_SOURCE = /^(asset|artifact|workspace):\/\//;
const RESOURCE_ELEMENT_TYPES = new Set(["img", "file"]);
const GENERIC_FILE_MEDIA_TYPE = "application/octet-stream";

interface OutputPreparationOptions {
  readonly signal?: AbortSignal;
  readonly warn?: (event: string, fields: { elementType: string }) => void;
}

export async function prepareOutputSegments(
  segments: readonly (readonly Element[])[],
  reader: ResourceReader,
  options: OutputPreparationOptions = {},
): Promise<Element[][]> {
  const prepared: Element[][] = [];
  for (const segment of segments) {
    prepared.push(await prepareElements(segment, reader, options));
  }
  return prepared;
}

async function prepareElements(
  elements: readonly Element[],
  reader: ResourceReader,
  options: OutputPreparationOptions,
): Promise<Element[]> {
  const prepared: Element[] = [];
  for (const element of elements) {
    const preparedElement = await prepareElement(element, reader, options);
    if (preparedElement) prepared.push(preparedElement);
  }
  return prepared;
}

async function prepareElement(
  element: Element,
  reader: ResourceReader,
  options: OutputPreparationOptions,
): Promise<Element | undefined> {
  if (element.children.length > 0) {
    return h(element.type, element.attrs, await prepareElements(element.children, reader, options));
  }
  const src = element.attrs.src;
  if (typeof src !== "string" || !RESOURCE_SOURCE.test(src) || !RESOURCE_ELEMENT_TYPES.has(element.type))
    return element;

  try {
    const opened = await reader.openBytes(src, options.signal);
    if (!opened) return omitOutputResource(element, options);
    const detected = detectMediaType(opened.bytes);
    let mediaType = opened.mediaType;
    if (element.type === "img") {
      if (!detected) return omitOutputResource(element, options);
      mediaType = detected;
    } else if (!mediaType || (mediaType.startsWith("image/") && !detected)) {
      mediaType = detected ?? GENERIC_FILE_MEDIA_TYPE;
    }
    const dataUrl = `data:${mediaType};base64,${Buffer.from(opened.bytes).toString("base64")}`;
    return h(element.type, { ...element.attrs, src: dataUrl });
  } catch {
    return omitOutputResource(element, options);
  }
}

function omitOutputResource(element: Element, options: OutputPreparationOptions): undefined {
  options.warn?.("resource_output_omitted", { elementType: element.type });
  return undefined;
}
