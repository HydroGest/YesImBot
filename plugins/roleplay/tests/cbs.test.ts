import { describe, expect, it, vi } from "vitest";

import { renderCBS } from "../src/cbs.js";

describe("renderCBS", () => {
  it("renders CCv3 substitutions case-insensitively", () => {
    const random = vi.fn().mockReturnValueOnce(0.8).mockReturnValueOnce(0.5);

    const result = renderCBS(["{{CHAR}}/{{user}}", "{{random:A,B\\,C}}", "{{roll:d6}}", "{{reverse:abc}}", "{{original}}"].join("|"), {
      charName: "Athena",
      random,
      userName: "Alice",
    });

    expect(result.text).toBe("Athena/Alice|B,C|4|cba|");
    expect(result.matchingText).toBe(result.text);
  });

  it("uses User as the default user name", () => {
    expect(renderCBS("{{user}}", { charName: "Athena" }).text).toBe("User");
  });

  it("keeps picks stable by normalized expression", () => {
    const cache = new Map<string, string>();
    const random = vi.fn().mockReturnValue(0.9);

    expect(
      renderCBS("{{pick: A, B }} {{PICK:A,B}}", {
        charName: "Athena",
        pickCache: cache,
        random,
      }).text,
    ).toBe(" B   B ");
    expect(random).toHaveBeenCalledOnce();
  });

  it("removes comments while exposing only hidden keys to matching", () => {
    const result = renderCBS("start{{hidden_key:secret}}{{// omitted}}{{comment:also omitted}}end", {
      charName: "Athena",
    });

    expect(result.text).toBe("startend");
    expect(result.matchingText).toBe("startsecretend");
  });

  it("leaves unknown and invalid expressions unchanged", () => {
    const input = "{{unknown:value}} {{roll:0}}";
    expect(renderCBS(input, { charName: "Athena" }).text).toBe(input);
  });
});
