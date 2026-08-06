import { encode as encodeJpeg } from "jpeg-js";
import { GifReader } from "omggif";
import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";

import { firstFrameToPng, staticToGif } from "../src/frames.js";

const GIF_BASE64 = "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

describe("firstFrameToPng", () => {
  it("converts the first GIF frame to a PNG", () => {
    const result = firstFrameToPng(new Uint8Array(Buffer.from(GIF_BASE64, "base64")));
    expect(result?.mediaType).toBe("image/png");

    const png = PNG.sync.read(Buffer.from(result!.bytes));
    expect(png.width).toBe(1);
    expect(png.height).toBe(1);
  });

  it("returns undefined for invalid GIF input", () => {
    expect(firstFrameToPng(new Uint8Array([1, 2, 3]))).toBeUndefined();
  });

  it("converts a static PNG to a single-frame GIF", () => {
    const png = new PNG({ width: 2, height: 1 });
    png.data.set([255, 0, 0, 255, 0, 255, 0, 255]);
    const result = staticToGif(new Uint8Array(PNG.sync.write(png)), "image/png");

    expect(result?.mediaType).toBe("image/gif");
    const gif = new GifReader(result!.bytes);
    expect(gif.width).toBe(2);
    expect(gif.height).toBe(1);
    expect(gif.numFrames()).toBe(1);
  });

  it("converts a static JPEG to a single-frame GIF", () => {
    const jpeg = encodeJpeg(
      {
        width: 1,
        height: 1,
        data: Buffer.from([255, 0, 0, 255]),
      },
      90,
    );
    const result = staticToGif(new Uint8Array(jpeg.data), "image/jpeg");

    expect(result?.mediaType).toBe("image/gif");
    const gif = new GifReader(result!.bytes);
    expect(gif.width).toBe(1);
    expect(gif.height).toBe(1);
    expect(gif.numFrames()).toBe(1);
  });

  it("returns undefined for unsupported static image input", () => {
    expect(staticToGif(new Uint8Array([1, 2, 3]), "image/webp")).toBeUndefined();
  });
});
