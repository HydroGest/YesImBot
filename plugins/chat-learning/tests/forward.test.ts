import { describe, expect, it, vi } from "vitest";

import { sendChatLearningForward } from "../src/forward.js";

describe("sendChatLearningForward", () => {
  it("sends group forward messages through OneBot internal", async () => {
    const sendGroupForwardMsg = vi.fn<() => Promise<unknown>>(async () => ({}));
    const session = {
      isDirect: false,
      selfId: "bot-1",
      channelId: "123456",
      bot: { internal: { sendGroupForwardMsg } },
    };

    const sent = await sendChatLearningForward(session as never, "line1\nline2");

    expect(sent).toBe(true);
    expect(sendGroupForwardMsg).toHaveBeenCalledOnce();
    const [channelId, nodes] = sendGroupForwardMsg.mock.calls[0]!;
    expect(channelId).toBe("123456");
    expect(JSON.stringify(nodes)).toContain("line1");
    expect(JSON.stringify(nodes)).toContain("line2");
  });

  it("uses private forward API for direct channels", async () => {
    const sendPrivateForwardMsg = vi.fn<() => Promise<unknown>>(async () => ({}));
    const session = {
      isDirect: true,
      selfId: "bot-1",
      channelId: "private:user-1",
      bot: { internal: { sendPrivateForwardMsg } },
    };

    const sent = await sendChatLearningForward(session as never, "private reply");

    expect(sent).toBe(true);
    expect(sendPrivateForwardMsg).toHaveBeenCalledWith(
      "user-1",
      expect.arrayContaining([
        expect.objectContaining({
          type: "node",
          data: expect.objectContaining({
            content: [{ type: "text", data: { text: "private reply" } }],
          }),
        }),
      ]),
    );
  });

  it("returns false when the adapter has no forward API", async () => {
    const session = {
      isDirect: false,
      selfId: "bot-1",
      channelId: "123456",
      bot: { internal: {} },
    };

    await expect(sendChatLearningForward(session as never, "long content")).resolves.toBe(false);
  });
});
