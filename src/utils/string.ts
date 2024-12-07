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

export function escapeUnicodeCharacters(str: string) {
  return str.replace(/[\u0080-\uffff]/g, function (ch) {
    return "\\u" + ("0000" + ch.charCodeAt(0).toString(16)).slice(-4);
  });
}

export function convertStringToNumber(value?: string | number): number {
  if (value == null || (typeof value === 'string' && value.trim() === '')) {
    return null;
  }
  const num = typeof value === 'number' ? value : Number(value);
  if (isNaN(num)) {
    throw new Error(`Invalid number value: ${value}`);
  }
  return num;
}

export function convertNumberToString(value?: number | string): string {
  if (value == null) {
    return '';
  }
  if (typeof value === 'string') {
    return value;
  }
  return value.toString();
}

export function isEmpty(str: string){
  return !str || String(str) == ""
}