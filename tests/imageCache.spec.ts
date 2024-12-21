import path from "path";
import assert from "assert";
import { beforeAll, afterAll, jest, it, describe } from "@jest/globals";

import { convertUrltoBase64 } from "../src/utils/imageUtils";


describe("imageCache", () => {
  it("convertUrltoBase64", async () => {
    let cacheKey = "test";
    const image = await convertUrltoBase64("https://i1.hdslb.com/bfs/face/f8d99297dd73a68548547d7b2eb0d32614baef36.jpg");
    assert(image.startsWith("data:image"));
  });
});
