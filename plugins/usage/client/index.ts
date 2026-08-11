import { type Context, store } from "@koishijs/client";
import { BarChart } from "echarts/charts";
import { GridComponent, LegendComponent, TooltipComponent } from "echarts/components";
import * as echarts from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import { computed, defineComponent, h, nextTick, onBeforeUnmount, onMounted, ref, resolveComponent, watch } from "vue";

echarts.use([BarChart, GridComponent, LegendComponent, TooltipComponent, CanvasRenderer]);

// Shared mode across both chart cards (linked tab switching)
const chartMode = ref<"input" | "output">("input");

// Reactive dark-mode detection via MutationObserver on <html>
const isDark = ref(document.documentElement.classList.contains("dark"));
const observer = new MutationObserver(() => {
  isDark.value = document.documentElement.classList.contains("dark");
});
observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });

const TokenRateStatus = defineComponent({
  setup() {
    const payload = usagePayload();

    return () => {
      const current = payload.value;
      if (!current) return null;
      const { inputPerMinute, outputPerMinute, totalPerMinute, cacheReadPerMinute, noCachePerMinute } = current.rate;

      return h(resolveComponent("k-status"), null, {
        tooltip: () => {
          const cacheTotal = cacheReadPerMinute + noCachePerMinute;
          const hitRate = cacheTotal > 0 ? ((cacheReadPerMinute / cacheTotal) * 100).toFixed(1) : "-";
          return h("div", { style: "padding: 8px 12px" }, [
            h("p", { style: "margin: 6px 0" }, `总消耗: ${formatExact(totalPerMinute)}/min`),
            h("p", { style: "margin: 6px 0" }, `输入: ${formatExact(inputPerMinute)}/min`),
            h("p", { style: "margin: 6px 0" }, `输出: ${formatExact(outputPerMinute)}/min`),
            h("p", { style: "margin: 6px 0" }, `缓存命中: ${formatExact(cacheReadPerMinute)}/min`),
            h("p", { style: "margin: 6px 0" }, `缓存未命中: ${formatExact(noCachePerMinute)}/min`),
            h("p", { style: "margin: 6px 0" }, `缓存命中率: ${hitRate}%`),
          ]);
        },
        default: () => `Token: ↑ ${formatCompact(inputPerMinute)}/min · ↓ ${formatCompact(outputPerMinute)}/min`,
      });
    };
  },
});

const EChart = defineComponent({
  props: { option: { type: Object, required: true } },
  setup(props) {
    const root = ref<HTMLDivElement>();
    let chart: echarts.ECharts | undefined;
    let resizeObserver: ResizeObserver | undefined;

    const render = () => {
      if (!chart) return;
      chart.setOption(props.option as never, true);
      chart.resize();
    };

    onMounted(async () => {
      if (!root.value) return;
      await nextTick();
      if (!root.value) return;
      chart = echarts.init(root.value);
      render();
      resizeObserver = new ResizeObserver(() => chart?.resize());
      resizeObserver.observe(root.value);
    });

    onBeforeUnmount(() => {
      resizeObserver?.disconnect();
      resizeObserver = undefined;
      chart?.dispose();
      chart = undefined;
    });

    watch(() => props.option, render, { deep: true });

    return () => h("div", { ref: root, class: "echarts", style: "width: 100%; height: 280px" });
  },
});

interface TokenCounts {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  noCacheTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

interface RateSnapshot {
  inputPerMinute: number;
  outputPerMinute: number;
  totalPerMinute: number;
  noCachePerMinute: number;
  cacheReadPerMinute: number;
}

interface UsagePayload {
  today: TokenCounts;
  recent: Array<TokenCounts & { date: number }>;
  byHour: Array<TokenCounts & { hour: number }>;
  rate: RateSnapshot;
}

export default function (ctx: Context): void {
  for (const type of ["analytic-chart", "home-usage"]) {
    ctx.slot({ type, component: createChartCard("近30天 Token 消耗", historyOption), order: 0 });
    ctx.slot({ type, component: createChartCard("每小时 Token 消耗", hourlyOption), order: 0 });
  }
  ctx.slot({ type: "status-right", component: TokenRateStatus, order: 0 });
}

function usagePayload() {
  return computed(() => (store as { yesimbotUsage?: UsagePayload }).yesimbotUsage);
}

function formatExact(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}

function formatCompact(value: number): string {
  const rounded = Math.round(value);
  if (rounded >= 1_000_000) return `${(rounded / 1_000_000).toFixed(1)}M`;
  if (rounded >= 1_000) return `${(rounded / 1_000).toFixed(1)}k`;
  return String(rounded);
}

/** ECharts axis tooltip formatter that appends cache hit rate */
function axisCacheHitFormatter(params: Array<{ seriesName: string; value: number; marker: string; axisValueLabel: string }>): string {
  if (!params.length) return "";
  const lines = [`${params[0].axisValueLabel}`];
  let cacheRead = 0;
  let noCache = 0;
  for (const p of params) {
    lines.push(`${p.marker} ${p.seriesName}: ${formatExact(p.value)}`);
    if (p.seriesName === "缓存命中") cacheRead = p.value;
    if (p.seriesName === "缓存未命中") noCache = p.value;
  }
  const total = cacheRead + noCache;
  const hitRate = total > 0 ? ((cacheRead / total) * 100).toFixed(1) : "-";
  lines.push(`缓存命中率: ${hitRate}%`);
  return lines.join("<br>");
}

/** Format "8:00" into "8:00 - 9:00" time range */
function hourLabel(axisValue: string): string {
  const hour = parseInt(axisValue, 10);
  const next = (hour + 1) % 24;
  return `${hour}:00 - ${next}:00`;
}

/** Hourly tooltip formatter with time range + cache hit rate */
function hourlyAxisCacheHitFormatter(params: Array<{ seriesName: string; value: number; marker: string; axisValueLabel: string }>): string {
  if (!params.length) return "";
  const lines = [hourLabel(params[0].axisValueLabel)];
  let cacheRead = 0;
  let noCache = 0;
  for (const p of params) {
    lines.push(`${p.marker} ${p.seriesName}: ${formatExact(p.value)}`);
    if (p.seriesName === "缓存命中") cacheRead = p.value;
    if (p.seriesName === "缓存未命中") noCache = p.value;
  }
  const total = cacheRead + noCache;
  const hitRate = total > 0 ? ((cacheRead / total) * 100).toFixed(1) : "-";
  lines.push(`缓存命中率: ${hitRate}%`);
  return lines.join("<br>");
}

/** Hourly tooltip formatter with time range (output mode) */
function hourlyAxisFormatter(params: Array<{ seriesName: string; value: number; marker: string; axisValueLabel: string }>): string {
  if (!params.length) return "";
  const lines = [hourLabel(params[0].axisValueLabel)];
  for (const p of params) {
    lines.push(`${p.marker} ${p.seriesName}: ${formatExact(p.value)}`);
  }
  return lines.join("<br>");
}

/** Dark-mode aware base chart option (text, axis, tooltip chrome) */
function darkAwareBase(): Record<string, unknown> {
  const dark = isDark.value;
  const textColor = dark ? "rgba(255, 255, 245, 0.86)" : "#333";
  const mutedColor = dark ? "rgba(255, 255, 245, 0.5)" : "#999";
  const borderColor = dark ? "rgba(82, 82, 89, 0.5)" : "#ccc";
  return {
    textStyle: { color: textColor },
    tooltip: { trigger: "axis", backgroundColor: dark ? "#1e1e20" : "#fff", borderColor, textStyle: { color: textColor } },
    legend: { textStyle: { color: textColor } },
    xAxis: { axisLabel: { color: mutedColor }, axisLine: { lineStyle: { color: borderColor } }, splitLine: { lineStyle: { color: borderColor } } },
    yAxis: { axisLabel: { color: mutedColor }, splitLine: { lineStyle: { color: dark ? "rgba(82, 82, 89, 0.3)" : "#eee" } } },
  };
}

function createChartCard(title: string, option: (payload: UsagePayload, mode: "input" | "output") => Record<string, unknown>) {
  return defineComponent({
    setup() {
      const payload = usagePayload();

      return () => {
        const current = payload.value;
        if (!current) return null;
        // Access isDark.value to trigger re-render on theme change
        void isDark.value;
        const chartOption = option(current, chartMode.value);

        return h(
          resolveComponent("k-card"),
          { class: "frameless analytic-chart usage-chart" },
          {
            header: () => [
              h("span", { class: "left" }, title),
              h("span", { class: "right" }, [
                h("span", { class: "tab-item" + (chartMode.value === "input" ? " active" : ""), onClick: () => (chartMode.value = "input") }, "输入"),
                h("span", { class: "tab-item" + (chartMode.value === "output" ? " active" : ""), onClick: () => (chartMode.value = "output") }, "输出"),
              ]),
            ],
            default: () => h(EChart, { option: chartOption }),
          },
        );
      };
    },
  });
}

function historyOption(payload: UsagePayload, mode: "input" | "output"): Record<string, unknown> {
  const base = darkAwareBase();
  const data = payload.recent.slice().reverse();
  const tokenField = mode === "input" ? "inputTokens" : "outputTokens";
  const series =
    mode === "input"
      ? [
          { name: "缓存命中", type: "bar", stack: "input", itemStyle: { color: "#90CAF9" }, data: data.map((item) => item.cacheReadTokens) },
          { name: "缓存未命中", type: "bar", stack: "input", itemStyle: { color: "#1976D2" }, data: data.map((item) => item.noCacheTokens) },
        ]
      : [{ name: "输出", type: "bar", itemStyle: { color: "#66BB6A" }, data: data.map((item) => item[tokenField]) }];
  return {
    ...base,
    tooltip: { ...(base.tooltip as object), trigger: "axis", formatter: mode === "input" ? axisCacheHitFormatter : undefined },
    xAxis: {
      ...(base.xAxis as object),
      type: "category",
      data: data.map((_, index) => new Date(Date.now() - (payload.recent.length - 1 - index) * 86_400_000).toLocaleDateString("zh-CN")),
    },
    yAxis: { ...(base.yAxis as object), type: "value" },
    legend: mode === "input" ? { ...(base.legend as object), data: ["缓存命中", "缓存未命中"] } : undefined,
    series,
  };
}

function hourlyOption(payload: UsagePayload, mode: "input" | "output"): Record<string, unknown> {
  const base = darkAwareBase();
  const series =
    mode === "input"
      ? [
          {
            name: "缓存命中",
            type: "bar",
            stack: "input",
            itemStyle: { color: "#90CAF9" },
            data: payload.byHour.map((item) => Math.round(item.cacheReadTokens)),
          },
          {
            name: "缓存未命中",
            type: "bar",
            stack: "input",
            itemStyle: { color: "#1976D2" },
            data: payload.byHour.map((item) => Math.round(item.noCacheTokens)),
          },
        ]
      : [{ name: "输出", type: "bar", itemStyle: { color: "#66BB6A" }, data: payload.byHour.map((item) => Math.round(item.outputTokens)) }];
  return {
    ...base,
    tooltip: { ...(base.tooltip as object), trigger: "axis", formatter: mode === "input" ? hourlyAxisCacheHitFormatter : hourlyAxisFormatter },
    xAxis: { ...(base.xAxis as object), type: "category", data: payload.byHour.map((_, hour) => `${hour}:00`) },
    yAxis: { ...(base.yAxis as object), type: "value" },
    legend: mode === "input" ? { ...(base.legend as object), data: ["缓存命中", "缓存未命中"] } : undefined,
    series,
  };
}
