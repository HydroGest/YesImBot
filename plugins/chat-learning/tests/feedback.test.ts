import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createFeedbackStore } from "../src/feedback.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("createFeedbackStore", () => {
  it("persists link corrections across store instances", async () => {
    const root = await mkdtemp(join(tmpdir(), "chat-learning-feedback-"));
    roots.push(root);
    const path = join(root, "feedback.jsonl");
    const first = createFeedbackStore(path);
    await first.init();

    await first.append({ action: "add", from: "m1", to: "m2", kind: "reply" });

    const second = createFeedbackStore(path);
    await second.init();

    expect(second.read()).toHaveLength(1);
    expect(second.read()[0]).toMatchObject({ action: "add", from: "m1", to: "m2", kind: "reply" });
  });
});
