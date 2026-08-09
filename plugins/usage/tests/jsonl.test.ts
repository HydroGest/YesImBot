import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { JsonlUsageHistory } from "../src/jsonl.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

describe("JsonlUsageHistory", () => {
  it("scans assistant usage and deduplicates entries across session files", async () => {
    const directory = await mkdtemp(join(tmpdir(), "yesimbot-usage-jsonl-"));
    temporaryDirectories.push(directory);
    const timestamp = Date.now();
    const message = (id: string) =>
      JSON.stringify({
        id: `entry-${id}`,
        type: "message",
        data: {
          id: `message-${id}`,
          timestamp,
          role: "assistant",
          usage: { inputTokens: 100, inputTokenDetails: { noCacheTokens: 40, cacheReadTokens: 60 }, outputTokens: 10, outputTokenDetails: {} },
        },
        timestamp,
      });

    await writeFile(join(directory, "a.jsonl"), `${message("a")}\n${message("b")}\n`);
    await writeFile(join(directory, "b.jsonl"), `${message("a")}\n`);

    const history = new JsonlUsageHistory(directory);
    const payload = await history.scan({ historySource: "jsonl", recentDayCount: 1, refreshInterval: 5000, rateWindowSeconds: 60 });

    expect(payload.recent[0].calls).toBe(2);
    expect(payload.recent[0].inputTokens).toBe(200);
    expect(payload.recent[0].outputTokens).toBe(20);
    expect(payload.byHour[new Date(timestamp).getHours()].calls).toBe(2);
  });
});
