import { randomUUID } from "node:crypto";

import { Context, Service, type Fragment, type Session } from "koishi";

import type { Config } from "../config.js";
import type { Platform } from "../platform/types.js";
import type { Delivery } from "./types.js";

class DeliveryTargetUnavailable extends Error {
  constructor(source: Platform.Source) {
    super(`No Bot is available for ${source.platform}:${source.selfId}`);
  }
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function normalizeDeliveryError(cause: unknown): Delivery.ErrorInfo {
  return {
    code:
      cause instanceof DeliveryTargetUnavailable
        ? "delivery.target_unavailable"
        : "delivery.send_failed",
    message: errorMessage(cause),
    retryable: false,
  };
}

declare module "koishi" {
  interface Context {
    "yesimbot.delivery": DeliveryService;
  }
}

export class DeliveryService extends Service<Config> {
  private readonly listeners = new Set<Delivery.Listener>();

  constructor(ctx: Context, config: Config) {
    super(ctx, "yesimbot.delivery", true);
    this.logger.level = config.logLevel ?? 2;
  }

  subscribe(listener: Delivery.Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async reply(session: Session, outputs: readonly Fragment[]): Promise<Delivery.Receipt> {
    return this.deliver("reply", outputs, () => (output) => session.send(output));
  }

  async send(
    source: Platform.Source,
    scope: Platform.Message["scope"],
    outputs: readonly Fragment[],
  ): Promise<Delivery.Receipt> {
    return this.deliver("send", outputs, () => {
      const bot = this.ctx.bots.find(
        (candidate) => candidate.platform === source.platform && candidate.selfId === source.selfId,
      );
      if (!bot) throw new DeliveryTargetUnavailable(source);
      return (output) => bot.sendMessage(scope.channelId, output);
    });
  }

  private async deliver(
    mode: Delivery.Mode,
    outputs: readonly Fragment[],
    resolveSend: () => (output: Fragment) => Promise<string[]>,
  ): Promise<Delivery.Receipt> {
    const deliveryId = randomUUID();
    const startedAt = Date.now();
    const messageIds: string[] = [];
    let sentCount = 0;
    let error: Delivery.ErrorInfo | undefined;

    this.notify({ type: "delivery.started", deliveryId, mode, startedAt });

    let send: ((output: Fragment) => Promise<string[]>) | undefined = undefined;
    try {
      send = resolveSend();
    } catch (cause) {
      error = normalizeDeliveryError(cause);
    }

    for (const output of outputs) {
      if (!send) break;
      try {
        const ids = await send(output);
        messageIds.push(...ids);
        sentCount += 1;
      } catch (cause) {
        error = normalizeDeliveryError(cause);
        break;
      }
    }

    const status: Delivery.Status = error ? (sentCount > 0 ? "partial" : "failed") : "sent";
    const receipt: Delivery.Receipt = {
      deliveryId,
      mode,
      status,
      sentCount,
      messageIds,
      startedAt,
      finishedAt: Date.now(),
      ...(error ? { error } : {}),
    };
    this.notify({ type: `delivery.${status}`, receipt });
    if (error) this.reportDeliveryFailure(error.message, receipt);
    return receipt;
  }

  private notify(event: Delivery.Event): void {
    for (const listener of [...this.listeners]) {
      try {
        const result = listener(event);
        if (result && typeof (result as PromiseLike<void>).then === "function") {
          void Promise.resolve(result).catch((cause) => this.reportListenerFailure(cause));
        }
      } catch (cause) {
        this.reportListenerFailure(cause);
      }
    }
  }

  private reportListenerFailure(cause: unknown): void {
    try {
      this.logger.warn({ event: "delivery.listener_failed", cause: errorMessage(cause) });
    } catch {
      // Diagnostics cannot interrupt delivery.
    }
  }

  private reportDeliveryFailure(cause: string, receipt: Delivery.Receipt): void {
    try {
      this.logger.warn({ event: "delivery.send_failed", cause, receipt });
    } catch {
      // Diagnostics cannot interrupt delivery.
    }
  }
}
