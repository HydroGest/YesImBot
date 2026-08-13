import Mustache from "mustache";

/**
 * 渲染器接口的渲染选项
 */
export interface RenderOptions {
    /**
     * 最大渲染深度，用于防止无限循环
     */
    maxDepth?: number;
}

/**
 * 模板解析结果
 */
export interface ParseResult {
    /**
     * 模板中使用的变量名集合
     */
    variables: Set<string>;
    /**
     * 模板中引用的子模板名称集合
     */
    partials: Set<string>;
}

/**
 * 渲染器接口
 * 定义了将模板和作用域结合生成最终字符串的标准方法
 */
export interface IRenderer {
    /**
     * 解析模板，提取变量和子模板引用
     * @param templateContent - 模板字符串
     * @returns 解析结果
     */
    parse: (templateContent: string) => ParseResult;

    /**
     * 渲染模板
     * @param templateContent - 模板字符串
     * @param scope - 包含所有动态数据的上下文对象
     * @param partials - 用于模板引用的可重用模板片段 (例如 {{> myPartial}})
     * @param options - 渲染选项，如最大深度
     * @returns 渲染后的字符串
     */
    render: (templateContent: string, scope: Record<string, any>, partials?: Record<string, string>, options?: RenderOptions) => string;
}

/**
 * 基于 Mustache.js 的默认渲染器实现
 * 支持二次渲染和循环保护
 */
export class MustacheRenderer implements IRenderer {
    public parse(templateContent: string): ParseResult {
        const tokens = Mustache.parse(templateContent);
        const variables = new Set<string>();
        const partials = new Set<string>();

        const traverse = (tokens: any[]) => {
            for (const token of tokens) {
                const type = token[0];
                const value = token[1];

                // 'name' (variable), '#' (section), '^' (inverted section), '&' (unescaped)
                if (type === "name" || type === "#" || type === "^" || type === "&") {
                    variables.add(value);
                } else if (type === ">") {
                    partials.add(value);
                }

                // token[4] contains sub-tokens for sections
                if (token[4]) {
                    traverse(token[4]);
                }
            }
        };

        traverse(tokens as any[]);
        return { variables, partials };
    }

    public render(templateContent: string, scope: Record<string, any>, partials?: Record<string, string>, options?: RenderOptions): string {
        const maxDepth = options?.maxDepth ?? 3;
        let output = templateContent;
        let previousOutput = "";
        let currentDepth = 0;

        // 循环渲染，直到输出不再变化或达到最大深度
        while (output !== previousOutput && currentDepth < maxDepth) {
            previousOutput = output;
            output = Mustache.render(previousOutput, scope, partials, { escape: (text) => text });
            currentDepth++;
        }

        // 如果达到最大深度后模板中仍有占位符，可能存在循环或深度不足，可以添加日志警告
        if (currentDepth >= maxDepth && output.includes("{{")) {
            // console.warn(`[PromptRenderer] Reached max render depth of ${maxDepth}. Output may still contain placeholders.`);
        }

        return output;
    }
}
