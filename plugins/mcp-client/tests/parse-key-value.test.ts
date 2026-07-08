import { describe, it, expect } from "vitest";

import { parseKeyValueString } from "../src/transports";

describe("parseKeyValueString", () => {
  it("parses key=value pairs", () => {
    const input = "KEY1=value1\nKEY2=value2";
    expect(parseKeyValueString(input)).toEqual({
      KEY1: "value1",
      KEY2: "value2",
    });
  });

  it("parses key:value pairs", () => {
    const input = "Key1: value1\nKey2: value2";
    expect(parseKeyValueString(input)).toEqual({
      Key1: "value1",
      Key2: "value2",
    });
  });

  it("handles mixed delimiters", () => {
    const input = "A=1\nB:2";
    expect(parseKeyValueString(input)).toEqual({ A: "1", B: "2" });
  });

  it("trims whitespace", () => {
    const input = "  KEY = value  ";
    expect(parseKeyValueString(input)).toEqual({ KEY: "value" });
  });

  it("handles empty string", () => {
    expect(parseKeyValueString("")).toEqual({});
  });

  it("handles values with colons", () => {
    const input = "URL=http://example.com:8080";
    expect(parseKeyValueString(input)).toEqual({
      URL: "http://example.com:8080",
    });
  });

  it("preserves equals signs inside values", () => {
    expect(parseKeyValueString("TOKEN=a=b")).toEqual({ TOKEN: "a=b" });
  });

  it("preserves authorization padding after colon delimiter", () => {
    expect(parseKeyValueString("Authorization: Bearer abc==")).toEqual({
      Authorization: "Bearer abc==",
    });
  });

  it("skips lines without delimiter", () => {
    const input = "KEY=value\nno delimiter line\nOTHER=val";
    expect(parseKeyValueString(input)).toEqual({ KEY: "value", OTHER: "val" });
  });
});
