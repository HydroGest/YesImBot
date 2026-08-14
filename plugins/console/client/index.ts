import { Context, icons, redirectTo } from "@koishijs/client";

import Channels from "./Channels.vue";
import ConversationDetail from "./ConversationDetail.vue";
import Home from "./Home.vue";
import YesImBotIcon from "./YesImBotIcon.vue";

icons.register("yesimbot", YesImBotIcon);

export default function (ctx: Context): void {
  ctx.on("activity", (activity) => activity.id === "home");

  const router = ctx.$router.router;
  const dispose = router.beforeEach((to) => {
    if (to.path === "/") return "/yesimbot";
  });
  ctx.on("dispose", dispose);

  if (router.currentRoute.value.path === "/") {
    redirectTo.value = "/yesimbot";
  }

  ctx.page({ id: "yesimbot", path: "/yesimbot", name: "主面板", icon: "yesimbot", order: 1000, component: Home });
  ctx.page({
    id: "yesimbot-channels",
    path: "/yesimbot/channels",
    name: "会话浏览",
    icon: "paper-plane",
    order: 950,
    component: Channels,
  });
  ctx.page({
    id: "yesimbot-conversation",
    path: "/yesimbot/channels/:channel/sessions/:session",
    name: "会话详情",
    icon: "paper-plane",
    order: 950,
    disabled: () => true,
    component: ConversationDetail,
  });
}
