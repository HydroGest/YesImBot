import { describe, expect, expectTypeOf, it } from "vitest";

import type {
  AgentCustomChannelEvent,
  AgentCustomChannelEvents,
  AgentCustomEntries,
  AgentCustomEntryData,
  AgentCustomMessage,
  AgentCustomMessages,
  AgentCustomState,
  AgentEntry,
  AgentInternalEvent,
  AgentInternalEventInit,
  AgentMessage,
  AgentPlugin,
  AgentState,
  CustomMessageBase,
} from "../src/index.js";
import { createCustomMessage } from "../src/index.js";

declare module "../src/index.js" {
  interface AgentCustomMessages {
    "example.custom": CustomMessageBase<"example.custom", { text: string }>;
    "example.user": {
      id: string;
      timestamp: number;
      role: "user";
      content: string;
      source: "example";
    };
  }

  interface AgentCustomEntries {
    "example.entry": {
      count: number;
    };
  }

  interface AgentCustomState {
    exampleFlag?: boolean;
  }

  interface AgentCustomChannelEvents {
    example: {
      type: "example.updated";
      data: { ok: true };
    };
  }
}

describe("public types", () => {
  it("accepts declaration-merged custom surfaces", () => {
    const message: AgentCustomMessage<"example.custom"> = {
      id: "msg_custom",
      timestamp: 1,
      role: "custom",
      type: "example.custom",
      data: { text: "ok" },
    };
    const agentMessage: AgentMessage = message;
    const entry: AgentEntry<"example.entry"> = {
      id: "entry_custom",
      type: "example.entry",
      data: { count: 1 },
      timestamp: 1,
    };
    const internalEventInit: AgentInternalEventInit = {
      type: "agent.init",
    };
    const internalEvent: AgentInternalEvent = {
      id: "evt_init",
      type: "agent.init",
      timestamp: 1,
    };
    const internalChannelEvent: AgentCustomChannelEvent<"internal"> = {
      id: "evt_init",
      type: "agent.init",
      timestamp: 1,
    };
    const customEvent: AgentCustomChannelEvent<"example"> = {
      type: "example.updated",
      data: { ok: true },
    };
    const state: AgentState = {
      version: 1,
      exampleFlag: true,
    };
    const plugin: AgentPlugin = {
      name: "example",
    };

    expect(agentMessage.role).toBe("custom");
    expect(message.type).toBe("example.custom");
    expect(entry.type).toBe("example.entry");
    expect(internalEventInit.type).toBe("agent.init");
    expect(internalEvent.type).toBe("agent.init");
    expect(internalChannelEvent.type).toBe("agent.init");
    expect(customEvent.type).toBe("example.updated");
    expect(state.exampleFlag).toBe(true);
    expect(plugin.name).toBe("example");
  });

  it("keeps merge surfaces importable and typed", () => {
    expectTypeOf<Array<keyof AgentCustomMessages>>().toEqualTypeOf<
      Array<"example.custom" | "example.user" | "compact.summary" | "custom.note" | "custom.visible">
    >();
    expectTypeOf<Array<keyof AgentCustomEntries>>().toEqualTypeOf<
      Array<"event" | "example.entry" | "message" | "state">
    >();
    expectTypeOf<AgentCustomState>().toMatchTypeOf<{ exampleFlag?: boolean }>();
    expectTypeOf<Array<keyof AgentCustomChannelEvents>>().toEqualTypeOf<
      Array<"example" | "internal" | "stream">
    >();
    expectTypeOf<AgentInternalEventInit>().toMatchTypeOf<{
      type: string;
    }>();
    expectTypeOf<AgentInternalEvent>().toMatchTypeOf<{
      id: string;
      timestamp: number;
      type: string;
    }>();
    expectTypeOf<AgentCustomMessage<"example.custom">>().toMatchTypeOf<{
      id: string;
      timestamp: number;
      role: "custom";
      type: "example.custom";
      data: { text: string };
    }>();
    expectTypeOf<AgentCustomMessage<"example.user">>().toMatchTypeOf<{
      id: string;
      timestamp: number;
      role: "user";
      content: string;
      source: "example";
    }>();
    expectTypeOf<AgentCustomEntryData<"example.entry">>().toMatchTypeOf<{ count: number }>();
    expectTypeOf<AgentCustomChannelEvent<"example">>().toMatchTypeOf<{
      type: "example.updated";
      data: { ok: true };
    }>();
  });

  it("rejects legacy metadata and event names on merged surfaces", () => {
    const invalidMessage: AgentMessage = {
      id: "msg_custom",
      timestamp: 1,
      role: "custom",
      type: "example.custom",
      data: { text: "ok" },
      // @ts-expect-error custom messages no longer accept meta
      meta: { source: "legacy" },
    };
    const invalidEvent: AgentCustomChannelEvent<"example"> = {
      type: "example.updated",
      // @ts-expect-error custom channel events use type, not name
      name: "example.updated",
      data: { ok: true },
    };

    expect(invalidMessage).toBeDefined();
    expect(invalidEvent).toBeDefined();
  });

  it("infers and constrains registered custom message data", () => {
    const valid = createCustomMessage("example.custom", { text: "ok" });

    expectTypeOf(valid).toMatchTypeOf<{
      id: string;
      timestamp: number;
      role: "custom";
      type: "example.custom";
      data: { text: string };
    }>();

    // @ts-expect-error example.custom requires text data
    createCustomMessage("example.custom", { count: 1 });

    // @ts-expect-error example.user is a registered message, but not a custom message
    createCustomMessage("example.user", "hello");

    // @ts-expect-error undeclared custom message types are rejected
    createCustomMessage("missing.custom", { text: "nope" });
  });
});
