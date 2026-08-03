import { readFile } from "node:fs/promises";

import { CCardLib, type CharacterCardV1, type CharacterCardV2, type CharacterCardV3 } from "@risuai/ccardlib";

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

type CharacterCard = CharacterCardV1 | CharacterCardV2 | CharacterCardV3;

export async function loadCharacterCard(path: string): Promise<CharacterCardV3> {
  const payload = extractCharacterCardPayload(await readFile(path));
  if (!BASE64.test(payload)) throw new TypeError("Character card payload must be base64 encoded");

  let card: unknown;
  try {
    card = JSON.parse(Buffer.from(payload, "base64").toString("utf8"));
  } catch {
    throw new TypeError("Character card payload must contain JSON");
  }

  const version = CCardLib.character.check(card);
  if (version === "unknown") throw new TypeError("Unsupported character card");

  return version === "v3"
    ? (card as CharacterCardV3)
    : CCardLib.character.convert(card as CharacterCard, {
        from: version,
        to: "v3",
        options: { convertRisuFields: false },
      });
}

function extractCharacterCardPayload(source: Buffer): string {
  if (source.length < PNG_SIGNATURE.length || !source.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    throw new TypeError("Character card must be a PNG file");
  }

  let offset = PNG_SIGNATURE.length;
  let chara: string | undefined;
  let ccv3: string | undefined;
  while (offset < source.length) {
    if (source.length - offset < 12) throw new TypeError("Character card PNG is malformed");

    const length = source.readUInt32BE(offset);
    const dataStart = offset + 8;
    const chunkEnd = dataStart + length;
    if (chunkEnd + 4 > source.length) throw new TypeError("Character card PNG is malformed");

    if (source.toString("ascii", offset + 4, dataStart) === "tEXt") {
      const chunk = source.subarray(dataStart, chunkEnd);
      const separator = chunk.indexOf(0);
      if (separator > 0) {
        const key = chunk.toString("latin1", 0, separator);
        const value = chunk.toString("latin1", separator + 1);
        if (key === "ccv3") ccv3 = value;
        if (key === "chara") chara = value;
      }
    }

    offset = chunkEnd + 4;
  }

  if (ccv3) return ccv3;
  if (chara) return chara;
  throw new TypeError("Character card PNG does not contain a ccv3 or chara chunk");
}
