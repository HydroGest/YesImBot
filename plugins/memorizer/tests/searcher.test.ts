import { describe, expect, it } from "vitest";

import { runSearch } from "../src/searcher.js";

describe("MemorySearcher", () => {
  it("exports runSearch as a public function", () => {
    expect(typeof runSearch).toBe("function");
  });
});
