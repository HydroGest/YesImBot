import { describe, expect, it } from "vitest";

import { assertValidMountConfig, normalizeVirtualMountPath } from "../src/mounts";

describe("workspace mount validation", () => {
  it("normalizes simple absolute virtual paths", () => {
    expect(normalizeVirtualMountPath("/knowledge/")).toBe("/knowledge");
  });

  it("rejects relative virtual paths", () => {
    expect(() => normalizeVirtualMountPath("knowledge")).toThrow(/absolute virtual path/);
  });

  it("rejects dot and dot-dot segments", () => {
    expect(() => normalizeVirtualMountPath("/data/../secret")).toThrow(/must not contain/);
    expect(() => normalizeVirtualMountPath("/data/./files")).toThrow(/must not contain/);
  });

  it("rejects duplicate mount points across maps", () => {
    expect(() =>
      assertValidMountConfig({
        persistPaths: { "/data": "/host/a" },
        readOnlyPaths: { "/data": "/host/b" },
      }),
    ).toThrow(/Duplicate mount point/);
  });

  it("rejects nested mount points", () => {
    expect(() =>
      assertValidMountConfig({
        persistPaths: { "/data": "/host/a" },
        overlayPaths: { "/data/repo": "/host/b" },
      }),
    ).toThrow(/Nested mount point/);
  });

  it("rejects explicit mounts nested under the default workspace", () => {
    expect(() =>
      assertValidMountConfig({
        persistPaths: { "/home/workspace/repo": "/host/repo" },
      }),
    ).toThrow(/reserved mount point/);
  });

  it("rejects duplicate mount points created by normalization in the same map", () => {
    expect(() =>
      assertValidMountConfig({
        persistPaths: {
          "/data": "/host/a",
          "/data/": "/host/b",
        },
      }),
    ).toThrow(/Duplicate mount point/);
  });

  it("rejects explicit mounts over the default workspace", () => {
    expect(() =>
      assertValidMountConfig({
        persistPaths: { "/home/workspace": "/host/workspace" },
      }),
    ).toThrow(/reserved mount point/);
  });
});
