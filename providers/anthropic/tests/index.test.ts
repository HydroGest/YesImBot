import { describe, expect, it, vi } from "vitest";
vi.mock("koishi", async () => import("@koishijs/core"));

import { apply } from "../src/index.js";

type RegisteredProvider = { tools?(modelId: string): Record<string, { readonly id?: string; readonly type?: string }> };

function registerProvider(config: Record<string, unknown>): RegisteredProvider {
  let ready: (() => void) | undefined;
  const model = { register: vi.fn(() => () => undefined) };
  const ctx = {
    on(event: string, callback: () => void) {
      if (event === "ready") ready = callback;
    },
    yesimbot: { model },
  };

  apply(ctx as never, config as never);
  if (!ready) throw new Error("provider did not register a ready callback");
  ready();
  return model.register.mock.calls[0]?.[0] as RegisteredProvider;
}

describe("Anthropic native web search", () => {
  it("registers web_search when enabled", () => {
    const provider = registerProvider({ id: "anthropic", apiKey: "test", webSearch: true, chatModels: [] });

    expect(provider.tools?.("claude-sonnet")?.web_search).toMatchObject({ type: "provider", id: "anthropic.web_search_20250305" });
  });

  it("omits web_search when disabled", () => {
    const provider = registerProvider({ id: "anthropic", apiKey: "test", webSearch: false, chatModels: [] });

    expect(provider.tools?.("claude-sonnet")).toEqual({});
  });
});
