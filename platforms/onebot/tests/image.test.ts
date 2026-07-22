import { describe, expect, it, vi } from "vitest";

vi.mock("koishi", async () => import("@koishijs/core"));

import { h, type Element } from "koishi";
import type { ResolveContext } from "koishi-plugin-yesimbot";

import { freezeOneBotImages } from "../src/image.js";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

function freezer(): ResolveContext["freezeImage"] & { mock: ReturnType<typeof vi.fn>["mock"] } {
  return vi.fn(async (element, load) => {
    const loaded = await load(new AbortController().signal);
    return h("img", { id: "asset_abc", mime: loaded.mime });
  }) as never;
}

describe("freezeOneBotImages", () => {
  it("loads a remote Lagrange image through Koishi HTTP and delegates storage to freezeImage", async () => {
    const file = vi.fn(async () => ({
      data: PNG.buffer,
      type: "image/png",
      filename: "image.png",
    }));
    const freezeImage = freezer();

    const result = await freezeOneBotImages(
      { http: { file } } as never,
      [h("p", {}, [h.text("before"), h("img", { src: "https://lagrange.example/image" })])],
      freezeImage,
    );

    expect(file).toHaveBeenCalledWith("https://lagrange.example/image");
    expect(freezeImage).toHaveBeenCalledOnce();
    expect(result[0].children[1].attrs).toEqual({ id: "asset_abc", mime: "image/png" });
  });

  it("loads a NapCat file URL through the same signal-aware file API", async () => {
    const file = vi.fn(async () => ({
      data: PNG.buffer,
      type: "image/png",
      filename: "image.png",
    }));
    const freezeImage = freezer();

    await freezeOneBotImages(
      { http: { file } } as never,
      [h("img", { src: "file:///tmp/napcat.png" })],
      freezeImage,
    );

    expect(file).toHaveBeenCalledWith("file:///tmp/napcat.png");
  });

  it("decodes a data image without a network request", async () => {
    const file = vi.fn();
    const freezeImage = freezer();
    const src = `data:image/png;base64,${Buffer.from(PNG).toString("base64")}`;

    const result = await freezeOneBotImages(
      { http: { file } } as never,
      [h("img", { src })],
      freezeImage,
    );

    expect(file).not.toHaveBeenCalled();
    expect(result[0].attrs).toEqual({ id: "asset_abc", mime: "image/png" });
  });

  it("rejects an aborted image load without waiting for the OneBot file API", async () => {
    const file = vi.fn(async () => ({
      data: PNG.buffer,
      type: "image/png",
      filename: "image.png",
    }));
    const controller = new AbortController();
    controller.abort(new Error("stopped"));
    const freezeImage = vi.fn(async (element, load) => {
      const loaded = await load(controller.signal);
      return h("img", { id: "asset_abc", mime: loaded.mime });
    });

    await expect(
      freezeOneBotImages(
        { http: { file } } as never,
        [h("img", { src: "https://lagrange.example/image" })],
        freezeImage,
      ),
    ).rejects.toThrow("stopped");
    expect(file).not.toHaveBeenCalled();
  });

  it("seals an image without a source or frozen asset as unavailable", async () => {
    const file = vi.fn();
    const freezeImage = freezer();

    const result = await freezeOneBotImages({ http: { file } } as never, [h("img")], freezeImage);

    expect(result[0].attrs).toEqual({ unavailable: "true" });
    expect(file).not.toHaveBeenCalled();
    expect(freezeImage).not.toHaveBeenCalled();
  });

  it("leaves local assets, quotes, and forwards untouched", async () => {
    const file = vi.fn();
    const freezeImage = freezer();
    const elements: Element[] = [
      h("img", { id: "asset_local", mime: "image/png" }),
      h("quote", { id: "quoted" }),
      h("forward", { id: "forward", summary: "fixed" }),
    ];

    await expect(
      freezeOneBotImages({ http: { file } } as never, elements, freezeImage),
    ).resolves.toEqual(elements);
    expect(file).not.toHaveBeenCalled();
    expect(freezeImage).not.toHaveBeenCalled();
  });
});
