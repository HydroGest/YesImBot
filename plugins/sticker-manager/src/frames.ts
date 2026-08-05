import { GifReader } from "omggif";
import { PNG } from "pngjs";

const MAX_FRAME_PIXELS = 16_777_216;

export interface StaticFrame {
  readonly bytes: Uint8Array;
  readonly mediaType: "image/png";
}

export function firstFrameToPng(input: Uint8Array): StaticFrame | undefined {
  try {
    const reader = new GifReader(input);
    if (reader.numFrames() === 0) return undefined;
    const width = reader.width;
    const height = reader.height;
    if (
      !Number.isInteger(width) ||
      !Number.isInteger(height) ||
      width <= 0 ||
      height <= 0 ||
      width * height > MAX_FRAME_PIXELS
    ) {
      return undefined;
    }

    const rgba = new Uint8Array(width * height * 4);
    reader.decodeAndBlitFrameRGBA(0, rgba);
    const png = new PNG({ width, height });
    png.data.set(rgba);
    return {
      bytes: new Uint8Array(PNG.sync.write(png)),
      mediaType: "image/png",
    };
  } catch {
    return undefined;
  }
}
