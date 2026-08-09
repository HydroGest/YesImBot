import { describe, expect, it } from "vitest";

import { commandMatches, normalizeCommand, validateCommandCall } from "../src/policy.js";

describe("command bridge policy", () => {
  it("normalizes leading slashes and case", () => {
    expect(normalizeCommand("/Weather 北京")).toBe("weather 北京");
  });

  it("matches parent and subcommand patterns", () => {
    expect(commandMatches("game", "game start")).toBe(true);
    expect(commandMatches("game", "game.roll")).toBe(true);
    expect(commandMatches("game", "weather")).toBe(false);
  });

  it("enforces hard deny before allowlist", () => {
    const config = {
      trustMode: "full" as const,
      allowCommands: ["weather"],
      hardDeny: ["yesimbot"],
    };

    expect(validateCommandCall("yesimbot.session.status", config)).toContain("hard-denied");
  });

  it("rejects commands outside locked allowlist", () => {
    const config = {
      trustMode: "locked" as const,
      allowCommands: ["weather"],
      hardDeny: [],
    };

    expect(validateCommandCall("lottery", config)).toContain("not allowed");
    expect(validateCommandCall("weather 上海", config)).toBeNull();
  });
});
