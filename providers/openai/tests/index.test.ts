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

describe("OpenAI native web search", () => {
  it("registers web_search for opted-in Responses models", () => {
    const provider = registerProvider({ id: "openai", apiKey: "test", format: "responses", webSearch: true, chatModels: [], embeddingModels: [] });

    expect(provider.tools?.("gpt-5")?.web_search).toMatchObject({ type: "provider", id: "openai.web_search" });
  });

  it("omits web_search when Responses search is not enabled", () => {
    const provider = registerProvider({ id: "openai", apiKey: "test", format: "responses", webSearch: false, chatModels: [], embeddingModels: [] });

    expect(provider.tools?.("gpt-5")).toEqual({});
  });

  it("omits web_search for the Chat Completions format", () => {
    const provider = registerProvider({ id: "openai", apiKey: "test", format: "chat", webSearch: true, chatModels: [], embeddingModels: [] });

    expect(provider.tools?.("gpt-5")).toEqual({});
  });
});
