import { describe, it } from "@jest/globals";

import { Schema } from "koishi";

describe("schema", () => {
  it("schema", () => {
    const schema = Schema.object({
      status: Schema.union(["online", "offline"]).default("online").description("状态"),
    })

    console.log(JSON.stringify(schema, null, 2));
  });
});
