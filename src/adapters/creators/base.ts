/**
 * Prompt 构建器基类
 */
export abstract class BasePromptCreator {
  /**
   * 动态渲染 Prompt 模板为目标 LLM 支持的格式
   */
  abstract render(): any;
}
