import type { Context } from "koishi";
import type { ChatMode } from "./types";
import type { Percept } from "@/services/horizon/types";

export abstract class BaseChatMode implements ChatMode {
    abstract name: string;
    abstract priority: number;
    constructor(protected ctx: Context) {}
    abstract match(percept: Percept): Promise<boolean> | boolean;
    abstract buildContext(percept: Percept): Promise<any>;
}
