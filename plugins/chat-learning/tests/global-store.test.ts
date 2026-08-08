import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  createEmptyGlobalRuleBank,
  createGlobalRuleStore,
  mergeLocalPatterns,
  selectGlobalPatterns,
} from "../src/global-store.js";
import type { InitiationPattern, ResponsePattern } from "../src/types.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("mergeLocalPatterns", () => {
  it("aggregates the same phrase across channels without double counting one channel", () => {
    const response: ResponsePattern = {
      intent: "agree",
      phrase: "确实",
      frequency: 2,
      sampleIds: ["a"],
    };
    const bank = mergeLocalPatterns(createEmptyGlobalRuleBank(), [response], [], "channel-a", 1000);
    const second = mergeLocalPatterns(bank, [response], [], "channel-b", 2000);
    const sameChannel = mergeLocalPatterns(second, [response], [], "channel-a", 3000);
    const pattern = sameChannel.patterns[0]!;

    expect(pattern.channels).toHaveLength(2);
    expect(pattern.channels[0]).toMatchObject({ key: expect.any(String), frequency: 2 });
    expect(pattern.channels[1]).toMatchObject({ key: expect.any(String), frequency: 2 });
  });

  it("selects only patterns seen in enough channels", () => {
    const response: ResponsePattern = {
      intent: "agree",
      phrase: "确实",
      frequency: 1,
      sampleIds: ["a"],
    };
    const bank = mergeLocalPatterns(createEmptyGlobalRuleBank(), [response], [], "channel-a", 1000);

    expect(selectGlobalPatterns(bank, "response", 2, 8)).toHaveLength(0);
    const crossed = mergeLocalPatterns(bank, [response], [], "channel-b", 2000);
    expect(selectGlobalPatterns(crossed, "response", 2, 8)).toHaveLength(1);
  });

  it("persists global rules across store instances", async () => {
    const root = await mkdtemp(join(tmpdir(), "chat-learning-global-"));
    roots.push(root);
    const path = join(root, "global.json");
    const response: ResponsePattern = {
      intent: "agree",
      phrase: "确实",
      frequency: 1,
      sampleIds: ["a"],
    };
    const first = createGlobalRuleStore(path);
    await first.init();
    const merged = mergeLocalPatterns(first.read(), [response], [], "channel-a", 1000);
    await first.update(merged);

    const second = createGlobalRuleStore(path);
    await second.init();

    expect(second.read().patterns).toHaveLength(1);
  });
});

describe("initiation patterns", () => {
  it("merges initiation patterns into the global bank", () => {
    const initiation: InitiationPattern = {
      intent: "question",
      phrase: "有人试过吗",
      frequency: 1,
      sampleIds: ["a"],
    };
    const bank = mergeLocalPatterns(createEmptyGlobalRuleBank(), [], [initiation], "channel-a", 1000);

    expect(selectGlobalPatterns(bank, "initiation", 1, 8)).toHaveLength(1);
  });
});
