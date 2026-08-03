import type { CharacterCardV3 } from "@risuai/ccardlib";
import { describe, expect, it } from "vitest";

import { selectGreeting } from "../src/greeting.js";

function createCard(): CharacterCardV3 {
  return {
    spec: "chara_card_v3",
    spec_version: "3.0",
    data: {
      name: "Athena",
      description: "",
      personality: "",
      scenario: "",
      first_mes: "first",
      mes_example: "",
      alternate_greetings: ["alternate"],
      group_only_greetings: [],
      character_version: "1",
      creator_notes: "",
      system_prompt: "",
      post_history_instructions: "",
      tags: [],
      creator: "",
      extensions: {},
    },
  };
}

describe("greeting selection", () => {
  it("uses the first greeting while random selection is disabled", () => {
    expect(selectGreeting(createCard(), false, () => 0.99)).toBe("first");
  });

  it("selects from the default and alternate greetings when enabled", () => {
    expect(selectGreeting(createCard(), true, () => 0.99)).toBe("alternate");
  });
});
