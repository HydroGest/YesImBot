// 折叠文本中间部分
export function foldText(text: string, maxLength: number): string {
  if (!text) return "";
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

export function isEmpty(str: string) {
  return !str || String(str) == ""
}

/**
 * 模板引擎
 *
 * 和 JS 模板字符串差不多
 */
export class Template {
  constructor(
    private templateString: string,
    private regex: RegExp = /\$\{(\w+(?:\.\w+)*)\}/g,
    private conditionRegex: RegExp = /\$\{(\w+),([^,]*),([^}]*)\}/g
  ) { }

  private getValue(data: any, keys: string[]) {
    let value = data;
    for (let key of keys) {
      if (value && typeof value === 'object') {
        value = value[key];
      } else {
        return '';
      }
    }
    return value || '';
  };

  render(model: any) {
    let result = this.templateString.replace(this.regex, (match, key) => {
      return this.getValue(model, key.split('.'));
    });

    return result.replace(this.conditionRegex, (match, condition, trueValue, falseValue) => {
      const conditionValue = this.getValue(model, condition.split('.'));
      return conditionValue ? trueValue : falseValue;
    });
  }

  unrender(source: string): Record<string, string> {
    const result: Record<string, string> = {};
    let template = this.templateString;
    let processedSource = source;

    template = template.replace(this.conditionRegex, (match, condition, trueValue, falseValue) => {
      const generalizedTrueValue = trueValue.replace(/\{\{.*?\}\}/g, '.*?');
      const pattern = new RegExp(generalizedTrueValue);

      if (pattern.test(processedSource)) {
        result[condition] = 'true';
        return trueValue;
      } else {
        result[condition] = 'false';
        return falseValue || '';
      }
    });

    const parts = template.split(/\{\{|\}\}/);
    for (let i = 1; i < parts.length; i += 2) {
      const key = parts[i];
      if (!key.includes(',')) {
        const prevPart = escapeRegExp(parts[i - 1]);
        const nextPart = parts[i + 1] ? escapeRegExp(parts[i + 1]) : '';

        let pattern;
        if (i === parts.length - 2) {
          pattern = new RegExp(`${prevPart}(.*?)$`);
        } else {
          pattern = new RegExp(`${prevPart}(.*?)${nextPart}`);
        }

        const match = source.match(pattern);
        if (match) {
          result[key] = match[1].trim();
        }
      }
    }

    return result;
  }
}

export function parseJSON(text: string) {
  const match = text.match(/{.*}/s);
  if (match) {
    try {
      return JSON.parse(match[0]);
    } catch (e) {
      return null;
    }
  }
}

export function formatSize(size: number): string {
  const units = ['B', 'KB', 'MB', 'GB'];
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index++;
  }
  return `${size.toFixed(2)}${units[index]}`;
}

function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function randomString(length: number): string {
  let result = '';
  const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const charactersLength = characters.length;
  for (let i = 0; i < length; i++) {
    result += characters.charAt(Math.floor(Math.random() * charactersLength));
  }
  return result;
}
