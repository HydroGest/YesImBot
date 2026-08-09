import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  createEmptyGlobalRuleBank,
  createGlobalRuleStore,
  mergeLocalPatterns,
  selectGlobalChains,
  selectGlobalMemeTemplates,
  selectGlobalPatterns,
  selectRelevantGlobalChains,
} from "../src/global-store.js";
import type { InitiationPattern, ResponsePattern } from "../src/types.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("mergeLocalPatterns", () => {
  it("aggregates the same phrase across channels without double counting one channel", () => {
    const response: ResponsePattern = { intent: "agree", phrase: "确实", frequency: 2, sampleIds: ["a"] };
    const bank = mergeLocalPatterns(createEmptyGlobalRuleBank(), [response], [], [], "channel-a", 1000);
    const second = mergeLocalPatterns(bank, [response], [], [], "channel-b", 2000);
    const sameChannel = mergeLocalPatterns(second, [response], [], [], "channel-a", 3000);
    const pattern = sameChannel.patterns[0]!;

    expect(pattern.channels).toHaveLength(2);
    expect(pattern.channels[0]).toMatchObject({ key: expect.any(String), frequency: 2 });
    expect(pattern.channels[1]).toMatchObject({ key: expect.any(String), frequency: 2 });
  });

  it("selects only patterns seen in enough channels", () => {
    const response: ResponsePattern = { intent: "agree", phrase: "确实", frequency: 1, sampleIds: ["a"] };
    const bank = mergeLocalPatterns(createEmptyGlobalRuleBank(), [response], [], [], "channel-a", 1000);

    expect(selectGlobalPatterns(bank, "response", 2, 8)).toHaveLength(0);
    const crossed = mergeLocalPatterns(bank, [response], [], [], "channel-b", 2000);
    expect(selectGlobalPatterns(crossed, "response", 2, 8)).toHaveLength(1);
  });

  it("persists global rules across store instances", async () => {
    const root = await mkdtemp(join(tmpdir(), "chat-learning-global-"));
    roots.push(root);
    const path = join(root, "global.json");
    const response: ResponsePattern = { intent: "agree", phrase: "确实", frequency: 1, sampleIds: ["a"] };
    const first = createGlobalRuleStore(path);
    await first.init();
    const merged = mergeLocalPatterns(first.read(), [response], [], [], "channel-a", 1000);
    await first.update(merged);

    const second = createGlobalRuleStore(path);
    await second.init();

    expect(second.read().patterns).toHaveLength(1);
  });
});

describe("initiation patterns", () => {
  it("merges initiation patterns into the global bank", () => {
    const initiation: InitiationPattern = { intent: "question", phrase: "有人试过吗", frequency: 1, sampleIds: ["a"] };
    const bank = mergeLocalPatterns(createEmptyGlobalRuleBank(), [], [initiation], [], "channel-a", 1000);

    expect(selectGlobalPatterns(bank, "initiation", 1, 8)).toHaveLength(1);
  });
});

describe("global chains", () => {
  it("aggregates the same chain structure across channels", () => {
    const bank = mergeLocalPatterns(
      createEmptyGlobalRuleBank(),
      [],
      [],
      [
        {
          chain: ["question", "agree"],
          frequency: 2,
          sample: {
            turns: [
              { intent: "question", speaker: "A", text: "有人试过吗" },
              { intent: "agree", speaker: "B", text: "确实" },
            ],
          },
        },
      ],
      "channel-a",
      1000,
    );
    const crossed = mergeLocalPatterns(
      bank,
      [],
      [],
      [
        {
          chain: ["question", "agree"],
          frequency: 1,
          semantics: "有人在提问后，群友通常会短接一句认可。",
          style: "直接、短句，先提问再短接认可。",
          styleSampleId: "sample-b",
          sample: {
            turns: [
              { intent: "question", speaker: "C", text: "这个能用吗" },
              { intent: "agree", speaker: "D", text: "能用" },
            ],
          },
        },
      ],
      "channel-b",
      2000,
    );

    expect(selectGlobalChains(crossed, 2, 8)).toHaveLength(1);
    expect(crossed.chains[0]?.channels[0]).toMatchObject({ frequency: 2 });
    expect(crossed.chains[0]?.samples).toHaveLength(2);
    expect(crossed.chains[0]?.style).toBe("直接、短句，先提问再短接认可。");
    expect(crossed.chains[0]?.styleSampleId).toBe("sample-b");
    expect(crossed.chains[0]?.semantics).toBe("有人在提问后，群友通常会短接一句认可。");
  });
});

describe("selectRelevantGlobalChains", () => {
  it("selects chains whose samples match the current message", () => {
    const bank = {
      version: 1,
      updatedAt: 1,
      patterns: [],
      chains: [
        {
          chain: ["question", "agree"],
          samples: [
            {
              turns: [
                { intent: "question", speaker: "A", text: "话说真有必要去淘个这吗" },
                { intent: "agree", speaker: "B", text: "有必要" },
              ],
              channelKey: "a",
            },
          ],
          channels: [
            { key: "a", frequency: 2, lastSeenAt: 1 },
            { key: "b", frequency: 1, lastSeenAt: 1 },
          ],
          firstSeenAt: 1,
          lastSeenAt: 1,
        },
        {
          chain: ["react", "ack"],
          samples: [
            {
              turns: [
                { intent: "react", speaker: "A", text: "草" },
                { intent: "ack", speaker: "B", text: "笑死" },
              ],
              channelKey: "a",
            },
          ],
          channels: [
            { key: "a", frequency: 2, lastSeenAt: 1 },
            { key: "b", frequency: 1, lastSeenAt: 1 },
          ],
          firstSeenAt: 1,
          lastSeenAt: 1,
        },
      ],
      templates: [],
    };

    const selected = selectRelevantGlobalChains(bank, "草 @bot 笑点解析", 2, 3);

    expect(selected.map((chain) => chain.chain)).toEqual([["react", "ack"]]);
  });
});

describe("selectGlobalMemeTemplates", () => {
  it("returns the newest cross-group meme templates", () => {
    const bank = {
      version: 1,
      updatedAt: 1,
      patterns: [],
      chains: [],
      templates: [{ template: "？！{X}！？", examples: ["？！强强！？"], usage: "把状态词套进感叹模板。", frequency: 3, firstSeenAt: 1, lastSeenAt: 2 }],
    };

    expect(selectGlobalMemeTemplates(bank, 1)).toHaveLength(1);
  });
});

describe("embedding-based pattern merge", () => {
  it("merges a similar local phrase into the existing global pattern", () => {
    const bank = {
      version: 1,
      updatedAt: 1,
      patterns: [
        {
          kind: "response" as const,
          intent: "agree",
          phrase: "没错",
          channels: [{ key: "old", frequency: 1, lastSeenAt: 1 }],
          firstSeenAt: 1,
          lastSeenAt: 1,
          embedding: [1, 0],
        },
      ],
      chains: [],
      templates: [],
    };
    const response: ResponsePattern = { intent: "agree", phrase: "确实", frequency: 2, sampleIds: ["m2"] };
    const localEmbeddings = new Map([["response:agree:确实", [0.99, 0.01]]]);

    const merged = mergeLocalPatterns(bank, [response], [], [], "channel-new", 2, { localEmbeddings, embeddingSimilarity: 0.9 });

    expect(merged.patterns).toHaveLength(1);
    expect(merged.patterns[0]?.phrase).toBe("没错");
    expect(merged.patterns[0]?.channels).toHaveLength(2);
  });
});
