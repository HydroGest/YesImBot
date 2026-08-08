import { describe, expect, it, vi } from "vitest";

vi.mock("koishi", async () => import("@koishijs/core"));

import { MemosCloudClient, MemosCloudClientError } from "../src/client.js";

const DEFAULT_MEMOS_BASE_URL = "https://memos.memtensor.cn/api/openmem/v1";

describe("memosConfigSchema", () => {
  it("uses the documented MemOS Cloud defaults", async () => {
    const { DEFAULT_MEMOS_BASE_URL, memosConfigSchema } = await import("../src/config.js");
    const snapshot = JSON.parse(JSON.stringify(memosConfigSchema)) as {
      uid: number;
      refs: Record<string, { meta?: { default?: unknown }; dict?: Record<string, number> }>;
    };
    const config = snapshot.refs[String(snapshot.uid)]?.dict ?? {};
    const refs = snapshot.refs;
    const getDefault = (key: string) => refs[config[key]]?.meta?.default;

    expect(DEFAULT_MEMOS_BASE_URL).toBe("https://memos.memtensor.cn/api/openmem/v1");
    expect(getDefault("baseUrl")).toBe(DEFAULT_MEMOS_BASE_URL);
    expect(getDefault("memoryScope")).toBe("auto");
    expect(getDefault("timeoutMs")).toBe(10000);
    expect(getDefault("searchMemoryLimit")).toBe(6);
    expect(getDefault("searchPreferenceLimit")).toBe(6);
    expect(getDefault("searchRelativity")).toBe(0.45);
    expect(getDefault("includePreference")).toBe(true);
    expect(getDefault("searchFilterMode")).toBe("context");
    expect(getDefault("searchTags")).toEqual(["yesimbot"]);
    expect(getDefault("searchImportSources")).toEqual([]);
    expect(getDefault("asyncMode")).toBe(true);
    expect(getDefault("tags")).toEqual(["yesimbot"]);
    expect(getDefault("includeRawIdentityInfo")).toBe(false);
  });
});

describe("MemosCloudClient", () => {
  it("posts search requests with token auth", async () => {
    const post = vi.fn<() => Promise<{ code: number; data: { memory_detail_list: never[] }; message: string }>>(async () => ({
      code: 0,
      data: { memory_detail_list: [] },
      message: "ok",
    }));
    const client = new MemosCloudClient({
      baseUrl: DEFAULT_MEMOS_BASE_URL,
      apiKey: "mpg-test",
      timeoutMs: 1000,
      post,
    });

    await client.searchMemory({
      user_id: "yb_ch_abc",
      query: "hello",
      filter: { and: [{ scene: "group_chat" }] },
    });

    expect(post).toHaveBeenCalledWith(
      "https://memos.memtensor.cn/api/openmem/v1/search/memory",
      {
        user_id: "yb_ch_abc",
        query: "hello",
        filter: { and: [{ scene: "group_chat" }] },
      },
      {
        headers: {
          Authorization: "Token mpg-test",
          "Content-Type": "application/json",
        },
        timeout: 1000,
      },
    );
  });

  it("posts add message requests with token auth", async () => {
    const post = vi.fn<() => Promise<{ code: number; data: { task_id: string }; message: string }>>(async () => ({
      code: 0,
      data: { task_id: "task_1" },
      message: "ok",
    }));
    const client = new MemosCloudClient({
      baseUrl: `${DEFAULT_MEMOS_BASE_URL}/`,
      apiKey: "mpg-test",
      timeoutMs: 2000,
      post,
    });

    await client.addMessage({
      user_id: "yb_ch_abc",
      conversation_id: "yb_conv_abc",
      messages: [{ role: "user", content: "hello" }],
    });

    expect(post).toHaveBeenCalledWith(
      "https://memos.memtensor.cn/api/openmem/v1/add/message",
      {
        user_id: "yb_ch_abc",
        conversation_id: "yb_conv_abc",
        messages: [{ role: "user", content: "hello" }],
      },
      {
        headers: {
          Authorization: "Token mpg-test",
          "Content-Type": "application/json",
        },
        timeout: 2000,
      },
    );
  });

  it("rejects non-object responses with a sanitized error", async () => {
    const client = new MemosCloudClient({
      baseUrl: DEFAULT_MEMOS_BASE_URL,
      apiKey: "mpg-secret-key",
      timeoutMs: 1000,
      post: vi.fn<() => Promise<string>>(async () => "bad response"),
    });

    await expect(client.searchMemory({ user_id: "yb_ch_abc", query: "hello" })).rejects.toMatchObject({
      name: "MemosCloudClientError",
      code: "invalid_response",
      message: "MemOS searchMemory returned an invalid response.",
    });
  });

  it("rejects api errors without leaking the api key", async () => {
    const client = new MemosCloudClient({
      baseUrl: DEFAULT_MEMOS_BASE_URL,
      apiKey: "mpg-secret-key",
      timeoutMs: 1000,
      post: vi.fn<
        () => Promise<{
          code: number;
          message: string;
        }>
      >(async () => ({
        code: 40132,
        message: "Authorization failed for Token mpg-secret-key",
      })),
    });

    await expect(client.searchMemory({ user_id: "yb_ch_abc", query: "hello" })).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(MemosCloudClientError);
      expect(error).toMatchObject({
        code: "api_error",
        apiCode: 40132,
      });
      expect((error as Error).message).toBe("MemOS searchMemory failed with code 40132: Authorization failed for Token [REDACTED]");
      expect(JSON.stringify(error)).not.toContain("mpg-secret-key");
      return true;
    });
  });
});
