import { h, type Context, type Element } from "koishi";
import type { ResolveContext } from "koishi-plugin-yesimbot";

const DATA_URL = /^data:([^;,]+)(;base64)?,([\s\S]*)$/;

export async function freezeOneBotImages(
  ctx: Context,
  elements: readonly Element[],
  freezeImage: ResolveContext["freezeImage"],
): Promise<Element[]> {
  return Promise.all(elements.map((element) => freezeOneBotElement(ctx, element, freezeImage)));
}

async function freezeOneBotElement(
  ctx: Context,
  element: Element,
  freezeImage: ResolveContext["freezeImage"],
): Promise<Element> {
  if (element.type === "img") {
    if (typeof element.attrs.src === "string") {
      return freezeImage(element, (signal) => loadOneBotImage(ctx, element.attrs.src as string, signal));
    }
    if (typeof element.attrs.id === "string" && typeof element.attrs.mime === "string") return element;
    return h("img", { unavailable: "true" });
  }
  if (!element.children.length) return element;
  return h(element.type, element.attrs, await freezeOneBotImages(ctx, element.children, freezeImage));
}

async function loadOneBotImage(
  ctx: Context,
  src: string,
  signal: AbortSignal,
): Promise<{ data: Uint8Array; mime?: string }> {
  const data = decodeDataImage(src);
  if (data) return data;

  signal.throwIfAborted();
  const response = await withAbort(ctx.http.file(src), signal);
  return {
    data: new Uint8Array(response.data),
    mime: response.type ?? response.mime,
  };
}

function withAbort<T>(task: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    void task.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

function decodeDataImage(src: string): { data: Uint8Array; mime?: string } | null {
  const match = DATA_URL.exec(src);
  if (!match) return null;
  const [, mime, base64, payload] = match;
  return {
    data: base64 ? new Uint8Array(Buffer.from(payload, "base64")) : new TextEncoder().encode(decodeURIComponent(payload)),
    mime,
  };
}
