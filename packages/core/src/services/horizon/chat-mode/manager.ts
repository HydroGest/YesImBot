import type { Context } from "koishi";
import type { Percept } from "../types";
import type { ChatMode, ModeResult } from "./types";

export class ChatModeManager {
    private modes: Map<string, ChatMode> = new Map();

    constructor(private ctx: Context) {

    }

    /** 注册聊天模式 */
    public register(mode: ChatMode): void {
        this.modes.set(mode.name, mode);
        this.ctx.logger("horizon/chat-mode").info(`已注册聊天模式：${mode.name}`);
    }

    /**
     * 解析并执行匹配的模式
     * @returns 第一个匹配成功的 Mode 的 buildContext 结果
     */
    resolve(percept: Percept): Promise<ModeResult> {
        const sortedModes = Array.from(this.modes.values()).sort((a, b) => (a.priority ?? 50) - (b.priority ?? 50));

        for (const mode of sortedModes) {
            if (mode.supportedTypes && !mode.supportedTypes.includes(percept.type)) {
                continue;
            }
            if (mode.match(percept)) {
                this.ctx.logger("horizon/chat-mode").info(`匹配到聊天模式：${mode.name}`);
                return mode.buildContext(percept);
            }
        }

        throw new Error("未找到匹配的聊天模式");
    }
}
