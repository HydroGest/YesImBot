import { decode as decodeJpeg } from "jpeg-js";
import { GifReader, GifWriter } from "omggif";
import { PNG } from "pngjs";

const MAX_FRAME_PIXELS = 16_777_216;
const GIF_BUFFER_EXTRA = 4096;

export interface StaticFrame {
  readonly bytes: Uint8Array;
  readonly mediaType: "image/png";
}

export interface StaticGif {
  readonly bytes: Uint8Array;
  readonly mediaType: "image/gif";
}

export interface PreparedImage {
  readonly bytes: Uint8Array;
  readonly mediaType: string;
}

interface RgbaImage {
  readonly width: number;
  readonly height: number;
  readonly rgba: Uint8Array;
}

interface HistogramBin {
  r: number;
  g: number;
  b: number;
  count: number;
}

export function firstFrameToPng(input: Uint8Array): StaticFrame | undefined {
  try {
    const reader = new GifReader(input);
    if (reader.numFrames() === 0) return undefined;
    const width = reader.width;
    const height = reader.height;
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 || width * height > MAX_FRAME_PIXELS) {
      return undefined;
    }

    const rgba = new Uint8Array(width * height * 4);
    reader.decodeAndBlitFrameRGBA(0, rgba);
    const png = new PNG({ width, height });
    png.data.set(rgba);
    return { bytes: new Uint8Array(PNG.sync.write(png)), mediaType: "image/png" };
  } catch {
    return undefined;
  }
}

export function staticToGif(input: Uint8Array, mediaType: string): StaticGif | undefined {
  try {
    const image = decodeStaticImage(input, mediaType);
    if (!image || !hasValidDimensions(image.width, image.height)) return undefined;
    return { bytes: encodeRgbaToGif(image.rgba, image.width, image.height), mediaType: "image/gif" };
  } catch {
    return undefined;
  }
}

export function prepareStaticGif(input: Uint8Array, mediaType: string, enabled: boolean): PreparedImage {
  if (!enabled) return { bytes: input, mediaType };
  return staticToGif(input, mediaType) ?? { bytes: input, mediaType };
}

function decodeStaticImage(input: Uint8Array, mediaType: string): RgbaImage | undefined {
  if (mediaType === "image/png") {
    const png = PNG.sync.read(Buffer.from(input));
    return { width: png.width, height: png.height, rgba: new Uint8Array(png.data) };
  }
  if (mediaType === "image/jpeg" || mediaType === "image/jpg") {
    const jpeg = decodeJpeg(Buffer.from(input), { useTArray: true });
    return { width: jpeg.width, height: jpeg.height, rgba: jpeg.data };
  }
  return undefined;
}

function hasValidDimensions(width: number, height: number): boolean {
  return Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0 && width * height <= MAX_FRAME_PIXELS;
}

function encodeRgbaToGif(rgba: Uint8Array, width: number, height: number): Uint8Array {
  const hasTransparency = hasTransparentPixels(rgba);
  const colors = medianCutPalette(buildHistogram(rgba), hasTransparency ? 255 : 256);
  const nearest = createNearestIndex(colors, hasTransparency ? 1 : 0);
  const indexed = new Uint8Array(width * height);

  for (let pixel = 0; pixel < indexed.length; pixel += 1) {
    const offset = pixel * 4;
    if (hasTransparency && rgba[offset + 3]! < 128) {
      indexed[pixel] = 0;
      continue;
    }
    const r = rgba[offset]!;
    const g = rgba[offset + 1]!;
    const b = rgba[offset + 2]!;
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    indexed[pixel] = nearest[key]!;
  }

  const palette = toGifPalette(colors, hasTransparency);
  const output = new Uint8Array(width * height * 2 + GIF_BUFFER_EXTRA);
  const writer = new GifWriter(output, width, height, { palette });
  writer.addFrame(0, 0, width, height, indexed as unknown as number[], { transparent: hasTransparency ? 1 : 0 });
  writer.end();
  return new Uint8Array(output.slice(0, writer.getOutputBufferPosition()));
}

function hasTransparentPixels(rgba: Uint8Array): boolean {
  for (let offset = 3; offset < rgba.length; offset += 4) {
    if (rgba[offset]! < 128) return true;
  }
  return false;
}

function buildHistogram(rgba: Uint8Array): HistogramBin[] {
  const bins = new Map<number, HistogramBin>();
  for (let pixel = 0; pixel * 4 < rgba.length; pixel += 1) {
    const offset = pixel * 4;
    if (rgba[offset + 3]! < 128) continue;
    const r = rgba[offset]!;
    const g = rgba[offset + 1]!;
    const b = rgba[offset + 2]!;
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    let bin = bins.get(key);
    if (!bin) {
      bin = { r: 0, g: 0, b: 0, count: 0 };
      bins.set(key, bin);
    }
    bin.r += r;
    bin.g += g;
    bin.b += b;
    bin.count += 1;
  }
  return [...bins.values()].map((bin) => ({ r: bin.r / bin.count, g: bin.g / bin.count, b: bin.b / bin.count, count: bin.count }));
}

function medianCutPalette(bins: readonly HistogramBin[], maxColors: number): Array<[number, number, number]> {
  if (bins.length === 0) return [[0, 0, 0]];
  let boxes: HistogramBin[][] = [bins as HistogramBin[]];
  while (boxes.length < maxColors) {
    const index = widestBoxIndex(boxes);
    if (index < 0) break;
    const split = splitBox(boxes[index]!);
    if (!split) break;
    boxes.splice(index, 1, split[0], split[1]);
  }
  return boxes.map(averageBoxColor);
}

function widestBoxIndex(boxes: readonly (readonly HistogramBin[])[]): number {
  let best = -1;
  let bestRange = -1;
  for (let index = 0; index < boxes.length; index += 1) {
    const range = boxRange(boxes[index]!);
    if (range > bestRange) {
      bestRange = range;
      best = index;
    }
  }
  return best;
}

function boxRange(box: readonly HistogramBin[]): number {
  let rMin = 255;
  let rMax = 0;
  let gMin = 255;
  let gMax = 0;
  let bMin = 255;
  let bMax = 0;
  for (const bin of box) {
    rMin = Math.min(rMin, bin.r);
    rMax = Math.max(rMax, bin.r);
    gMin = Math.min(gMin, bin.g);
    gMax = Math.max(gMax, bin.g);
    bMin = Math.min(bMin, bin.b);
    bMax = Math.max(bMax, bin.b);
  }
  return Math.max(rMax - rMin, gMax - gMin, bMax - bMin);
}

function splitBox(box: readonly HistogramBin[]): [HistogramBin[], HistogramBin[]] | undefined {
  if (box.length < 2) return undefined;
  const channel = largestChannel(box);
  const sorted = [...box].sort((left, right) => left[channel] - right[channel]);
  const total = sorted.reduce((sum, bin) => sum + bin.count, 0);
  let accumulated = 0;
  let splitAt = sorted.length;
  for (let index = 0; index < sorted.length - 1; index += 1) {
    accumulated += sorted[index]!.count;
    if (accumulated * 2 >= total) {
      splitAt = index + 1;
      break;
    }
  }
  if (splitAt >= sorted.length) splitAt = Math.floor(sorted.length / 2);
  if (splitAt <= 0 || splitAt >= sorted.length) return undefined;
  return [sorted.slice(0, splitAt), sorted.slice(splitAt)];
}

function largestChannel(box: readonly HistogramBin[]): "r" | "g" | "b" {
  let rMin = 255;
  let rMax = 0;
  let gMin = 255;
  let gMax = 0;
  let bMin = 255;
  let bMax = 0;
  for (const bin of box) {
    rMin = Math.min(rMin, bin.r);
    rMax = Math.max(rMax, bin.r);
    gMin = Math.min(gMin, bin.g);
    gMax = Math.max(gMax, bin.g);
    bMin = Math.min(bMin, bin.b);
    bMax = Math.max(bMax, bin.b);
  }
  const rRange = rMax - rMin;
  const gRange = gMax - gMin;
  const bRange = bMax - bMin;
  if (rRange >= gRange && rRange >= bRange) return "r";
  if (gRange >= bRange) return "g";
  return "b";
}

function averageBoxColor(box: readonly HistogramBin[]): [number, number, number] {
  let r = 0;
  let g = 0;
  let b = 0;
  let count = 0;
  for (const bin of box) {
    r += bin.r * bin.count;
    g += bin.g * bin.count;
    b += bin.b * bin.count;
    count += bin.count;
  }
  return [Math.round(r / count), Math.round(g / count), Math.round(b / count)];
}

function createNearestIndex(colors: readonly (readonly [number, number, number])[], offset: number): Uint8Array {
  const nearest = new Uint8Array(1 << 15);
  for (let key = 0; key < nearest.length; key += 1) {
    const r = ((key >> 10) << 3) | ((key >> 10) >> 2);
    const g = (((key >> 5) & 0x1f) << 3) | (((key >> 5) & 0x1f) >> 2);
    const b = ((key & 0x1f) << 3) | ((key & 0x1f) >> 2);
    let best = 0;
    let bestDistance = Infinity;
    for (let index = 0; index < colors.length; index += 1) {
      const color = colors[index]!;
      const dr = r - color[0];
      const dg = g - color[1];
      const db = b - color[2];
      const distance = dr * dr + dg * dg + db * db;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = index;
      }
    }
    nearest[key] = offset + best;
  }
  return nearest;
}

function toGifPalette(colors: readonly (readonly [number, number, number])[], hasTransparency: boolean): number[] {
  const palette = hasTransparency ? [[0, 0, 0], ...colors] : colors;
  const flat = palette.map(([r, g, b]) => (r << 16) | (g << 8) | b);
  let size = 2;
  while (size < flat.length) size <<= 1;
  while (flat.length < size) flat.push(0);
  return flat;
}
