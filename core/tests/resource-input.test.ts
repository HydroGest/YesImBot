import { describe, expect, it, vi } from "vitest";

vi.mock("koishi", async () => import("@koishijs/core"));

import { h } from "koishi";

import { persistElements } from "../src/resources/input.js";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
const id = "0123456789abcdef0123456789abcdef";

describe("session-live input resources", () => {
  it("persists an inbound image through the resolved ChannelResources owner", async () => {
    const http = Object.assign(
      vi.fn(async () => ({
        data: new ReadableStream({
          start(controller) {
            controller.enqueue(PNG);
            controller.close();
          },
        }),
      })),
      {
        head: vi.fn(async () => ({
          get: (name: string) => ({ "content-type": "image/png", "content-length": "4" })[name] ?? null,
        })),
      },
    );
    const resources = { assets: { put: vi.fn(async () => id) } };

    const elements = await persistElements({ http } as never, [h("img", { src: "https://example.test/image.png" })], resources as never);

    expect(resources.assets.put).toHaveBeenCalledWith(PNG);
    expect(elements).toEqual([h("img", { id })]);
  });
});
