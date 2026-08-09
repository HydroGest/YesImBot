import { describe, expect, it } from "vitest";

import { buildMemeTemplates } from "../src/memes.js";
import type { ResponsePattern } from "../src/types.js";

describe("buildMemeTemplates", () => {
  it("extracts a reusable slot template without embeddings or model", async () => {
    const patterns: ResponsePattern[] = [
      { intent: "joke", phrase: "？！强强！？", frequency: 3, sampleIds: ["a"] },
      { intent: "joke", phrase: "？！弱弱！？", frequency: 2, sampleIds: ["b"] },
      { intent: "joke", phrase: "？！急急！？", frequency: 1, sampleIds: ["c"] },
    ];

    const templates = await buildMemeTemplates(undefined, patterns, [], 1000);

    expect(templates[0]?.template).toBe("？！{X}！？");
    expect(templates[0]?.examples).toEqual(["？！强强！？", "？！弱弱！？", "？！急急！？"]);
    expect(templates[0]?.usage).toContain("可替换 {X}");
  });
});
