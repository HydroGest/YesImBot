/**
 * @file 向量（数组）计算工具函数
 */

/**
 * 计算两个向量的点积（Dot Product）。
 * @param vecA - 向量 A。
 * @param vecB - 向量 B。
 * @returns 向量 A 和 B 的点积。
 * @throws 如果向量长度不一致，则抛出错误。
 */
export function dotProduct(vecA: number[], vecB: number[]): number {
    if (vecA.length !== vecB.length) {
        throw new Error("Vectors must have the same length for dot product.");
    }
    let product = 0;
    for (let i = 0; i < vecA.length; i++) {
        product += vecA[i] * vecB[i];
    }
    return product;
}

/**
 * 计算向量的模（Magnitude/L2 Norm）。
 * @param vec - 向量。
 * @returns 向量的模。
 */
export function magnitude(vec: number[]): number {
    let sumOfSquares = 0;
    for (const val of vec) {
        sumOfSquares += val * val;
    }
    return Math.sqrt(sumOfSquares);
}

/**
 * 计算两个向量之间的余弦相似度。
 * 返回值范围为 -1 到 1，值越接近 1 表示两个向量越相似。
 * @param vecA - 向量 A (number[]).
 * @param vecB - 向量 B (number[]).
 * @returns 两个向量的余弦相似度。
 * @throws 如果向量长度不一致，则抛出错误。
 */
export function cosineSimilarity(vecA: number[], vecB: number[]): number {
    if (vecA.length !== vecB.length) {
        // 抛出错误比静默返回 0 更好，因为这通常是调用错误。
        throw new Error("Vectors must have the same length for cosine similarity calculation.");
    }

    // 复用 dotProduct 和 magnitude 函数，代码更清晰
    const product = dotProduct(vecA, vecB);
    const normA = magnitude(vecA);
    const normB = magnitude(vecB);

    if (normA === 0 || normB === 0) {
        // 如果任一向量是零向量，则它们之间没有明确的角度，相似度定义为 0。
        return 0;
    }

    return product / (normA * normB);
}

/**
 * 计算两个向量的欧氏距离。
 * @param vecA - 向量 A。
 * @param vecB - 向量 B。
 * @returns 两个向量之间的欧氏距离。
 * @throws 如果向量长度不一致，则抛出错误。
 */
export function euclideanDistance(vecA: number[], vecB: number[]): number {
    if (vecA.length !== vecB.length) {
        throw new Error("Vectors must have the same length for Euclidean distance.");
    }
    let sumOfSquaredDifferences = 0;
    for (let i = 0; i < vecA.length; i++) {
        const diff = vecA[i] - vecB[i];
        sumOfSquaredDifferences += diff * diff;
    }
    return Math.sqrt(sumOfSquaredDifferences);
}

/**
 * 向量加法。
 * @param vecA - 向量 A。
 * @param vecB - 向量 B。
 * @returns 两个向量相加得到的新向量。
 * @throws 如果向量长度不一致，则抛出错误。
 */
export function add(vecA: number[], vecB: number[]): number[] {
    if (vecA.length !== vecB.length) {
        throw new Error("Vectors must have the same length for addition.");
    }
    return vecA.map((val, i) => val + vecB[i]);
}

/**
 * 向量减法。
 * @param vecA - 向量 A。
 * @param vecB - 向量 B。
 * @returns 向量 A 减去向量 B 得到的新向量。
 * @throws 如果向量长度不一致，则抛出错误。
 */
export function subtract(vecA: number[], vecB: number[]): number[] {
    if (vecA.length !== vecB.length) {
        throw new Error("Vectors must have the same length for subtraction.");
    }
    return vecA.map((val, i) => val - vecB[i]);
}
