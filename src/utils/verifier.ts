import { runChatCompeletion, runEmbedding } from "./api-adapter";

export class ResponseVerifier {
  private previousResponse: string = "";
  private config: any;

  loadConfig(config: any) {
    this.config = config;
  }

  setPreviousResponse(response: string) {
    this.previousResponse = response;
  }

  async verifyResponse(currentResponse: string): Promise<boolean> {
    if (!this.config.Verifier.Enabled || !this.previousResponse) {
      return true; // Allow if verification is disabled or no previous response
    }

    try {
      if (this.config.Verifier.API.AIModel.includes("embedding")) {
        // 使用 embedding 模型验证相似度
        const previousEmbedding = await runEmbedding(
          this.config.Verifier.API.APIType,
          this.config.Verifier.API.BaseURL,
          this.config.Verifier.API.UID,
          this.config.Verifier.API.APIKey,
          this.config.Verifier.API.AIModel,
          this.previousResponse
        );

        const currentEmbedding = await runEmbedding(
          this.config.Verifier.API.APIType,
          this.config.Verifier.API.BaseURL,
          this.config.Verifier.API.UID,
          this.config.Verifier.API.APIKey,
          this.config.Verifier.API.AIModel,
          currentResponse
        );

        const similarityScore = this.calculateCosineSimilarity(
          previousEmbedding.response.data[0].embedding,
          currentEmbedding.response.data[0].embedding
        );

        return similarityScore <= this.config.Verifier.SimilarityThreshold;
      } else {
        const sysPrompt = `请分析以下两段文本的相似度，返回一个0到1之间的数字，精确到小数点后两位。
0表示完全不同，1表示完全相同。只返回数字，不要有任何其他文字。

判断标准：
1. 考虑语义相似度，而不仅仅是字面相似度
2. 考虑表达的核心意思是否相近
3. 如果两段文本表达了相同的情感或态度，认为相似度较高

接下来我将给你提供两个句子, 分别用 'A:' 和 'B:' 标识。`;
        const promptInput = `A: ${this.previousResponse}\nB: ${currentResponse}`;

        const response = await runChatCompeletion(
          this.config.Verifier.API.APIType,
          this.config.Verifier.API.BaseURL,
          this.config.Verifier.API.UID,
          this.config.Verifier.API.APIKey,
          this.config.Verifier.API.AIModel,
          sysPrompt,
          promptInput,
          this.config.Parameters
        );

        const similarityScore = this.extractSimilarityScore(response);
        return similarityScore <= this.config.Verifier.SimilarityThreshold;
      }
    } catch (error) {
      console.error("Verification failed:", error);
      return true;
    }
  }
  // 计算向量的余弦相似度
  private calculateCosineSimilarity(vec1: number[], vec2: number[]): number {
    const dotProduct = vec1.reduce((sum, val, i) => sum + val * vec2[i], 0);
    const magnitude1 = Math.sqrt(vec1.reduce((sum, val) => sum + val * val, 0));
    const magnitude2 = Math.sqrt(vec2.reduce((sum, val) => sum + val * val, 0));

    const cosineSimilarity = dotProduct / (magnitude1 * magnitude2);
    return (cosineSimilarity + 1) / 2; // Transform from [-1, 1] to [0, 1]
  }

  private extractSimilarityScore(response: any): number {
    let score: number;

    if (typeof response === "string") {
      const match = response.match(/\d+(\.\d+)?/);
      score = match ? parseFloat(match[0]) : 0;
    } else if (response.choices && response.choices[0]?.message?.content) {
      const match = response.choices[0].message.content.match(/\d+(\.\d+)?/);
      score = match ? parseFloat(match[0]) : 0;
    } else {
      score = 0;
    }

    return Math.min(Math.max(score, 0), 1); // Ensure score is between 0 and 1
  }
}
