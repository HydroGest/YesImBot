import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";

import { firstFrameToPng } from "../src/frames.js";

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
});
