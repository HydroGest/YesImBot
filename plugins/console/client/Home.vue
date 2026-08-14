<template>
  <k-layout class="yib-home" main="darker">
    <div class="yib-home__body">
      <!-- 顶部 Hero 区域 -->
      <section class="yib-hero">
        <YesImBotIcon class="yib-hero__bg" />
        <div class="yib-hero__content">
          <div class="yib-hero__title-row">
            <h1>YesImBot</h1>
            <span class="yib-badge yib-badge--brand">v4</span>
          </div>
          <p>机械壳，人类心。</p>
        </div>
        <div class="yib-hero__state">
          <span class="yib-status-pill" :class="{ 'is-online': connected }">
            <span class="yib-dot"></span>
            <span>{{ connected ? "服务在线" : "连接中..." }}</span>
          </span>
          <span class="yib-hero__instances">
            <k-icon name="start" class="yib-icon-inline"></k-icon>
            {{ panel.health.botCount }} 个实例
          </span>
        </div>
      </section>

      <!-- 重点优化：开始使用引导 (Onboarding) -->
      <section v-if="!panel.onboarding.complete" class="yib-panel yib-onboarding">
        <header class="yib-onboarding__header">
          <div class="yib-onboarding__title-wrap">
            <div class="yib-section-icon">
              <k-icon name="search"></k-icon>
            </div>
            <div>
              <h2>新手接入向导</h2>
              <p class="yib-section-desc">完成以下配置，快速激活 YesImBot 应用</p>
            </div>
          </div>
          <div class="yib-progress-wrap">
            <div class="yib-progress-text">
              <span>完成度</span>
              <strong>{{ onboardingProgress }}%</strong>
            </div>
            <div class="yib-progress-bar">
              <div class="yib-progress-bar__inner" :style="{ width: `${onboardingProgress}%` }"></div>
            </div>
          </div>
        </header>

        <ol class="yib-stepper">
          <li
            v-for="(step, index) in panel.onboarding.steps"
            :key="step.id"
            class="yib-step-item"
            :class="{
              'is-done': step.done,
              'is-active': !step.done && isCurrentStep(index),
              'is-pending': !step.done && !isCurrentStep(index),
            }"
          >
            <!-- 步骤序号/状态图标 -->
            <div class="yib-step-item__node">
              <div class="yib-step-item__circle">
                <k-icon v-if="step.done" name="check-full"></k-icon>
                <span v-else>{{ index + 1 }}</span>
              </div>
              <div v-if="index < panel.onboarding.steps.length - 1" class="yib-step-item__line"></div>
            </div>

            <!-- 步骤内容区 -->
            <div class="yib-step-item__body">
              <div class="yib-step-item__header">
                <div class="yib-step-item__info">
                  <div class="yib-step-item__title">
                    <strong>{{ step.title }}</strong>
                    <span v-if="step.done" class="yib-tag yib-tag--success">已就绪</span>
                    <span v-else-if="isCurrentStep(index)" class="yib-tag yib-tag--primary">进行中</span>
                  </div>
                  <p class="yib-step-item__desc">{{ step.description }}</p>
                </div>

                <!-- 步骤主操作 -->
                <div class="yib-step-item__actions">
                  <router-link v-if="!step.done && step.id !== 'adapter'" class="yib-btn yib-btn--primary" :to="step.target">
                    去配置
                    <k-icon name="chevron-right"></k-icon>
                  </router-link>
                </div>
              </div>

              <!-- 适配器子面板展开项 -->
              <div v-if="step.id === 'adapter' && !step.done" class="yib-adapter-section">
                <div class="yib-adapter-grid">
                  <article v-for="adapter in panel.adapters" :key="adapter.key" class="yib-adapter-card" :class="adapter.state">
                    <div class="yib-adapter-card__left">
                      <div class="yib-adapter-card__icon">
                        <k-icon :name="adapterIcon(adapter.platform)"></k-icon>
                      </div>
                      <div class="yib-adapter-card__detail">
                        <div class="yib-adapter-card__name">
                          {{ adapter.name }}
                          <span v-if="adapter.platform === 'qq'" class="yib-badge yib-badge--cyan">QQ官方机器人</span>
                          <span v-else-if="adapter.platform === 'onebot' || adapter.platform === 'napcat'" class="yib-badge yib-badge--brand">ONEBOT</span>
                        </div>
                        <div class="yib-adapter-card__status" :class="adapter.state">
                          <span class="yib-dot-mini"></span>
                          {{ adapterStateText(adapter) }}
                        </div>
                      </div>
                    </div>

                    <div class="yib-adapter-card__action">
                      <router-link v-if="!adapter.enabled" class="yib-btn yib-btn--sm yib-btn--secondary" :to="`/plugins/${adapter.configPath}`">
                        启用
                      </router-link>
                      <router-link v-else-if="adapter.state !== 'online'" class="yib-btn yib-btn--sm yib-btn--primary" :to="`/plugins/${adapter.configPath}`">
                        配置
                      </router-link>
                      <span v-else class="yib-text-success yib-text-sm"> <k-icon name="check-full"></k-icon> 正常 </span>
                    </div>
                  </article>
                </div>

                <div class="yib-adapter-footer">
                  <router-link class="yib-link-hint" to="/market">
                    <k-icon name="box-open"></k-icon>
                    探索更多通讯适配器插件
                    <k-icon name="chevron-right"></k-icon>
                  </router-link>
                </div>
              </div>
            </div>
          </li>
        </ol>
      </section>

      <!-- 告警与异常提示 -->
      <section v-if="panel.attention.length" class="yib-alerts">
        <article v-for="issue in panel.attention" :key="issue.message" :class="['yib-alert-card', `yib-alert-card--${issue.level}`]">
          <k-icon :name="issue.level === 'error' ? 'times-full' : 'info-full'" class="yib-alert-icon" />
          <div class="yib-alert-message">{{ issue.message }}</div>
        </article>
      </section>

      <!-- 概览指标卡片 -->
      <section class="yib-metrics-grid">
        <article class="yib-metric-card">
          <span class="yib-metric-card__label">接入实例</span>
          <div class="yib-metric-card__value-wrap">
            <span class="yib-metric-card__value">{{ panel.health.botCount }}</span>
            <span class="yib-metric-card__unit">个</span>
          </div>
          <p class="yib-metric-card__sub" :class="{ 'is-error': panel.health.botErrorCount > 0 }">
            {{ panel.health.botErrorCount ? `${panel.health.botErrorCount} 个报错` : "运行状态正常" }}
          </p>
        </article>

        <article class="yib-metric-card">
          <span class="yib-metric-card__label">默认聊天模型</span>
          <div class="yib-metric-card__value-wrap">
            <span class="yib-metric-card__value yib-metric-card__value--truncate">
              {{ panel.model.chatModel || panel.model.defaultChat || "未配置" }}
            </span>
          </div>
          <p class="yib-metric-card__sub">Vision：{{ panel.model.visionModel || "未配置" }}</p>
        </article>

        <article class="yib-metric-card">
          <span class="yib-metric-card__label">可用模型池</span>
          <div class="yib-metric-card__value-wrap">
            <span class="yib-metric-card__value">{{ panel.model.providers.length }}</span>
            <span class="yib-metric-card__unit">Providers</span>
          </div>
          <p class="yib-metric-card__sub">{{ panel.model.chatModels }} Chat · {{ panel.model.embeddingModels }} Embedding</p>
        </article>

        <article class="yib-metric-card">
          <span class="yib-metric-card__label">能力插件</span>
          <div class="yib-metric-card__value-wrap">
            <span class="yib-metric-card__value">{{ enabledPluginCount }}</span>
            <span class="yib-metric-card__unit">/ {{ panel.plugins.length }}</span>
          </div>
          <p class="yib-metric-card__sub">已加载运行</p>
        </article>
      </section>

      <!-- 最近异常/日志 -->
      <section v-if="panel.recent.length" class="yib-panel">
        <div class="yib-panel__title-bar">
          <h2>最近问题反馈</h2>
          <span class="yib-badge yib-badge--neutral">最近 {{ recentItems.length }} 条</span>
        </div>
        <div class="yib-recent-list">
          <article v-for="item in recentItems" :key="`${item.timestamp}-${item.message}`" class="yib-recent-item">
            <time class="yib-recent-item__time">{{ formatDate(item.timestamp) }}</time>
            <span class="yib-recent-item__channel">{{ item.channel }}</span>
            <p class="yib-recent-item__msg">{{ item.message }}</p>
          </article>
        </div>
      </section>

      <!-- 配置详情 -->
      <section class="yib-panel">
        <div class="yib-panel__title-bar">
          <h2>配置与运行参数</h2>
        </div>
        <dl class="yib-meta-grid">
          <div class="yib-meta-item">
            <dt>Chat 模型</dt>
            <dd>{{ panel.model.chatModel || panel.model.defaultChat || "未配置" }}</dd>
          </div>
          <div class="yib-meta-item">
            <dt>Vision 视觉模型</dt>
            <dd>{{ panel.model.visionModel || "未配置" }}</dd>
          </div>
          <div class="yib-meta-item">
            <dt>默认 Embedding</dt>
            <dd>{{ panel.model.defaultEmbedding || "未配置" }}</dd>
          </div>
          <div class="yib-meta-item">
            <dt>提供商 (Provider)</dt>
            <dd>{{ panel.model.providers.join("、") || "无" }}</dd>
          </div>
          <div class="yib-meta-item">
            <dt>图片输入通道</dt>
            <dd>{{ imageInputText }}</dd>
          </div>
          <div class="yib-meta-item">
            <dt>作用频道规则</dt>
            <dd>{{ panel.config.allowedChannels }} 条生效</dd>
          </div>
          <div class="yib-meta-item">
            <dt>会话空闲压缩</dt>
            <dd>{{ formatDuration(panel.config.idleTimeoutSeconds) }}</dd>
          </div>
          <div class="yib-meta-item">
            <dt>持久化数据目录</dt>
            <dd class="yib-code-text">{{ panel.config.basePath || "./data" }}</dd>
          </div>
        </dl>
      </section>

      <!-- 扩展插件状态网格 -->
      <section class="yib-panel">
        <div class="yib-panel__title-bar">
          <h2>扩展功能组件</h2>
        </div>
        <div v-if="panel.plugins.length" class="yib-plugin-grid">
          <article v-for="plugin in panel.plugins" :key="plugin.key" class="yib-plugin-card" :class="plugin.status">
            <div class="yib-plugin-card__status-dot"></div>
            <div class="yib-plugin-card__content">
              <strong>{{ plugin.label }}</strong>
              <p>{{ plugin.detail }}</p>
            </div>
            <router-link class="yib-plugin-card__btn" :to="`/plugins/${plugin.configPath}`" title="配置该插件">
              <k-icon name="edit"></k-icon>
            </router-link>
          </article>
        </div>
        <div v-else class="yib-empty-state">未发现任何功能插件</div>
      </section>

      <!-- 快捷入口 -->
      <section class="yib-quick-actions">
        <router-link class="yib-action-card" to="/yesimbot/channels">
          <div class="yib-action-card__icon"><k-icon name="clipboard-list"></k-icon></div>
          <div class="yib-action-card__info">
            <strong>会话浏览</strong>
            <p>查看频道历史、工具调用与内部思考</p>
          </div>
          <k-icon name="chevron-right" class="yib-action-card__arrow"></k-icon>
        </router-link>

        <router-link class="yib-action-card" to="/analytics">
          <div class="yib-action-card__icon"><k-icon name="tag"></k-icon></div>
          <div class="yib-action-card__info">
            <strong>数据统计分析</strong>
            <p>查看 Token 消耗趋势与对话活跃度</p>
          </div>
          <k-icon name="chevron-right" class="yib-action-card__arrow"></k-icon>
        </router-link>

        <router-link class="yib-action-card" to="/settings">
          <div class="yib-action-card__icon"><k-icon name="filter"></k-icon></div>
          <div class="yib-action-card__info">
            <strong>全局高级配置</strong>
            <p>调节人设 Prompt、安全策略与响应超时</p>
          </div>
          <k-icon name="chevron-right" class="yib-action-card__arrow"></k-icon>
        </router-link>
      </section>

      <section class="yib-home__usage">
        <k-slot name="home-usage"></k-slot>
      </section>
    </div>
  </k-layout>
</template>

<script lang="ts" setup>
import { socket, store } from "@koishijs/client";
import { computed } from "vue";
import YesImBotIcon from "./YesImBotIcon.vue";

const connected = computed(() => Boolean(socket.value));

const panel = computed(() => (store as { yesimbotPanel?: PanelPayload }).yesimbotPanel ?? emptyPanel());

const enabledPluginCount = computed(() => panel.value.plugins.filter((plugin) => plugin.enabled).length);

const onboardingProgress = computed(() => {
  const steps = panel.value.onboarding.steps;
  if (!steps || steps.length === 0) return 100;
  const doneCount = steps.filter((s) => s.done).length;
  return Math.round((doneCount / steps.length) * 100);
});

const recentItems = computed(() => panel.value.recent.slice(0, 8));

const imageInputText = computed(() => {
  if (!panel.value.model.imageInput) return "禁用";
  const budget = panel.value.model.imageBudget;
  return budget ? `启用 · ${budget.maxCount} 张 / ${formatSize(budget.maxBytesPerImage)}` : "启用";
});

interface PanelPayload {
  generatedAt: string;
  health: { online: boolean; botCount: number; botErrorCount: number; memory: { app: number; total: number }; uptimeSeconds: number };
  model: {
    chatModel: string | null;
    visionModel: string | null;
    defaultChat: string | null;
    defaultEmbedding: string | null;
    providers: string[];
    chatModels: number;
    embeddingModels: number;
    imageInput: boolean;
    imageBudget: { maxCount: number; maxBytesPerImage: number; maxTotalBytes: number } | null;
    describeImage: boolean;
  };
  config: { basePath: string; allowedChannels: number; idleTimeoutSeconds: number; configPath: string };
  plugins: PanelPlugin[];
  adapters: PanelAdapter[];
  onboarding: PanelOnboarding;
  recent: PanelRecent[];
  attention: PanelIssue[];
}

interface PanelPlugin {
  key: string;
  label: string;
  enabled: boolean;
  status: "enabled" | "disabled" | "attention";
  detail: string;
  configPath: string;
}

interface PanelAdapter {
  key: string;
  name: string;
  platform: string;
  enabled: boolean;
  state: "disabled" | "unconfigured" | "configured" | "error" | "online";
  configPath: string;
  error?: string;
}

interface PanelIssue {
  level: "error" | "warning";
  message: string;
}

interface PanelRecent {
  timestamp: string;
  level: "error";
  type: string;
  message: string;
  channel: string;
}

interface PanelOnboardingStep {
  id: "adapter" | "model" | "channels";
  title: string;
  description: string;
  target: string;
  done: boolean;
}

interface PanelOnboarding {
  complete: boolean;
  steps: PanelOnboardingStep[];
}

function isCurrentStep(index: number): boolean {
  const steps = panel.value.onboarding.steps;
  const firstUndone = steps.findIndex((s) => !s.done);
  return firstUndone === index;
}

function emptyPanel(): PanelPayload {
  return {
    generatedAt: "",
    health: { online: true, botCount: 0, botErrorCount: 0, memory: { app: 0, total: 0 }, uptimeSeconds: 0 },
    model: {
      chatModel: null,
      visionModel: null,
      defaultChat: null,
      defaultEmbedding: null,
      providers: [],
      chatModels: 0,
      embeddingModels: 0,
      imageInput: true,
      imageBudget: null,
      describeImage: false,
    },
    config: { basePath: "", allowedChannels: 0, idleTimeoutSeconds: 0, configPath: "yesimbot" },
    plugins: [],
    adapters: [],
    onboarding: { complete: true, steps: [] },
    recent: [],
    attention: [],
  };
}

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${bytes} B`;
}

function formatDuration(seconds: number): string {
  if (seconds <= 0) return "禁用";
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  if (days > 0) return `${days} 天 ${hours} 小时`;
  if (hours > 0) return `${hours} 小时 ${minutes} 分`;
  return `${minutes} 分钟`;
}

function formatDate(value: string): string {
  const date = new Date(value);
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function adapterIcon(platform: string): string {
  const icons: Record<string, string> = {
    napcat: "box-open",
    onebot: "box-open",
    qq: "user",
    discord: "user",
    telegram: "paper-plane",
    whatsapp: "paper-plane",
    wecom: "paper-plane",
    lark: "paper-plane",
    satori: "link",
    matrix: "link",
    line: "link",
    kook: "tools",
    slack: "tag",
    mail: "file-archive",
  };
  return icons[platform] ?? "tools";
}

function adapterStateText(adapter: PanelAdapter): string {
  if (adapter.state === "disabled") return "未启用";
  if (adapter.state === "unconfigured") return "未配置";
  if (adapter.state === "configured") return "等待连接";
  if (adapter.state === "error") return "连接异常";
  return "在线运行";
}
</script>

<style lang="scss" scoped>
/* 容器框架与色彩基础变量 */
.yib-home__body {
  box-sizing: border-box;
  height: 100%;
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 20px;
  overflow: auto;
  color: var(--k-text-dark, #1c1f23);
}

/* 基础卡片风格 */
.yib-panel {
  position: relative;
  background: transparent;
  border: 1px solid var(--k-color-divider);
  border-radius: 8px;
  padding: 20px;
  box-shadow: none;

  .yib-panel__title-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 16px;

    h2 {
      margin: 0;
      font-size: 16px;
      font-weight: 600;
      letter-spacing: -0.01em;
    }
  }
}

/* Hero 顶部概览 */
.yib-hero {
  position: relative;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 140px;
  padding: 28px 32px;
  background: transparent;
  border: 1px solid var(--k-color-divider);
  border-radius: 8px;

  .yib-hero__bg {
    position: absolute;
    right: -20px;
    top: 50%;
    transform: translateY(-50%);
    width: 240px;
    height: 240px;
    color: var(--k-color-primary, #409eff);
    opacity: 0.06;
    pointer-events: none;
  }

  .yib-hero__title-row {
    display: flex;
    align-items: center;
    gap: 12px;

    h1 {
      margin: 0;
      font-size: 26px;
      font-weight: 700;
    }
  }

  p {
    margin: 6px 0 0;
    color: var(--k-text-normal, #666);
    font-size: 14px;
  }

  .yib-hero__state {
    display: flex;
    align-items: center;
    gap: 16px;
  }

  .yib-hero__instances {
    font-size: 13px;
    color: var(--k-text-normal, #666);
    display: flex;
    align-items: center;
    gap: 6px;
  }
}

/* 状态药丸与点状指示 */
.yib-status-pill {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  border-radius: 999px;
  background: transparent;
  border: 1px solid var(--k-color-divider);
  font-size: 13px;
  font-weight: 500;

  .yib-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--k-text-normal, #666);
  }

  &.is-online {
    color: var(--k-color-success, #67c23a);
    background: transparent;
    border-color: var(--k-color-success, #67c23a);

    .yib-dot {
      background: var(--k-color-success, #67c23a);
    }
  }
}

/* ==========================================================
   全新设计：新手引导向导 (Onboarding Stepper)
   ========================================================== */

.yib-onboarding__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-bottom: 20px;
  border-bottom: 1px solid var(--k-color-divider);
  margin-bottom: 20px;

  .yib-onboarding__title-wrap {
    display: flex;
    align-items: center;
    gap: 12px;

    .yib-section-icon {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 40px;
      height: 40px;
      border-radius: 10px;
      background: transparent;
      color: var(--k-color-primary, #409eff);
      font-size: 20px;
    }

    h2 {
      margin: 0;
      font-size: 17px;
      font-weight: 600;
    }

    .yib-section-desc {
      margin: 3px 0 0;
      font-size: 13px;
      color: var(--k-text-normal, #666);
    }
  }
}

.yib-progress-wrap {
  width: 180px;

  .yib-progress-text {
    display: flex;
    justify-content: space-between;
    font-size: 12px;
    margin-bottom: 6px;
    color: var(--k-text-normal, #666);

    strong {
      color: var(--k-color-primary, #409eff);
    }
  }

  .yib-progress-bar {
    height: 6px;
    background: var(--k-color-divider);
    border-radius: 999px;
    overflow: hidden;

    .yib-progress-bar__inner {
      height: 100%;
      background: var(--k-color-primary, #409eff);
      transition: width 0.4s ease-in-out;
    }
  }
}

.yib-stepper {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
}

.yib-step-item {
  display: flex;
  gap: 16px;
  position: relative;

  .yib-step-item__node {
    display: flex;
    flex-direction: column;
    align-items: center;
    flex: 0 0 32px;

    .yib-step-item__circle {
      width: 30px;
      height: 30px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 13px;
      font-weight: 700;
      background: transparent;
      border: 2px solid var(--k-color-divider);
      color: var(--k-text-normal, #666);
      transition: all 0.25s ease;
      z-index: 2;
    }

    .yib-step-item__line {
      flex: 1 1 auto;
      width: 2px;
      background: var(--k-color-divider);
      margin: 6px 0;
      min-height: 24px;
    }
  }

  .yib-step-item__body {
    flex: 1 1 auto;
    padding-bottom: 24px;
  }

  .yib-step-item__header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;
  }

  .yib-step-item__title {
    display: flex;
    align-items: center;
    gap: 10px;

    strong {
      font-size: 15px;
      font-weight: 600;
    }
  }

  .yib-step-item__desc {
    margin: 4px 0 0;
    font-size: 13px;
    color: var(--k-text-normal, #666);
  }

  /* 状态特化 */
  &.is-done {
    .yib-step-item__circle {
      background: var(--k-color-success, #67c23a);
      border-color: var(--k-color-success, #67c23a);
      color: #fff;
    }
    .yib-step-item__line {
      background: var(--k-color-success, #67c23a);
    }
    .yib-step-item__desc {
      opacity: 0.7;
    }
  }

  &.is-active {
    .yib-step-item__circle {
      background: var(--k-color-primary, #409eff);
      border-color: var(--k-color-primary, #409eff);
      color: #fff;
    }
  }

  &.is-pending {
    opacity: 0.5;
  }
}

/* 步骤内的适配器网格 */
.yib-adapter-section {
  margin-top: 16px;
  padding: 14px;
  background: transparent;
  border-radius: 8px;
  border: 1px solid var(--k-color-divider);
}

.yib-adapter-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 12px;
}

.yib-adapter-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 14px;
  background: transparent;
  border: 1px solid var(--k-color-divider);
  border-radius: 8px;
  transition: all 0.2s ease;

  &:hover {
    border-color: var(--k-color-primary, #409eff);
    transform: translateY(-1px);
  }

  .yib-adapter-card__left {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
  }

  .yib-adapter-card__icon {
    width: 34px;
    height: 34px;
    border-radius: 8px;
    background: transparent;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 16px;
    color: var(--k-color-primary, #409eff);
  }

  .yib-adapter-card__detail {
    min-width: 0;

    .yib-adapter-card__name {
      font-size: 13px;
      font-weight: 600;
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .yib-adapter-card__status {
      font-size: 11px;
      margin-top: 2px;
      display: flex;
      align-items: center;
      gap: 4px;
      color: var(--k-text-normal, #666);

      &.online {
        color: var(--k-color-success, #67c23a);
      }
      &.error {
        color: var(--k-color-error, #f56c6c);
      }
      &.unconfigured {
        color: var(--k-color-warning, #e6a23c);
      }
    }
  }

  &.online {
    border-color: var(--k-color-success, #67c23a);
  }
}

.yib-adapter-footer {
  margin-top: 12px;
  display: flex;
  justify-content: flex-end;

  .yib-link-hint {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: var(--k-color-primary, #409eff);
    text-decoration: none;

    &:hover {
      text-decoration: underline;
    }
  }
}

/* ==========================================================
   通用标签、按钮与微组件
   ========================================================== */
.yib-badge {
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 600;

  &--brand {
    background: transparent;
    color: var(--k-color-primary, #409eff);
  }
  &--cyan {
    background: transparent;
    color: var(--k-color-primary, #409eff);
  }
  &--neutral {
    background: transparent;
    color: var(--k-text-normal, #666);
  }
}

.yib-tag {
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;

  &--primary {
    background: transparent;
    color: var(--k-color-primary, #409eff);
  }
  &--success {
    background: transparent;
    color: var(--k-color-success, #67c23a);
  }
}

.yib-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 8px 16px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 600;
  text-decoration: none;
  cursor: pointer;
  transition: all 0.2s ease;

  &--primary {
    background: var(--k-color-primary, #409eff);
    color: #fff;

    &:hover {
      background: var(--k-color-primary-shade, #3a8de6);
    }
  }

  &--secondary {
    background: transparent;
    color: var(--k-text-dark);

    &:hover {
      background: var(--k-hover-bg);
    }
  }

  &--sm {
    padding: 5px 10px;
    font-size: 12px;
    border-radius: 6px;
  }
}

.yib-dot-mini {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
}

/* ==========================================================
   指标与数据网格
   ========================================================== */
.yib-metrics-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 16px;
}

.yib-metric-card {
  padding: 18px 20px;
  background: transparent;
  border: 1px solid var(--k-color-divider);
  border-radius: 8px;
  display: flex;
  flex-direction: column;

  .yib-metric-card__label {
    font-size: 13px;
    color: var(--k-text-normal, #666);
  }

  .yib-metric-card__value-wrap {
    margin: 10px 0 6px;
    display: flex;
    align-items: baseline;
    gap: 4px;
  }

  .yib-metric-card__value {
    font-size: 26px;
    font-weight: 700;
    line-height: 1;

    &--truncate {
      font-size: 18px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
  }

  .yib-metric-card__unit {
    font-size: 13px;
    color: var(--k-text-normal, #666);
  }

  .yib-metric-card__sub {
    margin: 0;
    font-size: 12px;
    color: var(--k-text-normal, #666);

    &.is-error {
      color: var(--k-color-error, #f56c6c);
      font-weight: 600;
    }
  }
}

/* 详情 Meta 列表 */
.yib-meta-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
  margin: 0;

  .yib-meta-item {
    padding: 12px 14px;
    background: transparent;
    border-radius: 8px;
    border: 1px solid var(--k-color-divider);

    dt {
      font-size: 12px;
      color: var(--k-text-normal, #666);
      margin-bottom: 4px;
    }

    dd {
      margin: 0;
      font-size: 13px;
      font-weight: 500;
      overflow-wrap: anywhere;
    }

    .yib-code-text {
      font-family: monospace;
      font-size: 12px;
      color: var(--k-color-primary, #409eff);
    }
  }
}

/* 插件卡片网格 */
.yib-plugin-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 12px;
}

.yib-plugin-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
  background: transparent;
  border: 1px solid var(--k-color-divider);
  border-radius: 8px;

  .yib-plugin-card__status-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--k-text-normal, #666);
  }

  &.enabled .yib-plugin-card__status-dot {
    background: var(--k-color-success, #67c23a);
  }
  &.attention .yib-plugin-card__status-dot {
    background: var(--k-color-warning, #e6a23c);
  }

  .yib-plugin-card__content {
    flex: 1 1 auto;
    min-width: 0;

    strong {
      display: block;
      font-size: 14px;
    }

    p {
      margin: 3px 0 0;
      font-size: 12px;
      color: var(--k-text-normal, #666);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
  }

  .yib-plugin-card__btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border-radius: 6px;
    color: var(--k-text-normal, #666);
    background: transparent;
    text-decoration: none;

    &:hover {
      color: #fff;
      background: var(--k-color-primary, #409eff);
    }
  }
}

/* 快捷操作卡片 */
.yib-quick-actions {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px;
}

.yib-home__usage {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 16px;

  :deep(.k-card) {
    min-width: 0;
  }
}

.yib-action-card {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 18px 20px;
  background: transparent;
  border: 1px solid var(--k-color-divider);
  border-radius: 8px;
  text-decoration: none;
  color: inherit;
  transition: all 0.2s ease;

  .yib-action-card__icon {
    width: 44px;
    height: 44px;
    border-radius: 10px;
    background: transparent;
    color: var(--k-color-primary, #409eff);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 20px;
  }

  .yib-action-card__info {
    flex: 1 1 auto;
    min-width: 0;

    strong {
      display: block;
      font-size: 15px;
    }

    p {
      margin: 3px 0 0;
      font-size: 12px;
      color: var(--k-text-normal, #666);
    }
  }

  .yib-action-card__arrow {
    color: var(--k-text-normal, #666);
    transition: transform 0.2s ease;
  }

  &:hover {
    border-color: var(--k-color-primary, #409eff);
    transform: translateY(-2px);

    .yib-action-card__arrow {
      transform: translateX(3px);
      color: var(--k-color-primary, #409eff);
    }
  }
}

/* 警报/错误栏 */
.yib-alerts {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.yib-alert-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  border-radius: 8px;
  font-size: 13px;

  &--error {
    background: transparent;
    border: 1px solid var(--k-color-error, #f56c6c);
    color: var(--k-color-error, #f56c6c);
  }

  &--warning {
    background: transparent;
    border: 1px solid var(--k-color-warning, #e6a23c);
    color: var(--k-color-warning, #e6a23c);
  }
}

/* 最近问题反馈 */
.yib-recent-list {
  display: flex;
  flex-direction: column;
}

.yib-recent-item {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  gap: 6px 12px;
  padding: 12px 2px;
  border-bottom: 1px solid var(--k-color-divider);
  background: transparent;

  &:last-child {
    border-bottom: 0;
  }

  &__time {
    font-size: 12px;
    color: var(--k-text-normal, #666);
    white-space: nowrap;
  }

  &__channel {
    display: inline-flex;
    align-items: center;
    justify-self: start;
    max-width: 100%;
    padding: 0;
    color: var(--k-text-normal, #666);
    font-family: monospace;
    font-size: 12px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &__msg {
    grid-column: 1 / -1;
    margin: 2px 0 0;
    color: var(--k-color-error, #f56c6c);
    font-family: monospace;
    font-size: 13px;
    line-height: 1.5;
    overflow-wrap: anywhere;
    word-break: break-word;
  }
}

/* 响应式断点 */
@media screen and (min-width: 1200px) {
  .yib-home__usage {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media screen and (max-width: 900px) {
  .yib-metrics-grid,
  .yib-meta-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .yib-quick-actions {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media screen and (max-width: 640px) {
  .yib-home__body {
    padding: 14px;
    gap: 14px;
  }

  .yib-hero {
    flex-direction: column;
    align-items: flex-start;
    gap: 16px;
  }

  .yib-onboarding__header {
    flex-direction: column;
    align-items: flex-start;
    gap: 12px;

    .yib-progress-wrap {
      width: 100%;
    }
  }

  .yib-metrics-grid,
  .yib-meta-grid,
  .yib-quick-actions {
    grid-template-columns: 1fr;
  }

  .yib-step-item__header {
    flex-direction: column;
    align-items: stretch;
    gap: 10px;
  }
}
</style>
