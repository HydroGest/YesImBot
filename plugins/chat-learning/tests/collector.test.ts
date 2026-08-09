import { describe, expect, it, vi } from "vitest";

vi.mock("koishi", async () => import("@koishijs/core"));

import { collectTurns, segmentTurns } from "../src/collector.js";
import { assistantMessage, atElement, humanMessage, quoteElement } from "./helpers.js";

describe("collectTurns", () => {
  it("keeps human messages and skips assistant output", () => {
    const entries = [
      humanMessage("e1", "m1", "u1", "Alice", 1000, "今天天气不错"),
      assistantMessage("e2", 2000, "确实不错"),
      humanMessage("e3", "m3", "u2", "Bob", 3000, "我也觉得"),
    ];

    const turns = collectTurns(entries, { now: 4000 });

    expect(turns.map((turn) => turn.text)).toEqual(["今天天气不错", "我也觉得"]);
  });

  it("extracts quote and mention metadata", () => {
    const entries = [
      humanMessage("e1", "m1", "u1", "Alice", 1000, "原始消息"),
      humanMessage("e2", "m2", "u2", "Bob", 2000, "回应你", [quoteElement("m1"), atElement("bot-1")]),
    ];

    const turns = collectTurns(entries, { now: 3000 });
    const reply = turns[1]!;

    expect(reply.quoteId).toBe("m1");
    expect(reply.quoteType).toBe("reply");
    expect(reply.mentionIds).toContain("bot-1");
  });

  it("filters blocked user ids and bot name patterns", () => {
    const entries = [
      humanMessage("e1", "m1", "u1", "Alice", 1000, "正常发言"),
      humanMessage("e2", "m2", "bot-id", "SomeBot", 2000, "机器人公告"),
      humanMessage("e3", "m3", "u2", "小助手", 3000, "自动回复"),
    ];

    const turns = collectTurns(entries, { now: 4000, blockedUserIds: ["bot-id"], blockedUserPatterns: ["小助手"] });

    expect(turns.map((turn) => turn.userId)).toEqual(["u1"]);
  });

  it("optionally auto-filters common bot names", () => {
    const entries = [humanMessage("e1", "m1", "u1", "Alice", 1000, "正常发言"), humanMessage("e2", "m2", "u2", "Official Bot", 2000, "公告")];

    const turns = collectTurns(entries, { now: 3000, autoBlockBotNames: true });

    expect(turns.map((turn) => turn.userId)).toEqual(["u1"]);
  });
});

describe("segmentTurns", () => {
  it("splits segments on a long silence", () => {
    const turns = [
      humanMessage("e1", "m1", "u1", "Alice", 0, "第一段"),
      humanMessage("e2", "m2", "u2", "Bob", 60_000, "还在第一段"),
      humanMessage("e3", "m3", "u1", "Alice", 700_000, "第二段"),
    ];

    const segments = segmentTurns(turns);

    expect(segments).toHaveLength(2);
    expect(segments[0]!.turns.map((turn) => turn.id)).toEqual(["e1", "e2"]);
    expect(segments[1]!.turns.map((turn) => turn.id)).toEqual(["e3"]);
  });
});
