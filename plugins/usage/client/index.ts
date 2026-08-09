import { type Context, store } from "@koishijs/client";
import { BarChart } from "echarts/charts";
import { GridComponent, LegendComponent, TooltipComponent } from "echarts/components";
import * as echarts from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import { computed, defineComponent, h, onBeforeUnmount, onMounted, ref, resolveComponent, watch } from "vue";

echarts.use([BarChart, GridComponent, LegendComponent, TooltipComponent, CanvasRenderer]);

const TokenRateStatus = defineComponent({
  setup() {
    const payload = usagePayload();

    return () => {
      const current = payload.value;
      if (!current) return null;
      const { inputPerMinute, outputPerMinute, totalPerMinute, cacheReadPerMinute, noCachePerMinute } = current.rate;

      return h(resolveComponent("k-status"), null, {
        tooltip: () =>
          h("div", { class: "usage-rate-tooltip" }, [
            h("p", { style: "margin: 4px 0" }, `总消耗: ${formatExact(totalPerMinute)}/min`),
            h("p", { style: "margin: 4px 0" }, `输入: ${formatExact(inputPerMinute)}/min`),
            h("p", { style: "margin: 4px 0" }, `输出: ${formatExact(outputPerMinute)}/min`),
            h("p", { style: "margin: 4px 0" }, `缓存命中: ${formatExact(cacheReadPerMinute)}/min`),
            h("p", { style: "margin: 4px 0" }, `缓存未命中: ${formatExact(noCachePerMinute)}/min`),
          ]),
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

    const render = () => {
      if (!chart) return;
      chart.setOption(props.option as never, true);
    };

    onMounted(() => {
      if (!root.value) return;
      chart = echarts.init(root.value);
      render();
    });

    onBeforeUnmount(() => {
      chart?.dispose();
      chart = undefined;
    });

    watch(() => props.option, render, { deep: true });

    return () => h("div", { ref: root, style: "width: 100%; height: 280px" });
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
  ctx.slot({ type: "analytic-chart", component: createChartCard("近30天 Token 消耗", historyOption), order: 0 });
  ctx.slot({ type: "analytic-chart", component: createChartCard("每小时 Token 消耗", hourlyOption), order: 0 });
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

function createChartCard(title: string, option: (payload: UsagePayload, mode: "input" | "output") => Record<string, unknown>, tabs = true) {
  return defineComponent({
    setup() {
      const payload = usagePayload();
      const mode = ref<"input" | "output">("input");

      return () => {
        const current = payload.value;
        if (!current) return null;
        const chartOption = option(current, mode.value);

        return h(
          resolveComponent("k-card"),
          { class: "frameless analytic-chart" },
          {
            header: () => [
              h("span", { class: "left" }, title),
              tabs
                ? h("span", { class: "right" }, [
                    h("span", { class: "tab-item" + (mode.value === "input" ? " active" : ""), onClick: () => (mode.value = "input") }, "输入"),
                    h("span", { class: "tab-item" + (mode.value === "output" ? " active" : ""), onClick: () => (mode.value = "output") }, "输出"),
                  ])
                : [],
            ],
            default: () => h(EChart, { option: chartOption }),
          },
        );
      };
    },
  });
}

function historyOption(payload: UsagePayload, mode: "input" | "output"): Record<string, unknown> {
  const data = payload.recent.slice().reverse();
  const tokenField = mode === "input" ? "inputTokens" : "outputTokens";
  const series =
    mode === "input"
      ? [
          { name: "缓存命中", type: "bar", stack: "input", itemStyle: { color: "#90CAF9" }, data: data.map((item) => item.cacheReadTokens) },
          { name: "缓存未命中", type: "bar", stack: "input", itemStyle: { color: "#1976D2" }, data: data.map((item) => item.noCacheTokens) },
        ]
      : [{ type: "bar", data: data.map((item) => item[tokenField]) }];
  return {
    tooltip: { trigger: "axis" },
    xAxis: {
      type: "category",
      data: data.map((_, index) => new Date(Date.now() - (payload.recent.length - 1 - index) * 86_400_000).toLocaleDateString("zh-CN")),
    },
    yAxis: { type: "value" },
    legend: mode === "input" ? { data: ["缓存命中", "缓存未命中"] } : undefined,
    series,
  };
}

function hourlyOption(payload: UsagePayload, mode: "input" | "output"): Record<string, unknown> {
  const tokenField = mode === "input" ? "inputTokens" : "outputTokens";
  const series =
    mode === "input"
      ? [
          { name: "缓存命中", type: "bar", stack: "input", itemStyle: { color: "#90CAF9" }, data: payload.byHour.map((item) => item.cacheReadTokens) },
          { name: "缓存未命中", type: "bar", stack: "input", itemStyle: { color: "#1976D2" }, data: payload.byHour.map((item) => item.noCacheTokens) },
        ]
      : [{ type: "bar", data: payload.byHour.map((item) => item[tokenField]) }];
  return {
    tooltip: { trigger: "axis" },
    xAxis: { type: "category", data: payload.byHour.map((_, hour) => `${hour}:00`) },
    yAxis: { type: "value" },
    legend: mode === "input" ? { data: ["缓存命中", "缓存未命中"] } : undefined,
    series,
  };
}
