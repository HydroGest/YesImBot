import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ChannelScope } from "koishi-plugin-yesimbot";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  HOST_APPROVAL_TTL_MS,
  HOST_READ_LIMIT_BYTES,
  createHostApprovalBroker,
  createHostPolicy,
  type HostApprovalRequest,
  type HostPolicy,
} from "../src/host-policy";

const scopes = {
  shared: {
    type: "shared",
    platform: "onebot",
    selfId: "bot-1",
    channelId: "room-1",
  } satisfies ChannelScope,
  other: {
    type: "shared",
    platform: "onebot",
    selfId: "bot-1",
    channelId: "room-2",
  } satisfies ChannelScope,
  direct: {
    type: "direct",
    platform: "onebot",
    selfId: "bot-1",
    channelId: "room-1",
  } satisfies ChannelScope,
};

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })));
});

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "yesimbot-host-policy-"));
  directories.push(root);
  return root;
}

function hostPolicy(root: string, overrides: Record<string, unknown> = {}): HostPolicy {
  return createHostPolicy({
    allowedChannels: [{ platform: "onebot", channelId: "room-1" }],
    hostRoots: [],
    workspaceRoot: root,
    cwd: root,
    policyRevision: "test-policy-1",
    ...overrides,
  });
}

function approval(policy: HostPolicy, scope: ChannelScope, command: string) {
  return policy.classify(scope, "bash", { command });
}

describe("HostPolicy channel admission", () => {
  it("matches exact and wildcard platform/channel rules", async () => {
    const root = await temporaryRoot();
    const policy = createHostPolicy({
      allowedChannels: [
        { platform: "onebot", channelId: "room-1", type: "shared" },
        { platform: "telegram", channelId: "*", type: "direct", selfId: "bot-*" },
      ],
      hostRoots: [],
      workspaceRoot: root,
    });

    expect(policy.checkChannel(scopes.shared)).toBe(true);
    expect(policy.checkChannel(scopes.other)).toBe(false);
    expect(policy.checkChannel(scopes.direct)).toBe(false);
    expect(policy.checkChannel({ type: "direct", platform: "telegram", selfId: "bot-*", channelId: "room" })).toBe(true);
  });

  it("denies missing, empty, invalid, and incomplete allowlists", async () => {
    const root = await temporaryRoot();
    const matchingScope = scopes.shared;
    expect(createHostPolicy({ hostRoots: [], workspaceRoot: root }).checkChannel(matchingScope)).toBe(false);
    expect(createHostPolicy({ allowedChannels: [], hostRoots: [], workspaceRoot: root }).checkChannel(matchingScope)).toBe(false);
    expect(
      createHostPolicy({
        allowedChannels: [{ platform: "onebot", channelId: "room-1", type: "other" } as never],
        hostRoots: [],
        workspaceRoot: root,
      }).checkChannel(matchingScope),
    ).toBe(false);
    expect(
      createHostPolicy({
        allowedChannels: [{ platform: "onebot" } as never],
        hostRoots: [],
        workspaceRoot: root,
      }).checkChannel(matchingScope),
    ).toBe(false);
    expect(
      createHostPolicy({
        allowedChannels: [{ platform: "onebot", channelId: "room-1", selfId: "bot-1" }],
        hostRoots: [],
        workspaceRoot: root,
      }).checkChannel({ type: "shared", platform: "onebot", channelId: "room-1" } as never),
    ).toBe(false);
  });
});

describe("HostPolicy direct file roots", () => {
  it("allows workspace rw and declared ro/rw roots", async () => {
    const root = await temporaryRoot();
    const readOnly = join(root, "read-only");
    const readWrite = join(root, "read-write");
    await mkdir(readOnly);
    await mkdir(readWrite);
    await writeFile(join(root, "workspace.txt"), "workspace");
    await writeFile(join(readOnly, "guide.txt"), "guide");
    await writeFile(join(readWrite, "output.txt"), "output");
    const policy = hostPolicy(root, {
      hostRoots: [
        { path: readOnly, mode: "ro" },
        { path: readWrite, mode: "rw" },
      ],
    });

    expect(() => policy.checkFile("readFile", join(root, "workspace.txt"))).not.toThrow();
    expect(() => policy.checkFile("writeFile", join(root, "workspace.txt"))).not.toThrow();
    expect(() => policy.checkFile("readFile", join(readOnly, "guide.txt"))).not.toThrow();
    expect(() => policy.checkFile("writeFile", join(readOnly, "guide.txt"))).toThrow(/read-only|writable/i);
    expect(() => policy.checkFile("writeFile", join(readWrite, "output.txt"))).not.toThrow();
    expect(() => policy.checkFile("readFile", join(readWrite, "output.txt"))).not.toThrow();
  });

  it("rejects traversal, NUL, out-of-root, final symlinks, and non-regular files", async () => {
    const root = await temporaryRoot();
    const outside = await temporaryRoot();
    await writeFile(join(root, "inside.txt"), "inside");
    await writeFile(join(outside, "outside.txt"), "outside");
    await symlink(join(outside, "outside.txt"), join(root, "link.txt"));
    await mkdir(join(root, "directory"));
    const policy = hostPolicy(root);

    expect(() => policy.checkFile("readFile", `${root}/../${outside.split("/").at(-1)}/outside.txt`)).toThrow(/traversal/i);
    expect(() => policy.checkFile("readFile", `${join(root, "inside.txt")}\0secret`)).toThrow(/NUL/i);
    expect(() => policy.checkFile("readFile", join(outside, "outside.txt"))).toThrow(/outside|root/i);
    expect(() => policy.checkFile("readFile", join(root, "link.txt"))).toThrow(/symlink/i);
    expect(() => policy.checkFile("writeFile", join(root, "directory"))).toThrow(/regular|file/i);
  });

  it("rejects oversized reads while allowing a new writable target", async () => {
    const root = await temporaryRoot();
    const oversized = join(root, "large.bin");
    await writeFile(oversized, Buffer.alloc(HOST_READ_LIMIT_BYTES + 1, 0x61));
    const policy = hostPolicy(root);

    expect(() => policy.checkFile("readFile", oversized)).toThrow(/size|limit/i);
    expect(() => policy.checkFile("readFile", join(root, "missing.txt"))).toThrow(/exist/i);
    expect(() => policy.checkFile("writeFile", join(root, "new.txt"))).not.toThrow();
  });
});

describe("HostPolicy AST classification", () => {
  it("allows bounded literal read-only commands", async () => {
    const root = await temporaryRoot();
    const policy = hostPolicy(root);

    expect(approval(policy, scopes.shared, "cat README.md")).toEqual({ kind: "allow" });
    expect(approval(policy, scopes.shared, "printf '%s\\n' hello")).toEqual({ kind: "allow" });
    expect(approval(policy, scopes.shared, "cat README.md | grep hello")).toEqual({ kind: "allow" });
  });

  it.each([
    ["echo hello > output.txt", "write"],
    ["rm -f output.txt", "delete"],
    ["cat input.txt > output.txt", "overwrite"],
    ["curl https://example.com", "network"],
    ["python3 script.py", "interpreter"],
    ["./build.sh", "script"],
    ["echo hello &", "background"],
    ["cat $(printf secret)", "command-substitution"],
    ['cat "$TARGET"', "dynamic-expansion"],
  ])("requires approval for %s", async (command, riskTag) => {
    const root = await temporaryRoot();
    const policy = hostPolicy(root);
    const result = approval(policy, scopes.shared, command);

    expect(result.kind).toBe("approve");
    expect(result.kind === "approve" ? result.riskTags : []).toContain(riskTag);
  });

  it("walks nested command substitutions and retains all risk tags", async () => {
    const root = await temporaryRoot();
    const policy = hostPolicy(root);
    const command = "echo $(cat $(rm secret.txt))";
    const result = approval(policy, scopes.shared, command);

    expect(result.kind).toBe("approve");
    expect(result.kind === "approve" ? result.riskTags : []).toEqual(expect.arrayContaining(["command-substitution", "delete"]));
  });

  it("marks parser failures and unknown structures unsupported", async () => {
    const root = await temporaryRoot();
    const policy = hostPolicy(root);
    const result = approval(policy, scopes.shared, 'select item in a b; do echo "$item"; done');

    expect(result.kind).toBe("approve");
    expect(result.kind === "approve" ? result.riskTags : []).toContain("parser-unsupported");
  });

  it("fingerprints stable bindings without rewriting or exposing command bytes", async () => {
    const root = await temporaryRoot();
    const command = "echo super-secret > output.txt";
    const input = { command };
    const policy = hostPolicy(root);
    const same = approval(policy, scopes.shared, command);
    const changedCommand = approval(policy, scopes.shared, "echo different-secret > output.txt");
    const changedScope = hostPolicy(root, { allowedChannels: [{ platform: "onebot", channelId: "*" }] }).classify(scopes.other, "bash", { command });
    const changedTool = policy.classify(scopes.shared, "hostCommand", { command });
    const changedRevision = hostPolicy(root, { policyRevision: "test-policy-2" }).classify(scopes.shared, "bash", input);

    expect(input).toEqual({ command });
    expect(same.kind).toBe("approve");
    expect(changedCommand.kind).toBe("approve");
    expect(changedScope.kind).toBe("approve");
    expect(changedTool.kind).toBe("approve");
    expect(changedRevision.kind).toBe("approve");
    if (
      same.kind === "approve" &&
      changedCommand.kind === "approve" &&
      changedScope.kind === "approve" &&
      changedTool.kind === "approve" &&
      changedRevision.kind === "approve"
    ) {
      expect(same.fingerprint).toHaveLength(64);
      expect(new Set([same.fingerprint, changedCommand.fingerprint, changedScope.fingerprint, changedTool.fingerprint, changedRevision.fingerprint]).size).toBe(
        5,
      );
      expect(same.summary).not.toContain("super-secret");
      expect(same.summary).not.toContain(command);
      expect(same.riskTags).toEqual(["overwrite", "write", "redirection"]);
    }
  });

  it("blocks classification for an unlisted channel", async () => {
    const root = await temporaryRoot();
    const policy = hostPolicy(root);

    expect(() => approval(policy, scopes.other, "cat README.md")).toThrow(/channel|allow/i);
  });
});

function approvalRequest(overrides: Partial<HostApprovalRequest> = {}): HostApprovalRequest {
  return {
    scope: scopes.shared,
    toolName: "bash",
    cwd: "/tmp/workspace",
    policyRevision: "host-policy-v1",
    fingerprint: "f".repeat(64),
    riskTags: ["write"],
    summary: "Host bash command; arguments redacted",
    ...overrides,
  };
}

describe("HostApprovalBroker", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("notifies, binds approvals to the exact fingerprint, and reuses approval within the TTL", async () => {
    const notifications: unknown[] = [];
    const audit: string[] = [];
    const broker = createHostApprovalBroker({ audit: (event) => audit.push(event.event) });
    const request = approvalRequest({ notify: (record) => void notifications.push(record) });
    const pending = broker.request(request, new AbortController().signal);

    expect(broker.list()).toHaveLength(1);
    expect(notifications).toHaveLength(1);
    const record = broker.list()[0]!;
    expect(broker.approve(record.requestId, "wrong".padEnd(64, "0"))).toBe(false);
    expect(broker.list()).toHaveLength(1);
    expect(broker.approve(record.requestId, request.fingerprint, "admin")).toBe(true);
    await expect(pending).resolves.toBe("approved");
    await expect(broker.request(request, new AbortController().signal)).resolves.toBe("approved");
    expect(broker.list()).toHaveLength(0);
    expect(audit).toEqual(["pending", "approved"]);
  });

  it("rejects, expires, aborts, and stops pending requests without persistence", async () => {
    vi.useFakeTimers();
    const broker = createHostApprovalBroker();
    const rejected = broker.request(approvalRequest({ fingerprint: "a".repeat(64) }), new AbortController().signal);
    const rejectedRecord = broker.list()[0]!;
    expect(broker.reject(rejectedRecord.requestId, rejectedRecord.fingerprint, "admin")).toBe(true);
    await expect(rejected).resolves.toBe("rejected");

    const expired = broker.request(approvalRequest({ fingerprint: "b".repeat(64) }), new AbortController().signal);
    await vi.advanceTimersByTimeAsync(HOST_APPROVAL_TTL_MS);
    await expect(expired).resolves.toBe("expired");
    expect(broker.list()).toHaveLength(0);

    const controller = new AbortController();
    const aborted = broker.request(approvalRequest({ fingerprint: "c".repeat(64) }), controller.signal);
    controller.abort();
    await expect(aborted).resolves.toBe("rejected");

    const stopped = broker.request(approvalRequest({ fingerprint: "d".repeat(64) }), new AbortController().signal);
    broker.stop();
    await expect(stopped).resolves.toBe("rejected");
    expect(broker.list()).toEqual([]);
    await vi.advanceTimersByTimeAsync(HOST_APPROVAL_TTL_MS);
  });
});
