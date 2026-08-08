import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { loadCharacterCard } from "../src/card.js";

const roots: string[] = [];

function createPng(chunks: Array<{ key: string; value: unknown }>): Buffer {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([
    signature,
    ...chunks.map(({ key, value }) => {
      const data = Buffer.from(`${key}\0${Buffer.from(JSON.stringify(value)).toString("base64")}`);
      const length = Buffer.alloc(4);
      length.writeUInt32BE(data.length);
      return Buffer.concat([length, Buffer.from("tEXt"), data, Buffer.alloc(4)]);
    }),
  ]);
}

async function createCardFile(content: Buffer): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "yesimbot-roleplay-"));
  roots.push(root);
  const path = join(root, "card.png");
  await writeFile(path, content);
  return path;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

describe("character-card loader", () => {
  it("prefers a ccv3 chunk over a chara chunk", async () => {
    const path = await createCardFile(
      createPng([
        { key: "chara", value: { name: "V1", description: "old", personality: "old", scenario: "old", first_mes: "old", mes_example: "" } },
        {
          key: "ccv3",
          value: {
            spec: "chara_card_v3",
            spec_version: "3.0",
            data: {
              name: "V3",
              description: "new",
              personality: "new",
              scenario: "new",
              first_mes: "new",
              mes_example: "",
              alternate_greetings: [],
              group_only_greetings: [],
              character_version: "1",
              creator_notes: "",
              system_prompt: "",
              post_history_instructions: "",
              tags: [],
              creator: "",
              extensions: {},
            },
          },
        },
      ]),
    );

    const card = await loadCharacterCard(path);

    expect(card).toMatchObject({ spec: "chara_card_v3", data: { name: "V3" } });
  });
});
