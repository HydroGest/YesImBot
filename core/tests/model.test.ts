import { mkdir, mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Context } from "@koishijs/core";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("koishi", async () => import("@koishijs/core"));

import * as modelConfig from "../src/model/config.js";
import { ModelService } from "../src/model/service.js";
import type { ChatModelModality, ModelProvider } from "../src/model/types.js";

const temporaryDirectories: string[] = [];

async function createModelsPath(value: unknown): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "yesimbot-model-"));
  temporaryDirectories.push(directory);
  const path = join(directory, "models.json");
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
    chatModels: () => [
      {
        id: "gpt-4o",
        name: "GPT-4o",
        modalities: { input: ["image" as ChatModelModality] },
      },
    ],
    embeddingModels: () => [{ id: "text-embedding-3-small", dimension: 1536 }],
    chat: () => ({}) as never,
    embedding: () => ({}) as never,
  };
}

async function createModelService(
  models: unknown,
  basePath?: string,
  provider?: ModelProvider,
): Promise<ModelService> {
  const directory = basePath ?? (await createModelsPath(models)).slice(0, -"/models.json".length);
  const ctx = new Context();
  ctx.baseDir = "/";
  const service = new ModelService(ctx as never, { basePath: directory });
  await service.start();
  service.register(provider ?? createProvider());
  return service;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  );
});

describe("models.json modalities", () => {
  it("loads independent input and output modality arrays when their values are supported", async () => {
    const path = await createModelsPath({
      chat: {
        "openai:gpt-4o": {
          modalities: { input: ["image"], output: ["text"] },
        },
      },
    });

    const result = await modelConfig.loadModelsConfig(path);

    expect(result.config.chat["openai:gpt-4o"]?.modalities).toEqual({
      input: ["image"],
      output: ["text"],
    });
  });

  it("ignores invalid modality arrays without discarding valid independent values", async () => {
    const path = await createModelsPath({
      chat: {
        inputOnly: { modalities: { input: ["image"], output: ["unsupported"] } },
        outputOnly: { modalities: { input: "image", output: ["text"] } },
      },
    });

    const result = await modelConfig.loadModelsConfig(path);

    expect(result.config.chat.inputOnly?.modalities).toEqual({ input: ["image"] });
    expect(result.config.chat.outputOnly?.modalities).toEqual({ output: ["text"] });
    expect(result.warnings).toHaveLength(2);
  });

  it("adds an input modality through an alias, persists unrelated configuration, and refreshes resolution", async () => {
    const path = await createModelsPath({
      defaults: { chat: "openai:gpt-4o", embedding: "openai:text-embedding-3-small" },
      aliases: { vision: "openai:gpt-4o" },
      chat: {
        "openai:gpt-4o": { name: "Vision", variants: { transport: { region: "us" } } },
        "openai:other": { hidden: true },
      },
      embedding: { "openai:text-embedding-3-small": { hidden: true } },
    });
    const service = await createModelService(
      JSON.parse(await readFile(path, "utf8")),
      path.slice(0, -"/models.json".length),
    );

    await expect(service.addChatModelInputModality("vision", "image")).resolves.toBe("added");
    await expect(service.addChatModelInputModality("openai:gpt-4o", "image")).resolves.toBe(
      "unchanged",
    );

    expect(service.resolveChatModel("openai:gpt-4o").entry.modalities?.input).toEqual(["image"]);
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual({
      defaults: { chat: "openai:gpt-4o", embedding: "openai:text-embedding-3-small" },
      aliases: { vision: "openai:gpt-4o" },
      chat: {
        "openai:gpt-4o": {
          name: "Vision",
          variants: { transport: { region: "us" } },
          modalities: { input: ["image"] },
        },
        "openai:other": { hidden: true },
      },
      embedding: { "openai:text-embedding-3-small": { hidden: true } },
    });
  });

  it("serializes concurrent input modality additions through persistence and resolution", async () => {
    const path = await createModelsPath({});
    const service = await createModelService({}, path.slice(0, -"/models.json".length));

    await expect(
      Promise.all([
        service.addChatModelInputModality("openai:gpt-4o", "image"),
        service.addChatModelInputModality("openai:gpt-4o", "audio"),
      ]),
    ).resolves.toEqual(["added", "added"]);

    expect(service.resolveChatModel("openai:gpt-4o").entry.modalities?.input).toEqual([
      "image",
      "audio",
    ]);
    expect(JSON.parse(await readFile(path, "utf8")).chat["openai:gpt-4o"].modalities.input).toEqual(
      ["image", "audio"],
    );
  });

  it("keeps resolved modality arrays isolated from callers", async () => {
    const service = await createModelService({
      chat: { "openai:gpt-4o": { modalities: { input: ["image"] } } },
    });

    const first = service.resolveChatModel("openai:gpt-4o");
    first.entry.modalities?.input.push("text");

    expect(service.resolveChatModel("openai:gpt-4o").entry.modalities?.input).toEqual(["image"]);
  });

  it("rejects an unknown model or modality without changing models.json", async () => {
    const models = { chat: { "openai:gpt-4o": { name: "GPT-4o" } } };
    const path = await createModelsPath(models);
    const service = await createModelService(models, path.slice(0, -"/models.json".length));

    await expect(service.addChatModelInputModality("missing", "image")).rejects.toThrow();
    await expect(service.addChatModelInputModality("openai:gpt-4o", "unknown")).rejects.toThrow();

    expect(JSON.parse(await readFile(path, "utf8"))).toEqual(models);
  });

  it("exports an atomic models configuration writer", () => {
    expect(modelConfig).toHaveProperty("writeModelsConfig");
  });

  it("leaves the target file and config untouched when atomic rename fails", async () => {
    const path = await createModelsPath({ aliases: { vision: "openai:gpt-4o" } });
    const config = (await modelConfig.loadModelsConfig(path)).config;
    const directory = await mkdtemp(join(tmpdir(), "yesimbot-model-directory-"));
    temporaryDirectories.push(directory);

    await expect(modelConfig.writeModelsConfig(directory, config)).rejects.toMatchObject({
      code: "EISDIR",
    });
    expect(config).toEqual({
      defaults: {},
      aliases: { vision: "openai:gpt-4o" },
      chat: {},
      embedding: {},
    });
  });

  it("preserves chat model limit through an add-input-modality write cycle", async () => {
    const path = await createModelsPath({
      chat: {
        "openai:gpt-4o": {
          name: "Limited",
          limit: { context: 8000, output: 2000 },
        },
        "openai:other": {
          hidden: true,
          limit: { context: 4000, output: 1000 },
        },
      },
    });
    const service = await createModelService(
      JSON.parse(await readFile(path, "utf8")),
      path.slice(0, -"/models.json".length),
    );

    await service.addChatModelInputModality("openai:gpt-4o", "image");

    const persisted = JSON.parse(await readFile(path, "utf8"));
    expect(persisted.chat["openai:gpt-4o"].limit).toEqual({ context: 8000, output: 2000 });
    expect(persisted.chat["openai:other"].limit).toEqual({ context: 4000, output: 1000 });
    expect(service.resolveChatModel("openai:gpt-4o").entry.limit).toEqual({
      context: 8000,
      output: 2000,
    });
  });

  it("does not expose provider-declared image modalities without a models.json override", async () => {
    const path = await createModelsPath({});
    const service = await createModelService(
      JSON.parse(await readFile(path, "utf8")),
      path.slice(0, -"/models.json".length),
      createProviderWithImage(),
    );

    expect(service.resolveChatModel("openai:gpt-4o").entry.modalities?.input).toBeUndefined();
  });

  it("keeps later input modality additions usable after an atomic write failure", async () => {
    const models = { chat: { "openai:gpt-4o": { name: "GPT-4o" } } };
    const path = await createModelsPath(models);
    const service = await createModelService(models, path.slice(0, -"/models.json".length));

    expect(service.resolveChatModel("openai:gpt-4o").entry.modalities?.input).toBeUndefined();

    await unlink(path);
    await mkdir(path);

    await expect(service.addChatModelInputModality("openai:gpt-4o", "image")).rejects.toThrow();

    expect(service.resolveChatModel("openai:gpt-4o").entry.modalities?.input).toBeUndefined();
    expect(service.resolveChatModel("openai:gpt-4o").entry.name).toBe("GPT-4o");

    await rm(path, { recursive: true });
    await writeFile(path, `${JSON.stringify(models)}\n`, "utf8");
    await expect(service.addChatModelInputModality("openai:gpt-4o", "audio")).resolves.toBe(
      "added",
    );
    expect(service.resolveChatModel("openai:gpt-4o").entry.modalities?.input).toEqual(["audio"]);
    expect(JSON.parse(await readFile(path, "utf8")).chat["openai:gpt-4o"].modalities.input).toEqual(
      ["audio"],
    );
  });
});
