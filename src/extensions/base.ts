import fs from "fs";

export abstract class Extension {
  abstract name: string;
  abstract description: string;
  abstract params: {
    [key: string]: any;
  };
  constructor() {
    return this.apply.bind(this);
  }

  abstract apply(...args: any[]): any;
}

export function getExtensions(): Extension[] {
  let extensions: Extension[] = [];

  fs.readdirSync(__dirname)
    .filter((file) => file.startsWith("ext_"))
    .forEach((file) => {
      try {
        const extension = require(`./${file}`);
        if (typeof extension?.default === "function") {
          extensions.push(extension.default);
        } else {
          // @ts-ignore
          extensions.push(...Object.values(extension));
        }
        logger.info(`Loaded extension: ${file}`);
      } catch (e) {
        logger.error(`Failed to load extension: ${file}`, e);
      }
    });
  return extensions;
}
