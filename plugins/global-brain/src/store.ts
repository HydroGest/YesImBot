import { createHash, randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { ChannelScope } from "koishi-plugin-yesimbot";

import {
  type BrainContent,
  type BrainDigest,
  type BrainReply,
  type BrainStatus,
  type BrainThread,
  type BrainThreadStatus,
  type BrainThreadView,
  scopeKey,
} from "./types.js";

type BrainRecord =
  | { readonly type: "thread"; readonly data: BrainThread }
  | { readonly type: "reply"; readonly data: BrainReply }
  | { readonly type: "seen"; readonly data: BrainSeenRecord };

interface BrainSeenRecord {
  readonly scopeKey: string;
  readonly threadId?: string;
  readonly replyId?: string;
  readonly seenAt: number;
}

export interface GlobalBrainStoreOptions {
  readonly filePath: string;
  readonly maxDigestThreads: number;
  readonly maxDigestReplies: number;
  readonly maxBlobBytes?: number;
  readonly now?: () => number;
  readonly createId?: () => string;
  readonly logger?: {
    warn(message: string, context?: Record<string, unknown>): void;
  };
}

export interface BrainDepositInput {
  readonly kind: BrainThread["kind"];
  readonly sourceScope: ChannelScope;
  readonly content: string;
  readonly payload?: BrainContent;
  readonly tags?: readonly string[];
}

export interface BrainReplyInput {
  readonly threadId: string;
  readonly sourceScope: ChannelScope;
  readonly content: string;
  readonly replySource?: BrainReply["replySource"];
  readonly author?: BrainReply["author"];
}

export interface GlobalBrainStore {
  init(): Promise<void>;
  putBlob(bytes: Uint8Array): Promise<string>;
  getBlob(id: string): Promise<Uint8Array>;
  deposit(input: BrainDepositInput): Promise<BrainThread>;
  reply(input: BrainReplyInput): Promise<BrainReply>;
  read(threadId: string, readerScope?: ChannelScope): Promise<BrainThreadView | undefined>;
  resolve(threadId: string, callerScope: ChannelScope): Promise<BrainThread>;
  status(sourceScope: ChannelScope): Promise<BrainThreadStatus[]>;
  participantScopes(): Promise<ChannelScope[]>;
  digest(scope: ChannelScope): Promise<BrainDigest>;
}

export function createGlobalBrainStore(options: GlobalBrainStoreOptions): GlobalBrainStore {
  const now = options.now ?? Date.now;
  const createId = options.createId ?? randomUUID;
  const maxBlobBytes = options.maxBlobBytes ?? 5 * 1024 * 1024;
  const blobDir = join(dirname(options.filePath), "blobs");
  const threads = new Map<string, BrainThread>();
  const replies = new Map<string, BrainReply[]>();
  const seenThreads = new Map<string, Set<string>>();
  const seenReplies = new Map<string, Set<string>>();
  let tail: Promise<void> = Promise.resolve();
  let initialized = false;

  const serialize = <T>(task: () => Promise<T>): Promise<T> => {
    const next = tail.then(task, task);
    tail = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  };

  const appendRecord = (record: BrainRecord): Promise<void> => {
    return appendFile(options.filePath, `${JSON.stringify(record)}\n`, "utf8");
  };

  const warn = (message: string, context?: Record<string, unknown>): void => {
    options.logger?.warn(message, context);
  };

  const rememberThreadSeen = (threadId: string, key: string): void => {
    const seen = seenThreads.get(threadId) ?? new Set<string>();
    seen.add(key);
    seenThreads.set(threadId, seen);
  };

  const rememberReplySeen = (replyId: string, key: string): void => {
    const seen = seenReplies.get(replyId) ?? new Set<string>();
    seen.add(key);
    seenReplies.set(replyId, seen);
  };

  const markThreadSeen = async (threadId: string, key: string): Promise<void> => {
    if (isThreadSeen(threadId, key)) return;
    rememberThreadSeen(threadId, key);
    await appendRecord({ type: "seen", data: { scopeKey: key, threadId, seenAt: now() } });
  };

  const markReplySeen = async (replyId: string, key: string): Promise<void> => {
    if (isReplySeen(replyId, key)) return;
    rememberReplySeen(replyId, key);
    await appendRecord({ type: "seen", data: { scopeKey: key, replyId, seenAt: now() } });
  };

  const isThreadSeen = (threadId: string, key: string): boolean => {
    return seenThreads.get(threadId)?.has(key) ?? false;
  };

  const isReplySeen = (replyId: string, key: string): boolean => {
    return seenReplies.get(replyId)?.has(key) ?? false;
  };

  const readThread = (threadId: string): BrainThread | undefined => {
    return threads.get(threadId);
  };

  const readReplies = (threadId: string): readonly BrainReply[] => {
    return [...(replies.get(threadId) ?? [])];
  };

  const applyRecord = (record: BrainRecord): void => {
    if (record.type === "thread") {
      threads.set(record.data.id, record.data);
      return;
    }
    if (record.type === "seen") {
      if (record.data.threadId) rememberThreadSeen(record.data.threadId, record.data.scopeKey);
      if (record.data.replyId) rememberReplySeen(record.data.replyId, record.data.scopeKey);
      return;
    }
    const list = replies.get(record.data.threadId) ?? [];
    list.push(record.data);
    replies.set(record.data.threadId, list);
  };

  const load = async (): Promise<void> => {
    try {
      const content = await readFile(options.filePath, "utf8");
      for (const [index, line] of content.split("\n").entries()) {
        if (!line.trim()) continue;
        try {
          const record = parseRecord(JSON.parse(line) as unknown);
          if (record) applyRecord(record);
        } catch (cause) {
          warn("global_brain.invalid_record", {
            line: index + 1,
            cause: cause instanceof Error ? cause.message : String(cause),
          });
        }
      }
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause;
    }
  };

  return {
    async init() {
      if (initialized) return;
      await serialize(async () => {
        await mkdir(dirname(options.filePath), { recursive: true });
        await load();
        initialized = true;
      });
    },

    async putBlob(bytes) {
      await this.init();
      return serialize(async () => {
        if (!(bytes instanceof Uint8Array)) {
          throw new BrainStoreError("invalid_blob", "Blob data must be bytes");
        }
        if (bytes.byteLength > maxBlobBytes) {
          throw new BrainStoreError("blob_too_large", `Blob exceeds ${maxBlobBytes} bytes`);
        }
        const copied = bytes.slice();
        const id = createHash("sha256").update(copied).digest("hex").slice(0, 32);
        const destination = join(blobDir, id);
        try {
          await readFile(destination);
          return id;
        } catch (cause) {
          if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause;
        }
        const temporary = join(blobDir, `.${id}.${randomUUID()}.tmp`);
        await mkdir(blobDir, { recursive: true });
        try {
          await writeFile(temporary, copied, { flag: "wx" });
          await rename(temporary, destination);
        } finally {
          await rm(temporary, { force: true });
        }
        return id;
      });
    },

    async getBlob(id) {
      await this.init();
      if (!/^[a-f0-9]{32}$/.test(id)) throw new BrainStoreError("invalid_blob_id", "Invalid blob id");
      return serialize(async () => {
        return new Uint8Array(await readFile(join(blobDir, id)));
      });
    },

    async deposit(input) {
      await this.init();
      return serialize(async () => {
        const content = requireContent(input.content);
        const payload = input.payload === undefined ? undefined : requirePayload(input.payload);
        const thread: BrainThread = {
          id: createId(),
          kind: input.kind,
          sourceScope: { ...input.sourceScope },
          content,
          ...(payload === undefined ? {} : { payload }),
          tags: normalizeTags(input.tags),
          status: "open",
          createdAt: now(),
        };
        threads.set(thread.id, thread);
        await appendRecord({ type: "thread", data: thread });
        return { ...thread, tags: [...thread.tags] };
      });
    },

    async reply(input) {
      await this.init();
      return serialize(async () => {
        const thread = readThread(input.threadId);
        if (!thread) throw new BrainStoreError("thread_not_found", "Thread does not exist");
        if (thread.status === "resolved") throw new BrainStoreError("thread_resolved", "Thread is already resolved");
        const reply: BrainReply = {
          id: createId(),
          threadId: input.threadId,
          sourceScope: { ...input.sourceScope },
          replySource: input.replySource ?? "agent",
          ...(input.author === undefined ? {} : { author: { ...input.author } }),
          content: requireContent(input.content),
          createdAt: now(),
        };
        const list = replies.get(reply.threadId) ?? [];
        list.push(reply);
        replies.set(reply.threadId, list);
        await appendRecord({ type: "reply", data: reply });
        return { ...reply, ...(reply.author === undefined ? {} : { author: { ...reply.author } }) };
      });
    },

    async read(threadId, readerScope) {
      await this.init();
      return serialize(async () => {
        const thread = readThread(threadId);
        if (!thread) return undefined;
        const threadReplies = readReplies(threadId);
        if (readerScope) {
          const key = scopeKey(readerScope);
          await markThreadSeen(threadId, key);
          for (const reply of threadReplies) await markReplySeen(reply.id, key);
        }
        return { thread: { ...thread, tags: [...thread.tags] }, replies: threadReplies };
      });
    },

    async resolve(threadId, callerScope) {
      await this.init();
      return serialize(async () => {
        const thread = readThread(threadId);
        if (!thread) throw new BrainStoreError("thread_not_found", "Thread does not exist");
        if (scopeKey(thread.sourceScope) !== scopeKey(callerScope)) {
          throw new BrainStoreError("resolve_forbidden", "Only the source session can resolve this thread");
        }
        if (thread.status === "resolved") return { ...thread, tags: [...thread.tags] };
        const updated: BrainThread = {
          ...thread,
          status: "resolved" satisfies BrainStatus,
          resolvedAt: now(),
        };
        threads.set(updated.id, updated);
        await appendRecord({ type: "thread", data: updated });
        return { ...updated, tags: [...updated.tags] };
      });
    },

    async status(sourceScope) {
      await this.init();
      return serialize(async () => {
        const key = scopeKey(sourceScope);
        return [...threads.values()]
          .filter((thread) => scopeKey(thread.sourceScope) === key)
          .sort((left, right) => right.createdAt - left.createdAt)
          .map((thread) => ({
            thread: { ...thread, tags: [...thread.tags] },
            replyCount: readReplies(thread.id).length,
          }));
      });
    },

    async participantScopes() {
      await this.init();
      return serialize(async () => {
        const scopes = new Map<string, ChannelScope>();
        for (const thread of threads.values()) {
          scopes.set(scopeKey(thread.sourceScope), { ...thread.sourceScope });
        }
        for (const list of replies.values()) {
          for (const reply of list) {
            scopes.set(scopeKey(reply.sourceScope), { ...reply.sourceScope });
          }
        }
        return [...scopes.values()];
      });
    },

    async digest(scope) {
      await this.init();
      return serialize(async () => {
        const key = scopeKey(scope);
        const threadItems = [...threads.values()]
          .filter((thread) => thread.status === "open" && scopeKey(thread.sourceScope) !== key && !isThreadSeen(thread.id, key))
          .sort((left, right) => right.createdAt - left.createdAt)
          .slice(0, options.maxDigestThreads);
        const replyItems = [...threads.values()]
          .filter((thread) => thread.status === "open" && scopeKey(thread.sourceScope) === key)
          .map((thread) => {
            const pending = readReplies(thread.id).filter((reply) => !isReplySeen(reply.id, key));
            return { thread, replies: pending };
          })
          .filter((item) => item.replies.length > 0)
          .sort((left, right) => right.thread.createdAt - left.thread.createdAt)
          .slice(0, options.maxDigestReplies);
        for (const thread of threadItems) await markThreadSeen(thread.id, key);
        for (const item of replyItems) {
          for (const reply of item.replies) await markReplySeen(reply.id, key);
        }
        return {
          threads: threadItems.map((thread) => ({ ...thread, tags: [...thread.tags] })),
          replies: replyItems.map((item) => ({
            thread: { ...item.thread, tags: [...item.thread.tags] },
            replies: item.replies,
          })),
        };
      });
    },
  };
}

export class BrainStoreError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "BrainStoreError";
  }
}

function parseRecord(value: unknown): BrainRecord | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const record = value as Partial<BrainRecord>;
  if (record.type === "thread" && isThread(record.data)) return { type: "thread", data: record.data };
  if (record.type === "reply" && isReply(record.data)) return { type: "reply", data: record.data };
  if (record.type === "seen" && isSeenRecord(record.data)) return { type: "seen", data: record.data };
  return undefined;
}

function isThread(value: unknown): value is BrainThread {
  if (typeof value !== "object" || value === null) return false;
  const thread = value as Partial<BrainThread>;
  return (
    typeof thread.id === "string" &&
    (thread.kind === "share" || thread.kind === "question" || thread.kind === "insight") &&
    isScope(thread.sourceScope) &&
    typeof thread.content === "string" &&
    (thread.payload === undefined || isBrainContent(thread.payload)) &&
    Array.isArray(thread.tags) &&
    (thread.status === "open" || thread.status === "resolved") &&
    typeof thread.createdAt === "number"
  );
}

function isBrainContent(value: unknown): value is BrainContent {
  if (typeof value !== "object" || value === null) return false;
  const content = value as Partial<BrainContent>;
  if (content.kind === "text") {
    return typeof content.text === "string";
  }
  if (content.kind === "asset" || content.kind === "artifact") {
    return (
      typeof content.blobId === "string" &&
      (content.mediaType === undefined || typeof content.mediaType === "string") &&
      (content.filename === undefined || typeof content.filename === "string")
    );
  }
  if (content.kind === "forward") {
    return (
      typeof content.platform === "string" && typeof content.forwardId === "string" && (content.summary === undefined || typeof content.summary === "string")
    );
  }
  return false;
}

function isSeenRecord(value: unknown): value is BrainSeenRecord {
  if (typeof value !== "object" || value === null) return false;
  const seen = value as Partial<BrainSeenRecord>;
  return typeof seen.scopeKey === "string" && typeof seen.seenAt === "number" && (typeof seen.threadId === "string" || typeof seen.replyId === "string");
}

function isReply(value: unknown): value is BrainReply {
  if (typeof value !== "object" || value === null) return false;
  const reply = value as Partial<BrainReply>;
  return (
    typeof reply.id === "string" &&
    typeof reply.threadId === "string" &&
    isScope(reply.sourceScope) &&
    (reply.replySource === "agent" || reply.replySource === "human") &&
    typeof reply.content === "string" &&
    typeof reply.createdAt === "number"
  );
}

function isScope(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const scope = value as Partial<ChannelScope>;
  return (
    (scope.type === "shared" || scope.type === "direct") &&
    typeof scope.platform === "string" &&
    typeof scope.selfId === "string" &&
    typeof scope.channelId === "string"
  );
}

function requireContent(content: string): string {
  if (typeof content !== "string" || content.trim().length === 0) {
    throw new BrainStoreError("invalid_content", "Content must be a non-empty string");
  }
  return content;
}

function requirePayload(payload: BrainContent): BrainContent {
  if (!isBrainContent(payload)) throw new BrainStoreError("invalid_payload", "Payload is not a supported brain content");
  return payload;
}

function normalizeTags(tags: readonly string[] | undefined): readonly string[] {
  return [...new Set((tags ?? []).map((tag) => tag.trim()).filter((tag) => tag.length > 0))];
}
