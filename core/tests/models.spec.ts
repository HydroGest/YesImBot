import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { Context } from "@koishijs/core";
import type { ToolSet } from "ai";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("koishi", async () => import("@koishijs/core"));

import { ModelService } from "../src/models/index.js";

type ModelProvider = Parameters<ModelService["register"]>[0];

const temporaryDirectories: string[] = [];

async function createModelsPath(value: unknown): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "yesimbot-model-"));
  temporaryDirectories.push(directory);
  const path = path.join(directory, "models.json");
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return path;
}

function createProvider(): ModelProvider {
  return {
    id: "openai",
    capabilities: { chat: true, embedding: true },
    chatModels: () => [{ id: "gpt-4o", name: "GPT-4o" }],
    embeddingModels: () => [{ id: "text-embedding-3-small", dimension: 1536 }],
    chat: () => ({}) as never,
    embedding: () => ({}) as never,
  };
}

function createProviderWithImage(): ModelProvider {
  return {
    id: "openai",
    capabilities: { chat: true, embedding: true },
    chatModels: () => [{ id: "gpt-4o", name: "GPT-4o", modalities: { input: ["image" as const] } }],
    embeddingModels: () => [{ id: "text-embedding-3-small", dimension: 1536 }],
    chat: () => ({}) as never,
    embedding: () => ({}) as never,
  };
}

async function createModelService(models: unknown, basePath?: string, provider?: ModelProvider): Promise<ModelService> {
  const directory = basePath ?? (await createModelsPath(models)).slice(0, -"/models.json".length);
  const ctx = new Context();
  ctx.baseDir = "/";
  const service = new ModelService(ctx as never, { basePath: directory });
  await service.start();
  service.register(provider ?? createProvider());
  return service;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

describe("models.json modalities", () => {
  it("preserves configured embedding defaults through provider registration, resolution, listing, and query", async () => {
    const embedding = {};
    const provider: ModelProvider = {
      id: "openai",
      capabilities: { chat: true, embedding: true },
      chatModels: () => [{ id: "gpt-4o" }],
      embeddingModels: () => [{ id: "text-embedding-3-small", dimension: 1536 }],
      chat: () => ({}) as never,
      embedding: vi.fn(() => embedding as never),
    };
    const service = await createModelService(
      {
        defaults: { embedding: "openai:text-embedding-3-small" },
        aliases: { semantic: "openai:text-embedding-3-small" },
        embedding: { "openai:text-embedding-3-small": { name: "Semantic" } },
      },
      undefined,
      provider,
    );

    expect(service.getDefaultEmbeddingModelId()).toBe("openai:text-embedding-3-small");
    expect(service.resolveEmbedding("semantic")).not.toBe(embedding);
    expect(service.listEmbeddingModels()).toEqual([
      { fullId: "openai:text-embedding-3-small", config: { id: "text-embedding-3-small", dimension: 1536, name: "Semantic" } },
    ]);
    expect(service.getProvider("openai")).toBe(provider);
  });

  it("loads independent input and output modality arrays when their values are supported", async () => {
    const service = await createModelService({ chat: { "openai:gpt-4o": { modalities: { input: ["image"], output: ["text"] } } } });

    expect(service.resolveChatModel("openai:gpt-4o").entry.modalities).toEqual({ input: ["image"], output: ["text"] });
  });

  it("ignores invalid modality arrays without discarding valid independent values", async () => {
    const inputService = await createModelService({ chat: { "openai:gpt-4o": { modalities: { input: ["image"], output: ["unsupported"] } } } });
    const outputService = await createModelService({ chat: { "openai:gpt-4o": { modalities: { input: "image", output: ["text"] } } } });

    expect(inputService.resolveChatModel("openai:gpt-4o").entry.modalities).toEqual({ input: ["image"] });
    expect(outputService.resolveChatModel("openai:gpt-4o").entry.modalities).toEqual({ output: ["text"] });
  });

  it("keeps resolved modality arrays isolated from callers", async () => {
    const service = await createModelService({ chat: { "openai:gpt-4o": { modalities: { input: ["image"] } } } });

    const first = service.resolveChatModel("openai:gpt-4o");
    first.entry.modalities?.input.push("text");

    expect(service.resolveChatModel("openai:gpt-4o").entry.modalities?.input).toEqual(["image"]);
  });

  it("does not expose provider-declared image modalities without a models.json override", async () => {
    const path = await createModelsPath({});
    const service = await createModelService(JSON.parse(await readFile(path, "utf8")), path.slice(0, -"/models.json".length), createProviderWithImage());

    expect(service.resolveChatModel("openai:gpt-4o").entry.modalities?.input).toBeUndefined();
  });
  it("includes a provider tool set with the resolved chat model", async () => {
    const tools = { web_search: { type: "provider", id: "test.web_search", inputSchema: {} as never } } as ToolSet;
    const provider = { ...createProvider(), tools: vi.fn(() => tools) } as ModelProvider & { tools(modelId: string): ToolSet };
    const service = await createModelService({}, undefined, provider);

    const resolved = service.resolveChatModel("openai:gpt-4o");

    expect(provider.tools).toHaveBeenCalledWith("gpt-4o");
    expect(resolved.tools).toEqual(tools);
    expect(resolved.tools).not.toBe(tools);
  });
  it("wraps resolved chat models and emits their usage", async () => {
    const ctx = new Context();
    ctx.baseDir = "/";
    const model = {
      specificationVersion: "v3",
      provider: "openai",
      modelId: "gpt-4o",
      supportedUrls: {},
      async doGenerate() {
        throw new Error("not implemented");
      },
      async doStream() {
        return {
          stream: new ReadableStream({
            start(controller) {
              controller.enqueue({ type: "finish", usage: { inputTokens: 3, outputTokens: 2 } });
              controller.close();
            },
          }),
        };
      },
    };
    const service = new ModelService(ctx as never, { basePath: await createModelsPath({}).then((path) => path.slice(0, -"/models.json".length)) });
    await service.start();
    service.register({ ...createProvider(), chat: () => model as never });
    let event: unknown;
    ctx.on("yesimbot/model-usage" as never, (value: unknown) => {
      event = value;
    });
    let wrapped = 0;
    service.middleware({
      specificationVersion: "v3",
      wrapStream: async ({ doStream }) => {
        wrapped++;
        return doStream();
      },
    });

    const context = { type: "guild" as const, platform: "onebot", channelId: "123", guildId: "123" };
    const result = await (service.resolveChatModel("openai:gpt-4o", context).model as unknown as typeof model).doStream({} as never);
    const reader = result.stream.getReader();
    while (!(await reader.read()).done) continue;

    expect(wrapped).toBe(1);
    expect(event).toMatchObject({ context, modelId: "openai:gpt-4o", providerId: "openai", providerModelId: "gpt-4o", kind: "chat" });
  });
});
