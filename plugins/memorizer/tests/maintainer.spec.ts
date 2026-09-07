import { describe, expect, it } from "vitest";

import { runMaintenance } from "../src/maintainer.js";

describe("MemoryMaintainer", () => {
  it("exports runMaintenance as a public function", () => {
    expect(typeof runMaintenance).toBe("function");
  });
});
