import fs from "fs";

export class FilePersistence {
  static saveToFile(filePath: string, data: any): void {
    try {
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    } catch (error) {
      console.error("存档失败:", error);
    }
  }

  static loadFromFile<T>(filePath: string): T | null {
    try {
      if (fs.existsSync(filePath)) {
        return JSON.parse(fs.readFileSync(filePath, "utf-8"));
      }
    } catch (error) {
      console.error("加载失败:", error);
    }
    return null;
  }
}
