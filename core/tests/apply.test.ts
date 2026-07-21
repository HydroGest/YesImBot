import { describe, expect, it, vi } from "vitest";

vi.mock("koishi", async () => import("@koishijs/core"));

import { DeliveryService } from "../src/delivery/service.js";
import { apply } from "../src/index.js";
import { ModelService } from "../src/model/service.js";
import { PlatformService } from "../src/platform/service.js";
import { YesImBotService } from "../src/runtime/service.js";

describe("core apply", () => {
  it("registers core services in dependency order", () => {
    const plugin = vi.fn();

    apply({ plugin } as never, { basePath: "data", chatModel: "mock:model" });

    expect(plugin.mock.calls.map(([service]) => service)).toEqual([
      PlatformService,
      ModelService,
      DeliveryService,
      YesImBotService,
    ]);
  });
});
