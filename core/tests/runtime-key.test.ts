import { isAbsolute, join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { createChannelScopeId, type ChannelScope } from "../src/channel.js";
import {
  createChannelRuntimeKey,
  createChannelSessionPath,
  resolveBasePath,
} from "../src/runtime/key.js";

describe("runtime key helpers", () => {
  const scope: ChannelScope = {
    platform: "discord",
    selfId: "bot:1",
    channelId: "group/alpha",
  };

  it("resolves relative basePath against ctx.baseDir", () => {
    expect(resolveBasePath("data/yesimbot-core", "/tmp/athena")).toBe(
      resolve("/tmp/athena", "data/yesimbot-core"),
    );
  });

  it("keeps absolute basePath unchanged", () => {
    const basePath = isAbsolute("/var/lib/athena") ? "/var/lib/athena" : "C:\\athena\\data";
    expect(resolveBasePath(basePath, "/tmp/athena")).toBe(basePath);
  });

  it("builds runtime keys from canonical channel scope ids", () => {
    expect(createChannelRuntimeKey(scope)).toBe(createChannelScopeId(scope));
  });

  it("creates jsonl session paths under canonical channel directories", () => {
    const id = createChannelScopeId(scope);
    expect(createChannelSessionPath("/tmp/athena", scope)).toBe(
      join("/tmp/athena", "channels", id, "sessions", "messages.jsonl"),
    );
  });
});
