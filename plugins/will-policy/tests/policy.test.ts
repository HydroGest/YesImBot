import { describe, expect, it } from "vitest";

import { resolvePolicy } from "../src/policy.js";
import { defaultRoutingConfig, defaultWillingnessConfig } from "../src/types.js";

describe("resolvePolicy", () => {
  it("resolves the configured engine and complete defaults", () => {
    const config = {
      engine: "willingness",
      routing: defaultRoutingConfig(),
      willingness: { ...defaultWillingnessConfig(), probabilityThreshold: 30, textGain: 20 },
    };

    const resolved = resolvePolicy(config);

    expect(resolved.engine).toBe("willingness");
    expect(resolved.willingness.probabilityThreshold).toBe(30);
    expect(resolved.willingness.textGain).toBe(20);
    expect(resolved.routing.group).toBe("wait");
  });

  it("does not mutate the cloned base config", () => {
    const config = { engine: "routing", routing: defaultRoutingConfig(), willingness: defaultWillingnessConfig() };
    const resolved = resolvePolicy(config);

    expect(resolved.routing).not.toBe(config.routing);
    expect(resolved.willingness).not.toBe(config.willingness);
  });
});
