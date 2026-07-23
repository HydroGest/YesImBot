import { describe, expect, it, vi } from "vitest";

import { assertAssignee, AssigneeAdmissionError } from "../src/shared/assignee.js";

const shared = { platform: "onebot", selfId: "10000", channelId: "123", isDirect: false };
const direct = { ...shared, isDirect: true };

describe("assertAssignee", () => {
  it("accepts the database assignee", async () => {
    const ctx = { database: { get: vi.fn().mockResolvedValue([{ assignee: "10000" }]) } };

    await expect(assertAssignee(ctx as never, shared)).resolves.toBeUndefined();

    expect(ctx.database.get).toHaveBeenCalledWith("channel", { platform: "onebot", id: "123" }, [
      "assignee",
    ]);
  });

  it.each([
    [[], "missing"],
    [[{ assignee: "" }], "empty"],
    [[{ assignee: "20000" }], "mismatch"],
  ] as const)("rejects invalid assignment %#", async (rows, reason) => {
    const ctx = { database: { get: vi.fn().mockResolvedValue(rows) } };

    await expect(assertAssignee(ctx as never, shared)).rejects.toMatchObject({
      reason,
      scope: shared,
    } satisfies Partial<AssigneeAdmissionError>);
  });

  it("does not query Database for direct scopes", async () => {
    const ctx = { database: { get: vi.fn() } };

    await assertAssignee(ctx as never, direct);

    expect(ctx.database.get).not.toHaveBeenCalled();
  });
});
