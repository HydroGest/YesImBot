<template>
  <k-layout class="yib-detail" main="darker">
    <template #header>
      <div class="yib-top-nav">
        <button class="yib-top-nav__back" title="返回" @click="goBack">
          <svg class="yib-svg-icon" viewBox="0 0 24 24"><path fill="currentColor" d="M20 11H7.83l5.59-5.59L12 4l-8 8l8 8l1.41-1.41L7.83 13H20z" /></svg>
        </button>
        <router-link class="yib-top-nav__link" to="/yesimbot/channels">会话浏览</router-link>
        <span class="yib-top-nav__divider">/</span>
        <span class="yib-top-nav__current">会话详情</span>
      </div>
    </template>

    <div class="yib-detail__body">
      <header class="yib-detail__head">
        <div class="yib-detail__title">
          <p class="yib-eyebrow">Session · {{ sessionLabel }}</p>
          <h1>会话详情</h1>
          <p v-if="detail" class="yib-detail__subtitle">
            {{ detail.summary.messageCount }} 条消息 · {{ detail.summary.thoughtCount }} 次思考 · {{ detail.summary.toolCallCount }} 次工具调用 ·
            {{ detail.summary.errorCount }} 个错误
          </p>
        </div>
        <span v-if="detail?.truncated" class="yib-truncated-badge">只显示最近 {{ detail.entries.length }} 条</span>
      </header>

      <section class="yib-toolbar">
        <div class="yib-segmented">
          <button
            v-for="item in filters"
            :key="item.value"
            class="yib-segmented__item"
            :class="{ 'is-active': filter === item.value }"
            @click="filter = item.value"
          >
            {{ item.label }}
          </button>
        </div>
        <div class="yib-search-box">
          <svg class="yib-svg-icon" viewBox="0 0 24 24">
            <path
              fill="currentColor"
              d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 A6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"
            />
          </svg>
          <input v-model="query" placeholder="搜索消息、思考、工具参数或结果" />
        </div>
      </section>

      <section v-if="error" class="yib-alert">
        <svg class="yib-svg-icon" viewBox="0 0 24 24">
          <path fill="currentColor" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z" />
        </svg>
        <span>{{ error }}</span>
      </section>

      <section v-if="loading && !detail" class="yib-loading-state">
        <svg class="yib-svg-icon spin" viewBox="0 0 24 24">
          <path
            fill="currentColor"
            d="M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6c0 1.01-.25 1.97-.7 2.8l1.46 1.46A7.93 7.93 0 0 0 20 12c0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6c0-1.01.25-1.97.7-2.8L5.24 7.74A7.93 7.93 0 0 0 4 12c0 4.42 3.58 8 8 8v3l4-4l-4-4v3z"
          />
        </svg>
        <span>正在读取会话…</span>
      </section>

      <section v-else-if="turnGroups.length" class="yib-graph-list">
        <article v-for="group in turnGroups" :key="group.id" class="yib-turn-graph">
          <div class="yib-turn-graph__body">
            <ol class="yib-main-thread">
              <li v-for="node in visibleMainNodes(group)" :key="node.id" class="yib-main-node" :class="[`is-${node.kind}`, { 'is-error': node.error }]">
                <div class="yib-main-node__marker">
                  <svg v-if="node.kind === 'user'" class="yib-svg-icon" viewBox="0 0 24 24">
                    <path
                      fill="currentColor"
                      d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4s-4 1.79-4 4s1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"
                    />
                  </svg>
                  <svg v-else-if="node.kind === 'assistant'" class="yib-svg-icon" viewBox="0 0 24 24">
                    <path
                      fill="currentColor"
                      d="M20 2H4c-1.1 0-1.99.9-1.99 2L2 22l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM6 9h12v2H6V9zm8 5H6v-2h8v2zm4-6H6V6h12v2z"
                    />
                  </svg>
                  <svg v-else-if="node.kind === 'thought'" class="yib-svg-icon" viewBox="0 0 24 24">
                    <path
                      fill="currentColor"
                      d="M12 3c-4.97 0-9 4.03-9 9c0 2.12.74 4.07 1.97 5.61L4.35 21l3.68-.61C9.41 20.76 10.67 21 12 21c4.97 0 9-4.03 9-9s-4.03-9-9-9zm0 16c-1.18 0-2.31-.25-3.34-.73l-.24-.11l-2.47.41l.41-2.47l-.11-.24A6.98 6.98 0 0 1 5 12c0-3.86 3.14-7 7-7s7 3.14 7 7s-3.14 7-7 7z"
                    />
                  </svg>
                  <svg v-else-if="node.kind === 'tool-call'" class="yib-svg-icon" viewBox="0 0 24 24">
                    <path fill="currentColor" d="M9.4 16.6L4.8 12l4.6-4.6L8 6l-6 6l6 6l1.4-1.4zm5.2 0l4.6-4.6l-4.6-4.6L16 6l6 6l-6 6l-1.4-1.4z" />
                  </svg>
                  <svg v-else-if="node.kind === 'tool-result'" class="yib-svg-icon" viewBox="0 0 24 24">
                    <path
                      v-if="node.error"
                      fill="currentColor"
                      d="M19 6.41L17.59 5L12 10.59L6.41 5L5 6.41L10.59 12L5 17.59L6.41 19L12 13.41L17.59 19L19 17.59L13.41 12z"
                    />
                    <path v-else fill="currentColor" d="M9 16.17L4.83 12l-1.42 1.41L9 19L21 7l-1.41-1.41z" />
                  </svg>
                  <svg v-else class="yib-svg-icon" viewBox="0 0 24 24">
                    <path
                      fill="currentColor"
                      d="M11 7h2v2h-2zm0 4h2v6h-2zm1-9C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8s8 3.59 8 8s-3.59 8-8 8z"
                    />
                  </svg>
                </div>

                <div class="yib-main-node__content">
                  <div class="yib-main-node__label">
                    <strong>{{ mainNodeTitle(node) }}</strong>
                    <time>{{ formatTime(node.timestamp) }}</time>
                  </div>

                  <details v-if="node.thought" class="yib-thought-card" open>
                    <summary class="yib-thought-card__head">
                      <svg class="yib-svg-icon" viewBox="0 0 24 24">
                        <path
                          fill="currentColor"
                          d="M9 21c0 .55.45 1 1 1h4c.55 0 1-.45 1-1v-1H9v1zm3-19C8.14 2 5 5.14 5 9c0 2.38 1.19 4.47 3 5.74V17c0 .55.45 1 1 1h6c.55 0 1-.45 1-1v-2.26c1.81-1.27 3-3.36 3-5.74c0-3.86-3.14-7-7-7z"
                        />
                      </svg>
                      <span>思考过程</span>
                    </summary>
                    <div class="yib-thought-card__body">
                      {{ node.thought }}
                    </div>
                  </details>

                  <div v-if="node.reply" class="yib-reply-card">
                    <div class="yib-reply-card__body">
                      {{ node.reply }}
                    </div>
                  </div>

                  <p v-if="node.kind === 'user' && node.text" class="yib-user-text">{{ node.text }}</p>
                  <p v-if="node.kind === 'compact' && node.text" class="yib-compact-text">{{ node.text }}</p>

                  <div v-if="node.assets?.length" class="yib-asset-grid">
                    <a
                      v-for="asset in node.assets"
                      :key="asset.id"
                      class="yib-asset"
                      :href="asset.dataUrl"
                      :download="asset.kind === 'file' ? asset.title || asset.id : undefined"
                      target="_blank"
                      :title="asset.id"
                    >
                      <img v-if="asset.kind === 'image' && asset.dataUrl" :src="asset.dataUrl" :alt="asset.id" />
                      <span v-else-if="asset.kind === 'image'" class="yib-asset__placeholder">图片</span>
                      <span v-else class="yib-asset__placeholder">{{ asset.title || "文件" }}</span>
                      <small>{{ formatSize(asset.size) }}</small>
                    </a>
                  </div>

                  <div v-if="node.kind === 'will'" class="yib-will-box">
                    <span class="yib-decision-badge" :class="node.decision === 'trigger' ? 'is-trigger' : 'is-wait'">
                      {{ node.decision === "trigger" ? "触发" : "等待" }}
                    </span>
                    <details v-if="node.willDebug !== undefined">
                      <summary>策略参数</summary>
                      <pre>{{ prettyJson(node.willDebug) }}</pre>
                    </details>
                  </div>

                  <div v-if="node.kind === 'event'" class="yib-event-box">
                    <span class="yib-mono">{{ node.eventType }}</span>
                    <span v-if="node.error?.message" class="yib-error-text">{{ node.error.message }}</span>
                  </div>

                  <div v-if="node.kind === 'tool-call'" class="yib-tool-box">
                    <div class="yib-tool-box__head">
                      <span class="yib-tool-badge is-call">工具调用</span>
                      <span class="yib-mono">{{ node.toolName || "Tool" }}</span>
                    </div>
                    <details class="yib-code-box" open>
                      <summary>参数</summary>
                      <pre>{{ prettyJson(node.args) }}</pre>
                    </details>
                  </div>

                  <div v-else-if="node.kind === 'tool-result'" class="yib-tool-box" :class="{ 'is-error': node.error }">
                    <div class="yib-tool-box__head">
                      <span class="yib-tool-badge" :class="node.error ? 'is-error' : 'is-success'">
                        {{ node.error ? "工具异常" : "工具结果" }}
                      </span>
                      <span class="yib-mono">{{ node.toolName || "Tool" }}</span>
                    </div>
                    <div v-if="node.error?.message" class="yib-error-text">{{ node.error.message }}</div>
                    <details v-else-if="node.result !== undefined" class="yib-code-box" open>
                      <summary>返回结果</summary>
                      <pre>{{ prettyJson(node.result) }}</pre>
                    </details>
                    <div v-else class="yib-tool-box__pending">等待工具返回...</div>
                  </div>
                </div>
              </li>
            </ol>
          </div>
        </article>
      </section>

      <section v-else-if="detail" class="yib-empty-state">当前过滤条件下没有记录。</section>
    </div>
  </k-layout>
</template>

<script lang="ts" setup>
import { send } from "@koishijs/client";
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";

import type { ConversationAssetView, ConversationDetail as DetailPayload, ConversationEntryView, ConversationRequest } from "./types";

const route = useRoute();
const router = useRouter();
const detail = ref<DetailPayload>();
const loading = ref(false);
const error = ref("");
const query = ref("");
const filter = ref<"all" | "chat" | "thought" | "tool" | "event">("all");
let timer: number | undefined;

const filters = [
  { value: "all", label: "全部" },
  { value: "chat", label: "对话" },
  { value: "thought", label: "思考" },
  { value: "tool", label: "工具" },
  { value: "event", label: "事件" },
] as const;

const channel = computed(() => String(route.params.channel ?? ""));
const sessionName = computed(() => String(route.params.session ?? ""));
const sessionLabel = computed(() => formatSessionName(sessionName.value));
const turnGroups = computed(() => (detail.value ? buildTurnGroups(detail.value.entries) : []));

interface TurnGroup {
  id: string;
  start: number;
  mainNodes: MainNode[];
}

interface MainNode {
  id: string;
  groupKey?: string;
  kind: ConversationEntryView["kind"];
  timestamp: number;
  text?: string;
  thought?: string;
  reply?: string;
  sender?: string;
  assets?: ConversationAssetView[];
  eventType?: string;
  decision?: string;
  willDebug?: unknown;
  error?: { name?: string; message?: string };
  toolName?: string;
  toolCallId?: string;
  args?: unknown;
  result?: unknown;
}

async function load(): Promise<void> {
  if (!channel.value || !sessionName.value) return;
  loading.value = true;
  error.value = "";
  try {
    const request: ConversationRequest = { channel: channel.value, session: sessionName.value };
    const requestDetail = send as unknown as (type: "yesimbot/conversation", input: ConversationRequest) => Promise<DetailPayload>;
    detail.value = await requestDetail("yesimbot/conversation", request);
  } catch (error) {
    error.value = error instanceof Error ? error.message : String(error);
  } finally {
    loading.value = false;
  }
}

function visibleMainNodes(group: TurnGroup): MainNode[] {
  const keyword = query.value.trim().toLowerCase();
  return group.mainNodes.filter((node) => {
    if (filter.value === "chat") {
      if (node.kind !== "user" && node.kind !== "assistant") return false;
    } else if (filter.value === "thought") {
      if (!node.thought && node.kind !== "thought") return false;
    } else if (filter.value === "tool") {
      if (node.kind !== "tool-call" && node.kind !== "tool-result") return false;
    } else if (filter.value === "event") {
      if (node.kind !== "event" && node.kind !== "compact" && node.kind !== "will") return false;
    }
    if (!keyword) return true;
    return mainSearchable(node).toLowerCase().includes(keyword);
  });
}

function mainSearchable(node: MainNode): string {
  return [
    node.text,
    node.thought,
    node.reply,
    node.sender,
    node.eventType,
    node.decision,
    prettyJson(node.willDebug),
    node.toolName,
    node.toolCallId,
    prettyJson(node.args),
    prettyJson(node.result),
    node.assets?.map((asset) => asset.title || asset.id).join(" "),
  ]
    .filter(Boolean)
    .join(" ");
}

function mainNodeTitle(node: MainNode): string {
  if (node.kind === "user") return node.sender || "用户消息";
  if (node.kind === "assistant") return "模型响应";
  if (node.kind === "thought") return "思考推演";
  if (node.kind === "tool-call") return `工具调用 · ${node.toolName || "Tool"}`;
  if (node.kind === "tool-result") return node.error ? `工具异常 · ${node.toolName || "Tool"}` : `工具结果 · ${node.toolName || "Tool"}`;
  if (node.kind === "will") return `Will 决策 · ${node.decision === "trigger" ? "触发" : "等待"}`;
  if (node.kind === "compact") return "会话压缩摘要";
  return node.eventType ?? "运行事件";
}

function buildTurnGroups(entries: ConversationEntryView[]): TurnGroup[] {
  const groups: TurnGroup[] = [];
  let group: TurnGroup | undefined;
  let main: MainNode | undefined;

  // oxlint-disable-next-line unicorn/consistent-function-scoping
  const createGroup = (entry: ConversationEntryView): TurnGroup => ({ id: entry.id, start: entry.timestamp, mainNodes: [] });
  // oxlint-disable-next-line unicorn/consistent-function-scoping
  const createMain = (entry: ConversationEntryView): MainNode => {
    return {
      id: entry.id,
      groupKey: entry.groupKey,
      kind: entry.kind,
      timestamp: entry.timestamp,
      text: entry.text,
      thought: entry.kind === "thought" ? entry.text : undefined,
      reply: entry.kind === "assistant" ? entry.text : undefined,
      sender: entry.sender,
      assets: entry.assets,
      eventType: entry.eventType,
      decision: entry.decision,
      willDebug: entry.willDebug,
      error: entry.error,
      toolName: entry.toolName,
      toolCallId: entry.toolCallId,
      args: entry.args,
      result: entry.result,
    };
  };
  // oxlint-disable-next-line unicorn/consistent-function-scoping
  const mergeEntry = (target: MainNode, entry: ConversationEntryView): void => {
    if (entry.kind === "thought" && entry.text && !target.thought) target.thought = entry.text;
    if (entry.kind === "assistant" && entry.text && !target.reply) target.reply = entry.text;
    if (target.reply) target.kind = "assistant";
  };

  for (const entry of entries) {
    if (entry.kind === "user" || entry.kind === "event") {
      group = createGroup(entry);
      groups.push(group);
      main = createMain(entry);
      group.mainNodes.push(main);
      continue;
    }
    group ??= createGroup(entry);
    if (entry.kind === "thought" || entry.kind === "assistant") {
      if (main && (main.kind === "thought" || main.kind === "assistant") && main.groupKey && entry.groupKey && main.groupKey === entry.groupKey) {
        mergeEntry(main, entry);
      } else {
        main = createMain(entry);
        group.mainNodes.push(main);
      }
      continue;
    }
    main = createMain(entry);
    group.mainNodes.push(main);
    main = undefined;
  }
  return groups;
}

function formatTime(value: number): string {
  const date = new Date(value);
  // oxlint-disable-next-line unicorn/consistent-function-scoping
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function formatSessionName(value: string): string {
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})$/.exec(value);
  if (match) return `${match[2]}-${match[3]} ${match[4]}:${match[5]}`;
  return value.replace(/\.jsonl$/, "").slice(0, 20) || value;
}

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${bytes} B`;
}

function prettyJson(value: unknown): string {
  if (value === undefined || value === null) return "无";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function goBack(): void {
  if (window.history.length > 1) {
    router.back();
  } else {
    void router.push("/yesimbot/channels");
  }
}

watch([channel, sessionName], load);

onMounted(() => {
  void load();
  timer = window.setInterval(() => {
    if (document.visibilityState === "visible") void load();
  }, 3_000);
});

onBeforeUnmount(() => {
  if (timer !== undefined) window.clearInterval(timer);
});
</script>

<style lang="scss" scoped>
.yib-svg-icon {
  width: 14px;
  height: 14px;
  display: inline-block;
  flex-shrink: 0;

  &.spin {
    animation: yib-spin 1s linear infinite;
  }
}

@keyframes yib-spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

.yib-detail__body {
  box-sizing: border-box;
  height: 100%;
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 18px;
  overflow: auto;
  color: var(--k-text-dark, #1c1f23);
}

.yib-top-nav {
  display: flex;
  align-items: center;
  gap: 10px;

  &__back {
    width: 30px;
    height: 30px;
    padding: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 1px solid var(--k-color-divider);
    border-radius: 6px;
    background: transparent;
    color: var(--k-text-normal, #666);
    cursor: pointer;

    &:hover {
      color: var(--k-color-primary, #409eff);
      border-color: var(--k-color-primary, #409eff);
    }
  }

  &__link {
    color: var(--k-text-normal, #666);
    font-size: 13px;
    font-weight: 600;
    text-decoration: none;

    &:hover {
      color: var(--k-color-primary, #409eff);
    }
  }

  &__divider {
    color: var(--k-text-normal, #666);
  }

  &__current {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 13px;
    font-weight: 600;
  }
}

.yib-detail__head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
  padding: 4px 2px;
}

.yib-detail__title {
  flex: 1 1 auto;
  min-width: 0;

  h1 {
    margin: 4px 0 6px;
    font-size: 24px;
    font-weight: 700;
    letter-spacing: 0;
  }

  p {
    margin: 0;
  }

  .yib-detail__subtitle {
    color: var(--k-text-normal, #666);
    font-size: 13px;
  }
}

.yib-eyebrow {
  margin: 0;
  color: var(--k-color-primary, #409eff);
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
}

.yib-truncated-badge {
  flex: 0 0 auto;
  padding: 4px 10px;
  border: 1px solid var(--k-color-warning, #e6a23c);
  border-radius: 4px;
  color: var(--k-color-warning, #e6a23c);
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
}

.yib-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.yib-segmented {
  display: inline-flex;
  padding: 3px;
  border: 1px solid var(--k-color-divider);
  border-radius: 8px;

  &__item {
    min-width: 56px;
    height: 30px;
    border: 0;
    border-radius: 6px;
    background: transparent;
    color: var(--k-text-normal, #666);
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;

    &.is-active {
      background: var(--k-color-primary, #409eff);
      color: #fff;
    }
  }
}

.yib-search-box {
  flex: 1 1 auto;
  max-width: 420px;
  min-height: 38px;
  padding: 0 12px;
  display: flex;
  align-items: center;
  gap: 8px;
  border: 1px solid var(--k-color-divider);
  border-radius: 8px;
  color: var(--k-text-normal, #666);

  input {
    flex: 1 1 auto;
    min-width: 0;
    border: 0;
    outline: none;
    background: transparent;
    color: var(--k-text-dark, #1c1f23);
    font-size: 13px;
  }
}

/* 一条贯穿整个会话的主线程，节点只覆盖在线上的 Marker */
.yib-graph-list {
  position: relative;

  &::before {
    content: "";
    position: absolute;
    left: 15px;
    top: 16px;
    bottom: 16px;
    width: 2px;
    background: var(--k-color-divider);
    z-index: 1;
  }
}

.yib-main-thread {
  list-style: none;
  margin: 0;
  padding: 0;
  position: relative;
  z-index: 2;
}

.yib-main-node {
  position: relative;
  display: flex;
  align-items: flex-start;
  gap: 16px;
  padding-bottom: 24px;

  &:last-child {
    padding-bottom: 0;
  }

  &__marker {
    position: relative;
    z-index: 2;
    width: 32px;
    height: 32px;
    flex: 0 0 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    border: 2px solid var(--k-color-divider);
    background: var(--k-side-bg, #f7f7f9);
    color: var(--k-text-normal, #888);
    box-shadow: 0 0 0 4px var(--k-side-bg, #f7f7f9);
  }

  &.is-user &__marker {
    border-color: var(--k-color-primary, #409eff);
    color: var(--k-color-primary, #409eff);
  }

  &.is-assistant &__marker {
    border-color: var(--k-color-success, #67c23a);
    color: var(--k-color-success, #67c23a);
  }

  &.is-thought &__marker {
    border-style: dashed;
    border-color: var(--k-color-warning, #e6a23c);
    color: var(--k-color-warning, #e6a23c);
  }

  &.is-tool-call &__marker {
    border-color: var(--k-color-primary, #409eff);
    color: var(--k-color-primary, #409eff);
  }

  &.is-tool-result &__marker {
    border-color: var(--k-color-success, #67c23a);
    color: var(--k-color-success, #67c23a);
  }

  &.is-tool-result.is-error &__marker {
    border-color: var(--k-color-danger, #f56c6c);
    color: var(--k-color-danger, #f56c6c);
  }

  &__content {
    flex: 1 1 auto;
    min-width: 0;
    padding-top: 2px;
  }

  &__label {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 8px;

    strong {
      min-width: 0;
      font-size: 13px;
      font-weight: 600;
    }

    time {
      flex: 0 0 auto;
      color: var(--k-text-normal, #666);
      font-size: 11px;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }
  }
}

.yib-thought-card,
.yib-reply-card,
.yib-user-text,
.yib-compact-text {
  margin-bottom: 10px;
  padding: 12px 14px;
  border: 1px solid var(--k-color-divider);
  border-radius: 8px;
  background: transparent;
  font-size: 13px;
  line-height: 1.7;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.yib-user-text,
.yib-compact-text {
  margin: 0 0 10px;
}

.yib-thought-card {
  border-color: var(--k-color-warning, #e6a23c);

  &__head {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 0 8px;
    font-size: 12px;
    font-weight: 600;
    color: var(--k-color-warning, #e6a23c);
    cursor: pointer;
    user-select: none;
  }

  &__body {
    padding: 8px 0 0;
    border-top: 1px solid var(--k-color-divider);
    font-size: 12px;
    line-height: 1.6;
    color: var(--k-text-normal, #aaa);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
}

.yib-reply-card {
  border-color: var(--k-color-success, #67c23a);
}

.yib-user-text {
  border-color: var(--k-color-primary, #409eff);
}

.yib-compact-text {
  color: var(--k-text-normal, #888);
}

.yib-tool-box {
  margin-top: 10px;
  border: 1px solid var(--k-color-primary, #409eff);
  border-radius: 8px;
  background: transparent;
  overflow: hidden;

  &.is-error {
    border-color: var(--k-color-danger, #f56c6c);
  }

  &__head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 10px 12px;
    border-bottom: 1px solid var(--k-color-divider);
  }

  &__pending {
    padding: 10px 12px;
    color: var(--k-color-warning, #e6a23c);
    font-size: 12px;
    font-style: italic;
  }
}

.yib-tool-badge {
  display: inline-flex;
  padding: 2px 10px;
  border: 1px solid var(--k-color-primary, #409eff);
  border-radius: 4px;
  color: var(--k-color-primary, #409eff);
  font-size: 12px;
  font-weight: 600;

  &.is-success {
    border-color: var(--k-color-success, #67c23a);
    color: var(--k-color-success, #67c23a);
  }

  &.is-error {
    border-color: var(--k-color-danger, #f56c6c);
    color: var(--k-color-danger, #f56c6c);
  }
}

.yib-code-box {
  border: 0;
  border-top: 1px solid var(--k-color-divider);
  background: transparent;

  summary {
    padding: 10px 12px;
    color: var(--k-color-primary, #409eff);
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    user-select: none;
  }

  pre {
    max-height: 260px;
    margin: 0;
    padding: 10px 12px;
    overflow: auto;
    border-top: 1px solid var(--k-color-divider);
    background: transparent;
    font-family: var(--font-family-code);
    font-size: 12px;
    line-height: 1.5;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
}

.yib-asset-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 10px;
}

.yib-asset {
  min-width: 0;
  max-width: 180px;
  display: inline-flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px;
  border: 1px solid var(--k-color-divider);
  border-radius: 8px;
  background: transparent;
  color: inherit;
  text-decoration: none;

  &:hover {
    border-color: var(--k-color-primary, #409eff);
  }

  img {
    width: 100%;
    max-height: 160px;
    object-fit: cover;
    border-radius: 6px;
  }

  &__placeholder {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 12px;
    font-weight: 600;
  }

  small {
    color: var(--k-text-normal, #666);
    font-size: 11px;
  }
}

.yib-will-box,
.yib-event-box {
  margin-top: 10px;
  padding: 12px 14px;
  border: 1px solid var(--k-color-primary, #409eff);
  border-radius: 8px;
  background: transparent;

  summary {
    margin-top: 10px;
    cursor: pointer;
    color: var(--k-color-primary, #409eff);
    font-size: 12px;
  }

  pre {
    max-height: 320px;
    margin: 10px 0 0;
    padding: 12px;
    overflow: auto;
    border-top: 1px solid var(--k-color-divider);
    border-radius: 0 0 6px 6px;
    background: transparent;
    font-family: var(--font-family-code);
    font-size: 12px;
    line-height: 1.5;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
}

.yib-event-box {
  display: flex;
  flex-direction: column;
  gap: 6px;
  border-color: var(--k-color-warning, #e6a23c);
  font-size: 12px;
}

.yib-decision-badge {
  display: inline-flex;
  padding: 2px 10px;
  border: 1px solid var(--k-color-success, #67c23a);
  border-radius: 4px;
  background: transparent;
  color: var(--k-color-success, #67c23a);
  font-size: 12px;
  font-weight: 600;

  &.is-wait {
    border-color: var(--k-color-warning, #e6a23c);
    color: var(--k-color-warning, #e6a23c);
  }
}

.yib-mono {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  font-weight: 600;
  color: var(--k-text-normal, #666);
}

.yib-error-text {
  margin-top: 4px;
  font-size: 11px;
  color: var(--k-color-error, #f56c6c);
}

.yib-alert,
.yib-loading-state,
.yib-empty-state {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 16px 18px;
  border: 1px dashed var(--k-color-divider);
  border-radius: 8px;
  background: transparent;
  color: var(--k-text-normal, #888);
  font-size: 13px;
}

.yib-alert {
  border-color: var(--k-color-error, #f56c6c);
  color: var(--k-color-error, #f56c6c);
}

@media screen and (max-width: 900px) {
  .yib-detail__body {
    padding: 16px;
  }
  .yib-detail__head {
    flex-direction: column;
    align-items: flex-start;
  }
  .yib-toolbar {
    flex-direction: column;
    align-items: stretch;
  }
  .yib-search-box {
    max-width: none;
  }
}

@media screen and (max-width: 640px) {
  .yib-detail__body {
    padding: 12px;
  }

  .yib-graph-list::before {
    left: 13px;
  }

  .yib-main-node {
    gap: 12px;

    &__marker {
      width: 28px;
      height: 28px;
      flex: 0 0 28px;
    }

    &__label {
      flex-direction: column;
      gap: 4px;
    }
  }

  .yib-segmented {
    width: 100%;
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    &__item {
      min-width: 0;
    }
  }
}
</style>
