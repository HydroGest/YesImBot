interface MessageBot {
  sendMessage(channelId: string, content: string): Promise<unknown> | unknown;
}

function isMessageBot(bot: unknown): bot is MessageBot {
  return typeof bot === "object" && bot !== null && "sendMessage" in bot;
}

export async function sendToolObserverMessage(
  bot: unknown,
  channelId: string,
  content: string,
  timeoutMs: number,
): Promise<void> {
  if (!isMessageBot(bot)) {
    throw new Error("Current platform bot cannot send proactive messages");
  }

  await withTimeout(Promise.resolve(bot.sendMessage(channelId, content)), timeoutMs);
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Tool observer message send timed out")),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
