import type { Awaitable, Session } from "koishi";

import type { AssetService, AssetStore } from "../asset.js";
import type { PacingConfig } from "../config.js";
import type { EventRecord, MessageRecord, RecordBase } from "../messages.js";
import type { RuntimeManager } from "../runtime/index.js";

export interface ChannelAllowRule {
  readonly platform: string;
  readonly channelId: string;
  readonly isDirect?: boolean;
}

export interface PlatformTranslator {
  readonly platform: string;
  translate(
    base: RecordBase,
    session: Session,
    store: AssetStore,
  ): Awaitable<MessageRecord | EventRecord | null>;
}

export interface GatewayOptions {
  readonly runtime: RuntimeManager;
  readonly assets: AssetService;
  readonly ready: () => Promise<void>;
}

export interface GatewayConfig {
  allowedChannels: readonly ChannelAllowRule[];
  pacing: PacingConfig;
  logLevel: number;
}
