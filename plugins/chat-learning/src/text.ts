export function sanitizeForDisplay(value: string): string {
  let result = value;
  for (let index = 0; index < 3; index += 1) {
    result = result.replace(/\[[^\]]*\]/g, " ");
  }
  return result
    .replace(/https?:\/\/\S+/g, "[链接]")
    .replace(/asset:\/\/[a-f0-9]+/g, "[资源]")
    .replace(/@\S+/g, "@")
    .trim();
}

export function patternPhrase(value: string): string {
  let result = value;
  for (let index = 0; index < 3; index += 1) {
    result = result.replace(/\[[^\]]*\]/g, " ");
  }
  result = result
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/asset:\/\/\S+/g, " ")
    .replace(/@\S+/g, " ")
    .replace(/[#＃]\S+/g, " ")
    .replace(/正在检测[\s\S]*$/g, " ")
    .trim();
  if (result.length === 0) return "";
  result = result.replace(/[。！!？?，,～~]+$/g, "").trim();
  if (result.length === 0) return "";
  if (result.length <= 12) return result;
  const firstClause = result.split(/[，,。！!？?；;：:\n]/)[0]?.trim() ?? "";
  if (firstClause.length >= 2 && firstClause.length <= 12) return firstClause;
  return result.slice(0, 12);
}
