import { describe, expect, it } from "vitest";

import { isPrivateHost } from "../src/git";

describe("network security", () => {
  it("blocks localhost", () => {
    expect(isPrivateHost("localhost")).toBe(true);
    expect(isPrivateHost("127.0.0.1")).toBe(true);
    expect(isPrivateHost("::1")).toBe(true);
  });

  it("blocks private IP ranges", () => {
    expect(isPrivateHost("10.0.0.1")).toBe(true);
    expect(isPrivateHost("192.168.1.1")).toBe(true);
    expect(isPrivateHost("172.16.0.1")).toBe(true);
    expect(isPrivateHost("172.31.255.255")).toBe(true);
  });

  it("blocks .local domains", () => {
    expect(isPrivateHost("myhost.local")).toBe(true);
  });

  it("allows public hosts", () => {
    expect(isPrivateHost("github.com")).toBe(false);
    expect(isPrivateHost("8.8.8.8")).toBe(false);
    expect(isPrivateHost("codeload.github.com")).toBe(false);
  });
});
