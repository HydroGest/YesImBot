import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Context } from "@koishijs/core";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("koishi", async () => import("@koishijs/core"));

import * as modelConfig from "../src/model/config.js";
import { ModelService } from "../src/model/service.js";
import type { ModelProvider } from "../src/model/types.js";

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

async function createModelService(models: unknown, basePath?: string): Promise<ModelService> {
  const directory = basePath ?? (await createModelsPath(models)).slice(0, -"/models.json".length);
  const ctx = new Context();
  ctx.baseDir = "/";
  const service = new ModelService(ctx as never, { basePath: directory });
  await service.start();
  service.register(createProvider());
  return service;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })));
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

    await expect(modelConfig.writeModelsConfig(directory, config)).rejects.toMatchObject({ code: "EISDIR" });
    expect(config).toEqual({
      defaults: {},
      aliases: { vision: "openai:gpt-4o" },
      chat: {},
      embedding: {},
    });
  });
});
