import { Context, icons, redirectTo } from "@koishijs/client";

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

  ctx.page({ id: "yesimbot", path: "/yesimbot", name: "YesImBot 面板", icon: "yesimbot", order: 1000, component: Home });
}
