import { describe, expect, it } from "vitest";

import { buildMemeTemplates } from "../src/memes.js";

describe("buildMemeTemplates", () => {
  it("extracts a reusable slot template without embeddings or model", async () => {
    const phrases = [
      { phrase: "？！强强！？", frequency: 3 },
      { phrase: "？！弱弱！？", frequency: 2 },
      { phrase: "？！急急！？", frequency: 1 },
    ];

    const templates = await buildMemeTemplates(undefined, phrases, 1000);

    expect(templates[0]?.template).toBe("？！{X}！？");
    expect(templates[0]?.examples).toEqual(["？！强强！？", "？！弱弱！？", "？！急急！？"]);
    expect(templates[0]?.usage).toContain("可替换 {X}");
  });
});
