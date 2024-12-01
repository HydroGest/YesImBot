// 折叠文本中间部分
export function foldText(text: string, maxLength: number): string {
  if (text.length > maxLength) {
    const halfLength = Math.floor(maxLength / 2);
    const foldedChars = text.length - maxLength;
    return (
      text.slice(0, halfLength) +
      "\x1b[33m...[已折叠 " +
      "\x1b[33;1m" +
      foldedChars +
      "\x1b[0m\x1b[33m 个字符]...\x1b[0m" +
      text.slice(-halfLength)
    );
  }
  return text;
}
