import type { HorizonView, Percept, PerceptType } from "@/services/horizon/types";

export interface ChatMode {
    /** 模式名称 */
    name: string;

    /** 优先级（越小越先匹配，默认 50） */
    priority?: number;

    /** 支持的 Percept 类型（可选，用于快速过滤） */
    supportedTypes?: PerceptType[];

    /**
     * 判断当前输入是否匹配此模式
     */
    match: (percept: Percept) => Promise<boolean> | boolean;

    /**
     * 构建上下文
     */
    buildContext: (percept: Percept) => Promise<ModeResult>;
}

export interface ModeResult {
    /** 模板渲染的数据视图 */
    view: HorizonView;

    /** 使用的模板 */
    templates: {
        system: string;
        user: string;
    };

    /** 要激活的模板片段（可选） */
    partials?: string[];
}
