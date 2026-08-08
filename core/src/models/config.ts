import { readFile, writeFile } from "node:fs/promises";

let mutationTail: Promise<void> = Promise.resolve();

export async function readModelsConfig(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8"));
}

export function mutateModelsConfig(path: string, mutate: (value: unknown) => unknown | Promise<unknown>): Promise<void> {
  const task = mutationTail.then(async () => {
    const next = await mutate(await readModelsConfig(path));
    await writeFile(path, `${JSON.stringify(next, null, 2)}\n`);
  });
  mutationTail = task.then(
    () => undefined,
    () => undefined,
  );
  return task;
}
