import { describe, expect, it, vi } from "vitest";

vi.mock("koishi", async () => import("@koishijs/core"));

import { createSearXNGBackend } from "../src/backends/searxng.js";
import { createTavilyBackend } from "../src/backends/tavily.js";
import SearchService from "../src/index.js";

const runtime = { defaultLimit: 5, maxLimit: 10, timeoutMs: 1_000, blacklist: [] };
const logger = { error: vi.fn() };

async function promptFor(provider: "tavily" | "searxng"): Promise<string> {
  const serviceLogger = { error: vi.fn(), info: vi.fn() };
  const ctx = { logger: vi.fn(() => serviceLogger), on: vi.fn(), yesimbot: { agent: { use: vi.fn(() => () => undefined) } } };
  const config =
    provider === "tavily"
      ? { provider, tavily: { apiKey: "test", searchEndpoint: "https://example.com/search", extractEndpoint: "https://example.com/extract" } }
      : { provider, searxng: { endpoint: "https://example.com" } };
  const service = new SearchService(ctx as never, config as never);

  await service.start();
  try {
    const plugin = service.setup({} as never, {} as never);
    return (plugin?.appendSystemPrompt as () => string)();
  } finally {
    await service.stop();
  }
}

describe("search backend tool names", () => {
  it("names Tavily search tavily_web_search", () => {
    const backend = createTavilyBackend(
      {} as never,
      { apiKey: "test", searchEndpoint: "https://example.com/search", extractEndpoint: "https://example.com/extract" },
      runtime,
      logger as never,
    );

    expect(backend.createSearchTool().name).toBe("tavily_web_search");
  });

  it("names Tavily scraper tavily_web_scrape", () => {
    const backend = createTavilyBackend(
      {} as never,
      { apiKey: "test", searchEndpoint: "https://example.com/search", extractEndpoint: "https://example.com/extract" },
      runtime,
      logger as never,
    );

    expect(backend.createScrapeTool?.().name).toBe("tavily_web_scrape");
  });

  it("names SearXNG search searxng_web_search", () => {
    const backend = createSearXNGBackend({} as never, { endpoint: "https://example.com" }, runtime, logger as never);

    expect(backend.createSearchTool().name).toBe("searxng_web_search");
  });

  it("describes the selected backend's concrete tool names", async () => {
    await expect(promptFor("tavily")).resolves.toContain("`tavily_web_search`");
    await expect(promptFor("tavily")).resolves.toContain("`tavily_web_scrape`");
    await expect(promptFor("searxng")).resolves.toContain("`searxng_web_search`");
  });
});
