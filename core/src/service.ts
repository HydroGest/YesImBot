import { resolve } from "node:path";

import { type Context, Service } from "koishi";

import { Agents } from "./agents/index.js";
import { Channels } from "./channels/index.js";
import { registerSessionCommands } from "./commands/index.js";
import { Config } from "./config.js";
import { Messenger } from "./messengers/index.js";
import { ModelService } from "./models/index.js";
import { registerPlatforms } from "./platforms/index.js";
import type { Resources } from "./resources/index.js";
import { Runtimes } from "./runtimes/index.js";
import { ensureAgentsFile, ensureDefaultPersona } from "./runtimes/prompt.js";

export default class YesImBotService extends Service<Config> {
  public static readonly name = "yesimbot";
  public static readonly usage = ``;
  public static readonly inject = ["database"];
  public static readonly Config = Config;

  public readonly model: ModelService;
  public readonly messenger: Pick<Messenger, "use" | "post">;
  public readonly agent: Pick<Agents, "use" | "will">;
  public readonly resource: Resources;

  private readonly channels: Channels;
  private readonly runtimes: Runtimes;
  private readonly messengerOwner: Messenger;
  private readonly commandDisposer: () => void;
  private platformDisposer: (() => void) | undefined;

  public constructor(ctx: Context, config: Config) {
    super(ctx, "yesimbot");
    this.config = config;
    this.logger.level = config.logLevel ?? 2;
    this.model = new ModelService(ctx, { basePath: config.basePath, logLevel: config.logLevel });
    this.channels = new Channels(ctx, {
      basePath: config.basePath || ctx.baseDir,
      logLevel: config.logLevel,
      imageBudget:
        config.imageInput === false
          ? null
          : {
              maxCount: config.imageInput?.maxCount ?? 3,
              maxBytesPerImage: config.imageInput?.maxBytesPerImage ?? 5 * 1024 * 1024,
              maxTotalBytes: config.imageInput?.maxTotalBytes ?? 10 * 1024 * 1024,
            },
      readTimeoutMs: config.resourceReadTimeoutMs,
    });
    const agents = new Agents();
    this.runtimes = new Runtimes(ctx, this.channels, this.model, config, agents);
    this.messengerOwner = new Messenger(ctx, config, this.channels, this.runtimes);
    this.messenger = this.messengerOwner;
    this.agent = agents;
    this.resource = this.channels;
    this.commandDisposer = registerSessionCommands(ctx, this.runtimes, { authority: 4 });
  }

  public override async start(): Promise<void> {
    await this.channels.start();
    const promptBasePath = resolve(this.ctx.baseDir, this.config.basePath || this.ctx.baseDir);
    await ensureDefaultPersona(promptBasePath);
    await ensureAgentsFile(promptBasePath);
    this.platformDisposer = registerPlatforms(this.ctx, this.messengerOwner);
  }

  public override async stop(): Promise<void> {
    this.commandDisposer();
    this.platformDisposer?.();
    await this.messengerOwner.stop();
  }
}
