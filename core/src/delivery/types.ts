import type { Awaitable } from "koishi";

export namespace Delivery {
  export type Mode = "reply" | "send";
  export type Status = "sent" | "partial" | "failed";

  export interface ErrorInfo {
    code: "delivery.target_unavailable" | "delivery.send_failed";
    message: string;
    retryable: false;
  }

  export interface Receipt {
    deliveryId: string;
    mode: Mode;
    status: Status;
    sentCount: number;
    messageIds: string[];
    startedAt: number;
    finishedAt: number;
    error?: ErrorInfo;
  }

  export type Event =
    | { type: "delivery.started"; deliveryId: string; mode: Mode; startedAt: number }
    | { type: `delivery.${Status}`; receipt: Receipt };

  export type Listener = (event: Event) => Awaitable<void>;
}
