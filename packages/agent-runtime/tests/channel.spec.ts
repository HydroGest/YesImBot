import { describe, expect, it } from "vitest";

import { createAgentChannel } from "../src/channel.js";
import { createInternalEvent } from "../src/event.js";

describe("channel", () => {
  it("emits internal events to matching channel subscribers", async () => {
    const channel = createAgentChannel();
    const seen: string[] = [];
    const unsubscribe = channel.subscribe("internal", (event) => {
      if (event.type === "turn.start") seen.push(event.turnId);
    });

    await channel.emit("internal", createInternalEvent({ type: "turn.start", turnId: "turn_1" }));
    unsubscribe();
    await channel.emit("internal", createInternalEvent({ type: "turn.start", turnId: "turn_2" }));

    expect(seen).toEqual(["turn_1"]);
  });

  it("allows non-turn internal events without turnId", async () => {
    const channel = createAgentChannel();
    const seen: string[] = [];

    channel.subscribe("internal", (event) => {
      seen.push(event.type);
    });

    await channel.emit("internal", createInternalEvent({ type: "agent.init" }));

    expect(seen).toEqual(["agent.init"]);
  });

  it("isolates listener errors within the same channel", async () => {
    const channel = createAgentChannel();
    const seen: string[] = [];

    channel.subscribe("internal", () => {
      throw new Error("boom");
    });
    channel.subscribe("internal", (event) => {
      seen.push(event.type);
    });

    await expect(channel.emit("internal", createInternalEvent({ type: "agent.stop" }))).resolves.toBeUndefined();
    expect(seen).toEqual(["agent.stop"]);
  });
});
