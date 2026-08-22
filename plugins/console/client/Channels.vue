<template>
  <k-layout class="yib-channels" main="darker">
    <div class="yib-channels__body">
      <header class="yib-page-head">
        <div class="yib-page-head__title">
          <p class="yib-eyebrow">YesImBot</p>
          <h1>会话浏览</h1>
          <p>按频道查看 JSONL 历史，定位工具调用、内部思考与异常。</p>
        </div>
        <div class="yib-page-head__stats">
          <div class="yib-stat-chip">
            <strong>{{ panel.totalChannels }}</strong>
            <span>频道</span>
          </div>
          <div class="yib-stat-chip">
            <strong>{{ panel.totalSessions }}</strong>
            <span>会话</span>
          </div>
          <div class="yib-stat-chip">
            <strong>{{ formatSize(panel.totalSizeBytes) }}</strong>
            <span>存储</span>
          </div>
        </div>
      </header>

      <section class="yib-toolbar">
        <div class="yib-search-box">
          <k-icon name="search"></k-icon>
          <input v-model="query" placeholder="搜索平台、频道、会话 ID" />
        </div>
        <div class="yib-segmented">
          <button
            v-for="item in typeOptions"
            :key="item.value"
            class="yib-segmented__item"
            :class="{ 'is-active': typeFilter === item.value }"
            @click="typeFilter = item.value"
          >
            {{ item.label }}
          </button>
        </div>
      </section>

      <section class="yib-will-panel">
        <div class="yib-will-panel__head">
          <div class="yib-will-panel__title">
            <span class="yib-will-panel__icon">
              <k-icon name="filter"></k-icon>
            </span>
            <div>
              <h2>Will 策略</h2>
              <p>没安装 will-policy 时也会显示 Core 默认策略；启用插件后这里会展示实例参数。</p>
            </div>
          </div>
          <span class="yib-refresh-hint">每 10 秒刷新</span>
        </div>
        <div class="yib-will-grid">
          <article v-if="!panel.will.installed" class="yib-will-card">
            <span class="yib-will-card__engine">默认策略</span>
            <strong>{{ panel.will.defaultLabel }}</strong>
            <p>Core 默认 WillEngine：只对私聊和 @ 当前 Bot 的消息触发，其余群消息等待。</p>
          </article>
          <article v-for="policy in panel.will.policies" :key="policy.id" class="yib-will-card" :class="{ 'is-disabled': !policy.enabled }">
            <div class="yib-will-card__row">
              <span class="yib-will-card__engine">{{ policy.engine === "willingness" ? "意愿值" : "固定规则" }}</span>
              <span v-if="!policy.enabled" class="yib-tag yib-tag--disabled">未启用</span>
              <span v-if="policy.priority !== undefined" class="yib-mono">优先级 {{ policy.priority }}</span>
            </div>
            <strong>{{ willPolicyTitle(policy) }}</strong>
            <p>{{ willPolicyDetail(policy) }}</p>
          </article>
        </div>
      </section>

      <section v-if="filteredChannels.length" class="yib-channel-grid">
        <article v-for="channel in filteredChannels" :key="channel.key" class="yib-channel-card" :class="`is-${channel.type}`">
          <div class="yib-channel-card__head">
            <div class="yib-channel-card__identity">
              <span class="yib-channel-card__icon">
                <k-icon :name="channel.type === 'direct' ? 'user' : 'paper-plane'"></k-icon>
              </span>
              <div class="yib-channel-card__title">
                <div class="yib-channel-card__name">
                  <strong>{{ channelLabel(channel) }}</strong>
                  <span class="yib-tag" :class="`yib-tag--${channel.type}`">{{ typeLabel(channel.type) }}</span>
                </div>
                <p>{{ channel.platform }} · {{ channel.channelId }}</p>
              </div>
            </div>
            <time class="yib-channel-card__time">{{ formatDate(channel.lastActivityAt) }}</time>
          </div>

          <div class="yib-channel-card__meta">
            <span>{{ channel.sessions.length }} 个会话</span>
            <span>{{ formatSize(channel.totalSizeBytes) }}</span>
            <span>Will · {{ channelWillLabel(channel) }}</span>
            <span v-if="channel.activeSession" class="yib-text-success">活动会话存在</span>
            <span v-else class="yib-text-muted">无活动会话</span>
          </div>

          <div v-if="channel.sessions.length" class="yib-session-list">
            <router-link
              v-for="session in latestSessions(channel.sessions)"
              :key="session.filename"
              class="yib-session-item"
              :to="sessionPath(channel.key, session.filename)"
              :title="session.filename"
            >
              <span class="yib-session-item__dot" :class="{ 'is-active': session.isActive }"></span>
              <span class="yib-session-item__name">{{ formatSessionName(session.createdAt) }}</span>
              <span class="yib-session-item__size">{{ formatSize(session.size) }}</span>
              <k-icon name="chevron-right"></k-icon>
            </router-link>
          </div>
          <div v-else class="yib-empty-state">该频道还没有会话记录。</div>
        </article>
      </section>

      <section v-else-if="panel.generatedAt" class="yib-empty-state yib-empty-state--large">
        <k-icon name="file-archive"></k-icon>
        <strong>没有匹配的频道</strong>
        <p>可以检查 `basePath` 下是否已经产生会话数据。</p>
      </section>

      <section v-else class="yib-loading-state">
        <k-icon name="start"></k-icon>
        <span>正在读取会话索引…</span>
      </section>
    </div>
  </k-layout>
</template>

<script lang="ts" setup>
import { store } from "@koishijs/client";
import { computed, ref } from "vue";

import type { ConversationChannelSummary, ConversationIndex, ConversationWillPolicy } from "./types";

const panel = computed(() => (store as { yesimbotConversations?: ConversationIndex }).yesimbotConversations ?? emptyIndex());

const query = ref("");
const typeFilter = ref<"all" | "channel" | "guild" | "direct">("all");

const typeOptions = [
  { value: "all", label: "全部" },
  { value: "channel", label: "群聊" },
  { value: "guild", label: "频道" },
  { value: "direct", label: "私聊" },
] as const;

const filteredChannels = computed(() => {
  const keyword = query.value.trim().toLowerCase();
  return panel.value.channels.filter((channel) => {
    if (typeFilter.value !== "all" && channel.type !== typeFilter.value) return false;
    if (!keyword) return true;
    const haystack = [
      channel.platform,
      channel.channelId,
      channel.guildId,
      channel.userId,
      channel.selfId,
      ...channel.sessions.map((session) => session.filename),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return haystack.includes(keyword);
  });
});

function sessionPath(channel: string, session: string): string {
  return `/yesimbot/channels/${encodeURIComponent(channel)}/sessions/${encodeURIComponent(session)}`;
}

function channelLabel(channel: ConversationChannelSummary): string {
  if (channel.type === "direct") return channel.userId || channel.channelId;
  return channel.guildId || channel.channelId;
}

function channelWillLabel(channel: ConversationChannelSummary): string {
  if (!channel.will.matched) return "默认策略";
  return channel.will.matched.engine === "willingness" ? "意愿值" : "固定规则";
}

function typeLabel(type: ConversationChannelSummary["type"]): string {
  if (type === "direct") return "私聊";
  if (type === "guild") return "群聊";
  return "频道";
}

function formatDate(value: number | null): string {
  if (!value) return "从未活跃";
  const date = new Date(value);
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
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

function latestSessions(sessions: ConversationChannelSummary["sessions"]): ConversationChannelSummary["sessions"] {
  return [...sessions].reverse().slice(0, 4);
}

function emptyIndex(): ConversationIndex {
  return {
    generatedAt: "",
    channels: [],
    totalChannels: 0,
    totalSessions: 0,
    totalSizeBytes: 0,
    will: { installed: false, defaultLabel: "默认策略：私聊与 @ 触发，普通群聊等待", policies: [] },
  };
}

function willPolicyTitle(policy: ConversationWillPolicy): string {
  return policy.engine === "willingness" ? "意愿值引擎" : "固定规则引擎";
}

function willPolicyDetail(policy: ConversationWillPolicy): string {
  if (policy.engine === "routing") {
    const routing = policy.config?.routing as Record<string, unknown> | undefined;
    if (!routing) return "使用默认 routing 规则。";
    const direct = routing.direct === "trigger" ? "私聊触发" : "私聊等待";
    const mention = routing.mention === "trigger" ? " @ 触发" : " @ 等待";
    const group = routing.group === "trigger" ? "群聊触发" : "群聊等待";
    return `${direct} ·${mention} · ${group}`;
  }
  const willingness = policy.config?.willingness as Record<string, unknown> | undefined;
  if (!willingness) return "使用默认意愿值参数。";
  return `阈值 ${String(willingness.probabilityThreshold ?? 55)} · 上限 ${String(willingness.maxScore ?? 100)} · 回复成本 ${String(willingness.replyCost ?? 35)}`;
}
</script>

<style lang="scss" scoped>
.yib-channels__body {
  box-sizing: border-box;
  height: 100%;
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 18px;
  overflow: auto;
  color: var(--k-text-dark, #1c1f23);
}

.yib-page-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 20px;
  padding: 4px 2px;

  &__title {
    h1 {
      margin: 4px 0 6px;
      font-size: 24px;
      font-weight: 700;
      letter-spacing: 0;
    }

    p {
      margin: 0;
      color: var(--k-text-normal, #666);
      font-size: 13px;
    }
  }

  &__stats {
    display: flex;
    gap: 10px;
  }
}

.yib-eyebrow {
  margin: 0;
  color: var(--k-color-primary, #409eff);
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
}

.yib-stat-chip {
  min-width: 88px;
  padding: 12px 14px;
  border: 1px solid var(--k-color-divider);
  border-radius: 8px;
  background: transparent;
  display: flex;
  flex-direction: column;
  gap: 2px;

  strong {
    font-size: 18px;
    line-height: 1;
  }

  span {
    color: var(--k-text-normal, #666);
    font-size: 12px;
  }
}

.yib-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
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

.yib-segmented {
  display: inline-flex;
  padding: 3px;
  border: 1px solid var(--k-color-divider);
  border-radius: 8px;
  background: transparent;

  &__item {
    min-width: 58px;
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

.yib-channel-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
  gap: 14px;
}

.yib-channel-card {
  min-width: 0;
  padding: 16px;
  border: 1px solid var(--k-color-divider);
  border-radius: 8px;
  background: transparent;
  transition: border-color 0.2s ease;

  &:hover {
    border-color: var(--k-color-primary, #409eff);
  }

  &__head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
  }

  &__identity {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    min-width: 0;
  }

  &__icon {
    width: 36px;
    height: 36px;
    flex: 0 0 36px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 8px;
    border: 1px solid var(--k-color-divider);
    color: var(--k-color-primary, #409eff);
  }

  &__title {
    min-width: 0;
  }

  &__name {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;

    strong {
      display: block;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: 14px;
    }
  }

  p {
    margin: 3px 0 0;
    color: var(--k-text-normal, #666);
    font-size: 12px;
    font-family: monospace;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &__time {
    flex: 0 0 auto;
    color: var(--k-text-normal, #666);
    font-size: 11px;
    white-space: nowrap;
  }

  &__meta {
    margin: 14px 0 12px;
    padding: 10px 12px;
    display: flex;
    align-items: center;
    gap: 14px;
    border: 1px solid var(--k-color-divider);
    border-radius: 8px;
    font-size: 12px;
    color: var(--k-text-normal, #666);
  }
}

.yib-tag {
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;

  &--direct {
    color: var(--k-color-primary, #409eff);
  }

  &--channel {
    color: var(--k-color-success, #67c23a);
  }

  &--guild {
    color: var(--k-color-warning, #e6a23c);
  }
}

.yib-text-success {
  color: var(--k-color-success, #67c23a);
}

.yib-text-muted {
  color: var(--k-text-normal, #666);
}

.yib-session-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.yib-session-item {
  min-height: 34px;
  padding: 0 10px;
  display: flex;
  align-items: center;
  gap: 10px;
  border-radius: 6px;
  color: var(--k-text-dark, #1c1f23);
  text-decoration: none;
  font-size: 12px;

  &:hover {
    background: var(--k-hover-bg);
  }

  &__dot {
    width: 8px;
    height: 8px;
    flex: 0 0 8px;
    border-radius: 50%;
    background: var(--k-color-divider);

    &.is-active {
      background: var(--k-color-success, #67c23a);
    }
  }

  &__name {
    flex: 1 1 auto;
    min-width: 0;
    font-size: 13px;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &__size {
    color: var(--k-text-normal, #666);
  }
}

.yib-empty-state,
.yib-loading-state {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 24px;
  border: 1px dashed var(--k-color-divider);
  border-radius: 8px;
  color: var(--k-text-normal, #666);
  font-size: 13px;
}

.yib-empty-state--large {
  flex-direction: column;
  padding: 56px 24px;

  strong {
    color: var(--k-text-dark, #1c1f23);
  }

  p {
    margin: 0;
    font-family: monospace;
  }
}

.yib-loading-state {
  justify-content: flex-start;
}

.yib-will-panel {
  padding: 16px 18px;
  border: 1px solid var(--k-color-divider);
  border-radius: 8px;

  &__head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 12px;
  }

  &__title {
    display: flex;
    align-items: flex-start;
    gap: 10px;

    h2 {
      margin: 0;
      font-size: 15px;
      font-weight: 600;
    }

    p {
      margin: 3px 0 0;
      color: var(--k-text-normal, #666);
      font-size: 12px;
    }
  }

  &__icon {
    width: 34px;
    height: 34px;
    flex: 0 0 34px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 8px;
    border: 1px solid var(--k-color-divider);
    color: var(--k-color-primary, #409eff);
  }
}

.yib-refresh-hint {
  flex: 0 0 auto;
  color: var(--k-text-normal, #666);
  font-size: 11px;
}

.yib-will-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 10px;
}

.yib-will-card {
  min-width: 0;
  padding: 12px 14px;
  border: 1px solid var(--k-color-divider);
  border-radius: 8px;
  background: transparent;

  &.is-disabled {
    opacity: 0.55;
  }

  &__row {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
  }

  &__engine {
    display: inline-flex;
    padding: 2px 8px;
    border-radius: 4px;
    background: var(--k-color-primary, #409eff);
    color: #fff;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.04em;
  }

  strong {
    display: block;
    font-size: 13px;
  }

  p {
    margin: 5px 0 0;
    color: var(--k-text-normal, #666);
    font-size: 12px;
    line-height: 1.5;
  }
}

.yib-tag--disabled {
  color: var(--k-text-normal, #666);
}

@media screen and (max-width: 900px) {
  .yib-channels__body {
    padding: 16px;
  }

  .yib-page-head {
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
  .yib-channels__body {
    padding: 12px;
  }

  .yib-page-head__stats {
    width: 100%;
  }

  .yib-stat-chip {
    flex: 1 1 0;
    min-width: 0;
  }

  .yib-channel-grid {
    grid-template-columns: 1fr;
  }
}
</style>
